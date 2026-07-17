import test from 'node:test'
import assert from 'node:assert'

import * as utils from './utils'
import * as baAsn1 from '../../src/lib/asn1'
import { ReadRange } from '../../src/lib/services'
import { ApplicationTag, ObjectType, ReadRangeType } from '../../src'

test.describe('bacnet - Services layer ReadRange unit', () => {
	test('should successfully encode and decode by position', (t) => {
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
			property: {
				index: 0xffffffff,
				id: 85,
			},
			requestType: ReadRangeType.BY_POSITION,
			time: undefined,
		})
	})

	test('should successfully encode and decode by position with array index', (t) => {
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
			property: {
				index: 2,
				id: 12,
			},
			requestType: ReadRangeType.BY_SEQUENCE_NUMBER,
			time: undefined,
		})
	})

	test('should successfully encode and decode by sequence', (t) => {
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
			property: {
				index: 0xffffffff,
				id: 85,
			},
			requestType: ReadRangeType.BY_SEQUENCE_NUMBER,
			time: undefined,
		})
	})

	test('should successfully encode and decode by time', (t) => {
		const buffer = utils.getBuffer()
		const date = new Date(2024, 1, 1, 12, 15, 30, 990)
		date.setMilliseconds(990)
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
			property: {
				index: 0xffffffff,
				id: 85,
			},
			requestType: ReadRangeType.BY_TIME_REFERENCE_TIME_COUNT,
			time: date,
		})
	})
})

