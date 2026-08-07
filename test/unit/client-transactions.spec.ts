import test from 'node:test'
import assert from 'node:assert'

import BACnetClient from '../../src/lib/client'
import { RequestManager } from '../../src/lib/request-manager'
import * as baApdu from '../../src/lib/apdu'
import { ErrorService } from '../../src/lib/services'
import {
	AbortReason,
	ConfirmedServiceChoice,
	ErrorClass,
	ErrorCode,
	MaxApduLengthAccepted,
	MaxSegmentsAccepted,
	PduConReqBit,
	PduType,
} from '../../src/lib/enum'
import { InvokeIdInUseError } from '../../src/lib/errors'
import { BACNetAddress, EncodeBuffer } from '../../src/lib/types'

const DEVICE_A = '192.168.1.50:47808'
const DEVICE_B = '192.168.1.60:47808'
const SERVICE = ConfirmedServiceChoice.WRITE_PROPERTY

function createStubClient(opts: { apduTimeout?: number } = {}) {
	const sent: Array<{ data: Buffer; receiver?: BACNetAddress }> = []
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
	client._send = (buffer: EncodeBuffer, receiver?: BACNetAddress) => {
		sent.push({
			data: Buffer.from(buffer.buffer.subarray(0, buffer.offset)),
			receiver,
		})
	}
	return { client, sent }
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
	receiver: BACNetAddress,
	invokeId: number,
	segmentedRequest?: Record<string, unknown>,
): Promise<any> {
	return client._sendConfirmedRequest({
		receiver,
		service: SERVICE,
		maxSegments: MaxSegmentsAccepted.SEGMENTS_65,
		maxApdu: MaxApduLengthAccepted.OCTETS_1476,
		invokeId,
		segmentedRequest,
		encodePayload: fillPayload(segmentedRequest ? 10 : 2),
	})
}

function inject(
	client: any,
	sender: BACNetAddress,
	apduType: number,
	encode: (apdu: EncodeBuffer) => void,
) {
	const buffer = Buffer.alloc(32)
	const apdu: EncodeBuffer = { buffer, offset: 0 }
	encode(apdu)
	client._handlePdu(buffer, 0, apdu.offset, {
		apduType,
		sender,
		expectingReply: false,
		confirmedService: false,
	})
}

function injectSimpleAck(client: any, invokeId: number, sender: BACNetAddress) {
	inject(client, sender, PduType.SIMPLE_ACK, (apdu) =>
		baApdu.encodeSimpleAck(apdu, PduType.SIMPLE_ACK, SERVICE, invokeId),
	)
}

function injectError(client: any, invokeId: number, sender: BACNetAddress) {
	inject(client, sender, PduType.ERROR, (apdu) => {
		baApdu.encodeError(apdu, PduType.ERROR, SERVICE, invokeId)
		ErrorService.encode(
			apdu,
			ErrorClass.PROPERTY,
			ErrorCode.VALUE_OUT_OF_RANGE,
		)
	})
}

function injectAbort(
	client: any,
	invokeId: number,
	reason: number,
	sender: BACNetAddress,
) {
	inject(client, sender, PduType.ABORT, (apdu) =>
		baApdu.encodeAbort(apdu, PduType.ABORT | 0x01, invokeId, reason),
	)
}

function injectSegmentAck(
	client: any,
	invokeId: number,
	sequencenumber: number,
	actualWindowSize: number,
	sender: BACNetAddress,
) {
	const type = PduType.SEGMENT_ACK | 0x01 // server bit
	inject(client, sender, type, (apdu) =>
		baApdu.encodeSegmentAck(
			apdu,
			type,
			invokeId,
			sequencenumber,
			actualWindowSize,
		),
	)
}

function injectComplexAckSegment(
	client: any,
	invokeId: number,
	sequencenumber: number,
	moreFollows: boolean,
	payloadByte: number,
	sender: BACNetAddress,
) {
	const type =
		PduType.COMPLEX_ACK |
		PduConReqBit.SEGMENTED_MESSAGE |
		(moreFollows ? PduConReqBit.MORE_FOLLOWS : 0)
	inject(client, sender, type, (apdu) => {
		baApdu.encodeComplexAck(
			apdu,
			type,
			SERVICE,
			invokeId,
			sequencenumber,
			1,
		)
		apdu.buffer[apdu.offset++] = payloadByte
	})
}

