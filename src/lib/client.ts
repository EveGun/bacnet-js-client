import {
	BACnetClientEvents,
	BACnetEventsMap,
	TypedEventEmitter,
} from './EventTypes'
import debugLib from 'debug'

import Transport from './transport'
import ServicesMap, {
	AddListElement,
	AlarmAcknowledge,
	AlarmSummary,
	AtomicReadFile,
	AtomicWriteFile,
	CovNotify,
	CreateObject,
	DeleteObject,
	DeviceCommunicationControl,
	EventInformation,
	GetEventInformation,
	EventNotifyData,
	GetEnrollmentSummary,
	IAm,
	IHave,
	PrivateTransfer,
	ReadProperty,
	ReadPropertyMultiple,
	ReadRange,
	RegisterForeignDevice,
	ReinitializeDevice,
	SubscribeCov,
	SubscribeProperty,
	TimeSync,
	WhoIs,
	WriteProperty,
	WritePropertyMultiple,
	ErrorService,
} from './services'
import * as baAsn1 from './asn1'
import * as baApdu from './apdu'
import * as baNpdu from './npdu'
import * as baBvlc from './bvlc'

import {
	BACNetAddress,
	BACNetObjectID,
	BACNetPropertyID,
	BACNetAppData,
	BACNetWritePropertyValues,
	BACNetTimestamp,
	TransportSettings,
	ClientOptions,
	WhoIsOptions,
	ServiceOptions,
	ReadPropertyOptions,
	WritePropertyOptions,
	WriteFileOptions,
	ErrorCallback,
	DataCallback,
	DecodeAcknowledgeSingleResult,
	DecodeAcknowledgeMultipleResult,
	BACNetReadAccessSpecification,
	DeviceCommunicationOptions,
	ReinitializeDeviceOptions,
	EncodeBuffer,
	BACnetMessage,
	BACnetMessageBase,
	BACnetMessageHeader,
	BACnetError,
	BACNetEventInformation,
	BACNetReadAccess,
	BACNetAlarm,
	BACNetBitString,
	Abort,
	SimpleAck,
	SegmentAck,
	UnconfirmedServiceRequest,
	ConfirmedServiceRequest,
	ServiceMessage,
	SegmentableMessage,
	ConfirmedServiceRequestMessage,
	ComplexAck,
	ComplexAckMessage,
	HasInvokeId,
	SegmentAckMessage,
	PropertyReference,
	TypedValue,
	BacnetService,
	WritePropertyMultipleObject,
	DecodeAtomicWriteFileResult,
	DecodeAtomicReadFileResult,
	ReadRangeAcknowledge,
	ReadRangeOptions,
	EnrollmentOptions,
	EnrollmentSummaryAcknowledge,
	EventNotifyDataParams,
	NetworkOpResult,
	SegmentedRequestOptions,
	AcknowledgeAlarmOptions,
} from './types'
import {
	ApduTooLargeError,
	InvalidSegmentedRequestError,
	InvokeIdInUseError,
	SegmentCountExceededError,
	SegmentAckTimeoutError,
} from './errors'
import { format } from 'util'
import {
	UnconfirmedServiceChoice,
	ConfirmedServiceChoice,
	NpduControlPriority,
	NetworkLayerMessageType,
	PduType,
	PduSegAckBit,
	BvlcResultPurpose,
	PduConReqBit,
	PDU_TYPE_MASK,
	ErrorClass,
	ErrorCode,
	BvlcResultFormat,
	NpduControlBit,
	MaxSegmentsAccepted,
	MaxApduLengthAccepted,
	AbortReason,
	ASN1_ARRAY_ALL,
	ASN1_NO_PRIORITY,
	PropertyIdentifier,
	ReadRangeType,
	DEFAULT_BACNET_PORT,
} from './enum'
import { RequestManager } from './request-manager'
import {
	getPeerKey,
	getTransactionKey,
	normalizeAddress,
} from './transaction-key'

import { Buffer } from 'buffer'
const debug = debugLib('bacnet:client:debug')
const trace = debugLib('bacnet:client:trace')

const ALL_INTERFACES = '0.0.0.0'
const LOCALHOST_INTERFACES_IPV4 = '127.0.0.1'
const BROADCAST_ADDRESS = '255.255.255.255'
const DEFAULT_HOP_COUNT = 0xff
const BVLC_HEADER_LENGTH = 4
const BVLC_FWD_HEADER_LENGTH = 10 // FORWARDED_NPDU

// ASHRAE 135 - 20.1.2: fixed part of a BACnet-Confirmed-Request-PDU is
// 4 octets unsegmented and 6 octets segmented (adds sequence-number and
// proposed-window-size). The max-apdu-length-accepted limit applies to the
// APDU alone; BVLC and NPDU octets are not counted against it.
const CONFIRMED_REQUEST_HEADER_LENGTH = 4
const SEGMENTED_CONFIRMED_REQUEST_HEADER_LENGTH = 6
// ASHRAE 135 - 20.1.6.5: window sizes are in the range 1..127
const MIN_SEGMENT_WINDOW_SIZE = 1
const MAX_SEGMENT_WINDOW_SIZE = 127
const DEFAULT_SEGMENT_MAX_RETRIES = 3
// Scratch buffer for encoding a segmented service payload before splitting.
const OUTGOING_SEGMENT_PAYLOAD_BUFFER_LENGTH = 1 << 20
// Upper bound on remembered per-peer invokeId counters. Counters for the
// least recently used peers without pending requests are evicted beyond
// this, so long-lived clients scanning many transient peers do not grow
// without bound. Losing a counter is harmless: allocation restarts at 0
// and pending invokeIds are tracked separately in _activeInvokeIds.
const MAX_INVOKE_COUNTER_PEERS = 1024

interface SegmentAssemblyState {
	lastSequenceNumber: number | null
	segments: Buffer[]
	/** Segments received since the last SegmentACK we sent */
	segmentsSinceAck: number
	/** Inactivity timer that discards an incomplete assembly */
	timer: NodeJS.Timeout | null
}

interface OutgoingSegmentTransaction {
	key: string
	receiver: BACNetAddress
	service: ConfirmedServiceChoice
	invokeId: number
	/** Local advertisement for the response, unchanged by segmentation */
	maxSegments: number
	maxApdu: number
	/** PDU type octet without segmentation bits */
	baseType: number
	payload: Buffer
	segmentCapacity: number
	totalSegments: number
	proposedWindowSize: number
	/** Window size granted by the remote device (starts at 1 until the
	 * first SegmentACK is received, per ASHRAE 135 - 5.4.4.2) */
	actualWindowSize: number
	/** Absolute index of the first unacknowledged segment. Absolute
	 * indices are not truncated to one octet; the on-wire sequence number
	 * is `index & 0xff`, which yields wrap-around at 255 -> 0. */
	initialSequenceAbs: number
	retryCount: number
	maxRetries: number
	segmentAckTimeout: number
	timer: NodeJS.Timeout | null
	done: boolean
	/** Set once the window containing the final segment has been sent and
	 * the final service response has been registered with the request
	 * manager */
	responseRegistered: boolean
	responsePromise: Promise<NetworkOpResult> | null
	resolveTransfer: () => void
	rejectTransfer: (err: Error) => void
	transferPromise: Promise<void>
}

const beU = UnconfirmedServiceChoice
const unconfirmedServiceMap: BACnetEventsMap = {
	[beU.I_AM]: 'iAm',
	[beU.WHO_IS]: 'whoIs',
	[beU.WHO_HAS]: 'whoHas',
	[beU.UNCONFIRMED_COV_NOTIFICATION]: 'covNotifyUnconfirmed',
	[beU.TIME_SYNCHRONIZATION]: 'timeSync',
	[beU.UTC_TIME_SYNCHRONIZATION]: 'timeSyncUTC',
	[beU.UNCONFIRMED_EVENT_NOTIFICATION]: 'eventNotify',
	[beU.I_HAVE]: 'iHave',
	[beU.UNCONFIRMED_PRIVATE_TRANSFER]: 'privateTransfer',
}
const beC = ConfirmedServiceChoice
const confirmedServiceMap: BACnetEventsMap = {
	[beC.READ_PROPERTY]: 'readProperty',
	[beC.WRITE_PROPERTY]: 'writeProperty',
	[beC.READ_PROPERTY_MULTIPLE]: 'readPropertyMultiple',
	[beC.WRITE_PROPERTY_MULTIPLE]: 'writePropertyMultiple',
	[beC.CONFIRMED_COV_NOTIFICATION]: 'covNotify',
	[beC.ATOMIC_WRITE_FILE]: 'atomicWriteFile',
	[beC.ATOMIC_READ_FILE]: 'atomicReadFile',
	[beC.SUBSCRIBE_COV]: 'subscribeCov',
	[beC.SUBSCRIBE_COV_PROPERTY]: 'subscribeProperty',
	[beC.DEVICE_COMMUNICATION_CONTROL]: 'deviceCommunicationControl',
	[beC.REINITIALIZE_DEVICE]: 'reinitializeDevice',
	[beC.CONFIRMED_EVENT_NOTIFICATION]: 'eventNotify',
	[beC.READ_RANGE]: 'readRange',
	[beC.CREATE_OBJECT]: 'createObject',
	[beC.DELETE_OBJECT]: 'deleteObject',
	[beC.ACKNOWLEDGE_ALARM]: 'alarmAcknowledge',
	[beC.GET_ALARM_SUMMARY]: 'getAlarmSummary',
	[beC.GET_ENROLLMENT_SUMMARY]: 'getEnrollmentSummary',
	[beC.GET_EVENT_INFORMATION]: 'getEventInformation',
	[beC.LIFE_SAFETY_OPERATION]: 'lifeSafetyOperation',
	[beC.ADD_LIST_ELEMENT]: 'addListElement',
	[beC.REMOVE_LIST_ELEMENT]: 'removeListElement',
	[beC.CONFIRMED_PRIVATE_TRANSFER]: 'privateTransfer',
}

/**
 * To be able to communicate to BACNET devices, you have to initialize a new bacnet instance.
 * @class BACnetClient
 * @example
 * import BACnetClient from "@bacnet-js/client";
 *
 * const client = new BACnetClient({
 *   port: 47809,
 *   interface: '192.168.251.10',          // Listen on a specific interface
 *   broadcastAddress: '192.168.251.255',  // Use the subnet broadcast address
 *   apduTimeout: 6000                     // Wait twice as long for response
 * });
 */
export default class BACnetClient extends TypedEventEmitter<BACnetClientEvents> {
	private _settings: ClientOptions

	private _transport: Transport

	private _pendingForeignDeviceRegistrations?: Map<
		string,
		{
			ttl: number
			promise: Promise<void>
			reject: (err: Error) => void
		}
	>

	private _activeForeignDeviceRegistrations?: Map<
		string,
		{
			ttl: number
			expiresAt: number
			expiringTimer: NodeJS.Timeout
			expiryTimer: NodeJS.Timeout
		}
	>

	/** Rolling invokeId counter per peer, keyed by peer key */
	private _invokeCounters?: Map<string, number>

	/** InvokeIds reserved by pending confirmed requests, keyed by peer key */
	private _activeInvokeIds?: Map<string, Set<number>>

	private _requestManager: RequestManager

	/** Advertised max-segments of pending requests, keyed by transaction key */
	private _pendingRequestMaxSegments?: Map<string, number>

	private _segmentAssemblyStates?: Map<string, SegmentAssemblyState>

	private _outgoingSegmentTransactions?: Map<
		string,
		OutgoingSegmentTransaction
	>

	private _isClosed = false

	constructor(options?: ClientOptions) {
		super()

		options = options || {}

		this._settings = {
			port: options.port || DEFAULT_BACNET_PORT,
			interface: options.interface || ALL_INTERFACES, // Usa la costante
			transport: options.transport,
			broadcastAddress: options.broadcastAddress || BROADCAST_ADDRESS, // Usa la costante
			apduTimeout: options.apduTimeout || 3000,
			abortOnSegmentedResponseWhenNoSegAccepted:
				options.abortOnSegmentedResponseWhenNoSegAccepted || false,
			requireActiveFdrForForwardedNpdu:
				options.requireActiveFdrForForwardedNpdu || false,
		}

		this._requestManager = new RequestManager(this._settings.apduTimeout)

		options.reuseAddr =
			options.reuseAddr === undefined ? true : !!options.reuseAddr

		this._transport =
			this._settings.transport ||
			new Transport({
				port: this._settings.port,
				interface: this._settings.interface,
				broadcastAddress: this._settings.broadcastAddress,
				reuseAddr: options.reuseAddr,
			} as TransportSettings)

		// Setup code
		this._transport.on('message', this._receiveData.bind(this))
		this._transport.on('error', this._receiveError.bind(this))
		this._transport.on('listening', () => this.emit('listening'))
		this._transport.open()
	}

