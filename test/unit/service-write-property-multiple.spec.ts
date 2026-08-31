import test from 'node:test'
import assert from 'node:assert'

import * as utils from './utils'
import * as baAsn1 from '../../src/lib/asn1'
import { WriteProperty, WritePropertyMultiple } from '../../src/lib/services'
import {
	ApplicationTag,
	ObjectType,
	PropertyIdentifier,
} from '../../src/lib/enum'

function removeLen(obj: any): any {
	if (obj === null || typeof obj !== 'object') return obj

	if (Array.isArray(obj)) {
		return obj.map((item) => removeLen(item))
	}

	const newObj = { ...obj }
	delete newObj.len

	for (const key in newObj) {
		newObj[key] = removeLen(newObj[key])
	}

	return newObj
}

test.describe('bacnet - Services layer WritePropertyMultiple unit', () => {
	test('should successfully encode and decode', (t) => {
		const buffer = utils.getBuffer()
		const date = new Date(1, 1, 1)
		const time = new Date(1, 1, 1)
		time.setMilliseconds(990)
		WritePropertyMultiple.encode(buffer, { type: 39, instance: 2400 }, [
			{
				property: { id: 81, index: 0xffffffff },
				value: [
					{ type: 0, value: null },
					{ type: 0, value: null },
					{ type: 1, value: true },
					{ type: 1, value: false },
					{ type: 2, value: 1 },
					{ type: 2, value: 1000 },
					{ type: 2, value: 1000000 },
					{ type: 2, value: 1000000000 },
					{ type: 3, value: -1 },
					{ type: 3, value: -1000 },
					{ type: 3, value: -1000000 },
					{ type: 3, value: -1000000000 },
					{ type: 4, value: 0.1 },
					{ type: 5, value: 100.121212 },
					{ type: 6, value: [1, 2, 100, 200] },
					{ type: 7, value: 'Test1234$' },
					{ type: 8, value: { bitsUsed: 0, value: [] } },
					{
						type: 8,
						value: { bitsUsed: 24, value: [0xaa, 0xaa, 0xaa] },
					},
					{ type: 9, value: 4 },
					{ type: 10, value: date },
					{ type: 11, value: time },
					{ type: 12, value: { type: 3, instance: 0 } },
				],
				priority: 0,
			},
		])
		const result = WritePropertyMultiple.decode(
			buffer.buffer,
			0,
			buffer.offset,
		)
		const cleanResult = removeLen(result)

		const roundedResult = JSON.parse(JSON.stringify(cleanResult))
		roundedResult.values[0].value[12].value =
			Math.floor(roundedResult.values[0].value[12].value * 1000) / 1000

		roundedResult.values[0].value[19].value = date
		roundedResult.values[0].value[20].value = time

		assert.deepStrictEqual(roundedResult, {
			objectId: {
				type: 39,
				instance: 2400,
			},
			values: [
				{
					priority: 0,
					property: {
						index: 0xffffffff,
						id: 81,
					},
					value: [
						{ type: 0, value: null },
						{ type: 0, value: null },
						{ type: 1, value: true },
						{ type: 1, value: false },
						{ type: 2, value: 1 },
						{ type: 2, value: 1000 },
						{ type: 2, value: 1000000 },
						{ type: 2, value: 1000000000 },
						{ type: 3, value: -1 },
						{ type: 3, value: -1000 },
						{ type: 3, value: -1000000 },
						{ type: 3, value: -1000000000 },
						{ type: 4, value: 0.1 },
						{ type: 5, value: 100.121212 },
						{ type: 6, value: [1, 2, 100, 200] },
						{ type: 7, value: 'Test1234$', encoding: 0 },
						{ type: 8, value: { bitsUsed: 0, value: [] } },
						{
							type: 8,
							value: { bitsUsed: 24, value: [0xaa, 0xaa, 0xaa] },
						},
						{ type: 9, value: 4 },
						{ type: 10, value: date },
						{ type: 11, value: time },
						{ type: 12, value: { type: 3, instance: 0 } },
					],
				},
			],
		})
	})

	test('should successfully encode and decode with defined priority', (t) => {
		const buffer = utils.getBuffer()
		const time = new Date(1, 1, 1)
		time.setMilliseconds(990)
		WritePropertyMultiple.encode(buffer, { type: 39, instance: 2400 }, [
			{
				property: { id: 81, index: 0xffffffff },
				value: [{ type: 7, value: 'Test1234$' }],
				priority: 12,
			},
		])
		const result = WritePropertyMultiple.decode(
			buffer.buffer,
			0,
			buffer.offset,
		)
		const cleanResult = removeLen(result)
		assert.deepStrictEqual(cleanResult, {
			objectId: {
				type: 39,
				instance: 2400,
			},
			values: [
				{
					priority: 12,
					property: {
						index: 0xffffffff,
						id: 81,
					},
					value: [{ type: 7, value: 'Test1234$', encoding: 0 }],
				},
			],
		})
	})

	test('should successfully encode and decode with defined array index', (t) => {
		const buffer = utils.getBuffer()
		const time = new Date(1, 1, 1)
		time.setMilliseconds(990)
		WritePropertyMultiple.encode(buffer, { type: 39, instance: 2400 }, [
			{
				property: { id: 81, index: 414141 },
				value: [{ type: 7, value: 'Test1234$' }],
				priority: 0,
			},
		])
		const result = WritePropertyMultiple.decode(
			buffer.buffer,
			0,
			buffer.offset,
		)
		const cleanResult = removeLen(result)
		assert.deepStrictEqual(cleanResult, {
			objectId: {
				type: 39,
				instance: 2400,
			},
			values: [
				{
					priority: 0,
					property: {
						index: 414141,
						id: 81,
					},
					value: [{ type: 7, value: 'Test1234$', encoding: 0 }],
				},
			],
		})
	})

	test('should preserve array index 0 when encoding and decoding', () => {
		const buffer = utils.getBuffer()
		WritePropertyMultiple.encode(buffer, { type: 39, instance: 2400 }, [
			{
				property: { id: 81, index: 0 },
				value: [{ type: 2, value: 7 }],
				priority: 0,
			},
		])
		const result = WritePropertyMultiple.decode(
			buffer.buffer,
			0,
			buffer.offset,
		)
		const cleanResult = removeLen(result)
		assert.equal(cleanResult.values[0].property.index, 0)
		assert.equal(cleanResult.values[0].value[0].type, 2)
		assert.equal(cleanResult.values[0].value[0].value, 7)
	})

	test('should preserve both array index and priority on the same entry', () => {
		const buffer = utils.getBuffer()
		WritePropertyMultiple.encode(
			buffer,
			{ type: ObjectType.SCHEDULE, instance: 1 },
			[
				{
					property: {
						id: PropertyIdentifier.WEEKLY_SCHEDULE,
						index: 3,
					},
					value: [
						{
							time: {
								type: ApplicationTag.TIME,
								value: new Date(2024, 0, 3, 8, 0),
							},
							value: { type: ApplicationTag.REAL, value: 21.5 },
						},
					] as any,
					priority: 12,
				},
			],
		)
		const result = WritePropertyMultiple.decode(
			buffer.buffer,
			0,
			buffer.offset,
		)
		const cleanResult = removeLen(result)
		assert.equal(cleanResult.values[0].property.index, 3)
		assert.equal(cleanResult.values[0].priority, 12)
		assert.equal(
			cleanResult.values[0].value[0].type,
			ApplicationTag.WEEKLY_SCHEDULE,
		)
		assert.equal(cleanResult.values[0].value[0].value[0].value.value, 21.5)
	})

	test('should encode weekly schedule index 0 array size from app-data wrapper', () => {
		const buffer = utils.getBuffer()
		WritePropertyMultiple.encode(
			buffer,
			{ type: ObjectType.SCHEDULE, instance: 1 },
			[
				{
					property: {
						id: PropertyIdentifier.WEEKLY_SCHEDULE,
						index: 0,
					},
					value: [
						{ type: ApplicationTag.UNSIGNED_INTEGER, value: 7 },
					] as any,
					priority: 0,
				},
			],
		)
		const result = WritePropertyMultiple.decode(
			buffer.buffer,
			0,
			buffer.offset,
		)
		const cleanResult = removeLen(result)
		assert.equal(cleanResult.values[0].property.index, 0)
		assert.equal(
			cleanResult.values[0].value[0].type,
			ApplicationTag.UNSIGNED_INTEGER,
		)
		assert.equal(cleanResult.values[0].value[0].value, 7)
	})

	test('should encode and decode weekly schedule through write-property-multiple', () => {
		const buffer = utils.getBuffer()
		const weekly = [
			[
				{
					time: {
						type: ApplicationTag.TIME,
						value: new Date(2024, 0, 1, 8, 0),
					},
					value: { type: ApplicationTag.REAL, value: 21.5 },
				},
			],
			[],
			[],
			[],
			[],
			[],
			[],
		]
		WritePropertyMultiple.encode(
			buffer,
			{ type: ObjectType.SCHEDULE, instance: 1 },
			[
				{
					property: {
						id: PropertyIdentifier.WEEKLY_SCHEDULE,
						index: 0xffffffff,
					},
					value: weekly as any,
					priority: 0,
				},
			],
		)
		const result = WritePropertyMultiple.decode(
			buffer.buffer,
			0,
			buffer.offset,
		)
		assert.ok(result)
		const value = result.values[0].value[0]
		assert.equal(value.type, ApplicationTag.WEEKLY_SCHEDULE)
		assert.equal((value.value as any[]).length, 7)
		assert.equal((value.value as any[])[0][0].value?.value, 21.5)
	})

	test('should honor requested indexed weekly day in write-property-multiple decode', () => {
		const buffer = utils.getBuffer()
		baAsn1.encodeContextObjectId(buffer, 0, ObjectType.SCHEDULE, 1)
		baAsn1.encodeOpeningTag(buffer, 1)
		baAsn1.encodeContextEnumerated(
			buffer,
			0,
			PropertyIdentifier.WEEKLY_SCHEDULE,
		)
		baAsn1.encodeContextUnsigned(buffer, 1, 3)
		baAsn1.encodeOpeningTag(buffer, 2)
		for (let i = 0; i < 2; i++) {
			baAsn1.encodeOpeningTag(buffer, 0)
			baAsn1.encodeClosingTag(buffer, 0)
		}
		baAsn1.encodeOpeningTag(buffer, 0)
		baAsn1.bacappEncodeApplicationData(buffer, {
			type: ApplicationTag.TIME,
			value: new Date(2024, 0, 3, 7, 45, 0, 0),
		})
		baAsn1.bacappEncodeApplicationData(buffer, {
			type: ApplicationTag.REAL,
			value: 26.5,
		})
		baAsn1.encodeClosingTag(buffer, 0)
		for (let i = 0; i < 4; i++) {
			baAsn1.encodeOpeningTag(buffer, 0)
			baAsn1.encodeClosingTag(buffer, 0)
		}
		baAsn1.encodeClosingTag(buffer, 2)
		baAsn1.encodeClosingTag(buffer, 1)

		const result = WritePropertyMultiple.decode(
			buffer.buffer,
			0,
			buffer.offset,
		)
		assert.ok(result)
		const value = result.values[0].value[0]
		assert.equal(value.type, ApplicationTag.WEEKLY_SCHEDULE)
		assert.equal((value.value as any[]).length, 1)
		assert.equal((value.value as any[])[0].value?.value, 26.5)
	})

	test('should reject indexed effective period in write-property-multiple encode', () => {
		const buffer = utils.getBuffer()
		assert.throws(() => {
			WritePropertyMultiple.encode(
				buffer,
				{ type: ObjectType.SCHEDULE, instance: 1 },
				[
					{
						property: {
							id: PropertyIdentifier.EFFECTIVE_PERIOD,
							index: 1,
						},
						value: [
							{
								type: ApplicationTag.DATE,
								value: new Date(2024, 0, 1),
							},
							{
								type: ApplicationTag.DATE,
								value: new Date(2024, 11, 31),
							},
						] as any,
						priority: 0,
					},
				],
			)
		}, /effective period does not support indexed access/)
	})

	test('should reject indexed date list in write-property-multiple encode', () => {
		const buffer = utils.getBuffer()
		assert.throws(() => {
			WritePropertyMultiple.encode(
				buffer,
				{ type: ObjectType.CALENDAR, instance: 1 },
				[
					{
						property: {
							id: PropertyIdentifier.DATE_LIST,
							index: 1,
						},
						value: [
							{
								type: ApplicationTag.DATE,
								value: new Date(2025, 7, 22),
							},
						] as any,
						priority: 0,
					},
				],
			)
		}, /date list does not support indexed access/)
	})

	test('should reject indexed effective period in write-property-multiple decode', () => {
		const buffer = utils.getBuffer()
		baAsn1.encodeContextObjectId(buffer, 0, ObjectType.SCHEDULE, 1)
		baAsn1.encodeOpeningTag(buffer, 1)
		baAsn1.encodeContextEnumerated(
			buffer,
			0,
			PropertyIdentifier.EFFECTIVE_PERIOD,
		)
		baAsn1.encodeContextUnsigned(buffer, 1, 1)
		baAsn1.encodeOpeningTag(buffer, 2)
		baAsn1.bacappEncodeApplicationData(buffer, {
			type: ApplicationTag.DATE,
			value: new Date(2024, 0, 1),
		})
		baAsn1.bacappEncodeApplicationData(buffer, {
			type: ApplicationTag.DATE,
			value: new Date(2024, 11, 31),
		})
		baAsn1.encodeClosingTag(buffer, 2)
		baAsn1.encodeClosingTag(buffer, 1)

		const result = WritePropertyMultiple.decode(
			buffer.buffer,
			0,
			buffer.offset,
		)
		assert.equal(result, undefined)
	})

	test('should reject indexed date list in write-property-multiple decode', () => {
		const buffer = utils.getBuffer()
		baAsn1.encodeContextObjectId(buffer, 0, ObjectType.CALENDAR, 1)
		baAsn1.encodeOpeningTag(buffer, 1)
		baAsn1.encodeContextEnumerated(buffer, 0, PropertyIdentifier.DATE_LIST)
		baAsn1.encodeContextUnsigned(buffer, 1, 1)
		baAsn1.encodeOpeningTag(buffer, 2)
		baAsn1.encodeTag(buffer, 0, true, 4)
		buffer.buffer[buffer.offset++] = 125
		buffer.buffer[buffer.offset++] = 8
		buffer.buffer[buffer.offset++] = 22
		buffer.buffer[buffer.offset++] = 5
		baAsn1.encodeClosingTag(buffer, 2)
		baAsn1.encodeClosingTag(buffer, 1)

		const result = WritePropertyMultiple.decode(
			buffer.buffer,
			0,
			buffer.offset,
		)
		assert.equal(result, undefined)
	})
})