test.describe('bacnet - per-peer transaction correlation', () => {
	test('the same invokeId can be pending toward two IP devices concurrently', async () => {
		const { client, sent } = createStubClient()
		const promiseA = sendRequest(client, { address: DEVICE_A }, 5)
		const promiseB = sendRequest(client, { address: DEVICE_B }, 5)
		assert.strictEqual(sent.length, 2)

		// A response from an unrelated third device resolves nothing
		injectSimpleAck(client, 5, { address: '192.168.1.99:47808' })

		let resolvedA = false
		let resolvedB = false
		promiseA.then(() => (resolvedA = true))
		promiseB.then(() => (resolvedB = true))

		injectSimpleAck(client, 5, { address: DEVICE_B })
		await promiseB
		assert.strictEqual(resolvedB, true)
		assert.strictEqual(resolvedA, false)

		injectSimpleAck(client, 5, { address: DEVICE_A })
		await promiseA
		assert.strictEqual(resolvedA, true)
	})

	test('invokeIds are allocated independently per peer', () => {
		const { client } = createStubClient()
		assert.strictEqual(client._getInvokeId({ address: DEVICE_A }), 0)
		assert.strictEqual(client._getInvokeId({ address: DEVICE_A }), 1)
		// A different peer starts from its own counter
		assert.strictEqual(client._getInvokeId({ address: DEVICE_B }), 0)
		// Address normalization: same peer with and without default port
		assert.strictEqual(client._getInvokeId({ address: '192.168.1.50' }), 2)
	})

	test('reusing a pending invokeId toward the same peer is refused before sending', async () => {
		const { client, sent } = createStubClient()
		const promise = sendRequest(client, { address: DEVICE_A }, 5)
		assert.strictEqual(sent.length, 1)

		await assert.rejects(
			sendRequest(client, { address: DEVICE_A }, 5),
			(err: InvokeIdInUseError) => {
				assert.ok(err instanceof InvokeIdInUseError)
				assert.strictEqual(err.invokeId, 5)
				assert.strictEqual(err.service, SERVICE)
				return true
			},
		)
		assert.strictEqual(sent.length, 1)

		// Once the first request settles, the invokeId is free again
		injectSimpleAck(client, 5, { address: DEVICE_A })
		await promise
		const retry = sendRequest(client, { address: DEVICE_A }, 5)
		assert.strictEqual(sent.length, 2)
		injectSimpleAck(client, 5, { address: DEVICE_A })
		await retry
	})

	test('invokeId allocation wraps around while older requests are still pending', async () => {
		const { client } = createStubClient()
		const receiver = { address: DEVICE_A }
		const pending = sendRequest(client, receiver, 0)

		const ids: number[] = []
		for (let i = 0; i < 256; i++) {
			ids.push(client._getInvokeId(receiver))
		}
		// The pending invokeId 0 is never handed out again
		assert.ok(!ids.includes(0))
		assert.strictEqual(ids[0], 1)
		assert.strictEqual(ids[254], 255)
		// Wrap-around: after 255 the counter skips the pending 0
		assert.strictEqual(ids[255], 1)

		injectSimpleAck(client, 0, receiver)
		await pending
	})

	test('at most 256 concurrent requests per peer, without limiting other peers', async () => {
		const { client, sent } = createStubClient()
		const receiverA = { address: DEVICE_A }
		const promises: Array<Promise<any>> = []
		for (let id = 0; id < 256; id++) {
			promises.push(sendRequest(client, receiverA, id))
		}
		assert.strictEqual(sent.length, 256)

		assert.throws(
			() => client._getInvokeId(receiverA),
			/ERR_MAX_CONCURRENT_REQUESTS/,
		)
		await assert.rejects(
			sendRequest(client, receiverA, 42),
			InvokeIdInUseError,
		)

		// A different peer is unaffected by the exhausted peer
		assert.strictEqual(client._getInvokeId({ address: DEVICE_B }), 0)
		const promiseB = sendRequest(client, { address: DEVICE_B }, 0)
		injectSimpleAck(client, 0, { address: DEVICE_B })
		await promiseB

		for (let id = 0; id < 256; id++) {
			injectSimpleAck(client, id, receiverA)
		}
		await Promise.all(promises)

		// All 256 invokeIds are available again
		assert.strictEqual(client._getInvokeId(receiverA), 0)
	})

	test('routed devices behind the same router IP with different net/adr stay isolated', async () => {
		const { client, sent } = createStubClient()
		const router = '10.0.0.1:47808'
		const devA: BACNetAddress = { address: router, net: 100, adr: [1] }
		const devB: BACNetAddress = { address: router, net: 100, adr: [2] }
		const promiseA = sendRequest(client, devA, 1)
		const promiseB = sendRequest(client, devB, 1)
		assert.strictEqual(sent.length, 2)

		let resolvedB = false
		promiseB.then(() => (resolvedB = true))

		// Response NPDUs carry the routed source as sender.net/adr
		injectSimpleAck(client, 1, { address: router, net: 100, adr: [2] })
		await promiseB
		assert.strictEqual(resolvedB, true)

		injectError(client, 1, { address: router, net: 100, adr: [1] })
		await assert.rejects(promiseA, /BacnetError - Class:2 - Code:37/)
	})

	test('devices behind the same BBMD with different forwardedFrom stay isolated', async () => {
		const { client, sent } = createStubClient()
		const bbmd = '10.0.0.1:47808'
		const devA: BACNetAddress = { address: bbmd, forwardedFrom: '10.0.0.5' }
		const devB: BACNetAddress = { address: bbmd, forwardedFrom: '10.0.0.6' }
		const promiseA = sendRequest(client, devA, 1)
		const promiseB = sendRequest(client, devB, 1)
		assert.strictEqual(sent.length, 2)

		let resolvedA = false
		promiseA.then(() => (resolvedA = true))

		// The BVLC decoder may include or omit the default port in the
		// originating address; both must correlate to the same peer.
		injectSimpleAck(client, 1, {
			address: bbmd,
			forwardedFrom: '10.0.0.5:47808',
		})
		await promiseA
		assert.strictEqual(resolvedA, true)

		injectSimpleAck(client, 1, { address: bbmd, forwardedFrom: '10.0.0.6' })
		await promiseB
	})

	test('abort resolves only the request of the aborting peer', async () => {
		const { client } = createStubClient()
		const promiseA = sendRequest(client, { address: DEVICE_A }, 7)
		const promiseB = sendRequest(client, { address: DEVICE_B }, 7)

		injectAbort(client, 7, AbortReason.BUFFER_OVERFLOW, {
			address: DEVICE_B,
		})
		await assert.rejects(promiseB, /BacnetAbort/)

		injectSimpleAck(client, 7, { address: DEVICE_A })
		await promiseA
	})

	test('timeout rejects only the unanswered request', async () => {
		const { client } = createStubClient({ apduTimeout: 150 })
		const promiseA = sendRequest(client, { address: DEVICE_A }, 3)
		const promiseB = sendRequest(client, { address: DEVICE_B }, 3)
		const expectTimeoutA = assert.rejects(promiseA, /ERR_TIMEOUT/)

		injectSimpleAck(client, 3, { address: DEVICE_B })
		await promiseB

		await expectTimeoutA
	})

	test('a confirmed request without receiver address still correlates on invokeId alone', async () => {
		const { client } = createStubClient()
		const promise = sendRequest(client, {}, 9)
		injectSimpleAck(client, 9, { address: '192.168.1.77:47808' })
		await promise
	})

	test('segmented requests with the same invokeId toward two devices stay isolated', async () => {
		const { client, sent } = createStubClient()
		const segmented = { enabled: true, remoteMaxApduLength: 12 }
		const promiseA = sendRequest(client, { address: DEVICE_A }, 1, {
			...segmented,
		})
		const promiseB = sendRequest(client, { address: DEVICE_B }, 1, {
			...segmented,
		})
		// One initial segment each
		assert.strictEqual(sent.length, 2)
		assert.strictEqual(client._outgoingSegmentTransactions.size, 2)

		// Interleaved SegmentACKs advance only the matching transaction
		injectSegmentAck(client, 1, 0, 1, { address: DEVICE_B })
		assert.strictEqual(sent.length, 3)
		assert.strictEqual(sent[2].receiver?.address, DEVICE_B)
		injectSegmentAck(client, 1, 0, 1, { address: DEVICE_A })
		assert.strictEqual(sent.length, 4)
		assert.strictEqual(sent[3].receiver?.address, DEVICE_A)
		injectSegmentAck(client, 1, 1, 1, { address: DEVICE_A })
		injectSegmentAck(client, 1, 1, 1, { address: DEVICE_B })

		// Interleaved segmented ComplexACK responses reassemble per peer
		injectComplexAckSegment(client, 1, 0, true, 0xaa, { address: DEVICE_A })
		injectComplexAckSegment(client, 1, 0, true, 0xcc, { address: DEVICE_B })
		injectComplexAckSegment(client, 1, 1, false, 0xbb, {
			address: DEVICE_A,
		})
		injectComplexAckSegment(client, 1, 1, false, 0xdd, {
			address: DEVICE_B,
		})

		const [dataA, dataB] = await Promise.all([promiseA, promiseB])
		assert.deepStrictEqual(
			Buffer.from(
				dataA.buffer.subarray(
					dataA.offset,
					dataA.offset + dataA.length,
				),
			),
			Buffer.from([0xaa, 0xbb]),
		)
		assert.deepStrictEqual(
			Buffer.from(
				dataB.buffer.subarray(
					dataB.offset,
					dataB.offset + dataB.length,
				),
			),
			Buffer.from([0xcc, 0xdd]),
		)
		assert.strictEqual(client._outgoingSegmentTransactions.size, 0)
		assert.strictEqual(client._segmentAssemblyStates.size, 0)
	})
})
