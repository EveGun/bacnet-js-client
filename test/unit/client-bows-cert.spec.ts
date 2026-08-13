import test from 'node:test'
import assert from 'node:assert'

import BACnetClient from '../../src/lib/client'
import { RequestManager } from '../../src/lib/request-manager'
import * as baBvlc from '../../src/lib/bvlc'
import * as baNpdu from '../../src/lib/npdu'
import * as baApdu from '../../src/lib/apdu'
import * as baAsn1 from '../../src/lib/asn1'
import { ReadProperty, WhoHas } from '../../src/lib/services'
import {
	AbortReason,
	ApplicationTag,
	BvlcResultFormat,
	BvlcResultPurpose,
	HostAddressType,
	PropertyIdentifier,
	ConfirmedServiceChoice,
	ErrorClass,
	ErrorCode,
	MaxApduLengthAccepted,
	MaxSegmentsAccepted,
	PDU_TYPE_MASK,
	PduConReqBit,
	PduType,
	RejectReason,
	UnconfirmedServiceChoice,
} from '../../src/lib/enum'
import { BACNetAddress, EncodeBuffer } from '../../src/lib/types'
import { ErrorService } from '../../src/lib/services'

const DEVICE_A = '192.168.1.50:47808'
const SERVICE = ConfirmedServiceChoice.READ_PROPERTY

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

function decodeSentWhoHas(data: Buffer) {
	const bvlc = baBvlc.decode(data, 0)
	const npdu = baNpdu.decode(data, bvlc.len)
	const apdu = baApdu.decodeUnconfirmedServiceRequest(
		data,
		bvlc.len + npdu.len,
	)
	const payloadOffset = bvlc.len + npdu.len + apdu.len
	const payload = WhoHas.decode(
		data,
		payloadOffset,
		data.length - payloadOffset,
	)
	return { apdu, payload }
}

function inject(
	client: any,
	sender: BACNetAddress,
	apduType: number,
	encode: (apdu: EncodeBuffer) => void,
) {
	const buffer = Buffer.alloc(64)
	const apdu: EncodeBuffer = { buffer, offset: 0 }
	encode(apdu)
	client._handlePdu(buffer, 0, apdu.offset, {
		apduType,
		sender,
		expectingReply: false,
		confirmedService: false,
	})
}

function sendRequest(
	client: any,
	invokeId: number,
	extra: Record<string, unknown> = {},
): Promise<any> {
	return client._sendConfirmedRequest({
		receiver: { address: DEVICE_A },
		service: SERVICE,
		maxSegments: MaxSegmentsAccepted.SEGMENTS_65,
		maxApdu: MaxApduLengthAccepted.OCTETS_1476,
		invokeId,
		encodePayload: (buffer: EncodeBuffer) => {
			buffer.buffer[buffer.offset++] = 0x00
		},
		...extra,
	})
}

test('bacnet - whoHas sender', async (t) => {
	await t.test('encodes Who-Has by object identifier, no range', () => {
		const { client, sent } = createStubClient()
		client.whoHas({ objectId: { type: 8, instance: 4242 } })
		assert.strictEqual(sent.length, 1)
		const { apdu, payload } = decodeSentWhoHas(sent[0].data)
		assert.strictEqual(apdu.service, UnconfirmedServiceChoice.WHO_HAS)
		assert.deepStrictEqual(payload.objectId, { type: 8, instance: 4242 })
		assert.strictEqual(payload.lowLimit, undefined)
		assert.strictEqual(payload.highLimit, undefined)
	})

	await t.test('encodes Who-Has by object name with device range', () => {
		const { client, sent } = createStubClient()
		client.whoHas(
			{ address: DEVICE_A },
			{ objectName: 'Pump-1', lowLimit: 10, highLimit: 20 },
		)
		assert.strictEqual(sent.length, 1)
		assert.strictEqual(sent[0].receiver?.address, DEVICE_A)
		const { payload } = decodeSentWhoHas(sent[0].data)
		assert.strictEqual(payload.objectName, 'Pump-1')
		assert.strictEqual(payload.lowLimit, 10)
		assert.strictEqual(payload.highLimit, 20)
	})

	await t.test('rejects invalid choice and range combinations', () => {
		const { client } = createStubClient()
		assert.throws(() => client.whoHas({}), /exactly one of/)
		assert.throws(
			() =>
				client.whoHas({
					objectId: { type: 8, instance: 1 },
					objectName: 'x',
				}),
			/exactly one of/,
		)
		assert.throws(
			() => client.whoHas({ objectName: 'x', lowLimit: 5 }),
			/lowLimit and highLimit/,
		)
		assert.throws(
			() =>
				client.whoHas({
					objectName: 'x',
					lowLimit: 1,
					highLimit: 5000000,
				}),
			/lowLimit and highLimit/,
		)
	})
})