test.describe('bacnet - WritePropertyMultiple optional priority', () => {
	test('an absent priority is omitted from the wire (no Unsigned 0)', () => {
		const buffer = utils.getBuffer()
		WritePropertyMultiple.encode(
			buffer,
			{ type: ObjectType.ANALOG_VALUE, instance: 2 },
			[
				{
					property: {
						id: PropertyIdentifier.HIGH_LIMIT,
						index: 0xffffffff,
					},
					value: [{ type: ApplicationTag.REAL, value: 35 }],
				} as any,
			],
		)
		const result = WritePropertyMultiple.decode(
			buffer.buffer,
			0,
			buffer.offset,
		)
		assert(result)
		// Decoder reports "no priority" (ASN1_NO_PRIORITY = 0) — nothing was encoded.
		assert.strictEqual(result.values[0].priority, 0)
		// Byte-level: no context tag 3 follows the closing tag 2 of the value.
		const bytes = buffer.buffer.subarray(0, buffer.offset)
		assert.strictEqual(
			bytes[bytes.length - 1],
			0x1f,
			'ends with closing tag 1',
		)
		assert.strictEqual(
			bytes[bytes.length - 2],
			0x2f,
			'value closing tag 2 is last inside',
		)
	})

	test('an explicit priority still encodes and decodes', () => {
		const buffer = utils.getBuffer()
		WritePropertyMultiple.encode(
			buffer,
			{ type: ObjectType.ANALOG_VALUE, instance: 2 },
			[
				{
					property: {
						id: PropertyIdentifier.PRESENT_VALUE,
						index: 0xffffffff,
					},
					value: [{ type: ApplicationTag.REAL, value: 21 }],
					priority: 16,
				} as any,
			],
		)
		const result = WritePropertyMultiple.decode(
			buffer.buffer,
			0,
			buffer.offset,
		)
		assert(result)
		assert.strictEqual(result.values[0].priority, 16)
	})
})

