import test from 'node:test'
import assert from 'node:assert'

import * as utils from './utils'
import * as baAsn1 from '../../src/lib/asn1'
import { ReadRange } from '../../src/lib/services'
import { ApplicationTag, ObjectType, ReadRangeType } from '../../src'
import type { EncodeBuffer } from '../../src/lib/types'

// Helper: build the itemData buffer for a single LogRecord with the given logDatum payload.
// Produces: [0] Date Time [0] [1] <datum> [1] [2] statusFlags (optional)
function buildLogRecord(
	encodeDatum: (buf: EncodeBuffer) => void,
	statusFlags?: { inAlarm: boolean; fault: boolean; overridden: boolean; outOfService: boolean },
): Buffer {
	const buf = utils.getBuffer()
	// timestamp: [0] Date Time [0]
	baAsn1.encodeOpeningTag(buf, 0)
	baAsn1.bacappEncodeApplicationData(buf, { type: ApplicationTag.DATE, value: new Date(2024, 1, 3) })
	baAsn1.bacappEncodeApplicationData(buf, { type: ApplicationTag.TIME, value: new Date(2024, 1, 3, 12, 15, 30, 0) })
	baAsn1.encodeClosingTag(buf, 0)
	// logDatum: [1] ... [1]
	baAsn1.encodeOpeningTag(buf, 1)
	encodeDatum(buf)
	baAsn1.encodeClosingTag(buf, 1)
	// statusFlags: [2] BACnetStatusFlags BIT STRING (OPTIONAL)
	// bit0=IN_ALARM (0x80), bit1=FAULT (0x40), bit2=OVERRIDDEN (0x20), bit3=OUT_OF_SERVICE (0x10)
	if (statusFlags) {
		const bits =
			(statusFlags.inAlarm ? 0x80 : 0) |
			(statusFlags.fault ? 0x40 : 0) |
			(statusFlags.overridden ? 0x20 : 0) |
			(statusFlags.outOfService ? 0x10 : 0)
		baAsn1.encodeContextBitstring(buf, 2, { bitsUsed: 4, value: [bits] })
	}
	return buf.buffer.slice(0, buf.offset)
}

const TS = new Date(2024, 1, 3, 12, 15, 30, 0)

function encodeAndDecodeAck(itemData: Buffer) {
	const buf = utils.getBuffer()
	ReadRange.encodeAcknowledge(
		buf,
		{ type: ObjectType.TREND_LOG, instance: 0 },
		131, // LOG_BUFFER
		0xffffffff,
		{ bitsUsed: 3, value: [0b10000000] }, // FIRST_ITEM
		1,
		itemData,
		ReadRangeType.BY_POSITION,
		0,
	)
	return ReadRange.decodeAcknowledge(buf.buffer, 0, buf.offset)
}