	private _send(buffer: EncodeBuffer, receiver?: BACNetAddress) {
		this._transport.send(buffer.buffer, buffer.offset, receiver?.address)
	}

	private _getInvokeCounters() {
		if (!this._invokeCounters) {
			this._invokeCounters = new Map()
		}
		return this._invokeCounters
	}

	private _getActiveInvokeIds() {
		if (!this._activeInvokeIds) {
			this._activeInvokeIds = new Map()
		}
		return this._activeInvokeIds
	}

	/**
	 * Allocates the next free invokeId for the given peer. ASHRAE 135 -
	 * 5.4.4: the invokeId identifies a transaction only in combination with
	 * the peer address, so each peer has its own rolling counter and the
	 * same invokeId may be in flight to different peers concurrently.
	 * InvokeIds still pending toward this peer are skipped; with all 256
	 * ids pending the request is refused rather than queued.
	 */
	private _getInvokeId(receiver?: BACNetAddress) {
		const peerKey = getPeerKey(receiver)
		const counters = this._getInvokeCounters()
		const active = this._activeInvokeIds?.get(peerKey)
		const start = counters.get(peerKey) ?? 0
		for (let i = 0; i < 256; i++) {
			const id = (start + i) & 0xff
			if (!active?.has(id)) {
				// Delete-before-set keeps Map insertion order as LRU order
				counters.delete(peerKey)
				counters.set(peerKey, (id + 1) & 0xff)
				this._evictStaleInvokeCounters(counters)
				return id
			}
		}
		throw new Error('ERR_MAX_CONCURRENT_REQUESTS')
	}

	/** Evicts least recently used counters of peers without pending
	 * requests once the map exceeds MAX_INVOKE_COUNTER_PEERS. */
	private _evictStaleInvokeCounters(counters: Map<string, number>): void {
		if (counters.size <= MAX_INVOKE_COUNTER_PEERS) {
			return
		}
		for (const staleKey of counters.keys()) {
			if (counters.size <= MAX_INVOKE_COUNTER_PEERS) {
				break
			}
			if (!this._activeInvokeIds?.has(staleKey)) {
				counters.delete(staleKey)
			}
		}
	}

	/**
	 * Reserves an invokeId toward one peer for the lifetime of a confirmed
	 * request, refusing reuse while a request with the same invokeId is
	 * still pending toward that peer.
	 */
	private _acquireInvokeId(
		peerKey: string,
		invokeId: number,
		service: ConfirmedServiceChoice,
	): void {
		const activeIds = this._getActiveInvokeIds()
		let active = activeIds.get(peerKey)
		if (!active) {
			active = new Set()
			activeIds.set(peerKey, active)
		}
		if (active.has(invokeId)) {
			throw new InvokeIdInUseError({ peer: peerKey, invokeId, service })
		}
		active.add(invokeId)
	}

	private _releaseInvokeId(peerKey: string, invokeId: number): void {
		const active = this._activeInvokeIds?.get(peerKey)
		if (!active) return
		active.delete(invokeId)
		if (active.size === 0) {
			this._activeInvokeIds.delete(peerKey)
		}
	}

	/**
	 * Candidate transaction keys for correlating a response: the exact peer
	 * key, then the unknown-peer key so confirmed requests that were
	 * broadcast without a receiver address still correlate on invokeId
	 * alone. Deliberately no partial fallback (such as stripping net/adr):
	 * a reply from one device behind a router must never resolve a pending
	 * request addressed to a different peer sharing the same link address.
	 * A compliant reply carries SADR exactly when the request carried DADR,
	 * so the exact key always matches legitimate traffic. This also keeps
	 * response correlation consistent with the segment-transaction lookup,
	 * which is exact-key only.
	 */
	private _responseKeyCandidates(
		header: BACnetMessageHeader | undefined,
		invokeId: number,
	): string[] {
		const keys = [getTransactionKey(header?.sender, invokeId)]
		const unknownKey = getTransactionKey(undefined, invokeId)
		if (!keys.includes(unknownKey)) keys.push(unknownKey)
		return keys
	}

	/**
	 * Resolves the pending request identified by the responding peer and
	 * invokeId, trying `_responseKeyCandidates()` most specific first.
	 */
	private _resolvePendingRequest(
		header: BACnetMessageHeader | undefined,
		invokeId: number,
		err: Error | null,
		result?: NetworkOpResult,
	): boolean {
		for (const candidate of this._responseKeyCandidates(header, invokeId)) {
			const resolved = err
				? this._requestManager.resolve(candidate, err)
				: this._requestManager.resolve(candidate, null, result)
			if (resolved) return true
		}
		return false
	}

	/**
	 * Looks up the max-segments value advertised by the pending request the
	 * given response belongs to, with the same key fallbacks as
	 * `_resolvePendingRequest()`.
	 */
	private _getPendingMaxSegments(
		header: BACnetMessageHeader | undefined,
		invokeId: number,
	): number | undefined {
		const pending = this._pendingRequestMaxSegments
		if (!pending?.size) return undefined
		for (const candidate of this._responseKeyCandidates(header, invokeId)) {
			const maxSegments = pending.get(candidate)
			if (maxSegments !== undefined) return maxSegments
		}
		return undefined
	}

	private _getApduBuffer(address?: BACNetAddress): EncodeBuffer {
		const isForwarded: boolean = !!address?.forwardedFrom
		return {
			buffer: Buffer.alloc(this._transport.getMaxPayload()),
			offset: isForwarded ? BVLC_FWD_HEADER_LENGTH : BVLC_HEADER_LENGTH,
		}
	}

	private _normalizeAddress(
		address?: string,
		strictPort = false,
	): string | null {
		return normalizeAddress(address, strictPort)
	}

	private _getPendingForeignDeviceRegistrations() {
		if (!this._pendingForeignDeviceRegistrations) {
			this._pendingForeignDeviceRegistrations = new Map()
		}
		return this._pendingForeignDeviceRegistrations
	}

	private _getPendingRequestMaxSegments() {
		if (!this._pendingRequestMaxSegments) {
			this._pendingRequestMaxSegments = new Map()
		}
		return this._pendingRequestMaxSegments
	}

	private _getSegmentAssemblyStates() {
		if (!this._segmentAssemblyStates) {
			this._segmentAssemblyStates = new Map()
		}
		return this._segmentAssemblyStates
	}

	private _getSegmentAssemblyKey(
		msg: SegmentableMessage,
		server: boolean,
	): string {
		return `${server ? 'srv' : 'cli'}|${getTransactionKey(
			msg.header?.sender,
			msg.invokeId,
		)}`
	}

	private _getOutgoingSegmentTransactions() {
		if (!this._outgoingSegmentTransactions) {
			this._outgoingSegmentTransactions = new Map()
		}
		return this._outgoingSegmentTransactions
	}

	/**
	 * Sends a confirmed service request using the caller-selected transport
	 * strategy: unsegmented by default, segmented only when the caller
	 * explicitly enabled it. Service-specific payload encoding stays in the
	 * calling method; this method owns packet construction, size
	 * validation, the segment state machine and awaiting the response.
	 */
	private async _sendConfirmedRequest(args: {
		receiver: BACNetAddress
		service: ConfirmedServiceChoice
		maxSegments: number
		maxApdu: number
		invokeId: number
		acceptSegmentedResponse?: boolean
		segmentedRequest?: SegmentedRequestOptions
		encodePayload: (buffer: EncodeBuffer) => void
	}): Promise<NetworkOpResult> {
		// Reserve the invokeId toward this peer for the lifetime of the
		// request so it cannot be reused while still pending, while the
		// same invokeId stays available toward other peers.
		const peerKey = getPeerKey(args.receiver)
		this._acquireInvokeId(peerKey, args.invokeId, args.service)
		try {
			return await this._dispatchConfirmedRequest(args)
		} finally {
			this._releaseInvokeId(peerKey, args.invokeId)
		}
	}

	private async _dispatchConfirmedRequest(args: {
		receiver: BACNetAddress
		service: ConfirmedServiceChoice
		maxSegments: number
		maxApdu: number
		invokeId: number
		acceptSegmentedResponse?: boolean
		segmentedRequest?: SegmentedRequestOptions
		encodePayload: (buffer: EncodeBuffer) => void
	}): Promise<NetworkOpResult> {
		const baseType =
			PduType.CONFIRMED_REQUEST |
			(args.acceptSegmentedResponse &&
			args.maxSegments !== MaxSegmentsAccepted.SEGMENTS_0
				? PduConReqBit.SEGMENTED_RESPONSE_ACCEPTED
				: 0)

		if (args.segmentedRequest?.enabled) {
			return this._sendSegmentedConfirmedRequest(args, baseType)
		}

		const buffer = this._getApduBuffer(args.receiver)
		baNpdu.encode(
			buffer,
			NpduControlPriority.NORMAL_MESSAGE | NpduControlBit.EXPECTING_REPLY,
			args.receiver,
			null,
			DEFAULT_HOP_COUNT,
			NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK,
			0,
		)
		const apduStart = buffer.offset
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baseType,
			args.service,
			args.maxSegments,
			args.maxApdu,
			args.invokeId,
			0,
			0,
		)