test('bacnet - segmented response acceptance advertisement', async (t) => {
	await t.test(
		'acceptSegmentedResponse with unspecified max sends SEG bit and B000',
		async () => {
			const { client, sent } = createStubClient()
			const promise = sendRequest(client, 1, {
				maxSegments: MaxSegmentsAccepted.SEGMENTS_0,
				acceptSegmentedResponse: true,
			})
			assert.strictEqual(sent.length, 1)
			const data = sent[0].data
			const bvlc = baBvlc.decode(data, 0)
			const npdu = baNpdu.decode(data, bvlc.len)
			const apduTypeOctet = data[bvlc.len + npdu.len]
			assert.ok(
				apduTypeOctet & PduConReqBit.SEGMENTED_RESPONSE_ACCEPTED,
				'SEGMENTED_RESPONSE_ACCEPTED must be set',
			)
			// max-segments-accepted lives in bits 6..4 of the second octet
			const maxSegmentsOctet = data[bvlc.len + npdu.len + 1]
			assert.strictEqual(
				(maxSegmentsOctet >> 4) & 0x07,
				0,
				'max-segments must be B000 (unspecified)',
			)
			inject(client, { address: DEVICE_A }, PduType.SIMPLE_ACK, (apdu) =>
				baApdu.encodeSimpleAck(apdu, PduType.SIMPLE_ACK, SERVICE, 1),
			)
			await promise
		},
	)

	await t.test(
		'no acceptSegmentedResponse leaves the SEG bit unset',
		async () => {
			const { client, sent } = createStubClient()
			const promise = sendRequest(client, 2, {
				maxSegments: MaxSegmentsAccepted.SEGMENTS_65,
			})
			const data = sent[0].data
			const bvlc = baBvlc.decode(data, 0)
			const npdu = baNpdu.decode(data, bvlc.len)
			const apduTypeOctet = data[bvlc.len + npdu.len]
			assert.strictEqual(
				apduTypeOctet & PduConReqBit.SEGMENTED_RESPONSE_ACCEPTED,
				0,
			)
			inject(client, { address: DEVICE_A }, PduType.SIMPLE_ACK, (apdu) =>
				baApdu.encodeSimpleAck(apdu, PduType.SIMPLE_ACK, SERVICE, 2),
			)
			await promise
		},
	)

	await t.test(
		'readRange advertises segmented response acceptance',
		async () => {
			const { client, sent } = createStubClient()
			const promise = client
				.readRange(
					{ address: DEVICE_A },
					{ type: 20, instance: 1 },
					1,
					10,
					{
						invokeId: 3,
					},
				)
				.catch(() => {})
			assert.strictEqual(sent.length, 1)
			const data = sent[0].data
			const bvlc = baBvlc.decode(data, 0)
			const npdu = baNpdu.decode(data, bvlc.len)
			assert.ok(
				data[bvlc.len + npdu.len] &
					PduConReqBit.SEGMENTED_RESPONSE_ACCEPTED,
			)
			inject(client, { address: DEVICE_A }, PduType.ABORT, (apdu) =>
				baApdu.encodeAbort(apdu, PduType.ABORT | 0x01, 3, 4),
			)
			await promise
		},
	)
})

test('bacnet - reject vs abort distinction', async (t) => {
	await t.test('a Reject-PDU rejects with BacnetReject', async () => {
		const { client } = createStubClient()
		const promise = sendRequest(client, 7)
		inject(client, { address: DEVICE_A }, PduType.REJECT, (apdu) =>
			baApdu.encodeAbort(
				apdu,
				PduType.REJECT,
				7,
				RejectReason.UNRECOGNIZED_SERVICE,
			),
		)
		await assert.rejects(promise, /BacnetReject - Reason:9/)
	})

	await t.test('an Abort-PDU still rejects with BacnetAbort', async () => {
		const { client } = createStubClient()
		const promise = sendRequest(client, 8)
		inject(client, { address: DEVICE_A }, PduType.ABORT, (apdu) =>
			baApdu.encodeAbort(apdu, PduType.ABORT | 0x01, 8, 4),
		)
		await assert.rejects(promise, /BacnetAbort - Reason:4/)
	})
})