test.describe('bacnet - Services layer ReadRange unit', () => {
	test('should successfully encode and decode by position', () => {
		const buffer = utils.getBuffer()
		ReadRange.encode(
			buffer,
			{ type: ObjectType.DEVICE, instance: 35 },
			85,
			0xffffffff,
			ReadRangeType.BY_POSITION,
			10,
			null,
			0,
		)
		const result = ReadRange.decode(buffer.buffer, 0, buffer.offset)
		delete result.len
		assert.deepStrictEqual(result, {
			count: 0,
			objectId: { type: ObjectType.DEVICE, instance: 35 },
			position: 10,
			property: { index: 0xffffffff, id: 85 },
			requestType: ReadRangeType.BY_POSITION,
			time: undefined,
		})
	})

	test('should successfully encode and decode by position with array index', () => {
		const buffer = utils.getBuffer()
		ReadRange.encode(
			buffer,
			{ type: ObjectType.DEVICE, instance: 35 },
			12,
			2,
			ReadRangeType.BY_SEQUENCE_NUMBER,
			10,
			null,
			0,
		)
		const result = ReadRange.decode(buffer.buffer, 0, buffer.offset)
		delete result.len
		assert.deepStrictEqual(result, {
			count: 0,
			objectId: { type: ObjectType.DEVICE, instance: 35 },
			position: 10,
			property: { index: 2, id: 12 },
			requestType: ReadRangeType.BY_SEQUENCE_NUMBER,
			time: undefined,
		})
	})

	test('should successfully encode and decode by sequence', () => {
		const buffer = utils.getBuffer()
		ReadRange.encode(
			buffer,
			{ type: ObjectType.DEVICE, instance: 35 },
			85,
			0xffffffff,
			ReadRangeType.BY_SEQUENCE_NUMBER,
			11,
			null,
			1111,
		)
		const result = ReadRange.decode(buffer.buffer, 0, buffer.offset)
		delete result.len
		assert.deepStrictEqual(result, {
			count: 1111,
			objectId: { type: ObjectType.DEVICE, instance: 35 },
			position: 11,
			property: { index: 0xffffffff, id: 85 },
			requestType: ReadRangeType.BY_SEQUENCE_NUMBER,
			time: undefined,
		})
	})

	test('should successfully encode and decode by time', () => {
		const buffer = utils.getBuffer()
		const date = new Date(2024, 1, 1, 12, 15, 30, 990)
		ReadRange.encode(
			buffer,
			{ type: ObjectType.DEVICE, instance: 35 },
			85,
			0xffffffff,
			ReadRangeType.BY_TIME_REFERENCE_TIME_COUNT,
			null,
			date,
			-1111,
		)
		const result = ReadRange.decode(buffer.buffer, 0, buffer.offset)
		delete result.len
		assert.deepStrictEqual(result, {
			count: -1111,
			objectId: { type: ObjectType.DEVICE, instance: 35 },
			position: undefined,
			property: { index: 0xffffffff, id: 85 },
			requestType: ReadRangeType.BY_TIME_REFERENCE_TIME_COUNT,
			time: date,
		})
	})
})

