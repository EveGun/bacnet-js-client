import test from 'node:test'
import assert from 'node:assert'

import BACnetClient from '../../src/lib/client'
import { RequestManager } from '../../src/lib/request-manager'
import * as baNpdu from '../../src/lib/npdu'
import * as baApdu from '../../src/lib/apdu'
import * as baBvlc from '../../src/lib/bvlc'
import { ErrorService, WriteProperty } from '../../src/lib/services'
import {
	AbortReason,
	ApplicationTag,
	BvlcResultPurpose,
	ConfirmedServiceChoice,
	ErrorClass,
	ErrorCode,
	MaxApduLengthAccepted,
	MaxSegmentsAccepted,
	PduConReqBit,
	PduSegAckBit,
	PduType,
	PDU_TYPE_MASK,
	ASN1_ARRAY_ALL,
	ASN1_NO_PRIORITY,
} from '../../src/lib/enum'
import {
	ApduTooLargeError,
	InvalidSegmentedRequestError,
	InvokeIdInUseError,
	SegmentAckTimeoutError,
	SegmentCountExceededError,
} from '../../src/lib/errors'
import { EncodeBuffer } from '../../src/lib/types'

const DEVICE = '192.168.1.50:47808'
const SERVICE = ConfirmedServiceChoice.WRITE_PROPERTY

interface SentPacket {
	data: Buffer
	receiver?: { address?: string; forwardedFrom?: string }
}

interface ParsedConfirmed {
	bvlc: ReturnType<typeof baBvlc.decode>
	apdu: ReturnType<typeof baApdu.decodeConfirmedServiceRequest>
	apduLength: number
	payload: Buffer
}

function createStubClient(opts: { apduTimeout?: number } = {}) {
	const sent: SentPacket[] = []
	const apduTimeout = opts.apduTimeout ?? 500
	const client = Object.create(BACnetClient.prototype) as BACnetClient & {
		[key: string]: any
	}
	client._settings = { apduTimeout }
	client._requestManager = new RequestManager(apduTimeout)
	client._transport = {
		getMaxPayload: () => 1482,
		close: () => {},
	}
	client._send = (buffer: EncodeBuffer, receiver?: { address?: string }) => {
		sent.push({
			data: Buffer.from(buffer.buffer.subarray(0, buffer.offset)),
			receiver,
		})
	}
	return { client, sent }
}

function parseConfirmed(data: Buffer): ParsedConfirmed {
	const bvlc = baBvlc.decode(data, 0)
	assert.ok(bvlc)
	const npdu = baNpdu.decode(data, bvlc.len)
	assert.ok(npdu)
	const apdu = baApdu.decodeConfirmedServiceRequest(data, bvlc.len + npdu.len)
	const payloadOffset = bvlc.len + npdu.len + apdu.len
	return {
		bvlc,
		apdu,
		apduLength: data.length - (bvlc.len + npdu.len),
		payload: data.subarray(payloadOffset),
	}
}

function injectSegmentAck(
	client: any,
	invokeId: number,
	sequencenumber: number,
	actualWindowSize: number,
	opts: {
		negative?: boolean
		server?: boolean
		sender?: string
		forwardedFrom?: string
	} = {},
) {
	const type =
		PduType.SEGMENT_ACK |
		(opts.server === false ? 0 : PduSegAckBit.SERVER) |
		(opts.negative ? PduSegAckBit.NEGATIVE_ACK : 0)
	const buffer = Buffer.alloc(8)
	const apdu = { buffer, offset: 0 }
	baApdu.encodeSegmentAck(
		apdu,
		type,
		invokeId,
		sequencenumber,
		actualWindowSize,
	)
	client._handlePdu(buffer, 0, apdu.offset, {
		apduType: type,
		sender: {
			address: opts.sender ?? DEVICE,
			forwardedFrom: opts.forwardedFrom,
		},
		expectingReply: false,
		confirmedService: false,
	})
}

function injectSimpleAck(
	client: any,
	invokeId: number,
	opts: { sender?: string; service?: number; forwardedFrom?: string } = {},
) {
	const buffer = Buffer.alloc(8)
	const apdu = { buffer, offset: 0 }
	baApdu.encodeSimpleAck(
		apdu,
		PduType.SIMPLE_ACK,
		opts.service ?? SERVICE,
		invokeId,
	)
	client._handlePdu(buffer, 0, apdu.offset, {
		apduType: PduType.SIMPLE_ACK,
		sender: {
			address: opts.sender ?? DEVICE,
			forwardedFrom: opts.forwardedFrom,
		},
		expectingReply: false,
		confirmedService: false,
	})
}