test('bacnet - transaction observability events', async (t) => {
	await t.test('emits ack disposition with timing', async () => {
		const { client } = createStubClient()
		const outcomes: any[] = []
		client.on('transaction', (o: any) => outcomes.push(o))
		const promise = sendRequest(client, 11)
		inject(client, { address: DEVICE_A }, PduType.SIMPLE_ACK, (apdu) =>
			baApdu.encodeSimpleAck(apdu, PduType.SIMPLE_ACK, SERVICE, 11),
		)
		await promise
		assert.strictEqual(outcomes.length, 1)
		assert.strictEqual(outcomes[0].disposition, 'ack')
		assert.strictEqual(outcomes[0].invokeId, 11)
		assert.strictEqual(outcomes[0].service, SERVICE)
		assert.strictEqual(outcomes[0].link, DEVICE_A)
		assert.ok(outcomes[0].durationMs >= 0)
	})

	await t.test('emits error disposition with class and code', async () => {
		const { client } = createStubClient()
		const outcomes: any[] = []
		client.on('transaction', (o: any) => outcomes.push(o))
		const promise = sendRequest(client, 12)
		inject(client, { address: DEVICE_A }, PduType.ERROR, (apdu) => {
			baApdu.encodeError(apdu, PduType.ERROR, SERVICE, 12)
			ErrorService.encode(
				apdu,
				ErrorClass.OBJECT,
				ErrorCode.UNKNOWN_OBJECT,
			)
		})
		await assert.rejects(promise)
		assert.strictEqual(outcomes[0].disposition, 'error')
		assert.strictEqual(outcomes[0].errorClass, ErrorClass.OBJECT)
		assert.strictEqual(outcomes[0].errorCode, ErrorCode.UNKNOWN_OBJECT)
	})

	await t.test('emits reject and timeout dispositions', async () => {
		const { client } = createStubClient({ apduTimeout: 100 })
		const outcomes: any[] = []
		client.on('transaction', (o: any) => outcomes.push(o))
		const rejected = sendRequest(client, 13)
		inject(client, { address: DEVICE_A }, PduType.REJECT, (apdu) =>
			baApdu.encodeAbort(
				apdu,
				PduType.REJECT,
				13,
				RejectReason.UNRECOGNIZED_SERVICE,
			),
		)
		await assert.rejects(rejected)
		const timedOut = sendRequest(client, 14)
		await assert.rejects(timedOut, /ERR_TIMEOUT/)
		assert.strictEqual(outcomes[0].disposition, 'reject')
		assert.strictEqual(
			outcomes[0].rejectReason,
			RejectReason.UNRECOGNIZED_SERVICE,
		)
		assert.strictEqual(outcomes[1].disposition, 'timeout')
	})

	await t.test('no listener means no emission overhead', async () => {
		const { client } = createStubClient()
		const promise = sendRequest(client, 15)
		inject(client, { address: DEVICE_A }, PduType.SIMPLE_ACK, (apdu) =>
			baApdu.encodeSimpleAck(apdu, PduType.SIMPLE_ACK, SERVICE, 15),
		)
		await assert.doesNotReject(promise)
	})
})

function injectConfirmedRequest(
	client: any,
	service: number,
	invokeId: number,
	encodePayload?: (apdu: EncodeBuffer) => void,
	trailingBytes = 0,
) {
	const buffer = Buffer.alloc(128)
	const apdu: EncodeBuffer = { buffer, offset: 0 }
	baApdu.encodeConfirmedServiceRequest(
		apdu,
		PduType.CONFIRMED_REQUEST,
		service,
		MaxSegmentsAccepted.SEGMENTS_0,
		MaxApduLengthAccepted.OCTETS_1476,
		invokeId,
	)
	if (encodePayload) encodePayload(apdu)
	for (let i = 0; i < trailingBytes; i++) {
		// A fully-formed but unexpected extra tag (unsigned 1)
		buffer[apdu.offset++] = 0x21
		buffer[apdu.offset++] = 0x01
		i++
	}
	client._handlePdu(buffer, 0, apdu.offset, {
		apduType: PduType.CONFIRMED_REQUEST,
		sender: { address: DEVICE_A },
		expectingReply: true,
		confirmedService: false,
	})
}