test.describe('ReadRangeAcknowledge', () => {
	test('should successfully encode and decode', (t) => {
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
		const result = ReadRange.decodeAcknowledge(
			buffer.buffer,
			0,
			buffer.offset,
		)
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
		const result = ReadRange.decodeAcknowledge(
			buffer.buffer,
			0,
			buffer.offset,
		)
		assert.ok(result)
		assert.strictEqual(result.len, buffer.offset)
	})

	test('should decode trend range values from range buffer', () => {
		const applicationData = utils.getBuffer()
		baAsn1.encodeOpeningTag(applicationData, 0)
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.DATE,
			value: new Date(2024, 1, 3),
		})
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.TIME,
			value: new Date(2024, 1, 3, 12, 15, 30, 0),
		})
		baAsn1.encodeClosingTag(applicationData, 0)
		baAsn1.encodeOpeningTag(applicationData, 1)
		baAsn1.encodeTag(applicationData, 2, true, 4)
		applicationData.buffer.writeFloatBE(42.5, applicationData.offset)
		applicationData.offset += 4
		baAsn1.encodeClosingTag(applicationData, 1)
		baAsn1.encodeContextBitstring(applicationData, 2, {
			bitsUsed: 4,
			value: [0b0000],
		})

		const buffer = utils.getBuffer()
		ReadRange.encodeAcknowledge(
			buffer,
			{ type: 20, instance: 0 },
			131,
			0xffffffff,
			{ bitsUsed: 3, value: [0] },
			1,
			applicationData.buffer.slice(0, applicationData.offset),
			ReadRangeType.BY_POSITION,
			0,
		)

		const result = ReadRange.decodeAcknowledge(
			buffer.buffer,
			0,
			buffer.offset,
		)
		assert.ok(result)
		assert.ok(result.values)
		assert.equal(result.values?.length, 1)
		assert.equal(result.values?.[0].value, 42.5)
		assert.ok(result.values?.[0].timestamp instanceof Date)
		assert.equal(
			result.values?.[0].timestamp.getTime(),
			new Date(2024, 1, 3, 12, 15, 30, 0).getTime(),
		)
	})

	test('should decode special log-status records without status flags', () => {
		// Build a log record with log-status choice (tag 0) instead of normal value
		// Per ASHRAE 135, log-status records do NOT have status flags (context tag 2)
		const applicationData = utils.getBuffer()

		// First record: normal record with status flags
		baAsn1.encodeOpeningTag(applicationData, 0)
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.DATE,
			value: new Date(2024, 1, 3),
		})
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.TIME,
			value: new Date(2024, 1, 3, 12, 15, 30, 0),
		})
		baAsn1.encodeClosingTag(applicationData, 0)
		baAsn1.encodeOpeningTag(applicationData, 1)
		baAsn1.encodeTag(applicationData, 2, true, 4)
		applicationData.buffer.writeFloatBE(42.5, applicationData.offset)
		applicationData.offset += 4
		baAsn1.encodeClosingTag(applicationData, 1)
		baAsn1.encodeContextBitstring(applicationData, 2, {
			bitsUsed: 4,
			value: [0b0000],
		})

		// Second record: log-status (log-interrupted) without status flags
		baAsn1.encodeOpeningTag(applicationData, 0)
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.DATE,
			value: new Date(2024, 1, 3),
		})
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.TIME,
			value: new Date(2024, 1, 3, 12, 30, 0, 0),
		})
		baAsn1.encodeClosingTag(applicationData, 0)
		baAsn1.encodeOpeningTag(applicationData, 1)
		// log-status choice: context tag 0 with bitstring
		// LOG_INTERRUPTED = bit 2 = 0b0100 = 4
		baAsn1.encodeContextBitstring(applicationData, 0, {
			bitsUsed: 3,
			value: [0b0100],
		})
		baAsn1.encodeClosingTag(applicationData, 1)
		// NO status flags for log-status records!

		// Third record: another normal record with status flags
		baAsn1.encodeOpeningTag(applicationData, 0)
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.DATE,
			value: new Date(2024, 1, 3),
		})
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.TIME,
			value: new Date(2024, 1, 3, 12, 45, 0, 0),
		})
		baAsn1.encodeClosingTag(applicationData, 0)
		baAsn1.encodeOpeningTag(applicationData, 1)
		baAsn1.encodeTag(applicationData, 2, true, 4)
		applicationData.buffer.writeFloatBE(99.9, applicationData.offset)
		applicationData.offset += 4
		baAsn1.encodeClosingTag(applicationData, 1)
		baAsn1.encodeContextBitstring(applicationData, 2, {
			bitsUsed: 4,
			value: [0b0000],
		})

		const buffer = utils.getBuffer()
		ReadRange.encodeAcknowledge(
			buffer,
			{ type: 20, instance: 0 },
			131,
			0xffffffff,
			{ bitsUsed: 3, value: [0] },
			3,
			applicationData.buffer.slice(0, applicationData.offset),
			ReadRangeType.BY_POSITION,
			0,
		)

		const result = ReadRange.decodeAcknowledge(
			buffer.buffer,
			0,
			buffer.offset,
		)
		assert.ok(result)
		assert.ok(result.values)
		assert.equal(result.values?.length, 3)

		// First record: normal with value 42.5
		assert.equal(result.values?.[0].value, 42.5)
		assert.strictEqual(result.values?.[0].isLogStatus, undefined)
		assert.ok(result.values?.[0].status)

		// Second record: log-status (log-interrupted)
		assert.equal(result.values?.[1].isLogStatus, true)
		assert.ok(result.values?.[1].logStatus)
		assert.equal(result.values?.[1].logStatus?.log_interrupted, true)
		assert.equal(result.values?.[1].logStatus?.log_disabled, false)
		assert.equal(result.values?.[1].logStatus?.buffer_purged, false)
		assert.strictEqual(result.values?.[1].status, undefined)

		// Third record: normal with value 99.9 (approximately)
		assert.ok(Math.abs((result.values?.[2].value as number) - 99.9) < 0.01)
		assert.strictEqual(result.values?.[2].isLogStatus, undefined)
		assert.ok(result.values?.[2].status)
	})

	test('should decode time-change records without status flags', () => {
		// Build a log record with time-change choice (tag 9) per ASHRAE 135 §12.25
		// Per the BACnet standard, time-change records do NOT have status flags
		const applicationData = utils.getBuffer()

		// First record: normal record with status flags
		baAsn1.encodeOpeningTag(applicationData, 0)
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.DATE,
			value: new Date(2024, 1, 3),
		})
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.TIME,
			value: new Date(2024, 1, 3, 12, 0, 0, 0),
		})
		baAsn1.encodeClosingTag(applicationData, 0)
		baAsn1.encodeOpeningTag(applicationData, 1)
		baAsn1.encodeTag(applicationData, 2, true, 4)
		applicationData.buffer.writeFloatBE(42.5, applicationData.offset)
		applicationData.offset += 4
		baAsn1.encodeClosingTag(applicationData, 1)
		baAsn1.encodeContextBitstring(applicationData, 2, {
			bitsUsed: 4,
			value: [0b0000],
		})

		// Second record: time-change (context tag 9) without status flags
		// This represents a clock adjustment of 0.075 seconds
		baAsn1.encodeOpeningTag(applicationData, 0)
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.DATE,
			value: new Date(2024, 1, 3),
		})
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.TIME,
			value: new Date(2024, 1, 3, 12, 30, 0, 0),
		})
		baAsn1.encodeClosingTag(applicationData, 0)
		baAsn1.encodeOpeningTag(applicationData, 1)
		// time-change choice: context tag 9 with REAL value (seconds delta)
		baAsn1.encodeTag(applicationData, 9, true, 4)
		applicationData.buffer.writeFloatBE(0.075, applicationData.offset)
		applicationData.offset += 4
		baAsn1.encodeClosingTag(applicationData, 1)
		// NO status flags for time-change records!

		// Third record: another normal record with status flags
		baAsn1.encodeOpeningTag(applicationData, 0)
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.DATE,
			value: new Date(2024, 1, 3),
		})
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.TIME,
			value: new Date(2024, 1, 3, 12, 45, 0, 0),
		})
		baAsn1.encodeClosingTag(applicationData, 0)
		baAsn1.encodeOpeningTag(applicationData, 1)
		baAsn1.encodeTag(applicationData, 2, true, 4)
		applicationData.buffer.writeFloatBE(99.9, applicationData.offset)
		applicationData.offset += 4
		baAsn1.encodeClosingTag(applicationData, 1)
		baAsn1.encodeContextBitstring(applicationData, 2, {
			bitsUsed: 4,
			value: [0b0000],
		})

		const buffer = utils.getBuffer()
		ReadRange.encodeAcknowledge(
			buffer,
			{ type: 20, instance: 0 },
			131,
			0xffffffff,
			{ bitsUsed: 3, value: [0] },
			3,
			applicationData.buffer.slice(0, applicationData.offset),
			ReadRangeType.BY_POSITION,
			0,
		)

		const result = ReadRange.decodeAcknowledge(
			buffer.buffer,
			0,
			buffer.offset,
		)
		assert.ok(result)
		assert.ok(result.values)
		assert.equal(result.values?.length, 3)

		// First record: normal with value 42.5 and status flags
		assert.equal(result.values?.[0].value, 42.5)
		assert.strictEqual(result.values?.[0].isLogStatus, undefined)
		assert.strictEqual(result.values?.[0].isTimeChange, undefined)
		assert.ok(result.values?.[0].status)

		// Second record: time-change with value 0.075 (seconds delta)
		assert.equal(result.values?.[1].isTimeChange, true)
		assert.strictEqual(result.values?.[1].isLogStatus, undefined)
		assert.ok(
			Math.abs((result.values?.[1].value as number) - 0.075) < 0.001,
		)
		assert.strictEqual(result.values?.[1].status, undefined)

		// Third record: normal with value 99.9 and status flags
		assert.ok(Math.abs((result.values?.[2].value as number) - 99.9) < 0.01)
		assert.strictEqual(result.values?.[2].isLogStatus, undefined)
		assert.strictEqual(result.values?.[2].isTimeChange, undefined)
		assert.ok(result.values?.[2].status)
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
		const result = ReadRange.decodeAcknowledge(
			combined,
			2,
			ackBuffer.offset,
		)
		assert.ok(result)
		assert.deepStrictEqual(result.rangeBuffer, Buffer.from([1, 2, 3]))
		assert.equal(result.values, undefined)
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
		const result = ReadRange.decodeAcknowledge(
			truncated,
			0,
			truncated.length,
		)
		assert.equal(result, undefined)
	})
})