function injectError(client: any, invokeId: number, sender = DEVICE) {
	const buffer = Buffer.alloc(16)
	const apdu = { buffer, offset: 0 }
	baApdu.encodeError(apdu, PduType.ERROR, SERVICE, invokeId)
	ErrorService.encode(apdu, ErrorClass.PROPERTY, ErrorCode.VALUE_OUT_OF_RANGE)
	client._handlePdu(buffer, 0, apdu.offset, {
		apduType: PduType.ERROR,
		sender: { address: sender },
		expectingReply: false,
		confirmedService: false,
	})
}

function injectAbort(
	client: any,
	invokeId: number,
	reason: number,
	sender = DEVICE,
) {
	const buffer = Buffer.alloc(8)
	const apdu = { buffer, offset: 0 }
	baApdu.encodeAbort(apdu, PduType.ABORT | 0x01, invokeId, reason)
	client._handlePdu(buffer, 0, apdu.offset, {
		apduType: PduType.ABORT,
		sender: { address: sender },
		expectingReply: false,
		confirmedService: false,
	})
}

const fillPayload =
	(length: number) =>
	(buffer: EncodeBuffer): void => {
		for (let i = 0; i < length; i++) {
			buffer.buffer[buffer.offset++] = i & 0xff
		}
	}

function sendRequest(
	client: any,
	options: {
		payloadLength: number
		invokeId?: number
		receiver?: Record<string, unknown>
		segmentedRequest?: Record<string, unknown>
	},
): Promise<any> {
	return client._sendConfirmedRequest({
		receiver: options.receiver ?? { address: DEVICE },
		service: SERVICE,
		maxSegments: MaxSegmentsAccepted.SEGMENTS_65,
		maxApdu: MaxApduLengthAccepted.OCTETS_1476,
		invokeId: options.invokeId ?? 1,
		segmentedRequest: options.segmentedRequest,
		encodePayload: fillPayload(options.payloadLength),
	})
}

const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms))