function decodeSentPdu(data: Buffer) {
	const bvlc = baBvlc.decode(data, 0)
	const npdu = baNpdu.decode(data, bvlc.len)
	const apduOffset = bvlc.len + npdu.len
	const pduType = data[apduOffset] & PDU_TYPE_MASK
	return { bvlc, npdu, apduOffset, pduType, data }
}

test('bacnet - server-side reject behaviour (135.1 9.39.1 / 13.4.x)', async (t) => {
	await t.test(
		'unknown confirmed service choice elicits Reject UNRECOGNIZED_SERVICE',
		() => {
			const { client, sent } = createStubClient()
			injectConfirmedRequest(client, 77, 42)
			assert.strictEqual(sent.length, 1)
			const { pduType, data, apduOffset } = decodeSentPdu(sent[0].data)
			assert.strictEqual(pduType, PduType.REJECT)
			const abort = baApdu.decodeAbort(data, apduOffset)
			assert.strictEqual(abort.invokeId, 42)
			assert.strictEqual(abort.reason, RejectReason.UNRECOGNIZED_SERVICE)
		},
	)

	await t.test(
		'known service without listener elicits Reject, not Error',
		() => {
			const { client, sent } = createStubClient()
			injectConfirmedRequest(
				client,
				ConfirmedServiceChoice.READ_PROPERTY,
				43,
				(apdu) => ReadProperty.encode(apdu, 8, 1, 77, 0xffffffff),
			)
			assert.strictEqual(sent.length, 1)
			const { pduType, data, apduOffset } = decodeSentPdu(sent[0].data)
			assert.strictEqual(pduType, PduType.REJECT)
			const abort = baApdu.decodeAbort(data, apduOffset)
			assert.strictEqual(abort.reason, RejectReason.UNRECOGNIZED_SERVICE)
		},
	)

	await t.test(
		'malformed confirmed request elicits Reject INVALID_TAG',
		() => {
			const { client, sent } = createStubClient()
			client.on('readProperty', () => {})
			// Truncated ReadProperty payload: a lone context tag 0 with a
			// declared 4-octet object id but no content.
			injectConfirmedRequest(
				client,
				ConfirmedServiceChoice.READ_PROPERTY,
				44,
				(apdu) => {
					apdu.buffer[apdu.offset++] = 0x0c
				},
			)
			assert.strictEqual(sent.length, 1)
			const { pduType, data, apduOffset } = decodeSentPdu(sent[0].data)
			assert.strictEqual(pduType, PduType.REJECT)
			const abort = baApdu.decodeAbort(data, apduOffset)
			assert.strictEqual(abort.invokeId, 44)
			assert.strictEqual(abort.reason, RejectReason.INVALID_TAG)
		},
	)

	await t.test(
		'trailing octets after a valid request elicit a Reject (135.1 13.4.5 accepts INVALID_TAG)',
		() => {
			const { client, sent } = createStubClient()
			const seen: any[] = []
			client.on('readProperty', (msg: any) => seen.push(msg))
			injectConfirmedRequest(
				client,
				ConfirmedServiceChoice.READ_PROPERTY,
				45,
				(apdu) => ReadProperty.encode(apdu, 8, 1, 77, 0xffffffff),
				2,
			)
			assert.strictEqual(seen.length, 0, 'listener must not be called')
			assert.strictEqual(sent.length, 1)
			const { pduType, data, apduOffset } = decodeSentPdu(sent[0].data)
			assert.strictEqual(pduType, PduType.REJECT)
			const abort = baApdu.decodeAbort(data, apduOffset)
			assert.ok(
				abort.reason === RejectReason.TOO_MANY_ARGUMENTS ||
					abort.reason === RejectReason.INVALID_TAG,
				`reason ${abort.reason} must be TOO_MANY_ARGUMENTS or INVALID_TAG`,
			)
		},
	)

	await t.test(
		'application-class tag where a context tag is required elicits Reject INVALID_TAG (135.1 13.4.3)',
		() => {
			const { client, sent } = createStubClient()
			client.on('readProperty', () => {})
			// Valid object id, then property id as APPLICATION enumerated
			// (0x91) instead of context tag 1.
			injectConfirmedRequest(
				client,
				ConfirmedServiceChoice.READ_PROPERTY,
				47,
				(apdu) => {
					const b = apdu.buffer
					b[apdu.offset++] = 0x0c // context 0, len 4 (object id)
					b.writeUInt32BE((8 << 22) | 1, apdu.offset)
					apdu.offset += 4
					b[apdu.offset++] = 0x91 // application enumerated
					b[apdu.offset++] = 77
				},
			)
			assert.strictEqual(sent.length, 1)
			const { pduType, data, apduOffset } = decodeSentPdu(sent[0].data)
			assert.strictEqual(pduType, PduType.REJECT)
			assert.strictEqual(
				baApdu.decodeAbort(data, apduOffset).reason,
				RejectReason.INVALID_TAG,
			)
		},
	)

	await t.test('valid request with listener is dispatched normally', () => {
		const { client, sent } = createStubClient()
		const seen: any[] = []
		client.on('readProperty', (msg: any) => seen.push(msg))
		injectConfirmedRequest(
			client,
			ConfirmedServiceChoice.READ_PROPERTY,
			46,
			(apdu) => ReadProperty.encode(apdu, 8, 1, 77, 0xffffffff),
		)
		assert.strictEqual(seen.length, 1)
		assert.strictEqual(sent.length, 0)
	})
})