test.describe('bacnet - Timer complex datatypes (SCHED-VM-A 13.10.x.2)', () => {
	test('List_Of_Object_Property_References round-trips through WriteProperty', () => {
		const buffer = utils.getBuffer()
		WriteProperty.encode(
			buffer,
			31, // TIMER
			7201,
			PropertyIdentifier.LIST_OF_OBJECT_PROPERTY_REFERENCES,
			0xffffffff,
			0,
			[
				{
					type: ApplicationTag.OBJECT_PROPERTY_REFERENCE,
					value: { objectId: { type: 2, instance: 5 }, id: 85 },
				},
				{
					type: ApplicationTag.OBJECT_PROPERTY_REFERENCE,
					value: { objectId: { type: 5, instance: 3 }, id: 85 },
				},
			] as any,
		)
		const result = WriteProperty.decode(buffer.buffer, 0, buffer.offset)
		assert(result)
		const values = result.value.value
		assert.strictEqual(values.length, 2)
		assert.strictEqual(
			values[0].type,
			ApplicationTag.OBJECT_PROPERTY_REFERENCE,
		)
		assert.strictEqual(values[0].value.objectId.instance, 5)
		assert.strictEqual(values[0].value.id.value ?? values[0].value.id, 85)
		assert.strictEqual(values[1].value.objectId.objectType, 5)
	})

	test('Timer no-value ([0] NULL) encodes distinctly from application NULL and decodes back', () => {
		// Encode: no-value must be context [0] length 0 (0x08); NULL stays 0x00.
		const buffer = utils.getBuffer()
		baAsn1.bacappEncodeApplicationData(buffer, {
			type: ApplicationTag.NO_VALUE,
			value: null,
		})
		assert.strictEqual(buffer.offset, 1)
		assert.strictEqual(buffer.buffer[0], 0x08)
		const nullBuffer = utils.getBuffer()
		baAsn1.bacappEncodeApplicationData(nullBuffer, {
			type: ApplicationTag.NULL,
			value: null,
		})
		assert.strictEqual(nullBuffer.buffer[0], 0x00)

		// Round trip via WriteProperty of State_Change_Values[3].
		const wp = utils.getBuffer()
		WriteProperty.encode(
			wp,
			31,
			7201,
			PropertyIdentifier.STATE_CHANGE_VALUES,
			3,
			0,
			[{ type: ApplicationTag.NO_VALUE, value: null }] as any,
		)
		const result = WriteProperty.decode(wp.buffer, 0, wp.offset)
		assert(result)
		assert.strictEqual(result.value.value[0].type, ApplicationTag.NO_VALUE)
		assert.strictEqual(result.value.value[0].value, null)
	})
})