test.describe('ReadRangeAcknowledge log-datum choices', () => {
	const buildAck = (encodeDatum: (buf: any) => void): Buffer => {
		const applicationData = utils.getBuffer()
		baAsn1.encodeOpeningTag(applicationData, 0)
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.DATE,
			value: new Date(2024, 1, 3),
		})
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.TIME,
			value: new Date(2024, 1, 3, 12, 15, 30, 0),
		})
		baAsn1.encodeClosingTag(applicationData, 0)
		baAsn1.encodeOpeningTag(applicationData, 1)
		encodeDatum(applicationData)
		baAsn1.encodeClosingTag(applicationData, 1)

		const buffer = utils.getBuffer()
		ReadRange.encodeAcknowledge(
			buffer,
			{ type: 20, instance: 0 },
			131,
			0xffffffff,
			{ bitsUsed: 3, value: [0] },
			1,
			applicationData.buffer.slice(0, applicationData.offset),
			ReadRangeType.BY_POSITION,
			0,
		)
		return buffer.buffer.slice(0, buffer.offset)
	}

	const decodeSingle = (ack: Buffer) => {
		const result = ReadRange.decodeAcknowledge(ack, 0, ack.length)
		assert.ok(result)
		assert.ok(result.values)
		assert.equal(result.values?.length, 1)
		return result.values![0]
	}

	test('should decode boolean-value [1]', () => {
		const record = decodeSingle(
			buildAck((buf) => {
				baAsn1.encodeTag(buf, 1, true, 1)
				buf.buffer.writeUInt8(1, buf.offset)
				buf.offset += 1
			}),
		)
		assert.strictEqual(record.value, true)
		assert.equal(record.valueType, ApplicationTag.BOOLEAN)
	})

	test('should decode signed-value [5]', () => {
		const record = decodeSingle(
			buildAck((buf) => {
				baAsn1.encodeTag(buf, 5, true, 1)
				buf.buffer.writeInt8(-2, buf.offset)
				buf.offset += 1
			}),
		)
		assert.strictEqual(record.value, -2)
		assert.equal(record.valueType, ApplicationTag.SIGNED_INTEGER)
	})

	test('should decode bitstring-value [6]', () => {
		const record = decodeSingle(
			buildAck((buf) => {
				baAsn1.encodeContextBitstring(buf, 6, {
					bitsUsed: 4,
					value: [0b0101],
				})
			}),
		)
		assert.equal(record.valueType, ApplicationTag.BIT_STRING)
		assert.equal((record.value as any).bitsUsed, 4)
	})

	test('should decode null-value [7]', () => {
		const record = decodeSingle(
			buildAck((buf) => {
				baAsn1.encodeTag(buf, 7, true, 0)
			}),
		)
		assert.strictEqual(record.value, null)
		assert.equal(record.valueType, ApplicationTag.NULL)
	})

	test('should decode failure [8] with error class and code', () => {
		const record = decodeSingle(
			buildAck((buf) => {
				baAsn1.encodeOpeningTag(buf, 8)
				baAsn1.bacappEncodeApplicationData(buf, {
					type: ApplicationTag.ENUMERATED,
					value: 2,
				})
				baAsn1.bacappEncodeApplicationData(buf, {
					type: ApplicationTag.ENUMERATED,
					value: 32,
				})
				baAsn1.encodeClosingTag(buf, 8)
			}),
		)
		assert.equal(record.isFailure, true)
		assert.deepStrictEqual(record.value, { errorClass: 2, errorCode: 32 })
	})

	test('should decode any-value [10] carrying a double', () => {
		const record = decodeSingle(
			buildAck((buf) => {
				baAsn1.encodeOpeningTag(buf, 10)
				baAsn1.bacappEncodeApplicationData(buf, {
					type: ApplicationTag.DOUBLE,
					value: 1234.5678,
				})
				baAsn1.encodeClosingTag(buf, 10)
			}),
		)
		assert.equal(record.valueType, ApplicationTag.DOUBLE)
		assert.ok(Math.abs((record.value as number) - 1234.5678) < 1e-9)
	})

	test('should decode any-value [10] carrying a character string', () => {
		const record = decodeSingle(
			buildAck((buf) => {
				baAsn1.encodeOpeningTag(buf, 10)
				baAsn1.bacappEncodeApplicationData(buf, {
					type: ApplicationTag.CHARACTER_STRING,
					value: 'trend-note',
				})
				baAsn1.encodeClosingTag(buf, 10)
			}),
		)
		assert.equal(record.valueType, ApplicationTag.CHARACTER_STRING)
		assert.equal(record.value, 'trend-note')
	})

	test('should decode any-value [10] carrying an object identifier', () => {
		const record = decodeSingle(
			buildAck((buf) => {
				baAsn1.encodeOpeningTag(buf, 10)
				baAsn1.bacappEncodeApplicationData(buf, {
					type: ApplicationTag.OBJECTIDENTIFIER,
					value: { type: ObjectType.ANALOG_INPUT, instance: 42 },
				})
				baAsn1.encodeClosingTag(buf, 10)
			}),
		)
		assert.equal(record.valueType, ApplicationTag.OBJECTIDENTIFIER)
		assert.deepStrictEqual(record.value, {
			type: ObjectType.ANALOG_INPUT,
			instance: 42,
		})
	})

	test('should decode boolean-value record followed by status flags', () => {
		const applicationData = utils.getBuffer()
		baAsn1.encodeOpeningTag(applicationData, 0)
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.DATE,
			value: new Date(2024, 1, 3),
		})
		baAsn1.bacappEncodeApplicationData(applicationData, {
			type: ApplicationTag.TIME,
			value: new Date(2024, 1, 3, 12, 15, 30, 0),
		})
		baAsn1.encodeClosingTag(applicationData, 0)
		baAsn1.encodeOpeningTag(applicationData, 1)
		baAsn1.encodeTag(applicationData, 1, true, 1)
		applicationData.buffer.writeUInt8(1, applicationData.offset)
		applicationData.offset += 1
		baAsn1.encodeClosingTag(applicationData, 1)
		baAsn1.encodeContextBitstring(applicationData, 2, {
			bitsUsed: 4,
			value: [0b0100],
		})

		const buffer = utils.getBuffer()
		ReadRange.encodeAcknowledge(
			buffer,
			{ type: 20, instance: 0 },
			131,
			0xffffffff,
			{ bitsUsed: 3, value: [0] },
			1,
			applicationData.buffer.slice(0, applicationData.offset),
			ReadRangeType.BY_POSITION,
			0,
		)

		const result = ReadRange.decodeAcknowledge(
			buffer.buffer,
			0,
			buffer.offset,
		)
		assert.ok(result?.values)
		const record = result.values![0]
		assert.strictEqual(record.value, true)
		assert.ok(record.status)
	})
})