test('bacnet - BVLC BBMD-function NAKs (Annex J)', async (t) => {
	function injectBvlc(client: any, func: number, payload: Buffer) {
		const frame = Buffer.alloc(4 + payload.length)
		frame[0] = 0x81
		frame[1] = func
		frame.writeUInt16BE(frame.length, 2)
		payload.copy(frame, 4)
		client._receiveData(frame, DEVICE_A)
	}

	function expectNak(sent: any[], nak: number) {
		assert.strictEqual(sent.length, 1)
		const data: Buffer = sent[0].data
		assert.strictEqual(data[0], 0x81)
		assert.strictEqual(data[1], BvlcResultPurpose.BVLC_RESULT)
		assert.strictEqual(data.readUInt16BE(4), nak)
	}

	await t.test('Register-Foreign-Device without listener is NAKed', () => {
		const { client, sent } = createStubClient()
		injectBvlc(
			client,
			BvlcResultPurpose.REGISTER_FOREIGN_DEVICE,
			Buffer.from([0x00, 0x3c]),
		)
		expectNak(sent, BvlcResultFormat.REGISTER_FOREIGN_DEVICE_NAK)
	})

	await t.test('Register-Foreign-Device with listener is delegated', () => {
		const { client, sent } = createStubClient()
		const seen: any[] = []
		client.on('registerForeignDevice', (msg: any) => seen.push(msg))
		injectBvlc(
			client,
			BvlcResultPurpose.REGISTER_FOREIGN_DEVICE,
			Buffer.from([0x00, 0x3c]),
		)
		assert.strictEqual(seen.length, 1)
		assert.strictEqual(sent.length, 0)
	})

	await t.test('BBMD table administration functions are NAKed', () => {
		const cases: Array<[number, number]> = [
			[
				BvlcResultPurpose.WRITE_BROADCAST_DISTRIBUTION_TABLE,
				BvlcResultFormat.WRITE_BROADCAST_DISTRIBUTION_TABLE_NAK,
			],
			[
				BvlcResultPurpose.READ_BROADCAST_DISTRIBUTION_TABLE,
				BvlcResultFormat.READ_BROADCAST_DISTRIBUTION_TABLE_NAK,
			],
			[
				BvlcResultPurpose.READ_FOREIGN_DEVICE_TABLE,
				BvlcResultFormat.READ_FOREIGN_DEVICE_TABLE_NAK,
			],
			[
				BvlcResultPurpose.DELETE_FOREIGN_DEVICE_TABLE_ENTRY,
				BvlcResultFormat.DELETE_FOREIGN_DEVICE_TABLE_ENTRY_NAK,
			],
			[
				BvlcResultPurpose.DISTRIBUTE_BROADCAST_TO_NETWORK,
				BvlcResultFormat.DISTRIBUTE_BROADCAST_TO_NETWORK_NAK,
			],
		]
		for (const [func, nak] of cases) {
			const { client, sent } = createStubClient()
			injectBvlc(client, func, Buffer.alloc(6))
			expectNak(sent, nak)
		}
	})
})