test.describe('ReadRangeAcknowledge', () => {
	test('should successfully encode and decode (no values)', () => {
		const buffer = utils.getBuffer()
		ReadRange.encodeAcknowledge(
			buffer,
			{ type: 12, instance: 500 },
			5048,
			0xffffffff,
			{ bitsUsed: 24, value: [1, 2, 3] },
			12,
			Buffer.from([1, 2, 3]),
			2,
			2,
		)
		const result = ReadRange.decodeAcknowledge(buffer.buffer, 0, buffer.offset)
		delete result.len
		assert.deepStrictEqual(result, {
			objectId: { type: 12, instance: 500 },
			itemCount: 12,
			property: { id: 5048, index: 0xffffffff },
			resultFlag: { bitsUsed: 24, value: [1, 2, 3] },
			rangeBuffer: Buffer.from([1, 2, 3]),
		})
	})

	test('should report len including rangeBuffer and closing tag', () => {
		const buffer = utils.getBuffer()
		ReadRange.encodeAcknowledge(
			buffer,
			{ type: 12, instance: 500 },
			5048,
			0xffffffff,
			{ bitsUsed: 24, value: [1, 2, 3] },
			12,
			Buffer.from([1, 2, 3]),
			ReadRangeType.BY_POSITION,
			2,
		)
		const result = ReadRange.decodeAcknowledge(buffer.buffer, 0, buffer.offset)
		assert.ok(result)
		assert.strictEqual(result.len, buffer.offset)
	})

	test('should decode log-datum: real-value [2]', () => {
		const itemData = buildLogRecord((buf) => {
			// context tag 2, primitive, 4 bytes (REAL)
			baAsn1.encodeTag(buf, 2, true, 4)
			buf.buffer.writeFloatBE(42.5, buf.offset)
			buf.offset += 4
		})
		const result = encodeAndDecodeAck(itemData)
		assert.ok(result?.values?.length === 1)
		const rec = result.values[0]
		assert.equal(rec.logDatum.type, 'real-value')
		assert.ok(Math.abs((rec.logDatum as { type: string; value: number }).value - 42.5) < 0.001)
		assert.equal(rec.timestamp.getTime(), TS.getTime())
		assert.equal(rec.statusFlags, undefined)
	})

	test('should decode log-datum: boolean-value [1]', () => {
		const itemData = buildLogRecord((buf) => {
			// context tag 1, lenValueType=1 means true (BACnet boolean in context tag)
			baAsn1.encodeTag(buf, 1, true, 1)
		})
		const result = encodeAndDecodeAck(itemData)
		assert.ok(result?.values?.length === 1)
		assert.equal(result.values[0].logDatum.type, 'boolean-value')
		assert.equal((result.values[0].logDatum as { type: string; value: boolean }).value, true)
	})

	test('should decode log-datum: unsigned-value [4]', () => {
		const itemData = buildLogRecord((buf) => {
			baAsn1.encodeTag(buf, 4, true, 2)  // context tag 4, 2 bytes
			buf.buffer.writeUInt16BE(1234, buf.offset)
			buf.offset += 2
		})
		const result = encodeAndDecodeAck(itemData)
		assert.ok(result?.values?.length === 1)
		assert.equal(result.values[0].logDatum.type, 'unsigned-value')
		assert.equal((result.values[0].logDatum as { type: string; value: number }).value, 1234)
	})

	test('should decode log-datum: integer-value [5]', () => {
		const itemData = buildLogRecord((buf) => {
			baAsn1.encodeTag(buf, 5, true, 1)  // context tag 5, 1 byte
			buf.buffer.writeInt8(-5, buf.offset)
			buf.offset += 1
		})
		const result = encodeAndDecodeAck(itemData)
		assert.ok(result?.values?.length === 1)
		assert.equal(result.values[0].logDatum.type, 'integer-value')
		assert.equal((result.values[0].logDatum as { type: string; value: number }).value, -5)
	})

	test('should decode log-datum: enum-value [3]', () => {
		const itemData = buildLogRecord((buf) => {
			baAsn1.encodeTag(buf, 3, true, 1)  // context tag 3, 1 byte
			buf.buffer[buf.offset++] = 7
		})
		const result = encodeAndDecodeAck(itemData)
		assert.ok(result?.values?.length === 1)
		assert.equal(result.values[0].logDatum.type, 'enum-value')
		assert.equal((result.values[0].logDatum as { type: string; value: number }).value, 7)
	})

	test('should decode log-datum: binary-value [6]', () => {
		const itemData = buildLogRecord((buf) => {
			// context tag 6, lenValueType=0 means false
			baAsn1.encodeTag(buf, 6, true, 0)
		})
		const result = encodeAndDecodeAck(itemData)
		assert.ok(result?.values?.length === 1)
		assert.equal(result.values[0].logDatum.type, 'binary-value')
		assert.equal((result.values[0].logDatum as { type: string; value: boolean }).value, false)
	})

	test('should decode log-datum: null-value [8]', () => {
		const itemData = buildLogRecord((buf) => {
			// context tag 8, length 0
			baAsn1.encodeTag(buf, 8, true, 0)
		})
		const result = encodeAndDecodeAck(itemData)
		assert.ok(result?.values?.length === 1)
		assert.equal(result.values[0].logDatum.type, 'null-value')
		assert.equal((result.values[0].logDatum as { type: string; value: null }).value, null)
	})

	test('should decode log-datum: log-status [0] — bufferPurged', () => {
		const itemData = buildLogRecord((buf) => {
			// BACnetLogStatus context tag [0], 1 byte: bit7=logDisabled, bit6=bufferPurged, bit5=logInterrupted
			baAsn1.encodeTag(buf, 0, true, 1)
			buf.buffer[buf.offset++] = 0x40  // bufferPurged=true
		})
		const result = encodeAndDecodeAck(itemData)
		assert.ok(result?.values?.length === 1)
		assert.equal(result.values[0].logDatum.type, 'log-status')
		const ls = (result.values[0].logDatum as { type: string; value: { logDisabled: boolean; bufferPurged: boolean; logInterrupted: boolean } }).value
		assert.equal(ls.logDisabled, false)
		assert.equal(ls.bufferPurged, true)
		assert.equal(ls.logInterrupted, false)
	})

	test('should decode log-datum: time-change [10]', () => {
		const itemData = buildLogRecord((buf) => {
			baAsn1.encodeTag(buf, 10, true, 4)  // context tag 10, 4 bytes (REAL)
			buf.buffer.writeFloatBE(1.5, buf.offset)
			buf.offset += 4
		})
		const result = encodeAndDecodeAck(itemData)
		assert.ok(result?.values?.length === 1)
		assert.equal(result.values[0].logDatum.type, 'time-change')
		assert.ok(Math.abs((result.values[0].logDatum as { type: string; value: number }).value - 1.5) < 0.001)
	})

	test('should decode statusFlags when present', () => {
		const itemData = buildLogRecord(
			(buf) => { baAsn1.encodeTag(buf, 8, false, 0) }, // null-value
			{ inAlarm: true, fault: false, overridden: false, outOfService: true },
		)
		const result = encodeAndDecodeAck(itemData)
		assert.ok(result?.values?.length === 1)
		const sf = result.values[0].statusFlags
		assert.ok(sf)
		assert.equal(sf.inAlarm, true)
		assert.equal(sf.fault, false)
		assert.equal(sf.overridden, false)
		assert.equal(sf.outOfService, true)
	})

	test('should decode multiple records in a single response', () => {
		const buf = utils.getBuffer()
		// Record 1: real-value 1.0
		baAsn1.encodeOpeningTag(buf, 0)
		baAsn1.bacappEncodeApplicationData(buf, { type: ApplicationTag.DATE, value: new Date(2024, 1, 3) })
		baAsn1.bacappEncodeApplicationData(buf, { type: ApplicationTag.TIME, value: new Date(2024, 1, 3, 10, 0, 0, 0) })
		baAsn1.encodeClosingTag(buf, 0)
		baAsn1.encodeOpeningTag(buf, 1)
		baAsn1.encodeTag(buf, 2, true, 4)
		buf.buffer.writeFloatBE(1.0, buf.offset); buf.offset += 4
		baAsn1.encodeClosingTag(buf, 1)
		// Record 2: real-value 2.0
		baAsn1.encodeOpeningTag(buf, 0)
		baAsn1.bacappEncodeApplicationData(buf, { type: ApplicationTag.DATE, value: new Date(2024, 1, 3) })
		baAsn1.bacappEncodeApplicationData(buf, { type: ApplicationTag.TIME, value: new Date(2024, 1, 3, 11, 0, 0, 0) })
		baAsn1.encodeClosingTag(buf, 0)
		baAsn1.encodeOpeningTag(buf, 1)
		baAsn1.encodeTag(buf, 2, true, 4)
		buf.buffer.writeFloatBE(2.0, buf.offset); buf.offset += 4
		baAsn1.encodeClosingTag(buf, 1)

		const result = encodeAndDecodeAck(buf.buffer.slice(0, buf.offset))
		assert.ok(result?.values?.length === 2)
		assert.equal(result.values[0].logDatum.type, 'real-value')
		assert.equal(result.values[1].logDatum.type, 'real-value')
	})

	test('should return empty values array when itemCount=0', () => {
		const buf = utils.getBuffer()
		ReadRange.encodeAcknowledge(
			buf,
			{ type: ObjectType.TREND_LOG, instance: 0 },
			131,
			0xffffffff,
			{ bitsUsed: 3, value: [0] },
			0,
			Buffer.alloc(0),
			ReadRangeType.BY_POSITION,
			0,
		)
		const result = ReadRange.decodeAcknowledge(buf.buffer, 0, buf.offset)
		assert.ok(result)
		assert.deepStrictEqual(result.values, [])
	})

	test('should slice fallback rangeBuffer correctly with non-zero offset', () => {
		const ackBuffer = utils.getBuffer()
		ReadRange.encodeAcknowledge(
			ackBuffer,
			{ type: 20, instance: 0 },
			131,
			0xffffffff,
			{ bitsUsed: 3, value: [0] },
			1,
			Buffer.from([1, 2, 3]),
			ReadRangeType.BY_POSITION,
			0,
		)
		const combined = Buffer.concat([
			Buffer.from([0xaa, 0xbb]),
			ackBuffer.buffer.slice(0, ackBuffer.offset),
		])
		const result = ReadRange.decodeAcknowledge(combined, 2, ackBuffer.offset)
		assert.ok(result)
		assert.deepStrictEqual(result.rangeBuffer, Buffer.from([1, 2, 3]))
	})

	test('should reject acknowledge payloads missing closing tag 5', () => {
		const ackBuffer = utils.getBuffer()
		ReadRange.encodeAcknowledge(
			ackBuffer,
			{ type: 20, instance: 0 },
			131,
			0xffffffff,
			{ bitsUsed: 3, value: [0] },
			1,
			Buffer.from([1, 2, 3]),
			ReadRangeType.BY_POSITION,
			0,
		)
		const truncated = ackBuffer.buffer.slice(0, ackBuffer.offset - 1)
		const result = ReadRange.decodeAcknowledge(truncated, 0, truncated.length)
		assert.equal(result, undefined)
	})
})