test.describe('bacnet - outgoing request segmentation', () => {
	test('unsegmented request fitting the remote APDU limit exactly is sent', async () => {
		const { client, sent } = createStubClient()
		// 4 octets of confirmed-request header + 10 octets of payload
		const promise = sendRequest(client, {
			payloadLength: 10,
			segmentedRequest: { enabled: false, remoteMaxApduLength: 14 },
		})
		assert.strictEqual(sent.length, 1)
		const { apdu, apduLength } = parseConfirmed(sent[0].data)
		assert.strictEqual(apduLength, 14)
		assert.strictEqual(apdu.type & PduConReqBit.SEGMENTED_MESSAGE, 0)
		injectSimpleAck(client, 1)
		await promise
	})

	test('unsegmented request one octet above the remote APDU limit throws and sends nothing', async () => {
		const { client, sent } = createStubClient()
		await assert.rejects(
			sendRequest(client, {
				payloadLength: 11,
				segmentedRequest: { enabled: false, remoteMaxApduLength: 14 },
			}),
			(err: ApduTooLargeError) => {
				assert.ok(err instanceof ApduTooLargeError)
				assert.strictEqual(err.encodedLength, 15)
				assert.strictEqual(err.maximumLength, 14)
				assert.strictEqual(err.service, SERVICE)
				assert.strictEqual(err.invokeId, 1)
				assert.strictEqual(err.segmentationAvailable, true)
				return true
			},
		)
		assert.strictEqual(sent.length, 0)
	})

	test('unsegmented request overflowing the transport buffer throws and sends nothing', async () => {
		const { client, sent } = createStubClient()
		await assert.rejects(
			sendRequest(client, { payloadLength: 3000 }),
			ApduTooLargeError,
		)
		assert.strictEqual(sent.length, 0)
	})

	test('encoder RangeError from buffer bounds surfaces as ApduTooLargeError', async () => {
		const { client, sent } = createStubClient()
		await assert.rejects(
			client._sendConfirmedRequest({
				receiver: { address: DEVICE },
				service: SERVICE,
				maxSegments: MaxSegmentsAccepted.SEGMENTS_65,
				maxApdu: MaxApduLengthAccepted.OCTETS_1476,
				invokeId: 1,
				encodePayload: (buffer: EncodeBuffer) => {
					// Encoders using Buffer.write* throw RangeError when the
					// payload exceeds the transport buffer.
					buffer.buffer.writeUInt8(0, buffer.buffer.length)
				},
			}),
			ApduTooLargeError,
		)
		assert.strictEqual(sent.length, 0)
	})

	test('segmented mode with a payload fitting one segment sends an unsegmented request', async () => {
		const { client, sent } = createStubClient()
		const promise = sendRequest(client, {
			payloadLength: 10,
			segmentedRequest: { enabled: true, remoteMaxApduLength: 480 },
		})
		assert.strictEqual(sent.length, 1)
		const { apdu } = parseConfirmed(sent[0].data)
		// ASHRAE 135 - 20.1.2.4: single-segment messages are not segmented
		assert.strictEqual(apdu.type & PduConReqBit.SEGMENTED_MESSAGE, 0)
		assert.strictEqual(apdu.type & PduConReqBit.MORE_FOLLOWS, 0)
		assert.strictEqual(client._outgoingSegmentTransactions?.size ?? 0, 0)
		injectSimpleAck(client, 1)
		await promise
	})

	test('segmented request with two segments: sequence numbers, flags and APDU size', async () => {
		const { client, sent } = createStubClient()
		// remoteMaxApduLength 12 -> 6 header + 6 payload octets per segment
		const promise = sendRequest(client, {
			payloadLength: 10,
			segmentedRequest: { enabled: true, remoteMaxApduLength: 12 },
		})

		// Only the first segment may be sent before the initial SegmentACK
		assert.strictEqual(sent.length, 1)
		const seg0 = parseConfirmed(sent[0].data)
		assert.strictEqual(
			seg0.apdu.type & PDU_TYPE_MASK,
			PduType.CONFIRMED_REQUEST,
		)
		assert.ok(seg0.apdu.type & PduConReqBit.SEGMENTED_MESSAGE)
		assert.ok(seg0.apdu.type & PduConReqBit.MORE_FOLLOWS)
		assert.strictEqual(seg0.apdu.sequencenumber, 0)
		assert.strictEqual(seg0.apdu.proposedWindowNumber, 1)
		assert.strictEqual(seg0.apdu.invokeId, 1)
		assert.strictEqual(seg0.apdu.service, SERVICE)
		assert.ok(seg0.apduLength <= 12)
		assert.strictEqual(seg0.payload.length, 6)

		injectSegmentAck(client, 1, 0, 1)
		assert.strictEqual(sent.length, 2)
		const seg1 = parseConfirmed(sent[1].data)
		assert.ok(seg1.apdu.type & PduConReqBit.SEGMENTED_MESSAGE)
		assert.strictEqual(seg1.apdu.type & PduConReqBit.MORE_FOLLOWS, 0)
		assert.strictEqual(seg1.apdu.sequencenumber, 1)
		assert.strictEqual(seg1.apdu.invokeId, 1)
		assert.strictEqual(seg1.apdu.service, SERVICE)
		assert.strictEqual(seg1.payload.length, 4)

		const reassembled = Buffer.concat([seg0.payload, seg1.payload])
		const expected: EncodeBuffer = {
			buffer: Buffer.alloc(32),
			offset: 0,
		}
		fillPayload(10)(expected)
		assert.deepStrictEqual(
			reassembled,
			expected.buffer.subarray(0, expected.offset),
		)

		injectSegmentAck(client, 1, 1, 1)
		injectSimpleAck(client, 1)
		await promise

		// A stale SegmentACK after completion is ignored
		const sends = sent.length
		injectSegmentAck(client, 1, 1, 1)
		assert.strictEqual(sent.length, sends)
		assert.strictEqual(client._outgoingSegmentTransactions.size, 0)
	})

	test('windowed transfer honours the receiver actual window size', async () => {
		const { client, sent } = createStubClient()
		// capacity 10 per segment -> 10 segments
		const promise = sendRequest(client, {
			payloadLength: 100,
			segmentedRequest: {
				enabled: true,
				remoteMaxApduLength: 16,
				proposedWindowSize: 4,
			},
		})

		assert.strictEqual(sent.length, 1)
		assert.strictEqual(
			parseConfirmed(sent[0].data).apdu.proposedWindowNumber,
			4,
		)

		// Receiver grants a smaller actual window of 2
		injectSegmentAck(client, 1, 0, 2)
		assert.strictEqual(sent.length, 3)
		assert.strictEqual(parseConfirmed(sent[1].data).apdu.sequencenumber, 1)
		assert.strictEqual(parseConfirmed(sent[2].data).apdu.sequencenumber, 2)
		// Every segment still proposes the caller's window size
		assert.strictEqual(
			parseConfirmed(sent[2].data).apdu.proposedWindowNumber,
			4,
		)

		injectSegmentAck(client, 1, 2, 2)
		assert.strictEqual(sent.length, 5)
		injectSegmentAck(client, 1, 4, 2)
		assert.strictEqual(sent.length, 7)
		injectSegmentAck(client, 1, 6, 2)
		assert.strictEqual(sent.length, 9)
		injectSegmentAck(client, 1, 8, 2)
		assert.strictEqual(sent.length, 10)
		const finalSegment = parseConfirmed(sent[9].data)
		assert.strictEqual(finalSegment.apdu.sequencenumber, 9)
		assert.strictEqual(
			finalSegment.apdu.type & PduConReqBit.MORE_FOLLOWS,
			0,
		)

		injectSegmentAck(client, 1, 9, 2)
		injectSimpleAck(client, 1)
		await promise
	})

	test('negative SegmentACK retransmits from the segment after the acknowledged one', async () => {
		const { client, sent } = createStubClient()
		// capacity 4 -> 5 segments of a 20 octet payload
		const promise = sendRequest(client, {
			payloadLength: 20,
			segmentedRequest: {
				enabled: true,
				remoteMaxApduLength: 10,
				proposedWindowSize: 3,
			},
		})
		assert.strictEqual(sent.length, 1)
		injectSegmentAck(client, 1, 0, 3)
		// window of 3: segments 1, 2, 3
		assert.strictEqual(sent.length, 4)

		// Receiver got 1 but is missing 2: NAK with sequence number 1
		injectSegmentAck(client, 1, 1, 3, { negative: true })
		// Retransmission starts at segment 2: segments 2, 3, 4
		assert.strictEqual(sent.length, 7)
		assert.strictEqual(parseConfirmed(sent[4].data).apdu.sequencenumber, 2)
		assert.strictEqual(parseConfirmed(sent[5].data).apdu.sequencenumber, 3)
		assert.strictEqual(parseConfirmed(sent[6].data).apdu.sequencenumber, 4)

		injectSegmentAck(client, 1, 4, 3)
		injectSimpleAck(client, 1)
		await promise
	})

	test('SegmentACK timeout retries then aborts with a structured error', async () => {
		const { client, sent } = createStubClient({ apduTimeout: 2000 })
		const promise = sendRequest(client, {
			payloadLength: 20,
			segmentedRequest: {
				enabled: true,
				remoteMaxApduLength: 10,
				maxRetries: 1,
				segmentAckTimeout: 25,
			},
		})
		await assert.rejects(promise, (err: SegmentAckTimeoutError) => {
			assert.ok(err instanceof SegmentAckTimeoutError)
			assert.strictEqual(err.invokeId, 1)
			assert.strictEqual(err.retries, 1)
			return true
		})
		// initial segment 0 + one retry + abort PDU
		assert.strictEqual(sent.length, 3)
		assert.strictEqual(parseConfirmed(sent[0].data).apdu.sequencenumber, 0)
		assert.strictEqual(parseConfirmed(sent[1].data).apdu.sequencenumber, 0)
		const abortData = sent[2].data
		const bvlc = baBvlc.decode(abortData, 0)
		const npdu = baNpdu.decode(abortData, bvlc.len)
		const abort = baApdu.decodeAbort(abortData, bvlc.len + npdu.len)
		assert.strictEqual(abort.type & PDU_TYPE_MASK, PduType.ABORT)
		// Sent by the client side: server bit clear
		assert.strictEqual(abort.type & 0x01, 0)
		assert.strictEqual(abort.invokeId, 1)
		assert.strictEqual(abort.reason, AbortReason.TSM_TIMEOUT)
		assert.strictEqual(client._outgoingSegmentTransactions.size, 0)
	})

	test('stale, unknown and mismatched SegmentACKs are ignored', async () => {
		const { client, sent } = createStubClient()
		const promise = sendRequest(client, {
			payloadLength: 10,
			segmentedRequest: { enabled: true, remoteMaxApduLength: 12 },
		})
		assert.strictEqual(sent.length, 1)

		// Unknown invoke id
		injectSegmentAck(client, 99, 0, 1)
		assert.strictEqual(sent.length, 1)
		// Wrong sender
		injectSegmentAck(client, 1, 0, 1, { sender: '10.99.99.99:47808' })
		assert.strictEqual(sent.length, 1)
		// Missing server bit (we are the requesting client)
		injectSegmentAck(client, 1, 0, 1, { server: false })
		assert.strictEqual(sent.length, 1)
		// Duplicate/stale positive ACK outside the window only restarts the timer
		injectSegmentAck(client, 1, 200, 1)
		assert.strictEqual(sent.length, 1)

		injectSegmentAck(client, 1, 0, 1)
		assert.strictEqual(sent.length, 2)
		injectSegmentAck(client, 1, 1, 1)
		injectSimpleAck(client, 1)
		await promise
	})

	test('segmented mode requires valid options and sends nothing otherwise', async () => {
		const { client, sent } = createStubClient()

		await assert.rejects(
			sendRequest(client, {
				payloadLength: 10,
				segmentedRequest: { enabled: true },
			}),
			(err: InvalidSegmentedRequestError) => {
				assert.ok(err instanceof InvalidSegmentedRequestError)
				assert.strictEqual(err.option, 'remoteMaxApduLength')
				return true
			},
		)
		await assert.rejects(
			sendRequest(client, {
				payloadLength: 10,
				// Too small for the 6 octet segmented header + 1 payload octet
				segmentedRequest: { enabled: true, remoteMaxApduLength: 6 },
			}),
			InvalidSegmentedRequestError,
		)
		await assert.rejects(
			sendRequest(client, {
				payloadLength: 10,
				segmentedRequest: {
					enabled: true,
					remoteMaxApduLength: 480,
					proposedWindowSize: 0,
				},
			}),
			(err: InvalidSegmentedRequestError) => {
				assert.strictEqual(err.option, 'proposedWindowSize')
				return true
			},
		)
		await assert.rejects(
			sendRequest(client, {
				payloadLength: 10,
				segmentedRequest: {
					enabled: true,
					remoteMaxApduLength: 480,
					proposedWindowSize: 128,
				},
			}),
			InvalidSegmentedRequestError,
		)
		await assert.rejects(
			sendRequest(client, {
				payloadLength: 30,
				segmentedRequest: {
					enabled: true,
					remoteMaxApduLength: 16, // capacity 10 -> 3 segments
					remoteMaxSegmentsAccepted: 2,
				},
			}),
			(err: SegmentCountExceededError) => {
				assert.ok(err instanceof SegmentCountExceededError)
				assert.strictEqual(err.requiredSegments, 3)
				assert.strictEqual(err.maximumSegments, 2)
				return true
			},
		)
		assert.strictEqual(sent.length, 0)
	})

	test('final segment followed by an Error response rejects the request', async () => {
		const { client, sent } = createStubClient()
		const promise = sendRequest(client, {
			payloadLength: 10,
			segmentedRequest: { enabled: true, remoteMaxApduLength: 12 },
		})
		injectSegmentAck(client, 1, 0, 1)
		injectSegmentAck(client, 1, 1, 1)
		injectError(client, 1)
		await assert.rejects(promise, /BacnetError - Class:2 - Code:37/)
		assert.strictEqual(client._outgoingSegmentTransactions.size, 0)
		assert.strictEqual(sent.length, 2)
	})

	test('Abort received mid-transfer stops the transfer and rejects', async () => {
		const { client, sent } = createStubClient()
		const promise = sendRequest(client, {
			payloadLength: 30,
			segmentedRequest: { enabled: true, remoteMaxApduLength: 16 },
		})
		assert.strictEqual(sent.length, 1)
		injectAbort(client, 1, AbortReason.SEGMENTATION_NOT_SUPPORTED)
		await assert.rejects(promise, /BacnetAbort - Reason:4/)
		assert.strictEqual(sent.length, 1)
		assert.strictEqual(client._outgoingSegmentTransactions.size, 0)
	})

	test('receiver address including forwardedFrom is preserved for every segment and retransmission', async () => {
		const { client, sent } = createStubClient()
		const receiver = {
			address: DEVICE,
			forwardedFrom: '10.0.0.5:47808',
		}
		const promise = sendRequest(client, {
			payloadLength: 10,
			receiver,
			segmentedRequest: {
				enabled: true,
				remoteMaxApduLength: 12,
				segmentAckTimeout: 30,
			},
		})
		// Let the first SegmentACK time out once to cover retransmission
		await sleep(45)
		const forwardedFrom = '10.0.0.5:47808'
		injectSegmentAck(client, 1, 0, 1, { forwardedFrom })
		injectSegmentAck(client, 1, 1, 1, { forwardedFrom })
		injectSimpleAck(client, 1, { forwardedFrom })
		await promise

		assert.ok(sent.length >= 3)
		for (const packet of sent) {
			assert.strictEqual(packet.receiver, receiver)
			const bvlc = baBvlc.decode(packet.data, 0)
			assert.strictEqual(bvlc.func, BvlcResultPurpose.FORWARDED_NPDU)
			// bvlc.decode omits the default BACnet port from originatingIP
			assert.strictEqual(bvlc.originatingIP, '10.0.0.5')
		}
	})

	test('sequence numbers wrap around one octet (254, 255, 0, 1)', async () => {
		const { client, sent } = createStubClient({ apduTimeout: 2000 })
		// capacity 1 octet per segment -> 300 segments
		const promise = sendRequest(client, {
			payloadLength: 300,
			segmentedRequest: {
				enabled: true,
				remoteMaxApduLength: 7,
				proposedWindowSize: 8,
			},
		})

		let safety = 500
		for (;;) {
			assert.ok(safety-- > 0, 'auto-ack loop did not terminate')
			const last = parseConfirmed(sent[sent.length - 1].data)
			injectSegmentAck(client, 1, last.apdu.sequencenumber, 8)
			if (!(last.apdu.type & PduConReqBit.MORE_FOLLOWS)) {
				break
			}
		}
		injectSimpleAck(client, 1)
		await promise

		assert.strictEqual(sent.length, 300)
		const sequences = sent.map(
			(packet) => parseConfirmed(packet.data).apdu.sequencenumber,
		)
		for (let i = 0; i < 300; i++) {
			assert.strictEqual(sequences[i], i & 0xff)
		}
		assert.deepStrictEqual(
			sequences.slice(253, 259),
			[253, 254, 255, 0, 1, 2],
		)
		const reassembled = Buffer.concat(
			sent.map((packet) => parseConfirmed(packet.data).payload),
		)
		const expected: EncodeBuffer = {
			buffer: Buffer.alloc(512),
			offset: 0,
		}
		fillPayload(300)(expected)
		assert.deepStrictEqual(
			reassembled,
			expected.buffer.subarray(0, expected.offset),
		)
	})

	test('two concurrent segmented requests to different devices do not interfere', async () => {
		const { client, sent } = createStubClient()
		const deviceB = '192.168.1.60:47808'
		const promiseA = sendRequest(client, {
			payloadLength: 10,
			invokeId: 1,
			segmentedRequest: { enabled: true, remoteMaxApduLength: 12 },
		})
		const promiseB = sendRequest(client, {
			payloadLength: 10,
			invokeId: 2,
			receiver: { address: deviceB },
			segmentedRequest: { enabled: true, remoteMaxApduLength: 12 },
		})
		assert.strictEqual(sent.length, 2)

		// Interleave the two transfers
		injectSegmentAck(client, 2, 0, 1, { sender: deviceB })
		injectSegmentAck(client, 1, 0, 1)
		assert.strictEqual(sent.length, 4)
		injectSegmentAck(client, 1, 1, 1)
		injectSegmentAck(client, 2, 1, 1, { sender: deviceB })
		injectSimpleAck(client, 1)
		injectSimpleAck(client, 2, { sender: deviceB })
		await Promise.all([promiseA, promiseB])
		assert.strictEqual(client._outgoingSegmentTransactions.size, 0)

		for (const packet of sent) {
			const parsed = parseConfirmed(packet.data)
			if (parsed.apdu.invokeId === 1) {
				assert.strictEqual(packet.receiver?.address, DEVICE)
			} else {
				assert.strictEqual(packet.receiver?.address, deviceB)
			}
		}
	})

	test('duplicate segmented request for the same receiver and invokeId is rejected locally', async () => {
		const { client, sent } = createStubClient()
		const promise = sendRequest(client, {
			payloadLength: 10,
			segmentedRequest: { enabled: true, remoteMaxApduLength: 12 },
		})
		await assert.rejects(
			sendRequest(client, {
				payloadLength: 10,
				segmentedRequest: { enabled: true, remoteMaxApduLength: 12 },
			}),
			(err: InvokeIdInUseError) => {
				assert.ok(err instanceof InvokeIdInUseError)
				assert.strictEqual(err.invokeId, 1)
				return true
			},
		)
		injectSegmentAck(client, 1, 0, 1)
		injectSegmentAck(client, 1, 1, 1)
		injectSimpleAck(client, 1)
		await promise
		assert.strictEqual(sent.length, 2)
	})

	test('closing the client rejects an active segmented request and cleans up', async () => {
		const { client, sent } = createStubClient()
		const promise = sendRequest(client, {
			payloadLength: 30,
			segmentedRequest: { enabled: true, remoteMaxApduLength: 16 },
		})
		assert.strictEqual(sent.length, 1)
		client.close()
		await assert.rejects(promise, /ERR_CLOSED/)
		assert.strictEqual(client._outgoingSegmentTransactions.size, 0)
		await assert.rejects(
			sendRequest(client, {
				payloadLength: 30,
				segmentedRequest: { enabled: true, remoteMaxApduLength: 16 },
			}),
			/ERR_CLOSED/,
		)
	})

	test('segmented ComplexACK response after a segmented request resolves the request', async () => {
		const { client, sent } = createStubClient()
		const promise = sendRequest(client, {
			payloadLength: 10,
			segmentedRequest: { enabled: true, remoteMaxApduLength: 12 },
		})
		injectSegmentAck(client, 1, 0, 1)
		injectSegmentAck(client, 1, 1, 1)
		assert.strictEqual(sent.length, 2)

		// Respond with a two-segment ComplexACK
		const makeAckSegment = (
			sequencenumber: number,
			moreFollows: boolean,
			payloadByte: number,
		) => {
			const buffer = Buffer.alloc(16)
			const apdu = { buffer, offset: 0 }
			const type =
				PduType.COMPLEX_ACK |
				PduConReqBit.SEGMENTED_MESSAGE |
				(moreFollows ? PduConReqBit.MORE_FOLLOWS : 0)
			baApdu.encodeComplexAck(apdu, type, SERVICE, 1, sequencenumber, 1)
			buffer[apdu.offset++] = payloadByte
			client._handlePdu(buffer, 0, apdu.offset, {
				apduType: type,
				sender: { address: DEVICE },
				expectingReply: false,
				confirmedService: false,
			})
		}
		makeAckSegment(0, true, 0xaa)
		makeAckSegment(1, false, 0xbb)

		const data = await promise
		assert.strictEqual(data.msg.invokeId, 1)
		assert.deepStrictEqual(
			Buffer.from(
				data.buffer.subarray(data.offset, data.offset + data.length),
			),
			Buffer.from([0xaa, 0xbb]),
		)
		// The reassembly acknowledged both response segments (client side ACKs)
		const segmentAcks = sent
			.slice(2)
			.map((packet) => {
				const bvlc = baBvlc.decode(packet.data, 0)
				const npdu = baNpdu.decode(packet.data, bvlc.len)
				return baApdu.decodeSegmentAck(packet.data, bvlc.len + npdu.len)
			})
			.filter((ack) => (ack.type & PDU_TYPE_MASK) === PduType.SEGMENT_ACK)
		assert.ok(segmentAcks.length >= 1)
		for (const ack of segmentAcks) {
			// We acknowledge as the client: server bit must be clear
			assert.strictEqual(ack.type & PduSegAckBit.SERVER, 0)
			assert.strictEqual(ack.type & PduSegAckBit.NEGATIVE_ACK, 0)
		}
	})

	test('public writeProperty API sends a segmented request equal to the unsegmented encoding', async () => {
		const { client, sent } = createStubClient()
		const objectId = { type: 8, instance: 1234 }
		const values = [
			{
				type: ApplicationTag.CHARACTER_STRING,
				value: 'x'.repeat(600),
			},
		]

		const promise = client.writeProperty(
			{ address: DEVICE },
			objectId,
			85,
			values,
			{
				invokeId: 42,
				segmentedRequest: {
					enabled: true,
					remoteMaxApduLength: 480,
					proposedWindowSize: 1,
				},
			},
		)

		let safety = 50
		for (;;) {
			assert.ok(safety-- > 0, 'auto-ack loop did not terminate')
			const last = parseConfirmed(sent[sent.length - 1].data)
			assert.ok(last.apduLength <= 480)
			injectSegmentAck(client, 42, last.apdu.sequencenumber, 1)
			if (!(last.apdu.type & PduConReqBit.MORE_FOLLOWS)) {
				break
			}
		}
		injectSimpleAck(client, 42)
		await promise

		assert.ok(sent.length >= 2)
		const reassembled = Buffer.concat(
			sent.map((packet) => parseConfirmed(packet.data).payload),
		)
		const expected: EncodeBuffer = {
			buffer: Buffer.alloc(2048),
			offset: 0,
		}
		WriteProperty.encode(
			expected,
			objectId.type,
			objectId.instance,
			85,
			ASN1_ARRAY_ALL,
			ASN1_NO_PRIORITY,
			values,
		)
		assert.deepStrictEqual(
			reassembled,
			expected.buffer.subarray(0, expected.offset),
		)
	})
})