test('bacnet - responder overflow protection (135.1 9.18.1.6)', async (t) => {
	await t.test(
		'oversized ReadProperty response becomes Abort BUFFER_OVERFLOW',
		() => {
			const { client, sent } = createStubClient()
			const bigValue = Array.from({ length: 40 }, () => ({
				type: ApplicationTag.CHARACTER_STRING,
				value: 'x'.repeat(200),
			}))
			client.readPropertyResponse(
				{ address: DEVICE_A },
				91,
				{ type: 8, instance: 1 },
				{ id: 77, index: 0xffffffff },
				bigValue,
			)
			assert.strictEqual(sent.length, 1)
			const { pduType, data, apduOffset } = decodeSentPdu(sent[0].data)
			assert.strictEqual(pduType, PduType.ABORT)
			const abort = baApdu.decodeAbort(data, apduOffset)
			assert.strictEqual(abort.invokeId, 91)
			assert.strictEqual(abort.reason, AbortReason.BUFFER_OVERFLOW)
		},
	)

	await t.test(
		'response exceeding the requester max-APDU is aborted even if it fits the wire',
		() => {
			const { client, sent } = createStubClient()
			const value = [
				{
					type: ApplicationTag.CHARACTER_STRING,
					value: 'y'.repeat(600),
				},
			]
			client.readPropertyResponse(
				{ address: DEVICE_A },
				92,
				{ type: 8, instance: 1 },
				{ id: 77, index: 0xffffffff },
				value,
				{ maxApduLength: 480 },
			)
			const { pduType, data, apduOffset } = decodeSentPdu(sent[0].data)
			assert.strictEqual(pduType, PduType.ABORT)
			assert.strictEqual(
				baApdu.decodeAbort(data, apduOffset).reason,
				AbortReason.BUFFER_OVERFLOW,
			)
		},
	)

	await t.test('BACnetHostNPort round-trips through asn1', () => {
		const cases = [
			{
				host: {
					type: HostAddressType.IP_ADDRESS,
					address: [192, 168, 1, 77],
				},
				port: 47808,
			},
			{ host: { type: HostAddressType.NONE }, port: 47809 },
			{
				host: { type: HostAddressType.NAME, name: 'bbmd.example.com' },
				port: 47808,
			},
		]
		for (const value of cases) {
			const buffer: EncodeBuffer = {
				buffer: Buffer.alloc(64),
				offset: 0,
			}
			baAsn1.encodeHostNPort(buffer, value as any)
			const decoded = baAsn1.decodeHostNPort(
				buffer.buffer,
				0,
				buffer.offset,
			)
			assert.ok(decoded, 'decode must succeed')
			assert.strictEqual(decoded.len, buffer.offset)
			assert.strictEqual(decoded.value.port, value.port)
			assert.strictEqual(decoded.value.host.type, value.host.type)
			if ('address' in value.host) {
				assert.deepStrictEqual(
					decoded.value.host.address,
					value.host.address,
				)
			}
			if ('name' in value.host) {
				assert.strictEqual(decoded.value.host.name, value.host.name)
			}
			// The generic application-data decoder must route
			// FD_BBMD_Address through the HostNPort decoder.
			const generic = baAsn1.bacappDecodeApplicationData(
				buffer.buffer,
				0,
				buffer.offset,
				56,
				PropertyIdentifier.FD_BBMD_ADDRESS,
			)
			assert.ok(generic)
			assert.deepStrictEqual(generic.value, decoded.value)
		}
	})

	await t.test('a fitting response is sent as ComplexACK', () => {
		const { client, sent } = createStubClient()
		client.readPropertyResponse(
			{ address: DEVICE_A },
			93,
			{ type: 8, instance: 1 },
			{ id: 77, index: 0xffffffff },
			[{ type: ApplicationTag.CHARACTER_STRING, value: 'ok' }],
			{ maxApduLength: 480 },
		)
		const { pduType } = decodeSentPdu(sent[0].data)
		assert.strictEqual(pduType, PduType.COMPLEX_ACK)
	})
})
