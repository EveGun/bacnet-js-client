import test from 'node:test'
import assert from 'node:assert'

import * as utils from './utils'
import * as baAsn1 from '../../src/lib/asn1'
import { WritePropertyMultiple } from '../../src/lib/services'
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
					value: [{ type: ApplicationTag.UNSIGNED_INTEGER, value: 7 }] as any,
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
		assert.equal(cleanResult.values[0].value[0].type, ApplicationTag.UNSIGNED_INTEGER)
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

	test('should reject indexed effective period in write-property-multiple encode', () => {
		const buffer = utils.getBuffer()
		assert.throws(() => {
			WritePropertyMultiple.encode(
				buffer,
				{ type: ObjectType.SCHEDULE, instance: 1 },
				[
					{
						property: { id: PropertyIdentifier.EFFECTIVE_PERIOD, index: 1 },
						value: [
							{ type: ApplicationTag.DATE, value: new Date(2024, 0, 1) },
							{ type: ApplicationTag.DATE, value: new Date(2024, 11, 31) },
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
						property: { id: PropertyIdentifier.DATE_LIST, index: 1 },
						value: [
							{ type: ApplicationTag.DATE, value: new Date(2025, 7, 22) },
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
		baAsn1.encodeContextEnumerated(buffer, 0, PropertyIdentifier.EFFECTIVE_PERIOD)
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

		const result = WritePropertyMultiple.decode(buffer.buffer, 0, buffer.offset)
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

		const result = WritePropertyMultiple.decode(buffer.buffer, 0, buffer.offset)
		assert.equal(result, undefined)
	})
})
