"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const EventTypes_1 = require("./EventTypes");
const debug_1 = __importDefault(require("debug"));
const transport_1 = __importDefault(require("./transport"));
const services_1 = __importStar(require("./services"));
const baAsn1 = __importStar(require("./asn1"));
const baApdu = __importStar(require("./apdu"));
const baNpdu = __importStar(require("./npdu"));
const baBvlc = __importStar(require("./bvlc"));
const errors_1 = require("./errors");
const util_1 = require("util");
const enum_1 = require("./enum");
const request_manager_1 = require("./request-manager");
const transaction_key_1 = require("./transaction-key");
const buffer_1 = require("buffer");
const debug = (0, debug_1.default)('bacnet:client:debug');
const trace = (0, debug_1.default)('bacnet:client:trace');
const ALL_INTERFACES = '0.0.0.0';
const LOCALHOST_INTERFACES_IPV4 = '127.0.0.1';
const BROADCAST_ADDRESS = '255.255.255.255';
const DEFAULT_HOP_COUNT = 0xff;
const BVLC_HEADER_LENGTH = 4;
const BVLC_FWD_HEADER_LENGTH = 10;
const CONFIRMED_REQUEST_HEADER_LENGTH = 4;
const SEGMENTED_CONFIRMED_REQUEST_HEADER_LENGTH = 6;
const MIN_SEGMENT_WINDOW_SIZE = 1;
const MAX_SEGMENT_WINDOW_SIZE = 127;
const DEFAULT_SEGMENT_MAX_RETRIES = 3;
const OUTGOING_SEGMENT_PAYLOAD_BUFFER_LENGTH = 1 << 20;
const BACNET_IP_MAX_APDU_OCTETS = 1476;
const ACCEPTED_SEGMENTED_RESPONSE_UNSPECIFIED_MAX = -1;
const beU = enum_1.UnconfirmedServiceChoice;
const unconfirmedServiceMap = {
    [beU.I_AM]: 'iAm',
    [beU.WHO_IS]: 'whoIs',
    [beU.WHO_HAS]: 'whoHas',
    [beU.UNCONFIRMED_COV_NOTIFICATION]: 'covNotifyUnconfirmed',
    [beU.TIME_SYNCHRONIZATION]: 'timeSync',
    [beU.UTC_TIME_SYNCHRONIZATION]: 'timeSyncUTC',
    [beU.UNCONFIRMED_EVENT_NOTIFICATION]: 'eventNotify',
    [beU.I_HAVE]: 'iHave',
    [beU.UNCONFIRMED_PRIVATE_TRANSFER]: 'privateTransfer',
};
const beC = enum_1.ConfirmedServiceChoice;
const confirmedServiceMap = {
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
};
class BACnetClient extends EventTypes_1.TypedEventEmitter {
    _settings;
    _transport;
    _pendingForeignDeviceRegistrations;
    _activeForeignDeviceRegistrations;
    _invokeCounters;
    _activeInvokeIds;
    _linkQueues;
    _requestManager;
    _pendingRequestMaxSegments;
    _segmentAssemblyStates;
    _outgoingSegmentTransactions;
    _isClosed = false;
    constructor(options) {
        super();
        options = options || {};
        this._settings = {
            port: options.port || enum_1.DEFAULT_BACNET_PORT,
            interface: options.interface || ALL_INTERFACES,
            transport: options.transport,
            broadcastAddress: options.broadcastAddress || BROADCAST_ADDRESS,
            apduTimeout: options.apduTimeout || 3000,
            abortOnSegmentedResponseWhenNoSegAccepted: options.abortOnSegmentedResponseWhenNoSegAccepted || false,
            requireActiveFdrForForwardedNpdu: options.requireActiveFdrForForwardedNpdu || false,
        };
        this._requestManager = new request_manager_1.RequestManager(this._settings.apduTimeout);
        options.reuseAddr =
            options.reuseAddr === undefined ? true : !!options.reuseAddr;
        this._transport =
            this._settings.transport ||
                new transport_1.default({
                    port: this._settings.port,
                    interface: this._settings.interface,
                    broadcastAddress: this._settings.broadcastAddress,
                    reuseAddr: options.reuseAddr,
                });
        this._transport.on('message', this._receiveData.bind(this));
        this._transport.on('error', this._receiveError.bind(this));
        this._transport.on('listening', () => this.emit('listening'));
        this._transport.open();
    }
    _send(buffer, receiver) {
        this._transport.send(buffer.buffer, buffer.offset, receiver?.address);
    }
    _getInvokeCounters() {
        if (!this._invokeCounters) {
            this._invokeCounters = new Map();
        }
        return this._invokeCounters;
    }
    _getActiveInvokeIds() {
        if (!this._activeInvokeIds) {
            this._activeInvokeIds = new Map();
        }
        return this._activeInvokeIds;
    }
    _getInvokeId(receiver) {
        const linkKey = (0, transaction_key_1.getLinkKey)(receiver);
        const counters = this._getInvokeCounters();
        const active = this._activeInvokeIds?.get(linkKey);
        const start = counters.get(linkKey) ?? 0;
        for (let i = 0; i < 256; i++) {
            const id = (start + i) & 0xff;
            if (!active?.has(id)) {
                counters.set(linkKey, (id + 1) & 0xff);
                return id;
            }
        }
        throw new Error('ERR_MAX_CONCURRENT_REQUESTS');
    }
    _acquireInvokeId(linkKey, invokeId, service) {
        const activeIds = this._getActiveInvokeIds();
        let active = activeIds.get(linkKey);
        if (!active) {
            active = new Set();
            activeIds.set(linkKey, active);
        }
        if (active.has(invokeId)) {
            throw new errors_1.InvokeIdInUseError({ peer: linkKey, invokeId, service });
        }
        active.add(invokeId);
    }
    _releaseInvokeId(linkKey, invokeId) {
        const active = this._activeInvokeIds?.get(linkKey);
        if (!active)
            return;
        active.delete(invokeId);
        if (active.size === 0) {
            this._activeInvokeIds.delete(linkKey);
        }
    }
    _getLinkQueues() {
        if (!this._linkQueues) {
            this._linkQueues = new Map();
        }
        return this._linkQueues;
    }
    async _runSerializedOnLink(linkKey, task) {
        const queues = this._getLinkQueues();
        let state = queues.get(linkKey);
        if (!state) {
            state = { busy: false, waiting: [] };
            queues.set(linkKey, state);
        }
        if (state.busy) {
            await new Promise((resolve) => state.waiting.push(resolve));
        }
        else {
            state.busy = true;
        }
        try {
            if (this._isClosed) {
                throw new Error('ERR_CLOSED');
            }
            return await task();
        }
        finally {
            const next = state.waiting.shift();
            if (next) {
                next();
            }
            else {
                state.busy = false;
                if (queues.get(linkKey) === state) {
                    queues.delete(linkKey);
                }
            }
        }
    }
    _responseKeyCandidates(header, invokeId) {
        const keys = [];
        const push = (key) => {
            if (!keys.includes(key))
                keys.push(key);
        };
        const sender = header?.sender;
        const addressLink = (0, transaction_key_1.normalizeAddress)(sender?.address);
        if (addressLink)
            push(`${addressLink}#${invokeId}`);
        if (sender?.forwardedFrom) {
            const forwardedLink = (0, transaction_key_1.normalizeAddress)(sender.forwardedFrom);
            if (forwardedLink)
                push(`${forwardedLink}#${invokeId}`);
        }
        push(`${transaction_key_1.UNKNOWN_PEER_KEY}#${invokeId}`);
        return keys;
    }
    _resolvePendingRequest(header, invokeId, err, result) {
        for (const candidate of this._responseKeyCandidates(header, invokeId)) {
            const resolved = err
                ? this._requestManager.resolve(candidate, err)
                : this._requestManager.resolve(candidate, null, result);
            if (resolved)
                return true;
        }
        return false;
    }
    _getPendingMaxSegments(header, invokeId) {
        const pending = this._pendingRequestMaxSegments;
        if (!pending?.size)
            return undefined;
        for (const candidate of this._responseKeyCandidates(header, invokeId)) {
            const maxSegments = pending.get(candidate);
            if (maxSegments !== undefined)
                return maxSegments;
        }
        return undefined;
    }
    _getApduBuffer(address) {
        const isForwarded = !!address?.forwardedFrom;
        return {
            buffer: buffer_1.Buffer.alloc(this._transport.getMaxPayload()),
            offset: isForwarded ? BVLC_FWD_HEADER_LENGTH : BVLC_HEADER_LENGTH,
        };
    }
    _getResponseBuffer(address) {
        const isForwarded = !!address?.forwardedFrom;
        return {
            buffer: buffer_1.Buffer.alloc(OUTGOING_SEGMENT_PAYLOAD_BUFFER_LENGTH),
            offset: isForwarded ? BVLC_FWD_HEADER_LENGTH : BVLC_HEADER_LENGTH,
        };
    }
    _responseOverflowReason(segmentedResponseAccepted) {
        return segmentedResponseAccepted
            ? enum_1.AbortReason.BUFFER_OVERFLOW
            : enum_1.AbortReason.SEGMENTATION_NOT_SUPPORTED;
    }
    _responseExceedsLimits(buffer, apduStart, maxApduLength) {
        const apduLength = buffer.offset - apduStart;
        const transportLimit = this._transport.getMaxPayload() - apduStart;
        const requesterLimit = typeof maxApduLength === 'number' && maxApduLength > 0
            ? maxApduLength
            : Infinity;
        return apduLength > Math.min(transportLimit, requesterLimit);
    }
    _normalizeAddress(address, strictPort = false) {
        return (0, transaction_key_1.normalizeAddress)(address, strictPort);
    }
    _getPendingForeignDeviceRegistrations() {
        if (!this._pendingForeignDeviceRegistrations) {
            this._pendingForeignDeviceRegistrations = new Map();
        }
        return this._pendingForeignDeviceRegistrations;
    }
    _getPendingRequestMaxSegments() {
        if (!this._pendingRequestMaxSegments) {
            this._pendingRequestMaxSegments = new Map();
        }
        return this._pendingRequestMaxSegments;
    }
    _getSegmentAssemblyStates() {
        if (!this._segmentAssemblyStates) {
            this._segmentAssemblyStates = new Map();
        }
        return this._segmentAssemblyStates;
    }
    _getSegmentAssemblyKey(msg, server) {
        if (server) {
            return `srv|${(0, transaction_key_1.getPeerKey)(msg.header?.sender)}#${msg.invokeId}`;
        }
        return `cli|${(0, transaction_key_1.getTransactionKey)(msg.header?.sender, msg.invokeId)}`;
    }
    _getOutgoingSegmentTransactions() {
        if (!this._outgoingSegmentTransactions) {
            this._outgoingSegmentTransactions = new Map();
        }
        return this._outgoingSegmentTransactions;
    }
    async _sendConfirmedRequest(args) {
        const linkKey = (0, transaction_key_1.getLinkKey)(args.receiver);
        this._acquireInvokeId(linkKey, args.invokeId, args.service);
        const startedAt = Date.now();
        try {
            let result;
            if ((0, transaction_key_1.isRoutedPeer)(args.receiver)) {
                result = await this._runSerializedOnLink(linkKey, () => this._dispatchConfirmedRequest(args));
            }
            else {
                result = await this._dispatchConfirmedRequest(args);
            }
            this._emitTransactionOutcome(args, linkKey, startedAt, null);
            return result;
        }
        catch (err) {
            this._emitTransactionOutcome(args, linkKey, startedAt, err);
            throw err;
        }
        finally {
            this._releaseInvokeId(linkKey, args.invokeId);
        }
    }
    _emitTransactionOutcome(args, link, startedAt, err) {
        if (this.listenerCount('transaction') === 0)
            return;
        const outcome = {
            service: args.service,
            invokeId: args.invokeId,
            link,
            receiver: args.receiver,
            disposition: 'ack',
            segmentedRequest: !!args.segmentedRequest?.enabled,
            acceptedSegmentedResponse: !!args.acceptSegmentedResponse,
            durationMs: Date.now() - startedAt,
        };
        if (err) {
            const message = err.message || String(err);
            let match;
            if ((match = message.match(/^BacnetError - Class:(\d+) - Code:(\d+)/))) {
                outcome.disposition = 'error';
                outcome.errorClass = Number(match[1]);
                outcome.errorCode = Number(match[2]);
            }
            else if ((match = message.match(/^BacnetReject - Reason:(\d+)/))) {
                outcome.disposition = 'reject';
                outcome.rejectReason = Number(match[1]);
            }
            else if ((match = message.match(/^BacnetAbort - Reason:(\d+)/))) {
                outcome.disposition = 'abort';
                outcome.abortReason = Number(match[1]);
            }
            else if (message === 'ERR_TIMEOUT') {
                outcome.disposition = 'timeout';
            }
            else {
                outcome.disposition = 'failed';
                outcome.errorMessage = message;
            }
        }
        this.emit('transaction', outcome);
    }
    async _dispatchConfirmedRequest(args) {
        const acceptsSegmentedResponse = !!args.acceptSegmentedResponse;
        const baseType = enum_1.PduType.CONFIRMED_REQUEST |
            (acceptsSegmentedResponse
                ? enum_1.PduConReqBit.SEGMENTED_RESPONSE_ACCEPTED
                : 0);
        const responseMaxSegments = acceptsSegmentedResponse
            ? args.maxSegments === enum_1.MaxSegmentsAccepted.SEGMENTS_0
                ? ACCEPTED_SEGMENTED_RESPONSE_UNSPECIFIED_MAX
                : args.maxSegments
            : enum_1.MaxSegmentsAccepted.SEGMENTS_0;
        if (args.segmentedRequest?.enabled) {
            return this._sendSegmentedConfirmedRequest(args, baseType, responseMaxSegments);
        }
        const buffer = this._getApduBuffer(args.receiver);
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE | enum_1.NpduControlBit.EXPECTING_REPLY, args.receiver, null, DEFAULT_HOP_COUNT, enum_1.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK, 0);
        const apduStart = buffer.offset;
        baApdu.encodeConfirmedServiceRequest(buffer, baseType, args.service, args.maxSegments, args.maxApdu, args.invokeId, 0, 0);
        const remoteLimit = args.segmentedRequest?.remoteMaxApduLength;
        if (args.segmentedRequest) {
            const payload = {
                buffer: buffer_1.Buffer.alloc(OUTGOING_SEGMENT_PAYLOAD_BUFFER_LENGTH),
                offset: 0,
            };
            args.encodePayload(payload);
            const apduLength = CONFIRMED_REQUEST_HEADER_LENGTH + payload.offset;
            if (remoteLimit !== undefined && apduLength > remoteLimit) {
                throw new errors_1.ApduTooLargeError({
                    encodedLength: apduLength,
                    maximumLength: remoteLimit,
                    service: args.service,
                    invokeId: args.invokeId,
                    segmentationAvailable: true,
                });
            }
            if (buffer.offset + payload.offset > buffer.buffer.length) {
                throw new errors_1.ApduTooLargeError({
                    encodedLength: apduLength,
                    maximumLength: buffer.buffer.length - apduStart,
                    service: args.service,
                    invokeId: args.invokeId,
                    segmentationAvailable: true,
                });
            }
            payload.buffer.copy(buffer.buffer, buffer.offset, 0, payload.offset);
            buffer.offset += payload.offset;
        }
        else {
            try {
                args.encodePayload(buffer);
            }
            catch (error) {
                if (error instanceof RangeError) {
                    throw new errors_1.ApduTooLargeError({
                        encodedLength: buffer.offset - apduStart,
                        maximumLength: buffer.buffer.length - apduStart,
                        service: args.service,
                        invokeId: args.invokeId,
                        segmentationAvailable: true,
                    });
                }
                throw error;
            }
            if (buffer.offset > buffer.buffer.length) {
                throw new errors_1.ApduTooLargeError({
                    encodedLength: buffer.offset - apduStart,
                    maximumLength: buffer.buffer.length - apduStart,
                    service: args.service,
                    invokeId: args.invokeId,
                    segmentationAvailable: true,
                });
            }
        }
        this.sendBvlc(args.receiver, buffer);
        return this._awaitResponse(args.receiver, args.invokeId, responseMaxSegments);
    }
    async _sendSegmentedConfirmedRequest(args, baseType, responseMaxSegments) {
        const seg = args.segmentedRequest;
        const remoteMax = seg.remoteMaxApduLength;
        if (!Number.isInteger(remoteMax) ||
            remoteMax < SEGMENTED_CONFIRMED_REQUEST_HEADER_LENGTH + 1) {
            throw new errors_1.InvalidSegmentedRequestError({
                option: 'remoteMaxApduLength',
                value: remoteMax,
                reason: `must be an integer of at least ${SEGMENTED_CONFIRMED_REQUEST_HEADER_LENGTH + 1} octets to fit a segmented request APDU with at least one payload octet`,
                service: args.service,
                invokeId: args.invokeId,
            });
        }
        const proposedWindowSize = seg.proposedWindowSize ?? MIN_SEGMENT_WINDOW_SIZE;
        if (!Number.isInteger(proposedWindowSize) ||
            proposedWindowSize < MIN_SEGMENT_WINDOW_SIZE ||
            proposedWindowSize > MAX_SEGMENT_WINDOW_SIZE) {
            throw new errors_1.InvalidSegmentedRequestError({
                option: 'proposedWindowSize',
                value: seg.proposedWindowSize,
                reason: `must be an integer in the range ${MIN_SEGMENT_WINDOW_SIZE}..${MAX_SEGMENT_WINDOW_SIZE}`,
                service: args.service,
                invokeId: args.invokeId,
            });
        }
        const maxRetries = seg.maxRetries ?? DEFAULT_SEGMENT_MAX_RETRIES;
        if (!Number.isInteger(maxRetries) || maxRetries < 0) {
            throw new errors_1.InvalidSegmentedRequestError({
                option: 'maxRetries',
                value: seg.maxRetries,
                reason: 'must be a non-negative integer',
                service: args.service,
                invokeId: args.invokeId,
            });
        }
        const segmentAckTimeout = seg.segmentAckTimeout ?? this._settings.apduTimeout;
        if (!Number.isInteger(segmentAckTimeout) || segmentAckTimeout <= 0) {
            throw new errors_1.InvalidSegmentedRequestError({
                option: 'segmentAckTimeout',
                value: seg.segmentAckTimeout,
                reason: 'must be a positive integer of milliseconds',
                service: args.service,
                invokeId: args.invokeId,
            });
        }
        if (seg.remoteMaxSegmentsAccepted !== undefined &&
            (!Number.isInteger(seg.remoteMaxSegmentsAccepted) ||
                seg.remoteMaxSegmentsAccepted < 1)) {
            throw new errors_1.InvalidSegmentedRequestError({
                option: 'remoteMaxSegmentsAccepted',
                value: seg.remoteMaxSegmentsAccepted,
                reason: 'must be a positive integer',
                service: args.service,
                invokeId: args.invokeId,
            });
        }
        const payload = {
            buffer: buffer_1.Buffer.alloc(OUTGOING_SEGMENT_PAYLOAD_BUFFER_LENGTH),
            offset: 0,
        };
        args.encodePayload(payload);
        if (payload.offset > payload.buffer.length) {
            throw new errors_1.ApduTooLargeError({
                encodedLength: payload.offset,
                maximumLength: payload.buffer.length,
                service: args.service,
                invokeId: args.invokeId,
                segmentationAvailable: false,
            });
        }
        const npduProbe = {
            buffer: buffer_1.Buffer.alloc(64),
            offset: 0,
        };
        baNpdu.encode(npduProbe, enum_1.NpduControlPriority.NORMAL_MESSAGE | enum_1.NpduControlBit.EXPECTING_REPLY, args.receiver, null, DEFAULT_HOP_COUNT, enum_1.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK, 0);
        const bvlcLength = args.receiver?.forwardedFrom
            ? BVLC_FWD_HEADER_LENGTH
            : BVLC_HEADER_LENGTH;
        const transportApduSpace = this._transport.getMaxPayload() - bvlcLength - npduProbe.offset;
        const segmentApduLimit = Math.min(remoteMax, transportApduSpace);
        const segmentCapacity = segmentApduLimit - SEGMENTED_CONFIRMED_REQUEST_HEADER_LENGTH;
        if (segmentCapacity < 1) {
            throw new errors_1.InvalidSegmentedRequestError({
                option: 'remoteMaxApduLength',
                value: remoteMax,
                reason: 'leaves no room for segment payload octets',
                service: args.service,
                invokeId: args.invokeId,
            });
        }
        const totalSegments = Math.max(1, Math.ceil(payload.offset / segmentCapacity));
        if (seg.remoteMaxSegmentsAccepted !== undefined &&
            totalSegments > seg.remoteMaxSegmentsAccepted) {
            throw new errors_1.SegmentCountExceededError({
                requiredSegments: totalSegments,
                maximumSegments: seg.remoteMaxSegmentsAccepted,
                service: args.service,
                invokeId: args.invokeId,
            });
        }
        const payloadView = payload.buffer.subarray(0, payload.offset);
        if (totalSegments === 1) {
            const buffer = this._getApduBuffer(args.receiver);
            baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE |
                enum_1.NpduControlBit.EXPECTING_REPLY, args.receiver, null, DEFAULT_HOP_COUNT, enum_1.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK, 0);
            baApdu.encodeConfirmedServiceRequest(buffer, baseType, args.service, args.maxSegments, args.maxApdu, args.invokeId, 0, 0);
            payloadView.copy(buffer.buffer, buffer.offset);
            buffer.offset += payloadView.length;
            this.sendBvlc(args.receiver, buffer);
            return this._awaitResponse(args.receiver, args.invokeId, responseMaxSegments);
        }
        const key = (0, transaction_key_1.getTransactionKey)(args.receiver, args.invokeId);
        const transactions = this._getOutgoingSegmentTransactions();
        if (transactions.has(key)) {
            throw new errors_1.InvalidSegmentedRequestError({
                option: 'invokeId',
                value: args.invokeId,
                reason: 'a segmented request with this invokeId to this receiver is already in progress',
                service: args.service,
                invokeId: args.invokeId,
            });
        }
        if (this._isClosed) {
            throw new Error('ERR_CLOSED');
        }
        let resolveTransfer;
        let rejectTransfer;
        const transferPromise = new Promise((resolve, reject) => {
            resolveTransfer = resolve;
            rejectTransfer = reject;
        });
        const state = {
            key,
            receiver: args.receiver,
            service: args.service,
            invokeId: args.invokeId,
            maxSegments: args.maxSegments,
            responseMaxSegments,
            maxApdu: args.maxApdu,
            baseType,
            payload: payload.buffer.subarray(0, payload.offset),
            segmentCapacity,
            totalSegments,
            proposedWindowSize,
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
        };
        transactions.set(key, state);
        try {
            this._sendSegmentWindow(state);
            await state.transferPromise;
            return await state.responsePromise;
        }
        finally {
            this._cleanupOutgoingSegmentTransaction(state);
        }
    }
    _sendSegment(state, index) {
        const buffer = this._getApduBuffer(state.receiver);
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE | enum_1.NpduControlBit.EXPECTING_REPLY, state.receiver, null, DEFAULT_HOP_COUNT, enum_1.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK, 0);
        const moreFollows = index < state.totalSegments - 1;
        const type = state.baseType |
            enum_1.PduConReqBit.SEGMENTED_MESSAGE |
            (moreFollows ? enum_1.PduConReqBit.MORE_FOLLOWS : 0);
        baApdu.encodeConfirmedServiceRequest(buffer, type, state.service, state.maxSegments, state.maxApdu, state.invokeId, index & 0xff, state.proposedWindowSize);
        const chunk = state.payload.subarray(index * state.segmentCapacity, Math.min((index + 1) * state.segmentCapacity, state.payload.length));
        chunk.copy(buffer.buffer, buffer.offset);
        buffer.offset += chunk.length;
        this.sendBvlc(state.receiver, buffer);
    }
    _sendSegmentWindow(state) {
        const first = state.initialSequenceAbs;
        const last = Math.min(first + state.actualWindowSize - 1, state.totalSegments - 1);
        for (let index = first; index <= last; index++) {
            this._sendSegment(state, index);
        }
        if (last === state.totalSegments - 1 && !state.responseRegistered) {
            state.responseRegistered = true;
            state.responsePromise = this._awaitResponse(state.receiver, state.invokeId, state.responseMaxSegments);
            state.responsePromise.catch(() => { });
        }
        this._restartSegmentTimer(state);
    }
    _restartSegmentTimer(state) {
        if (state.timer) {
            clearTimeout(state.timer);
        }
        state.timer = setTimeout(() => {
            this._onSegmentAckTimeout(state);
        }, state.segmentAckTimeout);
        if (typeof state.timer.unref === 'function') {
            state.timer.unref();
        }
    }
    _onSegmentAckTimeout(state) {
        if (state.done) {
            return;
        }
        state.retryCount++;
        if (state.retryCount > state.maxRetries) {
            this.abortResponse(state.receiver, state.invokeId, enum_1.AbortReason.TSM_TIMEOUT, false);
            this._failOutgoingSegmentTransaction(state, new errors_1.SegmentAckTimeoutError({
                service: state.service,
                invokeId: state.invokeId,
                retries: state.maxRetries,
            }));
            return;
        }
        trace(`SegmentACK timeout for invokeId ${state.invokeId}, retry ${state.retryCount}/${state.maxRetries}`);
        this._sendSegmentWindow(state);
    }
    _completeOutgoingSegmentTransfer(state) {
        if (state.done) {
            return;
        }
        state.done = true;
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
        this._getOutgoingSegmentTransactions().delete(state.key);
        state.resolveTransfer();
    }
    _failOutgoingSegmentTransaction(state, err) {
        if (state.done) {
            return;
        }
        state.done = true;
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
        this._getOutgoingSegmentTransactions().delete(state.key);
        if (state.responseRegistered) {
            this._requestManager.resolve(state.key, err);
        }
        state.rejectTransfer(err);
    }
    _cleanupOutgoingSegmentTransaction(state) {
        state.done = true;
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
        this._getOutgoingSegmentTransactions().delete(state.key);
    }
    _findOutgoingSegmentTransaction(header, invokeId) {
        if (!this._outgoingSegmentTransactions?.size) {
            return undefined;
        }
        for (const key of this._responseKeyCandidates(header, invokeId)) {
            const state = this._outgoingSegmentTransactions.get(key);
            if (state)
                return state;
        }
        return undefined;
    }
    _completeSegmentTransferOnResponse(header, invokeId) {
        const state = this._findOutgoingSegmentTransaction(header, invokeId);
        if (state && state.responseRegistered) {
            this._completeOutgoingSegmentTransfer(state);
        }
    }
    _failSegmentTransferOnTerminal(header, invokeId, err) {
        const state = this._findOutgoingSegmentTransaction(header, invokeId);
        if (state) {
            this._failOutgoingSegmentTransaction(state, err);
        }
    }
    async _awaitResponse(receiver, invokeId, maxSegments) {
        const key = (0, transaction_key_1.getTransactionKey)(receiver, invokeId);
        this._getPendingRequestMaxSegments().set(key, maxSegments);
        try {
            return await this._requestManager.add(key);
        }
        finally {
            this._getPendingRequestMaxSegments().delete(key);
        }
    }
    _getActiveForeignDeviceRegistrations() {
        if (!this._activeForeignDeviceRegistrations) {
            this._activeForeignDeviceRegistrations = new Map();
        }
        return this._activeForeignDeviceRegistrations;
    }
    _setForeignDeviceRegistrationActive(normalizedAddress, ttlSeconds) {
        const active = this._getActiveForeignDeviceRegistrations();
        const previous = active.get(normalizedAddress);
        if (previous) {
            clearTimeout(previous.expiringTimer);
            clearTimeout(previous.expiryTimer);
        }
        const ttlMs = ttlSeconds * 1000;
        const now = Date.now();
        const expiresAt = now + ttlMs;
        const expiringDelayMs = Math.max(1, Math.floor(ttlMs * 0.8));
        const expiringTimer = setTimeout(() => {
            this.emit('fdrExpiring', {
                payload: {
                    address: normalizedAddress,
                    ttl: ttlSeconds,
                    expiresAt,
                },
            });
        }, expiringDelayMs);
        if (typeof expiringTimer.unref === 'function') {
            expiringTimer.unref();
        }
        const expiryTimer = setTimeout(() => {
            active.delete(normalizedAddress);
            this.emit('fdrExpired', {
                payload: {
                    address: normalizedAddress,
                    ttl: ttlSeconds,
                    expiredAt: Date.now(),
                },
            });
        }, ttlMs);
        if (typeof expiryTimer.unref === 'function') {
            expiryTimer.unref();
        }
        this.emit('fdrRegistered', {
            payload: {
                address: normalizedAddress,
                ttl: ttlSeconds,
                expiresAt,
            },
        });
        active.set(normalizedAddress, {
            ttl: ttlSeconds,
            expiresAt,
            expiringTimer,
            expiryTimer,
        });
    }
    _isForeignDeviceRegistrationActive(address) {
        const normalizedAddress = this._normalizeAddress(address);
        if (!normalizedAddress)
            return false;
        return this._getActiveForeignDeviceRegistrations().has(normalizedAddress);
    }
    _processError(invokeId, buffer, offset, length, header) {
        const result = services_1.ErrorService.decode(buffer, offset);
        if (!result)
            return debug('Couldn`t decode Error');
        const err = new Error(`BacnetError - Class:${result.class} - Code:${result.code}`);
        this._failSegmentTransferOnTerminal(header, invokeId, err);
        this._resolvePendingRequest(header, invokeId, err);
    }
    _processAbort(invokeId, reason, header, isReject = false) {
        const err = new Error(isReject
            ? `BacnetReject - Reason:${reason}`
            : `BacnetAbort - Reason:${reason}`);
        this._failSegmentTransferOnTerminal(header, invokeId, err);
        this._resolvePendingRequest(header, invokeId, err);
    }
    _segmentAckResponse(receiver, negative, server, originalInvokeId, sequencenumber, actualWindowSize) {
        const buffer = this._getApduBuffer(receiver);
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE, receiver, null, DEFAULT_HOP_COUNT, enum_1.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK, 0);
        baApdu.encodeSegmentAck(buffer, enum_1.PduType.SEGMENT_ACK |
            (negative ? enum_1.PduSegAckBit.NEGATIVE_ACK : 0) |
            (server ? enum_1.PduSegAckBit.SERVER : 0), originalInvokeId, sequencenumber, actualWindowSize);
        baBvlc.encode(buffer.buffer, enum_1.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
        this._send(buffer, receiver);
    }
    _performDefaultSegmentHandling(msg, assemblyState, first, moreFollows, buffer, offset, length) {
        if (first) {
            assemblyState.segments = [];
            msg.type &= ~enum_1.PduConReqBit.SEGMENTED_MESSAGE;
            let apduHeaderLen = 3;
            if ((msg.type & enum_1.PDU_TYPE_MASK) === enum_1.PduType.CONFIRMED_REQUEST) {
                apduHeaderLen = 4;
            }
            const apdubuffer = this._getApduBuffer();
            apdubuffer.offset = 0;
            buffer.copy(apdubuffer.buffer, apduHeaderLen, offset, offset + length);
            if ((msg.type & enum_1.PDU_TYPE_MASK) === enum_1.PduType.CONFIRMED_REQUEST) {
                const confirmedMsg = msg;
                baApdu.encodeConfirmedServiceRequest(apdubuffer, msg.type, confirmedMsg.service, confirmedMsg.maxSegments, confirmedMsg.maxApdu, confirmedMsg.invokeId, 0, 0);
            }
            else {
                const complexMsg = msg;
                baApdu.encodeComplexAck(apdubuffer, msg.type, complexMsg.service, complexMsg.invokeId, 0, 0);
            }
            assemblyState.segments.push(apdubuffer.buffer.slice(0, length + apduHeaderLen));
        }
        else {
            assemblyState.segments.push(buffer.slice(offset, offset + length));
        }
        if (!moreFollows) {
            const apduBuffer = buffer_1.Buffer.concat(assemblyState.segments);
            assemblyState.segments = [];
            msg.header.apduType &= ~enum_1.PduConReqBit.SEGMENTED_MESSAGE;
            this._handlePdu(apduBuffer, 0, apduBuffer.length, msg.header);
        }
    }
    _processSegment(msg, server, buffer, offset, length) {
        const key = this._getSegmentAssemblyKey(msg, server);
        const segmentStates = this._getSegmentAssemblyStates();
        const state = segmentStates.get(key) ?? {
            lastSequenceNumber: null,
            segments: [],
            segmentsSinceAck: 0,
            timer: null,
        };
        segmentStates.set(key, state);
        const actualWindowSize = Math.min(Math.max(msg.proposedWindowNumber || 1, 1), MAX_SEGMENT_WINDOW_SIZE);
        const first = msg.sequencenumber === 0 && state.lastSequenceNumber === null;
        if (!first) {
            const expectedSequence = ((state.lastSequenceNumber ?? 0) + 1) & 0xff;
            if (msg.sequencenumber !== expectedSequence) {
                this._touchSegmentAssemblyTimer(key, state);
                return this._segmentAckResponse(msg.header.sender, true, server, msg.invokeId, state.lastSequenceNumber ?? 0, actualWindowSize);
            }
        }
        state.lastSequenceNumber = msg.sequencenumber;
        state.segmentsSinceAck++;
        const moreFollows = !!(msg.type & enum_1.PduConReqBit.MORE_FOLLOWS);
        if (first ||
            state.segmentsSinceAck >= actualWindowSize ||
            !moreFollows) {
            this._segmentAckResponse(msg.header.sender, false, server, msg.invokeId, msg.sequencenumber, actualWindowSize);
            state.segmentsSinceAck = 0;
        }
        this._performDefaultSegmentHandling(msg, state, first, moreFollows, buffer, offset, length);
        if (!moreFollows) {
            if (state.timer) {
                clearTimeout(state.timer);
                state.timer = null;
            }
            segmentStates.delete(key);
        }
        else {
            this._touchSegmentAssemblyTimer(key, state);
        }
    }
    _touchSegmentAssemblyTimer(key, state) {
        if (state.timer) {
            clearTimeout(state.timer);
        }
        const timeout = this._settings?.apduTimeout ?? 3000;
        state.timer = setTimeout(() => {
            state.timer = null;
            this._getSegmentAssemblyStates().delete(key);
            trace(`Discarded incomplete segment assembly ${key} after ${timeout}ms`);
        }, timeout);
        if (typeof state.timer.unref === 'function') {
            state.timer.unref();
        }
    }
    _processSegmentAck(msg) {
        trace(`Received SegmentACK for invokeId ${msg.originalInvokeId} seq ${msg.sequencenumber} window ${msg.actualWindowSize}`);
        const state = this._findOutgoingSegmentTransaction(msg.header, msg.originalInvokeId);
        if (!state || state.done) {
            return trace(`SegmentACK for unknown or completed transaction -> Drop`);
        }
        if (!(msg.type & enum_1.PduSegAckBit.SERVER)) {
            return trace(`SegmentACK without server bit for outgoing request -> Drop`);
        }
        const negative = !!(msg.type & enum_1.PduSegAckBit.NEGATIVE_ACK);
        const offsetInWindow = (msg.sequencenumber - (state.initialSequenceAbs & 0xff)) & 0xff;
        const inWindow = offsetInWindow < state.actualWindowSize;
        if (!inWindow) {
            if (negative) {
                state.retryCount++;
                if (state.retryCount > state.maxRetries) {
                    this.abortResponse(state.receiver, state.invokeId, enum_1.AbortReason.TSM_TIMEOUT, false);
                    return this._failOutgoingSegmentTransaction(state, new errors_1.SegmentAckTimeoutError({
                        service: state.service,
                        invokeId: state.invokeId,
                        retries: state.maxRetries,
                    }));
                }
                return this._sendSegmentWindow(state);
            }
            return this._restartSegmentTimer(state);
        }
        if (msg.actualWindowSize >= MIN_SEGMENT_WINDOW_SIZE &&
            msg.actualWindowSize <= MAX_SEGMENT_WINDOW_SIZE) {
            state.actualWindowSize = msg.actualWindowSize;
        }
        const ackedAbs = state.initialSequenceAbs + offsetInWindow;
        if (ackedAbs >= state.totalSegments - 1) {
            return this._completeOutgoingSegmentTransfer(state);
        }
        state.initialSequenceAbs = ackedAbs + 1;
        if (negative) {
            state.retryCount++;
            if (state.retryCount > state.maxRetries) {
                this.abortResponse(state.receiver, state.invokeId, enum_1.AbortReason.TSM_TIMEOUT, false);
                return this._failOutgoingSegmentTransaction(state, new errors_1.SegmentAckTimeoutError({
                    service: state.service,
                    invokeId: state.invokeId,
                    retries: state.maxRetries,
                }));
            }
        }
        else {
            state.retryCount = 0;
        }
        this._sendSegmentWindow(state);
    }
    _processServiceRequest(serviceMap, content, buffer, offset, length) {
        const sender = content.header?.sender;
        if (sender?.address === LOCALHOST_INTERFACES_IPV4) {
            debug('Received and skipped localhost service request:', content.service);
            return;
        }
        const name = serviceMap[content.service];
        if (!name) {
            debug('Received unsupported service request:', content.service);
            this._rejectConfirmedServiceRequest(content, enum_1.RejectReason.UNRECOGNIZED_SERVICE);
            return;
        }
        const confirmedMsg = content;
        const id = confirmedMsg.invokeId
            ? `with invokeId ${confirmedMsg.invokeId}`
            : '';
        trace(`Received service request${id}:`, name);
        if (!this.listenerCount(name) &&
            !this.listenerCount('unhandledEvent')) {
            debug('Received request for unsupported service:', name);
            this._rejectConfirmedServiceRequest(content, enum_1.RejectReason.UNRECOGNIZED_SERVICE);
            return;
        }
        const serviceHandler = services_1.default[name];
        if (serviceHandler) {
            try {
                const utcDecoder = serviceHandler;
                content.payload =
                    name === 'timeSyncUTC' &&
                        typeof utcDecoder.decodeUtc === 'function'
                        ? utcDecoder.decodeUtc(buffer, offset, length)
                        : serviceHandler.decode(buffer, offset, length);
                trace(`Handled service request${id}:`, name, JSON.stringify(content));
            }
            catch (e) {
                debug('Exception thrown when processing message:', e);
                debug('Original message was', `${name}:`, content);
                this._rejectConfirmedServiceRequest(content, enum_1.RejectReason.INVALID_TAG);
                return;
            }
            if (!content.payload) {
                this._rejectConfirmedServiceRequest(content, enum_1.RejectReason.INVALID_TAG);
                return debug('Received invalid', name, 'message');
            }
            const consumed = content.payload.len;
            if (content.header?.confirmedService &&
                typeof consumed === 'number' &&
                Number.isFinite(consumed) &&
                consumed < length) {
                debug(`Confirmed ${name} request has ${length - consumed} trailing octet(s)`);
                this._rejectConfirmedServiceRequest(content, enum_1.RejectReason.TOO_MANY_ARGUMENTS);
                return;
            }
        }
        else {
            debug('No serviceHandler defined for:', name);
        }
        if (this.listenerCount(name)) {
            trace(`listener count by name emits ${name} with content. ${(0, util_1.format)('%o', content)}`);
            this.emit(name, content);
        }
        else {
            if (this.listenerCount('unhandledEvent')) {
                trace('unhandled event emitting with content');
                this.emit(name, content);
            }
            else {
                trace(`no unhandled event "${name}" handler with header: ${JSON.stringify(content.header)}`);
                if (content.header?.expectingReply) {
                    debug('Replying with reject for unhandled service:', name);
                    this._rejectConfirmedServiceRequest(content, enum_1.RejectReason.UNRECOGNIZED_SERVICE);
                }
            }
        }
    }
    _rejectConfirmedServiceRequest(content, reason) {
        const confirmedMsg = content;
        if (!content.header?.confirmedService ||
            confirmedMsg.invokeId === undefined ||
            !content.header.sender) {
            return;
        }
        content.header.sender.forwardedFrom = null;
        this.rejectResponse(content.header.sender, confirmedMsg.invokeId, reason);
    }
    _handlePdu(buffer, offset, length, header) {
        let msg;
        trace('handlePdu Header: ', header);
        switch (header.apduType & enum_1.PDU_TYPE_MASK) {
            case enum_1.PduType.UNCONFIRMED_REQUEST:
                msg = baApdu.decodeUnconfirmedServiceRequest(buffer, offset);
                msg.header = header;
                msg.header.confirmedService = false;
                this._processServiceRequest(unconfirmedServiceMap, msg, buffer, offset + msg.len, length - msg.len);
                break;
            case enum_1.PduType.SIMPLE_ACK:
                msg = baApdu.decodeSimpleAck(buffer, offset);
                offset += msg.len;
                length -= msg.len;
                this._completeSegmentTransferOnResponse(header, msg.invokeId);
                this._resolvePendingRequest(header, msg.invokeId, null, {
                    msg,
                    buffer,
                    offset,
                    length,
                });
                break;
            case enum_1.PduType.COMPLEX_ACK:
                msg = baApdu.decodeComplexAck(buffer, offset);
                msg.header = header;
                this._completeSegmentTransferOnResponse(header, msg.invokeId);
                const isSegmentedMessage = (header.apduType & enum_1.PduConReqBit.SEGMENTED_MESSAGE) !== 0;
                if (!isSegmentedMessage) {
                    this._resolvePendingRequest(header, msg.invokeId, null, {
                        msg,
                        buffer,
                        offset: offset + msg.len,
                        length: length - msg.len,
                    });
                }
                else {
                    const requestMaxSegments = this._getPendingMaxSegments(header, msg.invokeId);
                    if (this._settings
                        .abortOnSegmentedResponseWhenNoSegAccepted &&
                        requestMaxSegments === enum_1.MaxSegmentsAccepted.SEGMENTS_0) {
                        this.abortResponse(header.sender, msg.invokeId, enum_1.AbortReason.SEGMENTATION_NOT_SUPPORTED, false);
                        this._resolvePendingRequest(header, msg.invokeId, new Error(`BacnetAbort - Reason:${enum_1.AbortReason.SEGMENTATION_NOT_SUPPORTED}`));
                        break;
                    }
                    this._processSegment(msg, false, buffer, offset + msg.len, length - msg.len);
                }
                break;
            case enum_1.PduType.SEGMENT_ACK:
                msg = baApdu.decodeSegmentAck(buffer, offset);
                msg.header = header;
                this._processSegmentAck(msg);
                break;
            case enum_1.PduType.ERROR:
                msg = baApdu.decodeError(buffer, offset);
                this._processError(msg.invokeId, buffer, offset + msg.len, length - msg.len, header);
                break;
            case enum_1.PduType.REJECT:
            case enum_1.PduType.ABORT:
                msg = baApdu.decodeAbort(buffer, offset);
                this._processAbort(msg.invokeId, msg.reason, header, (header.apduType & enum_1.PDU_TYPE_MASK) === enum_1.PduType.REJECT);
                break;
            case enum_1.PduType.CONFIRMED_REQUEST:
                msg = baApdu.decodeConfirmedServiceRequest(buffer, offset);
                msg.header = header;
                msg.header.confirmedService = true;
                if ((header.apduType & enum_1.PduConReqBit.SEGMENTED_MESSAGE) === 0) {
                    this._processServiceRequest(confirmedServiceMap, msg, buffer, offset + msg.len, length - msg.len);
                }
                else {
                    this._processSegment(msg, true, buffer, offset + msg.len, length - msg.len);
                }
                break;
            default:
                debug(`Received unknown PDU type ${header.apduType} -> Drop packet`);
                break;
        }
    }
    _handleNpdu(buffer, offset, msgLength, header) {
        if (msgLength <= 0) {
            return trace('No NPDU data -> Drop package');
        }
        const result = baNpdu.decode(buffer, offset);
        if (!result) {
            return trace('Received invalid NPDU header -> Drop package');
        }
        if (result.funct & enum_1.NpduControlBit.NETWORK_LAYER_MESSAGE) {
            return trace('Received network layer message -> Drop package');
        }
        if (result.destination &&
            result.destination.net > 0 &&
            result.destination.net !== 0xffff) {
            return trace('Received NPDU addressed to remote network -> Drop package');
        }
        offset += result.len;
        msgLength -= result.len;
        if (msgLength <= 0) {
            return trace('No APDU data -> Drop package');
        }
        header.apduType = baApdu.getDecodedType(buffer, offset);
        header.expectingReply = !!(result.funct & enum_1.NpduControlBit.EXPECTING_REPLY);
        if ((header.apduType & enum_1.PDU_TYPE_MASK) === enum_1.PduType.CONFIRMED_REQUEST &&
            (header.func === enum_1.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU ||
                result.destination?.net === 0xffff)) {
            return trace('Received confirmed request as broadcast -> Drop package');
        }
        if (result.source) {
            header.sender.net = result.source.net;
            header.sender.adr = result.source.adr;
        }
        this._handlePdu(buffer, offset, msgLength, header);
    }
    _receiveData(buffer, remoteAddress) {
        if (buffer.length < BVLC_HEADER_LENGTH) {
            return trace('Received invalid data -> Drop package');
        }
        const result = baBvlc.decode(buffer, 0);
        if (!result) {
            return trace('Received invalid BVLC header -> Drop package');
        }
        const header = {
            func: result.func,
            sender: {
                address: remoteAddress,
                forwardedFrom: null,
            },
            apduType: 0,
            expectingReply: false,
        };
        switch (result.func) {
            case enum_1.BvlcResultPurpose.BVLC_RESULT: {
                if (result.msgLength - result.len < 2) {
                    return trace('Received invalid BVLC result message');
                }
                const bvlcResult = baApdu.decodeResult(buffer, result.len);
                this.emit('bvlcResult', {
                    header,
                    payload: bvlcResult,
                });
                break;
            }
            case enum_1.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU:
            case enum_1.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU:
                this._handleNpdu(buffer, result.len, buffer.length - result.len, header);
                break;
            case enum_1.BvlcResultPurpose.FORWARDED_NPDU:
                if (this._settings.requireActiveFdrForForwardedNpdu &&
                    !this._isForeignDeviceRegistrationActive(remoteAddress)) {
                    this.emit('forwardedNpduDroppedNoFdr', {
                        payload: { address: remoteAddress },
                    });
                    return trace('Received FORWARDED_NPDU without active foreign-device registration -> Drop package');
                }
                header.sender.forwardedFrom = result.originatingIP;
                this._handleNpdu(buffer, result.len, buffer.length - result.len, header);
                break;
            case enum_1.BvlcResultPurpose.REGISTER_FOREIGN_DEVICE: {
                const decodeResult = services_1.RegisterForeignDevice.decode(buffer, result.len, buffer.length - result.len);
                if (!decodeResult) {
                    return trace('Received invalid registerForeignDevice message');
                }
                if (this.listenerCount('registerForeignDevice') === 0) {
                    this.resultResponse(header.sender, enum_1.BvlcResultFormat.REGISTER_FOREIGN_DEVICE_NAK);
                    break;
                }
                this.emit('registerForeignDevice', {
                    header,
                    payload: decodeResult,
                });
                break;
            }
            case enum_1.BvlcResultPurpose.DISTRIBUTE_BROADCAST_TO_NETWORK:
                this.resultResponse(header.sender, enum_1.BvlcResultFormat.DISTRIBUTE_BROADCAST_TO_NETWORK_NAK);
                break;
            case enum_1.BvlcResultPurpose.WRITE_BROADCAST_DISTRIBUTION_TABLE:
                this.resultResponse(header.sender, enum_1.BvlcResultFormat.WRITE_BROADCAST_DISTRIBUTION_TABLE_NAK);
                break;
            case enum_1.BvlcResultPurpose.READ_BROADCAST_DISTRIBUTION_TABLE:
                this.resultResponse(header.sender, enum_1.BvlcResultFormat.READ_BROADCAST_DISTRIBUTION_TABLE_NAK);
                break;
            case enum_1.BvlcResultPurpose.READ_FOREIGN_DEVICE_TABLE:
                this.resultResponse(header.sender, enum_1.BvlcResultFormat.READ_FOREIGN_DEVICE_TABLE_NAK);
                break;
            case enum_1.BvlcResultPurpose.DELETE_FOREIGN_DEVICE_TABLE_ENTRY:
                this.resultResponse(header.sender, enum_1.BvlcResultFormat.DELETE_FOREIGN_DEVICE_TABLE_ENTRY_NAK);
                break;
            default:
                debug(`Received unknown BVLC function ${result.func} -> Drop package`);
                break;
        }
    }
    _receiveError(err) {
        this.emit('error', err);
    }
    whoIs(receiverOrOptions, options) {
        let receiver;
        if (!options) {
            if (receiverOrOptions &&
                typeof receiverOrOptions === 'object' &&
                ('lowLimit' in receiverOrOptions ||
                    'highLimit' in receiverOrOptions)) {
                options = receiverOrOptions;
                receiverOrOptions = undefined;
            }
            else {
                receiver = receiverOrOptions;
            }
        }
        else {
            receiver = receiverOrOptions;
        }
        options = options || {};
        const buffer = this._getApduBuffer(receiver);
        const npduDestination = receiver?.distributeBroadcastToNetwork
            ? undefined
            : receiver;
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE, npduDestination, null, DEFAULT_HOP_COUNT, enum_1.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK, 0);
        baApdu.encodeUnconfirmedServiceRequest(buffer, enum_1.PduType.UNCONFIRMED_REQUEST, enum_1.UnconfirmedServiceChoice.WHO_IS);
        services_1.WhoIs.encode(buffer, options.lowLimit, options.highLimit);
        this.sendBvlc(receiver, buffer);
    }
    whoIsThroughBBMD(bbmd, options) {
        if (!bbmd?.address) {
            throw new Error('whoIsThroughBBMD requires bbmd.address (bbmd_ip:port)');
        }
        this.whoIs({
            ...bbmd,
            distributeBroadcastToNetwork: true,
        }, options);
    }
    whoHas(receiverOrOptions, options) {
        let receiver;
        if (!options) {
            if (receiverOrOptions &&
                typeof receiverOrOptions === 'object' &&
                ('objectId' in receiverOrOptions ||
                    'objectName' in receiverOrOptions)) {
                options = receiverOrOptions;
                receiverOrOptions = undefined;
            }
            else {
                receiver = receiverOrOptions;
            }
        }
        else {
            receiver = receiverOrOptions;
        }
        options = options || {};
        const hasObjectId = !!(options.objectId &&
            Number.isFinite(options.objectId.type) &&
            Number.isFinite(options.objectId.instance));
        const hasObjectName = typeof options.objectName === 'string' && options.objectName !== '';
        if (hasObjectId === hasObjectName) {
            throw new Error('whoHas requires exactly one of objectId or objectName');
        }
        const hasRange = options.lowLimit !== undefined || options.highLimit !== undefined;
        if (hasRange &&
            !(Number.isInteger(options.lowLimit) &&
                Number.isInteger(options.highLimit) &&
                options.lowLimit >= 0 &&
                options.lowLimit <= enum_1.ASN1_MAX_INSTANCE &&
                options.highLimit >= 0 &&
                options.highLimit <= enum_1.ASN1_MAX_INSTANCE)) {
            throw new Error('whoHas device instance range requires both lowLimit and highLimit in 0..4194303');
        }
        const buffer = this._getApduBuffer(receiver);
        const npduDestination = receiver?.distributeBroadcastToNetwork
            ? undefined
            : receiver;
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE, npduDestination, null, DEFAULT_HOP_COUNT, enum_1.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK, 0);
        baApdu.encodeUnconfirmedServiceRequest(buffer, enum_1.PduType.UNCONFIRMED_REQUEST, enum_1.UnconfirmedServiceChoice.WHO_HAS);
        services_1.WhoHas.encode(buffer, hasRange ? options.lowLimit : -1, hasRange ? options.highLimit : -1, options.objectId ?? { type: 0, instance: 0 }, hasObjectName ? options.objectName : undefined);
        this.sendBvlc(receiver, buffer);
    }
    timeSync(receiver, dateTime) {
        const buffer = this._getApduBuffer(receiver);
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE, receiver);
        baApdu.encodeUnconfirmedServiceRequest(buffer, enum_1.PduType.UNCONFIRMED_REQUEST, enum_1.UnconfirmedServiceChoice.TIME_SYNCHRONIZATION);
        services_1.TimeSync.encode(buffer, dateTime);
        this.sendBvlc(receiver, buffer);
    }
    timeSyncUTC(receiver, dateTime) {
        const buffer = this._getApduBuffer(receiver);
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE, receiver);
        baApdu.encodeUnconfirmedServiceRequest(buffer, enum_1.PduType.UNCONFIRMED_REQUEST, enum_1.UnconfirmedServiceChoice.UTC_TIME_SYNCHRONIZATION);
        services_1.TimeSync.encodeUtc(buffer, dateTime);
        this.sendBvlc(receiver, buffer);
    }
    async registerForeignDevice(receiver, ttl) {
        if (this._isClosed) {
            throw new Error('ERR_CLOSED');
        }
        if (!receiver?.address) {
            throw new Error('registerForeignDevice requires receiver.address (bbmd_ip:port)');
        }
        if (!Number.isInteger(ttl) || ttl <= 0 || ttl > 0xffff) {
            throw new Error('registerForeignDevice ttl must be 1..65535 seconds');
        }
        const expectedAddress = this._normalizeAddress(receiver.address, true);
        if (!expectedAddress) {
            throw new Error(`Invalid receiver.address "${String(receiver.address)}"`);
        }
        const pendingRegistrations = this._getPendingForeignDeviceRegistrations();
        while (true) {
            const pending = pendingRegistrations.get(expectedAddress);
            if (!pending)
                break;
            if (pending.ttl === ttl)
                return pending.promise;
            try {
                await pending.promise;
            }
            catch (err) {
                if (err?.message === 'ERR_CLOSED') {
                    throw err;
                }
            }
            if (this._isClosed) {
                throw new Error('ERR_CLOSED');
            }
        }
        const buffer = this._getApduBuffer(receiver);
        services_1.RegisterForeignDevice.encode(buffer, ttl);
        baBvlc.encode(buffer.buffer, enum_1.BvlcResultPurpose.REGISTER_FOREIGN_DEVICE, buffer.offset);
        let rejectRegistration = (_err) => { };
        const registrationPromise = new Promise((resolve, reject) => {
            let settled = false;
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('ERR_TIMEOUT'));
            }, this._settings.apduTimeout || 3000);
            if (typeof timeout.unref === 'function') {
                ;
                timeout.unref();
            }
            const cleanup = () => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                this.off('bvlcResult', onResult);
            };
            rejectRegistration = (err) => {
                cleanup();
                reject(err);
            };
            const onResult = (content) => {
                if (this._normalizeAddress(content?.header?.sender?.address) !==
                    expectedAddress)
                    return;
                const resultCode = Number(content?.payload?.resultCode);
                if (resultCode === enum_1.BvlcResultFormat.SUCCESSFUL_COMPLETION) {
                    this._setForeignDeviceRegistrationActive(expectedAddress, ttl);
                    cleanup();
                    resolve();
                    return;
                }
                cleanup();
                reject(new Error(`BacnetError - Class:${enum_1.ErrorClass.COMMUNICATION} - Code:${enum_1.ErrorCode.REGISTER_FOREIGN_DEVICE_FAILED} - Result:${resultCode}`));
            };
            this.on('bvlcResult', onResult);
            this._send(buffer, receiver);
        });
        pendingRegistrations.set(expectedAddress, {
            ttl,
            promise: registrationPromise,
            reject: rejectRegistration,
        });
        try {
            await registrationPromise;
        }
        finally {
            const current = pendingRegistrations.get(expectedAddress);
            if (current?.promise === registrationPromise) {
                pendingRegistrations.delete(expectedAddress);
            }
        }
    }
    async readProperty(receiver, objectId, propertyId, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ??
                enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu ||
                enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId ||
                this._getInvokeId(receiver),
            arrayIndex: options.arrayIndex !== undefined
                ? options.arrayIndex
                : enum_1.ASN1_ARRAY_ALL,
        };
        const data = await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.READ_PROPERTY,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            acceptSegmentedResponse: true,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.ReadProperty.encode(buffer, objectId.type, objectId.instance, propertyId, settings.arrayIndex),
        });
        const result = services_1.ReadProperty.decodeAcknowledge(data.buffer, data.offset, data.length);
        if (!result) {
            throw new Error('INVALID_DECODING');
        }
        return result;
    }
    async writeProperty(receiver, objectId, propertyId, values, options) {
        const settings = {
            maxSegments: options.maxSegments ??
                enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu ||
                enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId ||
                this._getInvokeId(receiver),
            arrayIndex: options.arrayIndex ?? enum_1.ASN1_ARRAY_ALL,
            priority: options.priority ?? enum_1.ASN1_NO_PRIORITY,
        };
        await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.WRITE_PROPERTY,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            segmentedRequest: options?.segmentedRequest,
            encodePayload: (buffer) => services_1.WriteProperty.encode(buffer, objectId.type, objectId.instance, propertyId, settings.arrayIndex, settings.priority, values),
        });
    }
    async readPropertyMultiple(receiver, propertiesArray, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ??
                enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu ||
                enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId ||
                this._getInvokeId(receiver),
        };
        const data = await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.READ_PROPERTY_MULTIPLE,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            acceptSegmentedResponse: true,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.ReadPropertyMultiple.encode(buffer, propertiesArray),
        });
        const result = services_1.ReadPropertyMultiple.decodeAcknowledge(data.buffer, data.offset, data.length);
        if (!result) {
            throw new Error('INVALID_DECODING');
        }
        return result;
    }
    async writePropertyMultiple(receiver, values, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ??
                enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu ||
                enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId ||
                this._getInvokeId(receiver),
        };
        await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.WRITE_PROPERTY_MULTIPLE,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.WritePropertyMultiple.encodeObject(buffer, values),
        });
    }
    async confirmedCOVNotification(receiver, monitoredObject, subscribeId, initiatingDeviceId, lifetime, values, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ??
                enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu ||
                enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId ||
                this._getInvokeId(receiver),
        };
        await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.CONFIRMED_COV_NOTIFICATION,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.CovNotify.encode(buffer, subscribeId, initiatingDeviceId, monitoredObject, lifetime, values),
        });
    }
    async deviceCommunicationControl(receiver, timeDuration, enableDisable, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ??
                enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu ||
                enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId ||
                this._getInvokeId(receiver),
            password: options.password,
        };
        await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.DEVICE_COMMUNICATION_CONTROL,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.DeviceCommunicationControl.encode(buffer, timeDuration, enableDisable, settings.password),
        });
    }
    async reinitializeDevice(receiver, state, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ??
                enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu ||
                enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId ||
                this._getInvokeId(receiver),
            password: options.password,
        };
        await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.REINITIALIZE_DEVICE,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.ReinitializeDevice.encode(buffer, state, settings.password),
        });
    }
    async writeFile(receiver, objectId, position, fileBuffer, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ?? enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu || enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId || this._getInvokeId(receiver),
        };
        const isStream = options.isStream !== undefined ? options.isStream : true;
        const blocks = fileBuffer;
        const data = await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.ATOMIC_WRITE_FILE,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.AtomicWriteFile.encode(buffer, isStream, objectId, position, blocks),
        });
        const result = services_1.AtomicWriteFile.decodeAcknowledge(data.buffer, data.offset);
        if (!result) {
            throw new Error('INVALID_DECODING');
        }
        return result;
    }
    async readFile(receiver, objectId, position, count, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ??
                enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu ||
                enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId ||
                this._getInvokeId(receiver),
        };
        const data = await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.ATOMIC_READ_FILE,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.AtomicReadFile.encode(buffer, true, objectId, position, count),
        });
        const result = services_1.AtomicReadFile.decodeAcknowledge(data.buffer, data.offset);
        if (!result) {
            throw new Error('INVALID_DECODING');
        }
        return result;
    }
    async readRange(receiver, objectId, idxBegin, quantity, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ??
                enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu ||
                enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId ||
                this._getInvokeId(receiver),
        };
        const propertyId = options.propertyId ?? enum_1.PropertyIdentifier.LOG_BUFFER;
        const arrayIndex = options.arrayIndex ?? enum_1.ASN1_ARRAY_ALL;
        const requestType = options.requestType ?? enum_1.ReadRangeType.BY_POSITION;
        const time = options.time ?? new Date();
        const data = await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.READ_RANGE,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            acceptSegmentedResponse: true,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.ReadRange.encode(buffer, objectId, propertyId, arrayIndex, requestType, idxBegin, time, quantity),
        });
        const result = services_1.ReadRange.decodeAcknowledge(data.buffer, data.offset, data.length);
        if (!result) {
            throw new Error('INVALID_DECODING');
        }
        return result;
    }
    async subscribeCov(receiver, objectId, subscribeId, cancel, issueConfirmedNotifications, lifetime, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ?? enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu || enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId || this._getInvokeId(receiver),
        };
        await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.SUBSCRIBE_COV,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.SubscribeCov.encode(buffer, subscribeId, objectId, cancel, issueConfirmedNotifications, lifetime),
        });
    }
    async subscribeProperty(receiver, objectId, monitoredProperty, subscribeId, cancel, issueConfirmedNotifications, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ?? enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu || enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId || this._getInvokeId(receiver),
        };
        await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.SUBSCRIBE_COV_PROPERTY,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.SubscribeProperty.encode(buffer, subscribeId, objectId, cancel, issueConfirmedNotifications, 0, monitoredProperty, false, 0x0f),
        });
    }
    unconfirmedCOVNotification(receiver, subscriberProcessId, initiatingDeviceId, monitoredObjectId, timeRemaining, values) {
        const buffer = this._getApduBuffer();
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE, receiver);
        baApdu.encodeUnconfirmedServiceRequest(buffer, enum_1.PduType.UNCONFIRMED_REQUEST, enum_1.UnconfirmedServiceChoice.UNCONFIRMED_COV_NOTIFICATION);
        services_1.CovNotify.encode(buffer, subscriberProcessId, initiatingDeviceId, monitoredObjectId, timeRemaining, values);
        baBvlc.encode(buffer.buffer, enum_1.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
        this._send(buffer, receiver);
    }
    async createObject(receiver, objectId, values, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ?? enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu || enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId || this._getInvokeId(receiver),
        };
        await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.CREATE_OBJECT,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.CreateObject.encode(buffer, objectId, values),
        });
    }
    async deleteObject(receiver, objectId, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ?? enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu || enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId || this._getInvokeId(receiver),
        };
        await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.DELETE_OBJECT,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.DeleteObject.encode(buffer, objectId),
        });
    }
    async removeListElement(receiver, objectId, reference, values, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ?? enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu || enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId || this._getInvokeId(receiver),
        };
        await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.REMOVE_LIST_ELEMENT,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.AddListElement.encode(buffer, objectId, reference.id, reference.index, values),
        });
    }
    async addListElement(receiver, objectId, reference, values, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ?? enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu || enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId || this._getInvokeId(receiver),
        };
        await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.ADD_LIST_ELEMENT,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.AddListElement.encode(buffer, objectId, reference.id, reference.index, values),
        });
    }
    async getAlarmSummary(receiver, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ??
                enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu ||
                enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId ||
                this._getInvokeId(receiver),
        };
        const data = await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.GET_ALARM_SUMMARY,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            acceptSegmentedResponse: true,
            segmentedRequest: options.segmentedRequest,
            encodePayload: () => { },
        });
        const result = services_1.AlarmSummary.decode(data.buffer, data.offset, data.length);
        if (!result) {
            throw new Error('INVALID_DECODING');
        }
        return result.alarms;
    }
    async getEventInformation(receiver, objectId, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ??
                enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu ||
                enum_1.MaxApduLengthAccepted.OCTETS_1476,
        };
        const events = [];
        let lastReceivedObjectId = objectId ?? null;
        const maxPages = 1024;
        for (let page = 0; page < maxPages; page++) {
            const invokeId = page === 0 && options.invokeId != null
                ? options.invokeId
                : this._getInvokeId(receiver);
            const currentObjectId = lastReceivedObjectId;
            const data = await this._sendConfirmedRequest({
                receiver,
                service: enum_1.ConfirmedServiceChoice.GET_EVENT_INFORMATION,
                maxSegments: settings.maxSegments,
                maxApdu: settings.maxApdu,
                invokeId,
                acceptSegmentedResponse: true,
                segmentedRequest: options.segmentedRequest,
                encodePayload: (buffer) => {
                    if (currentObjectId) {
                        baAsn1.encodeContextObjectId(buffer, 0, currentObjectId.type, currentObjectId.instance);
                    }
                },
            });
            const result = services_1.GetEventInformation.decodeAcknowledge(data.buffer, data.offset, data.length);
            if (!result) {
                throw new Error('INVALID_DECODING');
            }
            events.push(...result.events);
            if (!result.moreEvents) {
                return events;
            }
            const lastEvent = result.events[result.events.length - 1];
            if (!lastEvent?.objectId) {
                throw new Error('INVALID_DECODING');
            }
            lastReceivedObjectId = lastEvent.objectId;
        }
        throw new Error('TOO_MANY_EVENT_PAGES');
    }
    async acknowledgeAlarm(receiver, objectId, eventState, ackText, evTimeStamp, ackTimeStamp, options) {
        if (!options || options.acknowledgingProcessId == null) {
            throw new Error('ACKNOWLEDGING_PROCESS_ID_REQUIRED');
        }
        const settings = {
            maxSegments: options.maxSegments ??
                enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu ||
                enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId ||
                this._getInvokeId(receiver),
        };
        await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.ACKNOWLEDGE_ALARM,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.AlarmAcknowledge.encode(buffer, options.acknowledgingProcessId, objectId, eventState, ackText, evTimeStamp, ackTimeStamp),
        });
    }
    async confirmedPrivateTransfer(receiver, vendorId, serviceNumber, data, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ??
                enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu ||
                enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId ||
                this._getInvokeId(receiver),
        };
        await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.CONFIRMED_PRIVATE_TRANSFER,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.PrivateTransfer.encode(buffer, vendorId, serviceNumber, data),
        });
    }
    unconfirmedPrivateTransfer(receiver, vendorId, serviceNumber, data) {
        const buffer = this._getApduBuffer(receiver);
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE, receiver);
        baApdu.encodeUnconfirmedServiceRequest(buffer, enum_1.PduType.UNCONFIRMED_REQUEST, enum_1.UnconfirmedServiceChoice.UNCONFIRMED_PRIVATE_TRANSFER);
        services_1.PrivateTransfer.encode(buffer, vendorId, serviceNumber, data);
        this.sendBvlc(receiver, buffer);
    }
    async getEnrollmentSummary(receiver, acknowledgmentFilter, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ?? enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu || enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId || this._getInvokeId(receiver),
        };
        const data = await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.GET_ENROLLMENT_SUMMARY,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            acceptSegmentedResponse: true,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.GetEnrollmentSummary.encode(buffer, acknowledgmentFilter, options.enrollmentFilter, options.eventStateFilter, options.eventTypeFilter, options.priorityFilter, options.notificationClassFilter),
        });
        const result = services_1.GetEnrollmentSummary.decodeAcknowledge(data.buffer, data.offset, data.length);
        if (!result) {
            throw new Error('INVALID_DECODING');
        }
        return result;
    }
    unconfirmedEventNotification(receiver, eventNotification) {
        const buffer = this._getApduBuffer(receiver);
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE, receiver);
        baApdu.encodeUnconfirmedServiceRequest(buffer, enum_1.PduType.UNCONFIRMED_REQUEST, enum_1.UnconfirmedServiceChoice.UNCONFIRMED_EVENT_NOTIFICATION);
        services_1.EventNotifyData.encode(buffer, eventNotification);
        this.sendBvlc(receiver, buffer);
    }
    async confirmedEventNotification(receiver, eventNotification, options = {}) {
        const settings = {
            maxSegments: options.maxSegments ??
                enum_1.MaxSegmentsAccepted.SEGMENTS_65,
            maxApdu: options.maxApdu ||
                enum_1.MaxApduLengthAccepted.OCTETS_1476,
            invokeId: options.invokeId ||
                this._getInvokeId(receiver),
        };
        await this._sendConfirmedRequest({
            receiver,
            service: enum_1.ConfirmedServiceChoice.CONFIRMED_EVENT_NOTIFICATION,
            maxSegments: settings.maxSegments,
            maxApdu: settings.maxApdu,
            invokeId: settings.invokeId,
            segmentedRequest: options.segmentedRequest,
            encodePayload: (buffer) => services_1.EventNotifyData.encode(buffer, eventNotification),
        });
    }
    readPropertyResponse(receiver, invokeId, objectId, property, value, options = {}) {
        const buffer = this._getResponseBuffer(receiver);
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE, receiver);
        const apduStart = buffer.offset;
        baApdu.encodeComplexAck(buffer, enum_1.PduType.COMPLEX_ACK, enum_1.ConfirmedServiceChoice.READ_PROPERTY, invokeId);
        const valueArray = Array.isArray(value) ? value : [value];
        services_1.ReadProperty.encodeAcknowledge(buffer, objectId, property.id, property.index, valueArray);
        if (this._responseExceedsLimits(buffer, apduStart, options.maxApduLength)) {
            return this.abortResponse(receiver, invokeId, this._responseOverflowReason(options.segmentedResponseAccepted));
        }
        this.sendBvlc(receiver, buffer);
    }
    readPropertyMultipleResponse(receiver, invokeId, values, options = {}) {
        const buffer = this._getResponseBuffer(receiver);
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE, receiver);
        const apduStart = buffer.offset;
        baApdu.encodeComplexAck(buffer, enum_1.PduType.COMPLEX_ACK, enum_1.ConfirmedServiceChoice.READ_PROPERTY_MULTIPLE, invokeId);
        services_1.ReadPropertyMultiple.encodeAcknowledge(buffer, values);
        if (this._responseExceedsLimits(buffer, apduStart, options.maxApduLength)) {
            return this.abortResponse(receiver, invokeId, this._responseOverflowReason(options.segmentedResponseAccepted));
        }
        this.sendBvlc(receiver, buffer);
    }
    iAmResponse(receiver, deviceId, segmentation, vendorId, maxApdu) {
        const buffer = this._getApduBuffer(receiver);
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE, receiver);
        baApdu.encodeUnconfirmedServiceRequest(buffer, enum_1.PduType.UNCONFIRMED_REQUEST, enum_1.UnconfirmedServiceChoice.I_AM);
        services_1.IAm.encode(buffer, deviceId, maxApdu ?? BACNET_IP_MAX_APDU_OCTETS, segmentation, vendorId);
        this.sendBvlc(receiver, buffer);
    }
    iHaveResponse(receiver, deviceId, objectId, objectName) {
        const buffer = this._getApduBuffer(receiver);
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE, receiver);
        baApdu.encodeUnconfirmedServiceRequest(buffer, enum_1.PduType.UNCONFIRMED_REQUEST, enum_1.UnconfirmedServiceChoice.I_HAVE);
        services_1.IHave.encode(buffer, deviceId, objectId, objectName);
        this.sendBvlc(receiver, buffer);
    }
    simpleAckResponse(receiver, service, invokeId) {
        const buffer = this._getApduBuffer(receiver);
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE, receiver);
        baApdu.encodeSimpleAck(buffer, enum_1.PduType.SIMPLE_ACK, service, invokeId);
        this.sendBvlc(receiver, buffer);
    }
    errorResponse(receiver, service, invokeId, errorClass, errorCode) {
        trace(`error response on ${JSON.stringify(receiver)} service: ${JSON.stringify(service)} invokeId: ${invokeId} errorClass: ${errorClass} errorCode: ${errorCode}`);
        trace(`error message ${services_1.ErrorService.buildMessage({ class: errorClass, code: errorCode })}`);
        const buffer = this._getApduBuffer(receiver);
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE, receiver);
        baApdu.encodeError(buffer, enum_1.PduType.ERROR, service, invokeId);
        services_1.ErrorService.encode(buffer, errorClass, errorCode);
        this.sendBvlc(receiver, buffer);
    }
    rejectResponse(receiver, invokeId, rejectReason) {
        const buffer = this._getApduBuffer(receiver);
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE, receiver);
        baApdu.encodeAbort(buffer, enum_1.PduType.REJECT, invokeId, rejectReason);
        this.sendBvlc(receiver, buffer);
    }
    abortResponse(receiver, invokeId, abortReason, isServer = true) {
        const buffer = this._getApduBuffer(receiver);
        baNpdu.encode(buffer, enum_1.NpduControlPriority.NORMAL_MESSAGE, receiver);
        const pduType = enum_1.PduType.ABORT | (isServer ? 0x01 : 0x00);
        baApdu.encodeAbort(buffer, pduType, invokeId, abortReason);
        this.sendBvlc(receiver, buffer);
    }
    sendBvlc(receiver, buffer) {
        if (receiver && receiver.forwardedFrom) {
            baBvlc.encode(buffer.buffer, enum_1.BvlcResultPurpose.FORWARDED_NPDU, buffer.offset, receiver.forwardedFrom);
        }
        else if (receiver && receiver.distributeBroadcastToNetwork) {
            baBvlc.encode(buffer.buffer, enum_1.BvlcResultPurpose.DISTRIBUTE_BROADCAST_TO_NETWORK, buffer.offset);
        }
        else if (receiver && receiver.address) {
            baBvlc.encode(buffer.buffer, enum_1.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
        }
        else {
            baBvlc.encode(buffer.buffer, enum_1.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU, buffer.offset);
        }
        this._send(buffer, receiver);
    }
    resultResponse(receiver, resultCode) {
        const buffer = this._getApduBuffer();
        baApdu.encodeResult(buffer, resultCode);
        baBvlc.encode(buffer.buffer, enum_1.BvlcResultPurpose.BVLC_RESULT, buffer.offset);
        this._send(buffer, receiver);
    }
    close() {
        this._isClosed = true;
        if (this._outgoingSegmentTransactions?.size) {
            const err = new Error('ERR_CLOSED');
            for (const state of Array.from(this._outgoingSegmentTransactions.values())) {
                this._failOutgoingSegmentTransaction(state, err);
            }
            this._outgoingSegmentTransactions.clear();
        }
        this._requestManager.clear(true);
        if (this._pendingForeignDeviceRegistrations?.size) {
            const err = new Error('ERR_CLOSED');
            for (const pending of this._pendingForeignDeviceRegistrations.values()) {
                pending.reject(err);
            }
            this._pendingForeignDeviceRegistrations.clear();
        }
        if (this._segmentAssemblyStates?.size) {
            for (const state of this._segmentAssemblyStates.values()) {
                if (state.timer) {
                    clearTimeout(state.timer);
                    state.timer = null;
                }
            }
            this._segmentAssemblyStates.clear();
        }
        if (this._activeForeignDeviceRegistrations?.size) {
            for (const registration of this._activeForeignDeviceRegistrations.values()) {
                clearTimeout(registration.expiringTimer);
                clearTimeout(registration.expiryTimer);
            }
            this._activeForeignDeviceRegistrations.clear();
        }
        this._transport.close();
    }
    static createBitstring(items) {
        let offset = 0;
        const bytes = [];
        let bitsUsed = 0;
        while (items.length) {
            let value = 0;
            items = items.filter((i) => {
                if (i >= offset + 8) {
                    return true;
                }
                value |= 1 << (i - offset);
                bitsUsed = Math.max(bitsUsed, i);
                return false;
            });
            bytes.push(value);
            offset += 8;
        }
        bitsUsed++;
        return {
            value: bytes,
            bitsUsed,
        };
    }
}
exports.default = BACnetClient;
//# sourceMappingURL=client.js.map