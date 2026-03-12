import test from 'node:test'
import assert from 'node:assert'

import * as utils from './utils'
import { ReadPropertyMultiple } from '../../src/lib/services'
import * as baAsn1 from '../../src/lib/asn1'
import {
	ApplicationTag,
	ASN1_ARRAY_ALL,
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

test.describe('bacnet - Services layer ReadPropertyMultiple unit', () => {
	test('should successfully encode and decode', (t) => {
		const buffer = utils.getBuffer()
		ReadPropertyMultiple.encode(buffer, [
			{
				objectId: { type: 51, instance: 1 },
				properties: [
					{ id: 85, index: 0xffffffff },
					{ id: 85, index: 4 },
				],
			},
		])
		const result = ReadPropertyMultiple.decode(
			buffer.buffer,
			0,
			buffer.offset,
		)
		const cleanResult = removeLen(result)

		assert.deepStrictEqual(cleanResult, {
			properties: [
				{
					objectId: { type: 51, instance: 1 },
					properties: [
						{ id: 85, index: 0xffffffff },
						{ id: 85, index: 4 },
					],
				},
			],
		})
	})

	test('should preserve array index 0 in read access specification', () => {
		const buffer = utils.getBuffer()
		ReadPropertyMultiple.encode(buffer, [
			{
				objectId: { type: ObjectType.SCHEDULE, instance: 1 },
				properties: [
					{ id: PropertyIdentifier.WEEKLY_SCHEDULE, index: 0 },
				],
			},
		])
		const result = ReadPropertyMultiple.decode(
			buffer.buffer,
			0,
			buffer.offset,
		)
		const cleanResult = removeLen(result)
		assert.deepStrictEqual(cleanResult, {
			properties: [
				{
					objectId: { type: ObjectType.SCHEDULE, instance: 1 },
					properties: [
						{
							id: PropertyIdentifier.WEEKLY_SCHEDULE,
							index: 0,
						},
					],
				},
			],
		})
	})
})

test.describe('ReadPropertyMultipleAcknowledge', () => {
	test('should successfully encode and decode', (t) => {
		const buffer = utils.getBuffer()
		const date = new Date(1, 1, 1)
		const time = new Date(1, 1, 1)
		time.setMilliseconds(990)
		ReadPropertyMultiple.encodeAcknowledge(buffer, [
			{
				objectId: { type: 9, instance: 50000 },
				values: [
					{
						property: { id: 81, index: 0xffffffff },
						value: [
							{ type: 0 },
							{ type: 1, value: null },
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
								value: {
									bitsUsed: 24,
									value: [0xaa, 0xaa, 0xaa],
								},
							},
							{ type: 9, value: 4 },
							{ type: 10, value: date },
							{ type: 11, value: time },
							{ type: 12, value: { type: 3, instance: 0 } },
						],
					},
				],
			},
		])
		const result = ReadPropertyMultiple.decodeAcknowledge(
			buffer.buffer,
			0,
			buffer.offset,
		)
		const cleanResult = removeLen(result)

		const modifiedResult = JSON.parse(JSON.stringify(cleanResult))

		modifiedResult.values[0].values[0].value[12].value = 0

		modifiedResult.values[0].values[0].value[19].value =
			'1901-01-31T23:00:00.000Z'
		modifiedResult.values[0].values[0].value[20].value =
			'1901-01-31T23:00:00.990Z'

		assert.deepStrictEqual(modifiedResult, {
			values: [
				{
					objectId: {
						type: 9,
						instance: 50000,
					},
					values: [
						{
							index: 4294967295,
							id: 81,
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
								{ type: 4, value: 0 },
								{ type: 5, value: 100.121212 },
								{ type: 6, value: [1, 2, 100, 200] },
								{ type: 7, value: 'Test1234$', encoding: 0 },
								{ type: 8, value: { bitsUsed: 0, value: [] } },
								{
									type: 8,
									value: {
										bitsUsed: 24,
										value: [0xaa, 0xaa, 0xaa],
									},
								},
								{ type: 9, value: 4 },
								{ type: 10, value: '1901-01-31T23:00:00.000Z' },
								{ type: 11, value: '1901-01-31T23:00:00.990Z' },
								{ type: 12, value: { type: 3, instance: 0 } },
							],
						},
					],
				},
			],
		})
	})

	test('should successfully encode and decode an error', (t) => {
		const buffer = utils.getBuffer()
		ReadPropertyMultiple.encodeAcknowledge(buffer, [
			{
				objectId: { type: 9, instance: 50000 },
				values: [
					{
						property: { id: 81, index: 0xffffffff },
						value: [
							{
								type: 0,
								value: {
									type: 'BacnetError',
									errorClass: 12,
									errorCode: 13,
								},
							},
						],
					},
				],
			},
		])
		const result = ReadPropertyMultiple.decodeAcknowledge(
			buffer.buffer,
			0,
			buffer.offset,
		)
		const cleanResult = removeLen(result)

		assert.deepStrictEqual(cleanResult, {
			values: [
				{
					objectId: {
						type: 9,
						instance: 50000,
					},
					values: [
						{
							index: 4294967295,
							id: 81,
							value: [
								{
									type: 105,
									value: {
										errorClass: 12,
										errorCode: 13,
									},
								},
							],
						},
					],
				},
			],
		})
	})

	test('should decode weekly schedule payload with scheduler-aware parsing', () => {
		const buffer = utils.getBuffer()
		baAsn1.encodeContextObjectId(buffer, 0, ObjectType.SCHEDULE, 1)
		baAsn1.encodeOpeningTag(buffer, 1)
		baAsn1.encodeContextEnumerated(
			buffer,
			2,
			PropertyIdentifier.WEEKLY_SCHEDULE,
		)
		baAsn1.encodeContextUnsigned(buffer, 3, ASN1_ARRAY_ALL)
		baAsn1.encodeOpeningTag(buffer, 4)
		baAsn1.encodeOpeningTag(buffer, 0)
		baAsn1.bacappEncodeApplicationData(buffer, {
			type: ApplicationTag.TIME,
			value: new Date(2024, 0, 1, 8, 0, 0, 0),
		})
		baAsn1.bacappEncodeApplicationData(buffer, {
			type: ApplicationTag.REAL,
			value: 21.5,
		})
		baAsn1.encodeClosingTag(buffer, 0)
		for (let i = 0; i < 6; i++) {
			baAsn1.encodeOpeningTag(buffer, 0)
			baAsn1.encodeClosingTag(buffer, 0)
		}
		baAsn1.encodeClosingTag(buffer, 4)
		baAsn1.encodeClosingTag(buffer, 1)

		const result = ReadPropertyMultiple.decodeAcknowledge(
			buffer.buffer,
			0,
			buffer.offset,
		)
		assert.ok(result)
		assert.equal(
			result.values[0].values[0].id,
			PropertyIdentifier.WEEKLY_SCHEDULE,
		)
		const weekly = result.values[0].values[0].value[0]
		assert.equal(weekly.type, ApplicationTag.WEEKLY_SCHEDULE)
		assert.equal((weekly.value as any[]).length, 7)
	})

	test('should decode single weekly schedule day when array index is set', () => {
		const buffer = utils.getBuffer()
		baAsn1.encodeContextObjectId(buffer, 0, ObjectType.SCHEDULE, 1)
		baAsn1.encodeOpeningTag(buffer, 1)
		baAsn1.encodeContextEnumerated(
			buffer,
			2,
			PropertyIdentifier.WEEKLY_SCHEDULE,
		)
		baAsn1.encodeContextUnsigned(buffer, 3, 1)
		baAsn1.encodeOpeningTag(buffer, 4)
		baAsn1.encodeOpeningTag(buffer, 0)
		baAsn1.bacappEncodeApplicationData(buffer, {
			type: ApplicationTag.TIME,
			value: new Date(2024, 0, 1, 8, 0, 0, 0),
		})
		baAsn1.bacappEncodeApplicationData(buffer, {
			type: ApplicationTag.REAL,
			value: 22.25,
		})
		baAsn1.encodeClosingTag(buffer, 0)
		baAsn1.encodeClosingTag(buffer, 4)
		baAsn1.encodeClosingTag(buffer, 1)

		const result = ReadPropertyMultiple.decodeAcknowledge(
			buffer.buffer,
			0,
			buffer.offset,
		)
		assert.ok(result)
		const day = result.values[0].values[0].value[0]
		assert.equal(day.type, ApplicationTag.WEEKLY_SCHEDULE)
		assert.equal((day.value as any[]).length, 1)
		assert.equal((day.value as any[])[0].value?.value, 22.25)
	})

	test('should decode indexed weekly schedule day when RPM response carries a single-day payload', () => {
		const buffer = utils.getBuffer()
		baAsn1.encodeContextObjectId(buffer, 0, ObjectType.SCHEDULE, 1)
		baAsn1.encodeOpeningTag(buffer, 1)
		baAsn1.encodeContextEnumerated(
			buffer,
			2,
			PropertyIdentifier.WEEKLY_SCHEDULE,
		)
		baAsn1.encodeContextUnsigned(buffer, 3, 3)
		baAsn1.encodeOpeningTag(buffer, 4)
		baAsn1.encodeOpeningTag(buffer, 0)
		baAsn1.bacappEncodeApplicationData(buffer, {
			type: ApplicationTag.TIME,
			value: new Date(2024, 0, 3, 8, 0, 0, 0),
		})
		baAsn1.bacappEncodeApplicationData(buffer, {
			type: ApplicationTag.REAL,
			value: 23.25,
		})
		baAsn1.encodeClosingTag(buffer, 0)
		baAsn1.encodeClosingTag(buffer, 4)
		baAsn1.encodeClosingTag(buffer, 1)

		const result = ReadPropertyMultiple.decodeAcknowledge(
			buffer.buffer,
			0,
			buffer.offset,
		)
		assert.ok(result)
		const day = result.values[0].values[0].value[0]
		assert.equal(day.type, ApplicationTag.WEEKLY_SCHEDULE)
		assert.equal((day.value as any[]).length, 1)
		assert.equal((day.value as any[])[0].value?.value, 23.25)
	})

	test('should decode indexed exception schedule as array payload in RPM', () => {
		const buffer = utils.getBuffer()
		baAsn1.encodeContextObjectId(buffer, 0, ObjectType.SCHEDULE, 1)
		baAsn1.encodeOpeningTag(buffer, 1)
		baAsn1.encodeContextEnumerated(
			buffer,
			2,
			PropertyIdentifier.EXCEPTION_SCHEDULE,
		)
		baAsn1.encodeContextUnsigned(buffer, 3, 3)
		baAsn1.encodeOpeningTag(buffer, 4)
		baAsn1.encodeOpeningTag(buffer, 0)
		baAsn1.encodeTag(buffer, 2, true, 3)
		buffer.buffer[buffer.offset++] = 3
		buffer.buffer[buffer.offset++] = 3
		buffer.buffer[buffer.offset++] = 3
		baAsn1.encodeClosingTag(buffer, 0)
		baAsn1.encodeOpeningTag(buffer, 2)
		baAsn1.bacappEncodeApplicationData(buffer, {
			type: ApplicationTag.TIME,
			value: new Date(2024, 0, 3, 9, 0, 0, 0),
		})
		baAsn1.bacappEncodeApplicationData(buffer, {
			type: ApplicationTag.UNSIGNED_INTEGER,
			value: 44,
		})
		baAsn1.encodeClosingTag(buffer, 2)
		baAsn1.bacappEncodeApplicationData(buffer, {
			type: ApplicationTag.UNSIGNED_INTEGER,
			value: 3,
		})
		baAsn1.encodeClosingTag(buffer, 4)
		baAsn1.encodeClosingTag(buffer, 1)

		const result = ReadPropertyMultiple.decodeAcknowledge(
			buffer.buffer,
			0,
			buffer.offset,
		)
		assert.ok(result)
		const payload = result.values[0].values[0].value[0]
		assert.equal(payload.type, ApplicationTag.SPECIAL_EVENT)
		const values = payload.value as any[]
		assert.equal(Array.isArray(values), true)
		assert.equal(values.length, 1)
		assert.equal(values[0].priority.value, 3)
	})
})