		const remoteLimit = args.segmentedRequest?.remoteMaxApduLength
		if (args.segmentedRequest) {
			// When segmentation options are supplied (even with segmented
			// mode disabled) the payload is encoded into a scratch buffer
			// first, so the exact APDU length is known even when it
			// exceeds the transport buffer and validation happens before
			// anything touches the wire.
			const payload: EncodeBuffer = {
				buffer: Buffer.alloc(OUTGOING_SEGMENT_PAYLOAD_BUFFER_LENGTH),
				offset: 0,
			}
			args.encodePayload(payload)
			const apduLength = CONFIRMED_REQUEST_HEADER_LENGTH + payload.offset
			if (remoteLimit !== undefined && apduLength > remoteLimit) {
				throw new ApduTooLargeError({
					encodedLength: apduLength,
					maximumLength: remoteLimit,
					service: args.service,
					invokeId: args.invokeId,
					segmentationAvailable: true,
				})
			}
			if (buffer.offset + payload.offset > buffer.buffer.length) {
				throw new ApduTooLargeError({
					encodedLength: apduLength,
					maximumLength: buffer.buffer.length - apduStart,
					service: args.service,
					invokeId: args.invokeId,
					segmentationAvailable: true,
				})
			}
			payload.buffer.copy(buffer.buffer, buffer.offset, 0, payload.offset)
			buffer.offset += payload.offset
		} else {
			// Without segmentation options we preserve the previous
			// behavior, except that a request physically overflowing the
			// transport buffer is rejected instead of being sent truncated
			// (some encoders write silently past the end, others throw a
			// RangeError from Buffer bounds checks).
			try {
				args.encodePayload(buffer)
			} catch (error) {
				if (error instanceof RangeError) {
					throw new ApduTooLargeError({
						encodedLength: buffer.offset - apduStart,
						maximumLength: buffer.buffer.length - apduStart,
						service: args.service,
						invokeId: args.invokeId,
						segmentationAvailable: true,
					})
				}
				throw error
			}
			if (buffer.offset > buffer.buffer.length) {
				throw new ApduTooLargeError({
					encodedLength: buffer.offset - apduStart,
					maximumLength: buffer.buffer.length - apduStart,
					service: args.service,
					invokeId: args.invokeId,
					segmentationAvailable: true,
				})
			}
		}
		this.sendBvlc(args.receiver, buffer)
		return this._awaitResponse(
			args.receiver,
			args.invokeId,
			args.maxSegments,
		)
	}

	private async _sendSegmentedConfirmedRequest(
		args: {
			receiver: BACNetAddress
			service: ConfirmedServiceChoice
			maxSegments: number
			maxApdu: number
			invokeId: number
			segmentedRequest?: SegmentedRequestOptions
			encodePayload: (buffer: EncodeBuffer) => void
		},
		baseType: number,
	): Promise<NetworkOpResult> {
		const seg = args.segmentedRequest
		const remoteMax = seg.remoteMaxApduLength
		if (
			!Number.isInteger(remoteMax) ||
			remoteMax < SEGMENTED_CONFIRMED_REQUEST_HEADER_LENGTH + 1
		) {
			throw new InvalidSegmentedRequestError({
				option: 'remoteMaxApduLength',
				value: remoteMax,
				reason: `must be an integer of at least ${
					SEGMENTED_CONFIRMED_REQUEST_HEADER_LENGTH + 1
				} octets to fit a segmented request APDU with at least one payload octet`,
				service: args.service,
				invokeId: args.invokeId,
			})
		}
		const proposedWindowSize =
			seg.proposedWindowSize ?? MIN_SEGMENT_WINDOW_SIZE
		if (
			!Number.isInteger(proposedWindowSize) ||
			proposedWindowSize < MIN_SEGMENT_WINDOW_SIZE ||
			proposedWindowSize > MAX_SEGMENT_WINDOW_SIZE
		) {
			throw new InvalidSegmentedRequestError({
				option: 'proposedWindowSize',
				value: seg.proposedWindowSize,
				reason: `must be an integer in the range ${MIN_SEGMENT_WINDOW_SIZE}..${MAX_SEGMENT_WINDOW_SIZE}`,
				service: args.service,
				invokeId: args.invokeId,
			})
		}
		const maxRetries = seg.maxRetries ?? DEFAULT_SEGMENT_MAX_RETRIES
		if (!Number.isInteger(maxRetries) || maxRetries < 0) {
			throw new InvalidSegmentedRequestError({
				option: 'maxRetries',
				value: seg.maxRetries,
				reason: 'must be a non-negative integer',
				service: args.service,
				invokeId: args.invokeId,
			})
		}
		const segmentAckTimeout =
			seg.segmentAckTimeout ?? this._settings.apduTimeout
		if (!Number.isInteger(segmentAckTimeout) || segmentAckTimeout <= 0) {
			throw new InvalidSegmentedRequestError({
				option: 'segmentAckTimeout',
				value: seg.segmentAckTimeout,
				reason: 'must be a positive integer of milliseconds',
				service: args.service,
				invokeId: args.invokeId,
			})
		}
		if (
			seg.remoteMaxSegmentsAccepted !== undefined &&
			(!Number.isInteger(seg.remoteMaxSegmentsAccepted) ||
				seg.remoteMaxSegmentsAccepted < 1)
		) {
			throw new InvalidSegmentedRequestError({
				option: 'remoteMaxSegmentsAccepted',
				value: seg.remoteMaxSegmentsAccepted,
				reason: 'must be a positive integer',
				service: args.service,
				invokeId: args.invokeId,
			})
		}

		// Encode the service payload separately from BVLC/NPDU/APDU headers
		// so it can be split across segments.
		const payload: EncodeBuffer = {
			buffer: Buffer.alloc(OUTGOING_SEGMENT_PAYLOAD_BUFFER_LENGTH),
			offset: 0,
		}
		args.encodePayload(payload)
		if (payload.offset > payload.buffer.length) {
			throw new ApduTooLargeError({
				encodedLength: payload.offset,
				maximumLength: payload.buffer.length,
				service: args.service,
				invokeId: args.invokeId,
				segmentationAvailable: false,
			})
		}

		// The remote APDU limit excludes NPDU and BVLC octets, but the
		// local transport buffer does not, so each segment APDU is capped
		// by both. Measure the NPDU length with a dry-run encode (it is
		// identical for every segment to this receiver).
		const npduProbe: EncodeBuffer = {
			buffer: Buffer.alloc(64),
			offset: 0,
		}
		baNpdu.encode(
			npduProbe,
			NpduControlPriority.NORMAL_MESSAGE | NpduControlBit.EXPECTING_REPLY,
			args.receiver,
			null,
			DEFAULT_HOP_COUNT,
			NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK,
			0,
		)
		const bvlcLength = args.receiver?.forwardedFrom
			? BVLC_FWD_HEADER_LENGTH
			: BVLC_HEADER_LENGTH
		const transportApduSpace =
			this._transport.getMaxPayload() - bvlcLength - npduProbe.offset
		const segmentApduLimit = Math.min(remoteMax, transportApduSpace)
		const segmentCapacity =
			segmentApduLimit - SEGMENTED_CONFIRMED_REQUEST_HEADER_LENGTH
		if (segmentCapacity < 1) {
			throw new InvalidSegmentedRequestError({
				option: 'remoteMaxApduLength',
				value: remoteMax,
				reason: 'leaves no room for segment payload octets',
				service: args.service,
				invokeId: args.invokeId,
			})
		}

		const totalSegments = Math.max(
			1,
			Math.ceil(payload.offset / segmentCapacity),
		)
		if (
			seg.remoteMaxSegmentsAccepted !== undefined &&
			totalSegments > seg.remoteMaxSegmentsAccepted
		) {
			throw new SegmentCountExceededError({
				requiredSegments: totalSegments,
				maximumSegments: seg.remoteMaxSegmentsAccepted,
				service: args.service,
				invokeId: args.invokeId,
			})
		}

		const payloadView = payload.buffer.subarray(0, payload.offset)
		if (totalSegments === 1) {
			// ASHRAE 135 - 20.1.2.4: the SEG bit marks a PDU that is one
			// segment of a segmented message. A request that fits in a
			// single segment is transmitted unsegmented, still honouring
			// the validated remote APDU limit.
			const buffer = this._getApduBuffer(args.receiver)
			baNpdu.encode(
				buffer,
				NpduControlPriority.NORMAL_MESSAGE |
					NpduControlBit.EXPECTING_REPLY,
				args.receiver,
				null,
				DEFAULT_HOP_COUNT,
				NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK,
				0,
			)
			baApdu.encodeConfirmedServiceRequest(
				buffer,
				baseType,
				args.service,
				args.maxSegments,
				args.maxApdu,
				args.invokeId,
				0,
				0,
			)
			payloadView.copy(buffer.buffer, buffer.offset)
			buffer.offset += payloadView.length
			this.sendBvlc(args.receiver, buffer)
			return this._awaitResponse(
				args.receiver,
				args.invokeId,
				args.maxSegments,
			)
		}

		const key = getTransactionKey(args.receiver, args.invokeId)
		const transactions = this._getOutgoingSegmentTransactions()
		if (transactions.has(key)) {
			throw new InvalidSegmentedRequestError({
				option: 'invokeId',
				value: args.invokeId,
				reason: 'a segmented request with this invokeId to this receiver is already in progress',
				service: args.service,
				invokeId: args.invokeId,
			})
		}
		if (this._isClosed) {
			throw new Error('ERR_CLOSED')
		}

		let resolveTransfer!: () => void
		let rejectTransfer!: (err: Error) => void
		const transferPromise = new Promise<void>((resolve, reject) => {
			resolveTransfer = resolve
			rejectTransfer = reject
		})

		const state: OutgoingSegmentTransaction = {
			key,
			receiver: args.receiver,
			service: args.service,
			invokeId: args.invokeId,
			maxSegments: args.maxSegments,
			maxApdu: args.maxApdu,
			baseType,
			payload: payload.buffer.subarray(0, payload.offset),
			segmentCapacity,
			totalSegments,
			proposedWindowSize,
			// Only segment 0 may be sent until the first SegmentACK
			// conveys the actual window size (ASHRAE 135 - 5.4.4.2).
			actualWindowSize: 1,
			initialSequenceAbs: 0,
			retryCount: 0,
			maxRetries,
			segmentAckTimeout,
			timer: null,
			done: false,
			responseRegistered: false,
			responsePromise: null,
			resolveTransfer,
			rejectTransfer,
			transferPromise,
		}
		transactions.set(key, state)

		try {
			this._sendSegmentWindow(state)
			await state.transferPromise
			return await state.responsePromise
		} finally {
			this._cleanupOutgoingSegmentTransaction(state)
		}
	}

	private _sendSegment(state: OutgoingSegmentTransaction, index: number) {
		const buffer = this._getApduBuffer(state.receiver)
		baNpdu.encode(
			buffer,
			NpduControlPriority.NORMAL_MESSAGE | NpduControlBit.EXPECTING_REPLY,
			state.receiver,
			null,
			DEFAULT_HOP_COUNT,
			NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK,
			0,
		)
		const moreFollows = index < state.totalSegments - 1
		const type =
			state.baseType |
			PduConReqBit.SEGMENTED_MESSAGE |
			(moreFollows ? PduConReqBit.MORE_FOLLOWS : 0)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			type,
			state.service,
			state.maxSegments,
			state.maxApdu,
			state.invokeId,
			index & 0xff,
			state.proposedWindowSize,
		)
		const chunk = state.payload.subarray(
			index * state.segmentCapacity,
			Math.min((index + 1) * state.segmentCapacity, state.payload.length),
		)
		chunk.copy(buffer.buffer, buffer.offset)
		buffer.offset += chunk.length
		this.sendBvlc(state.receiver, buffer)
	}

	/**
	 * (Re)transmits the current window starting at the first
	 * unacknowledged segment and re-arms the SegmentACK timer.
	 */
	private _sendSegmentWindow(state: OutgoingSegmentTransaction) {
		const first = state.initialSequenceAbs
		const last = Math.min(
			first + state.actualWindowSize - 1,
			state.totalSegments - 1,
		)
		for (let index = first; index <= last; index++) {
			this._sendSegment(state, index)
		}
		if (last === state.totalSegments - 1 && !state.responseRegistered) {
			// The final segment is now on the wire: register the pending
			// service response before its SegmentACK arrives so a fast
			// (or reordered) response is not dropped.
			state.responseRegistered = true
			state.responsePromise = this._awaitResponse(
				state.receiver,
				state.invokeId,
				state.maxSegments,
			)
			// Guard against an unhandled rejection when the transfer
			// phase fails first; the rejection is still observed by the
			// awaiting caller if the transfer succeeds.
			state.responsePromise.catch(() => {})
		}
		this._restartSegmentTimer(state)
	}

	private _restartSegmentTimer(state: OutgoingSegmentTransaction) {
		if (state.timer) {
			clearTimeout(state.timer)
		}
		state.timer = setTimeout(() => {
			this._onSegmentAckTimeout(state)
		}, state.segmentAckTimeout)
		if (typeof state.timer.unref === 'function') {
			state.timer.unref()
		}
	}

	private _onSegmentAckTimeout(state: OutgoingSegmentTransaction) {
		if (state.done) {
			return
		}
		state.retryCount++
		if (state.retryCount > state.maxRetries) {
			// ASHRAE 135 - 5.4.4.2: abort the transaction after the retry
			// budget is exhausted.
			this.abortResponse(
				state.receiver,
				state.invokeId,
				AbortReason.TSM_TIMEOUT,
				false,
			)
			this._failOutgoingSegmentTransaction(
				state,
				new SegmentAckTimeoutError({
					service: state.service,
					invokeId: state.invokeId,
					retries: state.maxRetries,
				}),
			)
			return
		}
		trace(
			`SegmentACK timeout for invokeId ${state.invokeId}, retry ${state.retryCount}/${state.maxRetries}`,
		)
		this._sendSegmentWindow(state)
	}

	private _completeOutgoingSegmentTransfer(
		state: OutgoingSegmentTransaction,
	) {
		if (state.done) {
			return
		}
		state.done = true
		if (state.timer) {
			clearTimeout(state.timer)
			state.timer = null
		}
		this._getOutgoingSegmentTransactions().delete(state.key)
		state.resolveTransfer()
	}

	private _failOutgoingSegmentTransaction(
		state: OutgoingSegmentTransaction,
		err: Error,
	) {
		if (state.done) {
			return
		}
		state.done = true
		if (state.timer) {
			clearTimeout(state.timer)
			state.timer = null
		}
		this._getOutgoingSegmentTransactions().delete(state.key)
		if (state.responseRegistered) {
			// Settle the pending response entry so it does not linger
			// until its own timeout. The transaction key of the response
			// entry equals the outgoing transaction key.
			this._requestManager.resolve(state.key, err)
		}
		state.rejectTransfer(err)
	}

	private _cleanupOutgoingSegmentTransaction(
		state: OutgoingSegmentTransaction,
	) {
		state.done = true
		if (state.timer) {
			clearTimeout(state.timer)
			state.timer = null
		}
		this._getOutgoingSegmentTransactions().delete(state.key)
	}

	private _findOutgoingSegmentTransaction(
		header: BACnetMessageHeader | undefined,
		invokeId: number,
	): OutgoingSegmentTransaction | undefined {
		if (!this._outgoingSegmentTransactions?.size) {
			return undefined
		}
		const key = getTransactionKey(header?.sender, invokeId)
		return this._outgoingSegmentTransactions.get(key)
	}

	/**
	 * Called when a final service response (SimpleACK/ComplexACK) arrives
	 * for an invokeId with an active outgoing segmented transaction. A
	 * response implies the remote device received every segment, so the
	 * transfer phase is completed even if the final SegmentACK was lost.
	 */
	private _completeSegmentTransferOnResponse(
		header: BACnetMessageHeader | undefined,
		invokeId: number,
	) {
		const state = this._findOutgoingSegmentTransaction(header, invokeId)
		if (state && state.responseRegistered) {
			this._completeOutgoingSegmentTransfer(state)
		}
	}

	/**
	 * Called when a terminal Error/Reject/Abort arrives for an invokeId
	 * with an active outgoing segmented transaction, possibly before the
	 * final segment was sent.
	 */
	private _failSegmentTransferOnTerminal(
		header: BACnetMessageHeader | undefined,
		invokeId: number,
		err: Error,
	) {
		const state = this._findOutgoingSegmentTransaction(header, invokeId)
		if (state) {
			this._failOutgoingSegmentTransaction(state, err)
		}
	}

	private async _awaitResponse(
		receiver: BACNetAddress | undefined,
		invokeId: number,
		maxSegments: number,
	): Promise<any> {
		const key = getTransactionKey(receiver, invokeId)
		this._getPendingRequestMaxSegments().set(key, maxSegments)
		try {
			return await this._requestManager.add(key)
		} finally {
			this._getPendingRequestMaxSegments().delete(key)
		}
	}

	private _getActiveForeignDeviceRegistrations() {
		if (!this._activeForeignDeviceRegistrations) {
			this._activeForeignDeviceRegistrations = new Map()
		}
		return this._activeForeignDeviceRegistrations
	}

	private _setForeignDeviceRegistrationActive(
		normalizedAddress: string,
		ttlSeconds: number,
	): void {
		const active = this._getActiveForeignDeviceRegistrations()
		const previous = active.get(normalizedAddress)
		if (previous) {
			clearTimeout(previous.expiringTimer)
			clearTimeout(previous.expiryTimer)
		}

		const ttlMs = ttlSeconds * 1000
		const now = Date.now()
		const expiresAt = now + ttlMs
		const expiringDelayMs = Math.max(1, Math.floor(ttlMs * 0.8))

		const expiringTimer = setTimeout(() => {
			this.emit('fdrExpiring', {
				payload: {
					address: normalizedAddress,
					ttl: ttlSeconds,
					expiresAt,
				},
			})
		}, expiringDelayMs)
		if (typeof expiringTimer.unref === 'function') {
			expiringTimer.unref()
		}

		const expiryTimer = setTimeout(() => {
			active.delete(normalizedAddress)
			this.emit('fdrExpired', {
				payload: {
					address: normalizedAddress,
					ttl: ttlSeconds,
					expiredAt: Date.now(),
				},
			})
		}, ttlMs)
		if (typeof expiryTimer.unref === 'function') {
			expiryTimer.unref()
		}

		this.emit('fdrRegistered', {
			payload: {
				address: normalizedAddress,
				ttl: ttlSeconds,
				expiresAt,
			},
		})

		active.set(normalizedAddress, {
			ttl: ttlSeconds,
			expiresAt,
			expiringTimer,
			expiryTimer,
		})
	}

	private _isForeignDeviceRegistrationActive(address?: string): boolean {
		const normalizedAddress = this._normalizeAddress(address)
		if (!normalizedAddress) return false
		return this._getActiveForeignDeviceRegistrations().has(
			normalizedAddress,
		)
	}

	private _processError(
		invokeId: number,
		buffer: Buffer,
		offset: number,
		length: number,
		header?: BACnetMessageHeader,
	) {
		const result = ErrorService.decode(buffer, offset)
		if (!result) return debug('Couldn`t decode Error')
		const err = new Error(
			`BacnetError - Class:${result.class} - Code:${result.code}`,
		)
		this._failSegmentTransferOnTerminal(header, invokeId, err)
		this._resolvePendingRequest(header, invokeId, err)
	}

	private _processAbort(
		invokeId: number,
		reason: number,
		header?: BACnetMessageHeader,
	) {
		const err = new Error(`BacnetAbort - Reason:${reason}`)
		this._failSegmentTransferOnTerminal(header, invokeId, err)
		this._resolvePendingRequest(header, invokeId, err)
	}

	private _segmentAckResponse(
		receiver: BACNetAddress,
		negative: boolean,
		server: boolean,
		originalInvokeId: number,
		sequencenumber: number,
		actualWindowSize: number,
	) {
		const buffer = this._getApduBuffer(receiver)
		baNpdu.encode(
			buffer,
			NpduControlPriority.NORMAL_MESSAGE,
			receiver,
			null,
			DEFAULT_HOP_COUNT,
			NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK,
			0,
		)
		baApdu.encodeSegmentAck(
			buffer,
			PduType.SEGMENT_ACK |
				(negative ? PduSegAckBit.NEGATIVE_ACK : 0) |
				(server ? PduSegAckBit.SERVER : 0),
			originalInvokeId,
			sequencenumber,
			actualWindowSize,
		)
		baBvlc.encode(
			buffer.buffer,
			BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._send(buffer, receiver)
	}

	private _performDefaultSegmentHandling(
		msg: BACnetMessage,
		assemblyState: SegmentAssemblyState,
		first: boolean,
		moreFollows: boolean,
		buffer: Buffer,
		offset: number,
		length: number,
	): void {
		if (first) {
			assemblyState.segments = []
			msg.type &= ~PduConReqBit.SEGMENTED_MESSAGE

			let apduHeaderLen = 3
			if ((msg.type & PDU_TYPE_MASK) === PduType.CONFIRMED_REQUEST) {
				apduHeaderLen = 4
			}

			const apdubuffer = this._getApduBuffer()
			apdubuffer.offset = 0
			buffer.copy(
				apdubuffer.buffer,
				apduHeaderLen,
				offset,
				offset + length,
			)

			if ((msg.type & PDU_TYPE_MASK) === PduType.CONFIRMED_REQUEST) {
				const confirmedMsg = msg as ConfirmedServiceRequest &
					BACnetMessageBase
				baApdu.encodeConfirmedServiceRequest(
					apdubuffer,
					msg.type,
					confirmedMsg.service,
					confirmedMsg.maxSegments,
					confirmedMsg.maxApdu,
					confirmedMsg.invokeId,
					0,
					0,
				)
			} else {
				const complexMsg = msg as ComplexAck & BACnetMessageBase
				baApdu.encodeComplexAck(
					apdubuffer,
					msg.type,
					complexMsg.service,
					complexMsg.invokeId,
					0,
					0,
				)
			}

			assemblyState.segments.push(
				apdubuffer.buffer.slice(0, length + apduHeaderLen),
			)
		} else {
			assemblyState.segments.push(buffer.slice(offset, offset + length))
		}

		if (!moreFollows) {
			const apduBuffer = Buffer.concat(assemblyState.segments)
			assemblyState.segments = []
			msg.header.apduType &= ~PduConReqBit.SEGMENTED_MESSAGE
			this._handlePdu(apduBuffer, 0, apduBuffer.length, msg.header)
		}
	}

	private _processSegment(
		msg: SegmentableMessage &
			(ConfirmedServiceRequestMessage | ComplexAckMessage),
		server: boolean,
		buffer: Buffer,
		offset: number,
		length: number,
	): void {
		const key = this._getSegmentAssemblyKey(msg, server)
		const segmentStates = this._getSegmentAssemblyStates()
		const state = segmentStates.get(key) ?? {
			lastSequenceNumber: null,
			segments: [],
			segmentsSinceAck: 0,
			timer: null,
		}
		segmentStates.set(key, state)

		// We grant the sender's proposed window size, clamped to the
		// valid BACnet range.
		const actualWindowSize = Math.min(
			Math.max(msg.proposedWindowNumber || 1, 1),
			MAX_SEGMENT_WINDOW_SIZE,
		)

		const first =
			msg.sequencenumber === 0 && state.lastSequenceNumber === null
		if (!first) {
			const expectedSequence =
				((state.lastSequenceNumber ?? 0) + 1) & 0xff
			if (msg.sequencenumber !== expectedSequence) {
				// Duplicate or out-of-order segment: negative ACK with the
				// last segment received in order, keep the assembly alive.
				this._touchSegmentAssemblyTimer(key, state)
				return this._segmentAckResponse(
					msg.header.sender,
					true,
					server,
					msg.invokeId,
					state.lastSequenceNumber ?? 0,
					actualWindowSize,
				)
			}
		}

		state.lastSequenceNumber = msg.sequencenumber
		state.segmentsSinceAck++
		const moreFollows = !!(msg.type & PduConReqBit.MORE_FOLLOWS)

		// ASHRAE 135 - 5.4.5.2: the first segment is acknowledged
		// immediately to convey the actual window size; afterwards one ACK
		// per full window and one for the final segment. Counting segments
		// since the last ACK (instead of `sequence % window`) keeps the
		// cadence correct across sequence-number wrap-around.
		if (
			first ||
			state.segmentsSinceAck >= actualWindowSize ||
			!moreFollows
		) {
			this._segmentAckResponse(
				msg.header.sender,
				false,
				server,
				msg.invokeId,
				msg.sequencenumber,
				actualWindowSize,
			)
			state.segmentsSinceAck = 0
		}

		this._performDefaultSegmentHandling(
			msg,
			state,
			first,
			moreFollows,
			buffer,
			offset,
			length,
		)

		if (!moreFollows) {
			if (state.timer) {
				clearTimeout(state.timer)
				state.timer = null
			}
			segmentStates.delete(key)
		} else {
			this._touchSegmentAssemblyTimer(key, state)
		}
	}

	/**
	 * (Re)arms the inactivity timer that discards an incomplete incoming
	 * segment assembly.
	 */
	private _touchSegmentAssemblyTimer(
		key: string,
		state: SegmentAssemblyState,
	) {
		if (state.timer) {
			clearTimeout(state.timer)
		}
		const timeout = this._settings?.apduTimeout ?? 3000
		state.timer = setTimeout(() => {
			state.timer = null
			this._getSegmentAssemblyStates().delete(key)
			trace(
				`Discarded incomplete segment assembly ${key} after ${timeout}ms`,
			)
		}, timeout)
		if (typeof state.timer.unref === 'function') {
			state.timer.unref()
		}
	}

	private _processSegmentAck(msg: SegmentAckMessage): void {
		trace(
			`Received SegmentACK for invokeId ${msg.originalInvokeId} seq ${msg.sequencenumber} window ${msg.actualWindowSize}`,
		)
		const state = this._findOutgoingSegmentTransaction(
			msg.header,
			msg.originalInvokeId,
		)
		if (!state || state.done) {
			return trace(
				`SegmentACK for unknown or completed transaction -> Drop`,
			)
		}
		// Our outgoing segmented transfers are confirmed requests, so the
		// acknowledging peer is the server and must set the server bit.
		if (!(msg.type & PduSegAckBit.SERVER)) {
			return trace(
				`SegmentACK without server bit for outgoing request -> Drop`,
			)
		}
		const negative = !!(msg.type & PduSegAckBit.NEGATIVE_ACK)

		// ASHRAE 135 - 5.4.4.2: the acknowledged sequence number is the
		// last segment the peer received in order; transmission resumes at
		// the following sequence number. Window membership is evaluated in
		// modulo-256 space to support sequence wrap-around.
		const offsetInWindow =
			(msg.sequencenumber - (state.initialSequenceAbs & 0xff)) & 0xff
		const inWindow = offsetInWindow < state.actualWindowSize

		if (!inWindow) {
			// Duplicate ACK (e.g. a re-acknowledgement of the previous
			// window). A duplicate negative ACK triggers an immediate
			// bounded retransmission of the current window; a duplicate
			// positive ACK only restarts the timer (ASHRAE 135 - 5.4.4.2).
			if (negative) {
				state.retryCount++
				if (state.retryCount > state.maxRetries) {
					this.abortResponse(
						state.receiver,
						state.invokeId,
						AbortReason.TSM_TIMEOUT,
						false,
					)
					return this._failOutgoingSegmentTransaction(
						state,
						new SegmentAckTimeoutError({
							service: state.service,
							invokeId: state.invokeId,
							retries: state.maxRetries,
						}),
					)
				}
				return this._sendSegmentWindow(state)
			}
			return this._restartSegmentTimer(state)
		}

		// Apply the actual window size granted by the receiver.
		if (
			msg.actualWindowSize >= MIN_SEGMENT_WINDOW_SIZE &&
			msg.actualWindowSize <= MAX_SEGMENT_WINDOW_SIZE
		) {
			state.actualWindowSize = msg.actualWindowSize
		}

		const ackedAbs = state.initialSequenceAbs + offsetInWindow
		if (ackedAbs >= state.totalSegments - 1) {
			// Final segment acknowledged: the segmented request phase is
			// complete. The request itself is only resolved by the final
			// service response, which is already registered.
			return this._completeOutgoingSegmentTransfer(state)
		}

		state.initialSequenceAbs = ackedAbs + 1
		if (negative) {
			// The peer is missing segments after ackedAbs; retransmit
			// from there, bounded to avoid infinite resend loops.
			state.retryCount++
			if (state.retryCount > state.maxRetries) {
				this.abortResponse(
					state.receiver,
					state.invokeId,
					AbortReason.TSM_TIMEOUT,
					false,
				)
				return this._failOutgoingSegmentTransaction(
					state,
					new SegmentAckTimeoutError({
						service: state.service,
						invokeId: state.invokeId,
						retries: state.maxRetries,
					}),
				)
			}
		} else {
			state.retryCount = 0
		}
		this._sendSegmentWindow(state)
	}

	private _processServiceRequest(
		serviceMap: Record<number, keyof BACnetClientEvents>,
		content: ServiceMessage,
		buffer: Buffer,
		offset: number,
		length: number,
	): void {
		const sender = content.header?.sender
		if (sender?.address === LOCALHOST_INTERFACES_IPV4) {
			debug(
				'Received and skipped localhost service request:',
				content.service,
			)
			return
		}

		const name = serviceMap[content.service]
		if (!name) {
			debug('Received unsupported service request:', content.service)
			return
		}

		// Use type assertion to access potential invokeId property
		const confirmedMsg = content as Partial<ConfirmedServiceRequest> &
			BACnetMessageBase
		const id = confirmedMsg.invokeId
			? `with invokeId ${confirmedMsg.invokeId}`
			: ''
		trace(`Received service request${id}:`, name)

		// Find a function to decode the packet.
		const serviceHandler = ServicesMap[
			name as keyof typeof ServicesMap
		] as BacnetService

		if (serviceHandler) {
			try {
				const utcDecoder = serviceHandler as {
					decode: (
						buffer: Buffer,
						offset: number,
						apduLen: number,
					) => unknown
					decodeUtc?: (
						buffer: Buffer,
						offset: number,
						apduLen: number,
					) => unknown
				}
				content.payload =
					name === 'timeSyncUTC' &&
					typeof utcDecoder.decodeUtc === 'function'
						? utcDecoder.decodeUtc(buffer, offset, length)
						: serviceHandler.decode(buffer, offset, length)
				trace(
					`Handled service request${id}:`,
					name,
					JSON.stringify(content),
				)
			} catch (e) {
				// Sometimes incomplete or corrupted messages will cause exceptions
				// during decoding, but we don't want these to terminate the program, so
				// we'll just log them and ignore them.
				debug('Exception thrown when processing message:', e)
				debug('Original message was', `${name}:`, content)
				return
			}
			if (!content.payload) {
				return debug('Received invalid', name, 'message')
			}
		} else {
			debug('No serviceHandler defined for:', name)
			// Call the callback anyway, just with no payload.
		}

		// Call the user code, if they've defined a callback.
		if (this.listenerCount(name)) {
			trace(
				`listener count by name emits ${name} with content. ${format('%o', content)}`,
			)
			this.emit(name, content)
		} else {
			if (this.listenerCount('unhandledEvent')) {
				trace('unhandled event emitting with content')
				this.emit(name, content)
			} else {
				// No 'unhandled event' handler, so respond with an error ourselves.
				// This is better than doing nothing, which can often make the other
				// device think we have gone offline.
				trace(
					`no unhandled event "${name}" handler with header: ${JSON.stringify(
						content.header,
					)}`,
				)
				if (content.header?.expectingReply) {
					debug('Replying with error for unhandled service:', name)
					// Make sure we don't reply pretending to be the caller, if we got a
					// forwarded message!  Really this should be overridden to be your
					// own IP, but only if it's not null/undefined to begin with.
					if (content.header.sender) {
						content.header.sender.forwardedFrom = null
					}
					this.errorResponse(
						content.header.sender,
						content.service,
						confirmedMsg.invokeId,
						ErrorClass.SERVICES,
						ErrorCode.REJECT_UNRECOGNIZED_SERVICE,
					)
				}
			}
		}
	}

	private _handlePdu(
		buffer: Buffer,
		offset: number,
		length: number,
		header: BACnetMessageHeader,
	): void {
		let msg: BACnetMessage
		trace('handlePdu Header: ', header)

		// Handle different PDU types
		switch (header.apduType & PDU_TYPE_MASK) {
			case PduType.UNCONFIRMED_REQUEST:
				msg = baApdu.decodeUnconfirmedServiceRequest(
					buffer,
					offset,
				) as UnconfirmedServiceRequest & BACnetMessageBase
				msg.header = header
				msg.header.confirmedService = false
				this._processServiceRequest(
					unconfirmedServiceMap,
					msg,
					buffer,
					offset + msg.len,
					length - msg.len,
				)
				break

			case PduType.SIMPLE_ACK:
				msg = baApdu.decodeSimpleAck(buffer, offset) as SimpleAck &
					BACnetMessageBase &
					HasInvokeId
				offset += msg.len
				length -= msg.len
				this._completeSegmentTransferOnResponse(
					header,
					(msg as HasInvokeId).invokeId,
				)
				this._resolvePendingRequest(
					header,
					(msg as HasInvokeId).invokeId,
					null,
					{
						msg,
						buffer,
						offset,
						length,
					},
				)
				break

			case PduType.COMPLEX_ACK:
				msg = baApdu.decodeComplexAck(
					buffer,
					offset,
				) as ComplexAckMessage
				msg.header = header
				this._completeSegmentTransferOnResponse(
					header,
					(msg as HasInvokeId).invokeId,
				)
				const isSegmentedMessage =
					(header.apduType & PduConReqBit.SEGMENTED_MESSAGE) !== 0
				if (!isSegmentedMessage) {
					this._resolvePendingRequest(
						header,
						(msg as HasInvokeId).invokeId,
						null,
						{
							msg,
							buffer,
							offset: offset + msg.len,
							length: length - msg.len,
						},
					)
				} else {
					const requestMaxSegments = this._getPendingMaxSegments(
						header,
						(msg as HasInvokeId).invokeId,
					)
					if (
						this._settings
							.abortOnSegmentedResponseWhenNoSegAccepted &&
						requestMaxSegments === MaxSegmentsAccepted.SEGMENTS_0
					) {
						this.abortResponse(
							header.sender,
							(msg as HasInvokeId).invokeId,
							AbortReason.SEGMENTATION_NOT_SUPPORTED,
							false,
						)
						this._resolvePendingRequest(
							header,
							(msg as HasInvokeId).invokeId,
							new Error(
								`BacnetAbort - Reason:${AbortReason.SEGMENTATION_NOT_SUPPORTED}`,
							),
						)
						break
					}
					this._processSegment(
						msg as SegmentableMessage &
							(
								| ConfirmedServiceRequestMessage
								| ComplexAckMessage
							),
						false,
						buffer,
						offset + msg.len,
						length - msg.len,
					)
				}
				break

			case PduType.SEGMENT_ACK:
				msg = baApdu.decodeSegmentAck(buffer, offset) as SegmentAck &
					BACnetMessageBase
				msg.header = header
				this._processSegmentAck(msg as SegmentAckMessage)
				break

			case PduType.ERROR:
				msg = baApdu.decodeError(buffer, offset) as BACnetError &
					BACnetMessageBase
				this._processError(
					(msg as HasInvokeId).invokeId,
					buffer,
					offset + msg.len,
					length - msg.len,
					header,
				)
				break

			case PduType.REJECT:
			case PduType.ABORT:
				msg = baApdu.decodeAbort(buffer, offset) as Abort &
					BACnetMessageBase
				this._processAbort(msg.invokeId, msg.reason, header)
				break

			case PduType.CONFIRMED_REQUEST:
				msg = baApdu.decodeConfirmedServiceRequest(
					buffer,
					offset,
				) as ConfirmedServiceRequest & BACnetMessageBase
				msg.header = header
				msg.header.confirmedService = true
				if ((header.apduType & PduConReqBit.SEGMENTED_MESSAGE) === 0) {
					this._processServiceRequest(
						confirmedServiceMap,
						msg,
						buffer,
						offset + msg.len,
						length - msg.len,
					)
				} else {
					this._processSegment(
						msg as SegmentableMessage &
							(
								| ConfirmedServiceRequestMessage
								| ComplexAckMessage
							),
						true,
						buffer,
						offset + msg.len,
						length - msg.len,
					)
				}
				break

			default:
				debug(
					`Received unknown PDU type ${header.apduType} -> Drop packet`,
				)
				break
		}
	}

	private _handleNpdu(
		buffer: Buffer,
		offset: number,
		msgLength: number,
		header: BACnetMessageHeader,
	): void {
		// Check data length
		if (msgLength <= 0) {
			return trace('No NPDU data -> Drop package')
		}

		// Parse baNpdu header
		const result = baNpdu.decode(buffer, offset)
		if (!result) {
			return trace('Received invalid NPDU header -> Drop package')
		}

		if (result.funct & NpduControlBit.NETWORK_LAYER_MESSAGE) {
			return trace('Received network layer message -> Drop package')
		}

		offset += result.len
		msgLength -= result.len

		if (msgLength <= 0) {
			return trace('No APDU data -> Drop package')
		}

		header.apduType = baApdu.getDecodedType(buffer, offset)
		header.expectingReply = !!(
			result.funct & NpduControlBit.EXPECTING_REPLY
		)

		if (result.source) {
			header.sender.net = result.source.net
			header.sender.adr = result.source.adr
		}

		this._handlePdu(buffer, offset, msgLength, header)
	}

	private _receiveData(buffer: Buffer, remoteAddress: string): void {
		// Check data length
		if (buffer.length < BVLC_HEADER_LENGTH) {
			return trace('Received invalid data -> Drop package')
		}

		// Parse BVLC header
		const result = baBvlc.decode(buffer, 0)
		if (!result) {
			return trace('Received invalid BVLC header -> Drop package')
		}

		const header: BACnetMessageHeader = {
			// Which function the packet came in on, so later code can distinguish
			// between ORIGINAL_BROADCAST_NPDU and DISTRIBUTE_BROADCAST_TO_NETWORK.
			func: result.func,
			sender: {
				// Address of the host we are directly connected to. String, IP:port.
				address: remoteAddress,
				// If the host is a BBMD passing messages along to another node, this
				// is the address of the distant BACnet node. String, IP:port.
				// Typically we won't have network connectivity to this address, but
				// we have to include it in replies so the host we are connect to knows
				// where to forward the messages.
				forwardedFrom: null,
			},
			apduType: 0,
			expectingReply: false,
		}
		// Check BVLC function
		switch (result.func) {
			case BvlcResultPurpose.BVLC_RESULT: {
				if (result.msgLength - result.len < 2) {
					return trace('Received invalid BVLC result message')
				}
				const bvlcResult = baApdu.decodeResult(buffer, result.len)
				this.emit('bvlcResult', {
					header,
					payload: bvlcResult,
				})
				break
			}

			case BvlcResultPurpose.ORIGINAL_UNICAST_NPDU:
			case BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU:
				this._handleNpdu(
					buffer,
					result.len,
					buffer.length - result.len,
					header,
				)
				break

			case BvlcResultPurpose.FORWARDED_NPDU:
				// Dropping unsolicited FORWARDED_NPDU is opt-in: BBMDs
				// re-broadcast Forwarded-NPDU from BDT peers on their local
				// subnet, so ordinary devices receive them without any FDR.
				if (
					this._settings.requireActiveFdrForForwardedNpdu &&
					!this._isForeignDeviceRegistrationActive(remoteAddress)
				) {
					this.emit('forwardedNpduDroppedNoFdr', {
						payload: { address: remoteAddress },
					})
					return trace(
						'Received FORWARDED_NPDU without active foreign-device registration -> Drop package',
					)
				}
				// Preserve the IP of the node behind the BBMD so we know where to send
				// replies back to.
				header.sender.forwardedFrom = result.originatingIP
				this._handleNpdu(
					buffer,
					result.len,
					buffer.length - result.len,
					header,
				)
				break

			case BvlcResultPurpose.REGISTER_FOREIGN_DEVICE: {
				const decodeResult = RegisterForeignDevice.decode(
					buffer,
					result.len,
					buffer.length - result.len,
				)
				if (!decodeResult) {
					return trace(
						'Received invalid registerForeignDevice message',
					)
				}
				this.emit('registerForeignDevice', {
					header,
					payload: decodeResult,
				})
				break
			}

			case BvlcResultPurpose.DISTRIBUTE_BROADCAST_TO_NETWORK:
				this._handleNpdu(
					buffer,
					result.len,
					buffer.length - result.len,
					header,
				)
				break

			default:
				debug(
					`Received unknown BVLC function ${
						result.func
					} -> Drop package`,
				)
				break
		}
	}

	private _receiveError(err: Error) {
		/**
		 * @event BACnetClient.error
		 * @example
		 * import BACnetClient from "@bacnet-js/client";
		 *
		 * const client = new BACnetClient();
		 *
		 * client.on('error', (err) => {
		 *   console.log('Error occurred: ', err);
		 *   client.close();
		 * });
		 */
		this.emit('error', err)
	}

	/**
	 * The whoIs command discovers all BACNET devices in a network.
	 * @fires BACnetClient.iAm
	 */
	public whoIs(
		receiverOrOptions?: BACNetAddress | WhoIsOptions,
		options?: WhoIsOptions,
	): void {
		let receiver: BACNetAddress | undefined
		if (!options) {
			if (
				receiverOrOptions &&
				typeof receiverOrOptions === 'object' &&
				('lowLimit' in receiverOrOptions ||
					'highLimit' in receiverOrOptions)
			) {
				options = receiverOrOptions as WhoIsOptions
				receiverOrOptions = undefined
			} else {
				receiver = receiverOrOptions as BACNetAddress
			}
		} else {
			receiver = receiverOrOptions as BACNetAddress
		}

		options = options || {}

		const buffer = this._getApduBuffer(receiver)
		const npduDestination = receiver?.distributeBroadcastToNetwork
			? undefined
			: receiver

		baNpdu.encode(
			buffer,
			NpduControlPriority.NORMAL_MESSAGE,
			npduDestination,
			null,
			DEFAULT_HOP_COUNT,
			NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK,
			0,
		)

		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			PduType.UNCONFIRMED_REQUEST,
			UnconfirmedServiceChoice.WHO_IS,
		)

		WhoIs.encode(buffer, options.lowLimit, options.highLimit)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Sends Who-Is through a BBMD using BVLC Distribute-Broadcast-To-Network (0x09).
	 * Requires prior foreign-device registration in the same BBMD.
	 */
	public whoIsThroughBBMD(bbmd: BACNetAddress, options?: WhoIsOptions): void {
		if (!bbmd?.address) {
			throw new Error(
				'whoIsThroughBBMD requires bbmd.address (bbmd_ip:port)',
			)
		}
		this.whoIs(
			{
				...bbmd,
				distributeBroadcastToNetwork: true,
			},
			options,
		)
	}

	/**
	 * The timeSync command sets the time of a target device.
	 */
	timeSync(receiver: BACNetAddress, dateTime: Date): void {
		const buffer = this._getApduBuffer(receiver)
		baNpdu.encode(buffer, NpduControlPriority.NORMAL_MESSAGE, receiver)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			PduType.UNCONFIRMED_REQUEST,
			UnconfirmedServiceChoice.TIME_SYNCHRONIZATION,
		)
		TimeSync.encode(buffer, dateTime)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * The timeSyncUTC command sets the UTC time of a target device.
	 */
	timeSyncUTC(receiver: BACNetAddress, dateTime: Date | number): void {
		const buffer = this._getApduBuffer(receiver)
		baNpdu.encode(buffer, NpduControlPriority.NORMAL_MESSAGE, receiver)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			PduType.UNCONFIRMED_REQUEST,
			UnconfirmedServiceChoice.UTC_TIME_SYNCHRONIZATION,
		)
		TimeSync.encodeUtc(buffer, dateTime)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Registers this client as a foreign device in a BBMD.
	 *
	 * The library tracks local FDR lifetime and emits `fdrRegistered`,
	 * `fdrExpiring`, and `fdrExpired`. Renewal is caller-managed.
	 */
	async registerForeignDevice(
		receiver: BACNetAddress,
		ttl: number,
	): Promise<void> {
		if (this._isClosed) {
			throw new Error('ERR_CLOSED')
		}
		if (!receiver?.address) {
			throw new Error(
				'registerForeignDevice requires receiver.address (bbmd_ip:port)',
			)
		}
		if (!Number.isInteger(ttl) || ttl <= 0 || ttl > 0xffff) {
			throw new Error(
				'registerForeignDevice ttl must be 1..65535 seconds',
			)
		}

		const expectedAddress = this._normalizeAddress(receiver.address, true)
		if (!expectedAddress) {
			throw new Error(
				`Invalid receiver.address "${String(receiver.address)}"`,
			)
		}
		const pendingRegistrations =
			this._getPendingForeignDeviceRegistrations()
		// BVLC-Result has no invoke-id, so registrations to the same BBMD
		// must be serialized to avoid correlating one response to multiple requests.
		while (true) {
			const pending = pendingRegistrations.get(expectedAddress)
			if (!pending) break
			if (pending.ttl === ttl) return pending.promise
			try {
				await pending.promise
			} catch (err) {
				if ((err as Error)?.message === 'ERR_CLOSED') {
					throw err
				}
				// If the earlier registration failed, still allow a new attempt
				// with the requested TTL instead of propagating stale failure.
			}
			if (this._isClosed) {
				throw new Error('ERR_CLOSED')
			}
		}

		const buffer = this._getApduBuffer(receiver)
		RegisterForeignDevice.encode(buffer, ttl)
		baBvlc.encode(
			buffer.buffer,
			BvlcResultPurpose.REGISTER_FOREIGN_DEVICE,
			buffer.offset,
		)

		let rejectRegistration = (_err: Error) => {}
		const registrationPromise = new Promise<void>((resolve, reject) => {
			let settled = false
			const timeout = setTimeout(() => {
				cleanup()
				reject(new Error('ERR_TIMEOUT'))
			}, this._settings.apduTimeout || 3000)
			if (typeof (timeout as NodeJS.Timeout).unref === 'function') {
				;(timeout as NodeJS.Timeout).unref()
			}

			const cleanup = () => {
				if (settled) return
				settled = true
				clearTimeout(timeout)
				this.off('bvlcResult', onResult)
			}
			rejectRegistration = (err: Error) => {
				cleanup()
				reject(err)
			}

			const onResult = (content: {
				header?: { sender?: { address?: string } }
				payload?: { resultCode?: number }
			}) => {
				if (
					this._normalizeAddress(content?.header?.sender?.address) !==
					expectedAddress
				)
					return
				const resultCode = Number(content?.payload?.resultCode)
				// ASHRAE 135 Annex J encodes successful completion as 0x0000 for all
				// BVLC operations. For now we can only correlate by sender address.
				if (resultCode === BvlcResultFormat.SUCCESSFUL_COMPLETION) {
					this._setForeignDeviceRegistrationActive(
						expectedAddress,
						ttl,
					)
					cleanup()
					resolve()
					return
				}
				cleanup()
				reject(
					new Error(
						`BacnetError - Class:${ErrorClass.COMMUNICATION} - Code:${ErrorCode.REGISTER_FOREIGN_DEVICE_FAILED} - Result:${resultCode}`,
					),
				)
			}

			this.on('bvlcResult', onResult)
			this._send(buffer, receiver)
		})
		pendingRegistrations.set(expectedAddress, {
			ttl,
			promise: registrationPromise,
			reject: rejectRegistration,
		})
		try {
			await registrationPromise
		} finally {
			const current = pendingRegistrations.get(expectedAddress)
			if (current?.promise === registrationPromise) {
				pendingRegistrations.delete(expectedAddress)
			}
		}
	}

	/**
	 * The readProperty command reads a single property of an object from a device.
	 * Use `options.arrayIndex` for indexed array reads (`0` = array size).
	 */

	async readProperty(
		receiver: BACNetAddress,
		objectId: BACNetObjectID,
		propertyId: number,
		options: ReadPropertyOptions = {},
	): Promise<DecodeAcknowledgeSingleResult> {
		const settings: ReadPropertyOptions = {
			maxSegments:
				(options as ReadPropertyOptions).maxSegments ??
				MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ReadPropertyOptions).maxApdu ||
				MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ReadPropertyOptions).invokeId ||
				this._getInvokeId(receiver),
			arrayIndex:
				(options as ReadPropertyOptions).arrayIndex !== undefined
					? (options as ReadPropertyOptions).arrayIndex
					: ASN1_ARRAY_ALL,
		}

		const data = await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.READ_PROPERTY,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			acceptSegmentedResponse: true,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				ReadProperty.encode(
					buffer,
					objectId.type,
					objectId.instance,
					propertyId,
					settings.arrayIndex,
				),
		})

		const result = ReadProperty.decodeAcknowledge(
			data.buffer,
			data.offset,
			data.length,
		)
		if (!result) {
			throw new Error('INVALID_DECODING')
		}

		return result
	}

	/**
	 * The writeProperty command writes a single property of an object to a device.
	 * `options.arrayIndex` supports indexed writes for schedule array properties.
	 */
	async writeProperty(
		receiver: BACNetAddress,
		objectId: BACNetObjectID,
		propertyId: number,
		values: BACNetWritePropertyValues,
		options: WritePropertyOptions,
	): Promise<void> {
		const settings: WritePropertyOptions = {
			maxSegments:
				(options as WritePropertyOptions).maxSegments ??
				MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as WritePropertyOptions).maxApdu ||
				MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as WritePropertyOptions).invokeId ||
				this._getInvokeId(receiver),
			arrayIndex:
				(options as WritePropertyOptions).arrayIndex ?? ASN1_ARRAY_ALL,
			priority:
				(options as WritePropertyOptions).priority ?? ASN1_NO_PRIORITY,
		}

		await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.WRITE_PROPERTY,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options?.segmentedRequest,
			encodePayload: (buffer) =>
				WriteProperty.encode(
					buffer,
					objectId.type,
					objectId.instance,
					propertyId,
					settings.arrayIndex,
					settings.priority,
					values,
				),
		})
	}

	/**
	 * The readPropertyMultiple command reads multiple properties in multiple objects from a device.
	 */
	async readPropertyMultiple(
		receiver: BACNetAddress,
		propertiesArray: BACNetReadAccessSpecification[],
		options: ServiceOptions = {},
	): Promise<DecodeAcknowledgeMultipleResult> {
		const settings = {
			maxSegments:
				(options as ServiceOptions).maxSegments ??
				MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId ||
				this._getInvokeId(receiver),
		}
		const data = await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.READ_PROPERTY_MULTIPLE,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			acceptSegmentedResponse: true,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				ReadPropertyMultiple.encode(buffer, propertiesArray),
		})
		const result = ReadPropertyMultiple.decodeAcknowledge(
			data.buffer,
			data.offset,
			data.length,
		)
		if (!result) {
			throw new Error('INVALID_DECODING')
		}
		return result
	}

	/**
	 * The writePropertyMultiple command writes multiple properties in multiple objects to a device.
	 */
	async writePropertyMultiple(
		receiver: BACNetAddress,
		values: WritePropertyMultipleObject[],
		options: ServiceOptions = {},
	): Promise<void> {
		const settings = {
			maxSegments:
				(options as ServiceOptions).maxSegments ??
				MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId ||
				this._getInvokeId(receiver),
		}
		await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.WRITE_PROPERTY_MULTIPLE,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				WritePropertyMultiple.encodeObject(buffer, values),
		})
	}

	/**
	 * The confirmedCOVNotification command is used to push notifications to other
	 * systems that have registered with us via a subscribeCov message.
	 */
	async confirmedCOVNotification(
		receiver: BACNetAddress,
		monitoredObject: BACNetObjectID,
		subscribeId: number,
		initiatingDeviceId: number,
		lifetime: number,
		values: Array<{
			property: PropertyReference
			value: TypedValue[]
		}>,
		options: ServiceOptions = {},
	): Promise<void> {
		const settings = {
			maxSegments:
				(options as ServiceOptions).maxSegments ??
				MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId ||
				this._getInvokeId(receiver),
		}
		await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.CONFIRMED_COV_NOTIFICATION,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				CovNotify.encode(
					buffer,
					subscribeId,
					initiatingDeviceId,
					monitoredObject,
					lifetime,
					values,
				),
		})
	}

	/**
	 * The deviceCommunicationControl command enables or disables network communication of the target device.
	 */
	async deviceCommunicationControl(
		receiver: BACNetAddress,
		timeDuration: number,
		enableDisable: number,
		options: DeviceCommunicationOptions = {},
	): Promise<void> {
		const settings = {
			maxSegments:
				(options as DeviceCommunicationOptions).maxSegments ??
				MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as DeviceCommunicationOptions).maxApdu ||
				MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as DeviceCommunicationOptions).invokeId ||
				this._getInvokeId(receiver),
			password: (options as DeviceCommunicationOptions).password,
		}
		await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.DEVICE_COMMUNICATION_CONTROL,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				DeviceCommunicationControl.encode(
					buffer,
					timeDuration,
					enableDisable,
					settings.password,
				),
		})
	}

	/**
	 * The reinitializeDevice command initiates a restart of the target device.
	 */
	async reinitializeDevice(
		receiver: BACNetAddress,
		state: number,
		options: ReinitializeDeviceOptions = {},
	): Promise<void> {
		const settings = {
			maxSegments:
				(options as ReinitializeDeviceOptions).maxSegments ??
				MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ReinitializeDeviceOptions).maxApdu ||
				MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ReinitializeDeviceOptions).invokeId ||
				this._getInvokeId(receiver),
			password: (options as ReinitializeDeviceOptions).password,
		}
		await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.REINITIALIZE_DEVICE,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				ReinitializeDevice.encode(buffer, state, settings.password),
		})
	}

	/**
	 * Writes a file to a remote device.
	 * @param receiver - The BACnet device address
	 * @param objectId - The file object identifier
	 * @param position - Start position (byte offset for stream, record number for records)
	 * @param fileBuffer - Array of byte arrays containing the data to write
	 * @param options - Optional parameters including isStream (defaults to true for stream mode)
	 */
	async writeFile(
		receiver: BACNetAddress,
		objectId: BACNetObjectID,
		position: number,
		fileBuffer: number[][],
		options: WriteFileOptions = {},
	): Promise<DecodeAtomicWriteFileResult> {
		const settings = {
			maxSegments: options.maxSegments ?? MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu: options.maxApdu || MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(receiver),
		}
		// Default to stream mode (true) as it's the most common file access method
		const isStream =
			options.isStream !== undefined ? options.isStream : true
		const blocks: number[][] = fileBuffer
		const data = await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.ATOMIC_WRITE_FILE,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				AtomicWriteFile.encode(
					buffer,
					isStream,
					objectId,
					position,
					blocks,
				),
		})
		const result = AtomicWriteFile.decodeAcknowledge(
			data.buffer,
			data.offset,
		)
		if (!result) {
			throw new Error('INVALID_DECODING')
		}
		return result
	}

	/**
	 * Reads a file from a remote device.
	 */
	async readFile(
		receiver: BACNetAddress,
		objectId: BACNetObjectID,
		position: number,
		count: number,
		options: ServiceOptions = {},
	): Promise<DecodeAtomicReadFileResult> {
		const settings = {
			maxSegments:
				(options as ServiceOptions).maxSegments ??
				MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId ||
				this._getInvokeId(receiver),
		}
		const data = await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.ATOMIC_READ_FILE,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				AtomicReadFile.encode(buffer, true, objectId, position, count),
		})
		const result = AtomicReadFile.decodeAcknowledge(
			data.buffer,
			data.offset,
		)
		if (!result) {
			throw new Error('INVALID_DECODING')
		}
		return result
	}

	/**
	 * Reads a range of data from a remote device with BACnet `ReadRange`.
	 *
	 * Defaults to `LOG_BUFFER` and `BY_POSITION` for common Trend Log
	 * access; `options` may select another property, array index, range
	 * type, or reference time for BY_TIME requests. Returns both raw ACK
	 * data and decoded `LogRecord[]` when item-data parsing succeeds.
	 */
	async readRange(
		receiver: BACNetAddress,
		objectId: BACNetObjectID,
		idxBegin: number,
		quantity: number,
		options: ReadRangeOptions = {},
	): Promise<ReadRangeAcknowledge> {
		const settings = {
			maxSegments:
				(options as ServiceOptions).maxSegments ??
				MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId ||
				this._getInvokeId(receiver),
		}
		const propertyId = options.propertyId ?? PropertyIdentifier.LOG_BUFFER
		const arrayIndex = options.arrayIndex ?? ASN1_ARRAY_ALL
		const requestType = options.requestType ?? ReadRangeType.BY_POSITION
		const time = options.time ?? new Date()
		const data = await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.READ_RANGE,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				ReadRange.encode(
					buffer,
					objectId,
					propertyId,
					arrayIndex,
					requestType,
					idxBegin,
					time,
					quantity,
				),
		})
		const result = ReadRange.decodeAcknowledge(
			data.buffer,
			data.offset,
			data.length,
		)
		if (!result) {
			throw new Error('INVALID_DECODING')
		}
		return result
	}

	/**
	 * Subscribes to Change of Value (COV) notifications for an object
	 */
	public async subscribeCov(
		receiver: BACNetAddress,
		objectId: BACNetObjectID,
		subscribeId: number,
		cancel: boolean,
		issueConfirmedNotifications: boolean,
		lifetime: number,
		options: ServiceOptions = {},
	): Promise<void> {
		const settings = {
			maxSegments: options.maxSegments ?? MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu: options.maxApdu || MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(receiver),
		}
		await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.SUBSCRIBE_COV,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				SubscribeCov.encode(
					buffer,
					subscribeId,
					objectId,
					cancel,
					issueConfirmedNotifications,
					lifetime,
				),
		})
	}

	/**
	 * Subscribes to Change of Value (COV) notifications for a specific property
	 */
	public async subscribeProperty(
		receiver: BACNetAddress,
		objectId: BACNetObjectID,
		monitoredProperty: BACNetPropertyID,
		subscribeId: number,
		cancel: boolean,
		issueConfirmedNotifications: boolean,
		options: ServiceOptions = {},
	): Promise<void> {
		const settings = {
			maxSegments: options.maxSegments ?? MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu: options.maxApdu || MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(receiver),
		}
		await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.SUBSCRIBE_COV_PROPERTY,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				SubscribeProperty.encode(
					buffer,
					subscribeId,
					objectId,
					cancel,
					issueConfirmedNotifications,
					0,
					monitoredProperty,
					false,
					0x0f,
				),
		})
	}

	/**
	 * Sends an unconfirmed COV notification to a device
	 */
	public unconfirmedCOVNotification(
		receiver: BACNetAddress,
		subscriberProcessId: number,
		initiatingDeviceId: number,
		monitoredObjectId: BACNetObjectID,
		timeRemaining: number,
		values: Array<{
			property: {
				id: number
				index?: number
			}
			value: BACNetAppData[]
		}>,
	): void {
		const buffer = this._getApduBuffer()
		baNpdu.encode(buffer, NpduControlPriority.NORMAL_MESSAGE, receiver)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			PduType.UNCONFIRMED_REQUEST,
			UnconfirmedServiceChoice.UNCONFIRMED_COV_NOTIFICATION,
		)
		CovNotify.encode(
			buffer,
			subscriberProcessId,
			initiatingDeviceId,
			monitoredObjectId,
			timeRemaining,
			values,
		)
		baBvlc.encode(
			buffer.buffer,
			BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._send(buffer, receiver)
	}

	/**
	 * Creates a new object in a device
	 */
	public async createObject(
		receiver: BACNetAddress,
		objectId: BACNetObjectID,
		values: Array<{
			property: {
				id: number
				index?: number
			}
			value: BACNetAppData[]
		}>,
		options: ServiceOptions = {},
	): Promise<void> {
		const settings = {
			maxSegments: options.maxSegments ?? MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu: options.maxApdu || MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(receiver),
		}
		await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.CREATE_OBJECT,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				CreateObject.encode(buffer, objectId, values),
		})
	}

	/**
	 * Deletes an object from a device
	 */
	public async deleteObject(
		receiver: BACNetAddress,
		objectId: BACNetObjectID,
		options: ServiceOptions = {},
	): Promise<void> {
		const settings = {
			maxSegments: options.maxSegments ?? MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu: options.maxApdu || MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(receiver),
		}
		await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.DELETE_OBJECT,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) => DeleteObject.encode(buffer, objectId),
		})
	}

	/**
	 * Removes an element from a list property
	 */
	public async removeListElement(
		receiver: BACNetAddress,
		objectId: BACNetObjectID,
		reference: {
			id: number
			index: number
		},
		values: BACNetAppData[],
		options: ServiceOptions = {},
	): Promise<void> {
		const settings = {
			maxSegments: options.maxSegments ?? MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu: options.maxApdu || MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(receiver),
		}
		await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.REMOVE_LIST_ELEMENT,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				AddListElement.encode(
					buffer,
					objectId,
					reference.id,
					reference.index,
					values,
				),
		})
	}

	/**
	 * Adds an element to a list property
	 */
	public async addListElement(
		receiver: BACNetAddress,
		objectId: BACNetObjectID,
		reference: {
			id: number
			index: number
		},
		values: BACNetAppData[],
		options: ServiceOptions = {},
	): Promise<void> {
		const settings = {
			maxSegments: options.maxSegments ?? MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu: options.maxApdu || MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(receiver),
		}
		await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.ADD_LIST_ELEMENT,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				AddListElement.encode(
					buffer,
					objectId,
					reference.id,
					reference.index,
					values,
				),
		})
	}

	/**
	 * Gets the alarm summary from a device.
	 */
	async getAlarmSummary(
		receiver: BACNetAddress,
		options: ServiceOptions = {},
	): Promise<BACNetAlarm[]> {
		const settings: ServiceOptions = {
			maxSegments:
				(options as ServiceOptions).maxSegments ??
				MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId ||
				this._getInvokeId(receiver),
		}
		const data = await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.GET_ALARM_SUMMARY,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: () => {},
		})
		const result = AlarmSummary.decode(
			data.buffer,
			data.offset,
			data.length,
		)
		if (!result) {
			throw new Error('INVALID_DECODING')
		}
		return result.alarms
	}

	/**
	 * Gets event information from a device.
	 *
	 * This method follows paged `GetEventInformation` responses automatically
	 * while `moreEvents` is set by the remote device.
	 */
	async getEventInformation(
		receiver: BACNetAddress,
		objectId?: BACNetObjectID | null,
		options: ServiceOptions = {},
	): Promise<BACNetEventInformation[]> {
		const settings: ServiceOptions = {
			maxSegments:
				(options as ServiceOptions).maxSegments ??
				MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				MaxApduLengthAccepted.OCTETS_1476,
		}
		const events: BACNetEventInformation[] = []
		let lastReceivedObjectId = objectId ?? null
		const maxPages = 1024

		for (let page = 0; page < maxPages; page++) {
			const invokeId =
				page === 0 && options.invokeId != null
					? options.invokeId
					: this._getInvokeId(receiver)
			const currentObjectId = lastReceivedObjectId
			const data = await this._sendConfirmedRequest({
				receiver,
				service: ConfirmedServiceChoice.GET_EVENT_INFORMATION,
				maxSegments: settings.maxSegments,
				maxApdu: settings.maxApdu,
				invokeId,
				segmentedRequest: options.segmentedRequest,
				encodePayload: (buffer) => {
					if (currentObjectId) {
						baAsn1.encodeContextObjectId(
							buffer,
							0,
							currentObjectId.type,
							currentObjectId.instance,
						)
					}
				},
			})
			const result = GetEventInformation.decodeAcknowledge(
				data.buffer,
				data.offset,
				data.length,
			)
			if (!result) {
				throw new Error('INVALID_DECODING')
			}
			events.push(...result.events)
			if (!result.moreEvents) {
				return events
			}
			const lastEvent = result.events[result.events.length - 1]
			if (!lastEvent?.objectId) {
				throw new Error('INVALID_DECODING')
			}
			lastReceivedObjectId = lastEvent.objectId
		}

		throw new Error('TOO_MANY_EVENT_PAGES')
	}

	/**
	 * Acknowledges an alarm.
	 *
	 * `options.acknowledgingProcessId` is mandatory and the call will throw
	 * `ACKNOWLEDGING_PROCESS_ID_REQUIRED` when it is omitted.
	 */
	async acknowledgeAlarm(
		receiver: BACNetAddress,
		objectId: BACNetObjectID,
		eventState: number,
		ackText: string,
		evTimeStamp: BACNetTimestamp,
		ackTimeStamp: BACNetTimestamp,
		options: AcknowledgeAlarmOptions,
	): Promise<void> {
		if (!options || options.acknowledgingProcessId == null) {
			throw new Error('ACKNOWLEDGING_PROCESS_ID_REQUIRED')
		}

		const settings: ServiceOptions = {
			maxSegments:
				(options as ServiceOptions).maxSegments ??
				MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId ||
				this._getInvokeId(receiver),
		}
		await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.ACKNOWLEDGE_ALARM,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				AlarmAcknowledge.encode(
					buffer,
					options.acknowledgingProcessId,
					objectId,
					eventState,
					ackText,
					evTimeStamp,
					ackTimeStamp,
				),
		})
	}

	/**
	 * Sends a confirmed private transfer.
	 */
	async confirmedPrivateTransfer(
		receiver: BACNetAddress,
		vendorId: number,
		serviceNumber: number,
		data: number[],
		options: ServiceOptions = {},
	): Promise<void> {
		const settings: ServiceOptions = {
			maxSegments:
				(options as ServiceOptions).maxSegments ??
				MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId ||
				this._getInvokeId(receiver),
		}
		await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.CONFIRMED_PRIVATE_TRANSFER,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				PrivateTransfer.encode(buffer, vendorId, serviceNumber, data),
		})
	}

	/**
	 * Sends an unconfirmed private transfer.
	 */
	unconfirmedPrivateTransfer(
		receiver: BACNetAddress,
		vendorId: number,
		serviceNumber: number,
		data: number[],
	): void {
		const buffer = this._getApduBuffer(receiver)
		baNpdu.encode(buffer, NpduControlPriority.NORMAL_MESSAGE, receiver)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			PduType.UNCONFIRMED_REQUEST,
			UnconfirmedServiceChoice.UNCONFIRMED_PRIVATE_TRANSFER,
		)
		PrivateTransfer.encode(buffer, vendorId, serviceNumber, data)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Gets enrollment summary from a device.
	 */
	async getEnrollmentSummary(
		receiver: BACNetAddress,
		acknowledgmentFilter: number,
		options: EnrollmentOptions = {},
	): Promise<EnrollmentSummaryAcknowledge> {
		const settings: ServiceOptions = {
			maxSegments: options.maxSegments ?? MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu: options.maxApdu || MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(receiver),
		}
		const data = await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.GET_ENROLLMENT_SUMMARY,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				GetEnrollmentSummary.encode(
					buffer,
					acknowledgmentFilter,
					options.enrollmentFilter,
					options.eventStateFilter,
					options.eventTypeFilter,
					options.priorityFilter,
					options.notificationClassFilter,
				),
		})
		const result = GetEnrollmentSummary.decodeAcknowledge(
			data.buffer,
			data.offset,
			data.length,
		)
		if (!result) {
			throw new Error('INVALID_DECODING')
		}
		return result
	}

	/**
	 * Sends an unconfirmed event notification.
	 */
	unconfirmedEventNotification(
		receiver: BACNetAddress,
		eventNotification: EventNotifyDataParams,
	): void {
		const buffer = this._getApduBuffer(receiver)
		baNpdu.encode(buffer, NpduControlPriority.NORMAL_MESSAGE, receiver)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			PduType.UNCONFIRMED_REQUEST,
			UnconfirmedServiceChoice.UNCONFIRMED_EVENT_NOTIFICATION,
		)
		EventNotifyData.encode(buffer, eventNotification)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Sends a confirmed event notification.
	 */
	async confirmedEventNotification(
		receiver: BACNetAddress,
		eventNotification: EventNotifyDataParams,
		options: ServiceOptions = {},
	): Promise<void> {
		const settings: ServiceOptions = {
			maxSegments:
				(options as ServiceOptions).maxSegments ??
				MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId ||
				this._getInvokeId(receiver),
		}
		await this._sendConfirmedRequest({
			receiver,
			service: ConfirmedServiceChoice.CONFIRMED_EVENT_NOTIFICATION,
			maxSegments: settings.maxSegments,
			maxApdu: settings.maxApdu,
			invokeId: settings.invokeId,
			segmentedRequest: options.segmentedRequest,
			encodePayload: (buffer) =>
				EventNotifyData.encode(buffer, eventNotification),
		})
	}

	/**
	 * The readPropertyResponse call sends a response with information about one of our properties.
	 */
	readPropertyResponse(
		receiver: BACNetAddress,
		invokeId: number,
		objectId: BACNetObjectID,
		property: BACNetPropertyID,
		value: BACNetAppData[] | BACNetAppData,
		options: { forwardedFrom?: string } = {},
	): void {
		const buffer = this._getApduBuffer(receiver)
		baNpdu.encode(buffer, NpduControlPriority.NORMAL_MESSAGE, receiver)
		baApdu.encodeComplexAck(
			buffer,
			PduType.COMPLEX_ACK,
			ConfirmedServiceChoice.READ_PROPERTY,
			invokeId,
		)

		const valueArray = Array.isArray(value) ? value : [value]

		ReadProperty.encodeAcknowledge(
			buffer,
			objectId,
			property.id,
			property.index,
			valueArray,
		)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Sends a response with information about multiple properties.
	 */
	readPropertyMultipleResponse(
		receiver: BACNetAddress,
		invokeId: number,
		values: BACNetReadAccess[],
	): void {
		const buffer = this._getApduBuffer(receiver)
		baNpdu.encode(buffer, NpduControlPriority.NORMAL_MESSAGE, receiver)
		baApdu.encodeComplexAck(
			buffer,
			PduType.COMPLEX_ACK,
			ConfirmedServiceChoice.READ_PROPERTY_MULTIPLE,
			invokeId,
		)
		ReadPropertyMultiple.encodeAcknowledge(buffer, values)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * The iAmResponse command is sent as a reply to a whoIs request.
	 */
	iAmResponse(
		receiver: BACNetAddress,
		deviceId: number,
		segmentation: number,
		vendorId: number,
	): void {
		const buffer = this._getApduBuffer(receiver)
		baNpdu.encode(buffer, NpduControlPriority.NORMAL_MESSAGE, receiver)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			PduType.UNCONFIRMED_REQUEST,
			UnconfirmedServiceChoice.I_AM,
		)
		IAm.encode(
			buffer,
			deviceId,
			this._transport.getMaxPayload(),
			segmentation,
			vendorId,
		)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Sends an iHave response.
	 */
	iHaveResponse(
		receiver: BACNetAddress,
		deviceId: BACNetObjectID,
		objectId: BACNetObjectID,
		objectName: string,
	): void {
		const buffer = this._getApduBuffer(receiver)
		baNpdu.encode(buffer, NpduControlPriority.NORMAL_MESSAGE, receiver)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			PduType.UNCONFIRMED_REQUEST,
			UnconfirmedServiceChoice.I_HAVE,
		)
		IHave.encode(buffer, deviceId, objectId, objectName)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Sends a simple acknowledgement response.
	 */
	simpleAckResponse(
		receiver: BACNetAddress,
		service: number,
		invokeId: number,
	): void {
		const buffer = this._getApduBuffer(receiver)
		baNpdu.encode(buffer, NpduControlPriority.NORMAL_MESSAGE, receiver)
		baApdu.encodeSimpleAck(buffer, PduType.SIMPLE_ACK, service, invokeId)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Sends an error response.
	 */
	errorResponse(
		receiver: BACNetAddress,
		service: number,
		invokeId: number,
		errorClass: number,
		errorCode: number,
	): void {
		trace(
			`error response on ${JSON.stringify(receiver)} service: ${JSON.stringify(service)} invokeId: ${invokeId} errorClass: ${errorClass} errorCode: ${errorCode}`,
		)
		trace(
			`error message ${ErrorService.buildMessage({ class: errorClass, code: errorCode })}`,
		)
		const buffer = this._getApduBuffer(receiver)
		baNpdu.encode(buffer, NpduControlPriority.NORMAL_MESSAGE, receiver)
		baApdu.encodeError(buffer, PduType.ERROR, service, invokeId)
		ErrorService.encode(buffer, errorClass, errorCode)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Sends a reject response.
	 */
	rejectResponse(
		receiver: BACNetAddress,
		invokeId: number,
		rejectReason: number,
	): void {
		const buffer = this._getApduBuffer(receiver)
		baNpdu.encode(buffer, NpduControlPriority.NORMAL_MESSAGE, receiver)
		baApdu.encodeAbort(buffer, PduType.REJECT, invokeId, rejectReason)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Sends an abort response.
	 */
	abortResponse(
		receiver: BACNetAddress,
		invokeId: number,
		abortReason: number,
		isServer = true,
	): void {
		const buffer = this._getApduBuffer(receiver)
		baNpdu.encode(buffer, NpduControlPriority.NORMAL_MESSAGE, receiver)
		const pduType = PduType.ABORT | (isServer ? 0x01 : 0x00)
		baApdu.encodeAbort(buffer, pduType, invokeId, abortReason)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Sends a BACnet Virtual Link Control message.
	 */
	sendBvlc(receiver: BACNetAddress | null, buffer: EncodeBuffer): void {
		if (receiver && receiver.forwardedFrom) {
			// Remote node address given, forward to BBMD
			baBvlc.encode(
				buffer.buffer,
				BvlcResultPurpose.FORWARDED_NPDU,
				buffer.offset,
				receiver.forwardedFrom,
			)
		} else if (receiver && receiver.distributeBroadcastToNetwork) {
			// Foreign device broadcast distribution through BBMD (BVLC 0x09)
			baBvlc.encode(
				buffer.buffer,
				BvlcResultPurpose.DISTRIBUTE_BROADCAST_TO_NETWORK,
				buffer.offset,
			)
		} else if (receiver && receiver.address) {
			// Specific address, unicast
			baBvlc.encode(
				buffer.buffer,
				BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
				buffer.offset,
			)
		} else {
			// No address, broadcast
			baBvlc.encode(
				buffer.buffer,
				BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU,
				buffer.offset,
			)
		}

		this._send(buffer, receiver)
	}

	/**
	 * The resultResponse is a BVLC-Result message used to respond to certain events, such as BBMD registration.
	 * This message cannot be wrapped for passing through a BBMD, as it is used as a BBMD control message.
	 */
	resultResponse(receiver: BACNetAddress, resultCode: number): void {
		const buffer = this._getApduBuffer()
		baApdu.encodeResult(buffer, resultCode)
		baBvlc.encode(
			buffer.buffer,
			BvlcResultPurpose.BVLC_RESULT,
			buffer.offset,
		)
		this._send(buffer, receiver)
	}

	/**
	 * Unloads the current bacnet instance and closes the underlying UDP socket.
	 */
	close(): void {
		this._isClosed = true
		if (this._outgoingSegmentTransactions?.size) {
			const err = new Error('ERR_CLOSED')
			for (const state of Array.from(
				this._outgoingSegmentTransactions.values(),
			)) {
				this._failOutgoingSegmentTransaction(state, err)
			}
			this._outgoingSegmentTransactions.clear()
		}
		this._requestManager.clear(true)
		if (this._pendingForeignDeviceRegistrations?.size) {
			const err = new Error('ERR_CLOSED')
			for (const pending of this._pendingForeignDeviceRegistrations.values()) {
				pending.reject(err)
			}
			this._pendingForeignDeviceRegistrations.clear()
		}
		if (this._segmentAssemblyStates?.size) {
			for (const state of this._segmentAssemblyStates.values()) {
				if (state.timer) {
					clearTimeout(state.timer)
					state.timer = null
				}
			}
			this._segmentAssemblyStates.clear()
		}
		if (this._activeForeignDeviceRegistrations?.size) {
			for (const registration of this._activeForeignDeviceRegistrations.values()) {
				clearTimeout(registration.expiringTimer)
				clearTimeout(registration.expiryTimer)
			}
			this._activeForeignDeviceRegistrations.clear()
		}
		this._transport.close()
	}

	/**
	 * Helper function to take an array of enums and produce a bitstring suitable
	 * for inclusion as a property.
	 * @returns BACnet bitstring object
	 */
	static createBitstring(items: number[]): BACNetBitString {
		let offset = 0
		const bytes: number[] = []
		let bitsUsed = 0

		while (items.length) {
			// Find any values between offset and offset+8, for the next byte
			let value = 0
			items = items.filter((i) => {
				if (i >= offset + 8) {
					return true
				} // leave for future iteration
				value |= 1 << (i - offset)
				bitsUsed = Math.max(bitsUsed, i)
				return false // remove from list
			})
			bytes.push(value)
			offset += 8
		}
		bitsUsed++

		return {
			value: bytes,
			bitsUsed,
		}
	}
}