test.describe('bacnet - incoming segmentation hardening', () => {
	const makeSegmentMsg = (options: {
		invokeId: number
		sequencenumber: number
		window: number
		moreFollows: boolean
		sender?: string
		service?: number
	}) =>
		({
			type:
				PduType.CONFIRMED_REQUEST |
				PduConReqBit.SEGMENTED_MESSAGE |
				(options.moreFollows ? PduConReqBit.MORE_FOLLOWS : 0),
			service: options.service ?? SERVICE,
			invokeId: options.invokeId,
			sequencenumber: options.sequencenumber,
			proposedWindowNumber: options.window,
			header: {
				apduType:
					PduType.CONFIRMED_REQUEST | PduConReqBit.SEGMENTED_MESSAGE,
				sender: { address: options.sender ?? DEVICE },
				expectingReply: true,
				confirmedService: true,
			},
		}) as any

	test('first segment is acknowledged immediately with the granted window size', () => {
		const { client } = createStubClient()
		const acks: Array<{
			negative: boolean
			sequencenumber: number
			actualWindowSize: number
		}> = []
		client._segmentAckResponse = (
			_receiver: any,
			negative: boolean,
			_server: boolean,
			_invokeId: number,
			sequencenumber: number,
			actualWindowSize: number,
		) => {
			acks.push({ negative, sequencenumber, actualWindowSize })
		}
		client._performDefaultSegmentHandling = () => {}

		client._processSegment(
			makeSegmentMsg({
				invokeId: 5,
				sequencenumber: 0,
				window: 4,
				moreFollows: true,
			}),
			true,
			Buffer.alloc(1),
			0,
			1,
		)
		assert.deepStrictEqual(acks, [
			{ negative: false, sequencenumber: 0, actualWindowSize: 4 },
		])

		// Segments 1..3 complete the window of 4 counted after the initial ACK
		for (let seq = 1; seq <= 3; seq++) {
			client._processSegment(
				makeSegmentMsg({
					invokeId: 5,
					sequencenumber: seq,
					window: 4,
					moreFollows: true,
				}),
				true,
				Buffer.alloc(1),
				0,
				1,
			)
		}
		assert.strictEqual(acks.length, 1)
		client._processSegment(
			makeSegmentMsg({
				invokeId: 5,
				sequencenumber: 4,
				window: 4,
				moreFollows: true,
			}),
			true,
			Buffer.alloc(1),
			0,
			1,
		)
		assert.deepStrictEqual(acks[1], {
			negative: false,
			sequencenumber: 4,
			actualWindowSize: 4,
		})
	})

	test('duplicate segment triggers a negative ACK with the last in-order sequence number', () => {
		const { client } = createStubClient()
		const acks: Array<{ negative: boolean; sequencenumber: number }> = []
		client._segmentAckResponse = (
			_receiver: any,
			negative: boolean,
			_server: boolean,
			_invokeId: number,
			sequencenumber: number,
		) => {
			acks.push({ negative, sequencenumber })
		}
		client._performDefaultSegmentHandling = () => {}

		for (let seq = 0; seq <= 1; seq++) {
			client._processSegment(
				makeSegmentMsg({
					invokeId: 6,
					sequencenumber: seq,
					window: 8,
					moreFollows: true,
				}),
				true,
				Buffer.alloc(1),
				0,
				1,
			)
		}
		// Duplicate of segment 1
		client._processSegment(
			makeSegmentMsg({
				invokeId: 6,
				sequencenumber: 1,
				window: 8,
				moreFollows: true,
			}),
			true,
			Buffer.alloc(1),
			0,
			1,
		)
		const negatives = acks.filter((ack) => ack.negative)
		assert.strictEqual(negatives.length, 1)
		assert.strictEqual(negatives[0].sequencenumber, 1)
	})

	test('incomplete segment assembly is discarded after the inactivity timeout', async () => {
		const { client } = createStubClient({ apduTimeout: 30 })
		client._segmentAckResponse = () => {}
		client._performDefaultSegmentHandling = () => {}

		client._processSegment(
			makeSegmentMsg({
				invokeId: 7,
				sequencenumber: 0,
				window: 1,
				moreFollows: true,
			}),
			true,
			Buffer.alloc(1),
			0,
			1,
		)
		assert.strictEqual(client._segmentAssemblyStates.size, 1)
		await sleep(80)
		assert.strictEqual(client._segmentAssemblyStates.size, 0)
	})

	test('concurrent assemblies from different devices with the same invokeId stay isolated', () => {
		const { client } = createStubClient()
		let negativeAcks = 0
		client._segmentAckResponse = (_receiver: any, negative: boolean) => {
			if (negative) negativeAcks++
		}
		client._performDefaultSegmentHandling = () => {}

		const deviceB = '192.168.1.60:47808'
		for (let seq = 0; seq <= 2; seq++) {
			client._processSegment(
				makeSegmentMsg({
					invokeId: 9,
					sequencenumber: seq,
					window: 1,
					moreFollows: seq < 2,
				}),
				true,
				Buffer.alloc(1),
				0,
				1,
			)
			client._processSegment(
				makeSegmentMsg({
					invokeId: 9,
					sequencenumber: seq,
					window: 1,
					moreFollows: seq < 2,
					sender: deviceB,
				}),
				true,
				Buffer.alloc(1),
				0,
				1,
			)
		}
		assert.strictEqual(negativeAcks, 0)
		assert.strictEqual(client._segmentAssemblyStates.size, 0)
	})

	test('incoming segmented ComplexACK reassembly supports sequence wrap-around', () => {
		const { client } = createStubClient()
		client._segmentAckResponse = () => {}
		let reassembled: Buffer | undefined
		client._handlePdu = (
			buffer: Buffer,
			offset: number,
			length: number,
		) => {
			reassembled = Buffer.from(buffer.subarray(offset, offset + length))
		}

		const total = 300
		for (let i = 0; i < total; i++) {
			const moreFollows = i < total - 1
			const msg = {
				type:
					PduType.COMPLEX_ACK |
					PduConReqBit.SEGMENTED_MESSAGE |
					(moreFollows ? PduConReqBit.MORE_FOLLOWS : 0),
				service: SERVICE,
				invokeId: 11,
				sequencenumber: i & 0xff,
				proposedWindowNumber: 16,
				header: {
					apduType:
						PduType.COMPLEX_ACK | PduConReqBit.SEGMENTED_MESSAGE,
					sender: { address: DEVICE },
					expectingReply: false,
					confirmedService: false,
				},
			} as any
			client._processSegment(msg, false, Buffer.from([i & 0xff]), 0, 1)
		}

		assert.ok(reassembled)
		// 3 octets of ComplexACK header + 300 payload octets
		assert.strictEqual(reassembled.length, 303)
		const ack = baApdu.decodeComplexAck(reassembled, 0)
		assert.strictEqual(ack.invokeId, 11)
		assert.strictEqual(ack.type & PduConReqBit.SEGMENTED_MESSAGE, 0)
		for (let i = 0; i < total; i++) {
			assert.strictEqual(reassembled[3 + i], i & 0xff)
		}
		assert.strictEqual(client._segmentAssemblyStates.size, 0)
	})
})
