import test from 'node:test'
import assert from 'node:assert'

import * as utils from './utils'
import * as baAsn1 from '../../src/lib/asn1'
import { GetEnrollmentSummary } from '../../src/lib/services'

test.describe('bacnet - Services layer GetEnrollmentSummary unit', () => {
	test('should successfully encode and decode', (t) => {
		const buffer = utils.getBuffer()
		GetEnrollmentSummary.encode(buffer, 2)
		const result = GetEnrollmentSummary.decode(buffer.buffer, 0)
		delete result.len
		assert.deepStrictEqual(result, {
			acknowledgmentFilter: 2,
		})
	})

	test('should successfully encode and decode full payload', (t) => {
		const buffer = utils.getBuffer()
		GetEnrollmentSummary.encode(
			buffer,
			2,
			{ objectId: { type: 5, instance: 33 }, processId: 7 },
			1,
			3,
			{ min: 1, max: 65 },
			5,
		)
		const result = GetEnrollmentSummary.decode(buffer.buffer, 0)
		delete result.len
		assert.deepStrictEqual(result, {
			acknowledgmentFilter: 2,
			enrollmentFilter: {
				objectId: { type: 5, instance: 33 },
				processId: 7,
			},
			eventStateFilter: 1,
			eventTypeFilter: 3,
			priorityFilter: { min: 1, max: 65 },
			notificationClassFilter: 5,
		})
	})

	test('should encode and decode zero-valued filters', () => {
		const buffer = utils.getBuffer()
		GetEnrollmentSummary.encode(buffer, 2, undefined, 0, 0, undefined, 0)
		const result = GetEnrollmentSummary.decode(buffer.buffer, 0)
		delete result.len
		assert.deepStrictEqual(result, {
			acknowledgmentFilter: 2,
			eventStateFilter: 0,
			eventTypeFilter: 0,
			notificationClassFilter: 0,
		})
	})

	test('should encode filter tags as primitive context values', () => {
		const buffer = utils.getBuffer()
		GetEnrollmentSummary.encode(buffer, 2, undefined, 0, 0, undefined, 0)

		let len = 0
		let result = baAsn1.decodeTagNumberAndValue(buffer.buffer, len)
		len += result.len
		let decoded = baAsn1.decodeEnumerated(buffer.buffer, len, result.value)
		len += decoded.len
		assert.strictEqual(decoded.value, 2)

		assert.ok(baAsn1.decodeIsContextTag(buffer.buffer, len, 2))
		assert.ok(!baAsn1.decodeIsOpeningTagNumber(buffer.buffer, len, 2))
		result = baAsn1.decodeTagNumberAndValue(buffer.buffer, len)
		len += result.len
		decoded = baAsn1.decodeEnumerated(buffer.buffer, len, result.value)
		len += decoded.len
		assert.strictEqual(decoded.value, 0)

		assert.ok(baAsn1.decodeIsContextTag(buffer.buffer, len, 3))
		assert.ok(!baAsn1.decodeIsOpeningTagNumber(buffer.buffer, len, 3))
		result = baAsn1.decodeTagNumberAndValue(buffer.buffer, len)
		len += result.len
		decoded = baAsn1.decodeEnumerated(buffer.buffer, len, result.value)
		len += decoded.len
		assert.strictEqual(decoded.value, 0)

		assert.ok(baAsn1.decodeIsContextTag(buffer.buffer, len, 5))
		assert.ok(!baAsn1.decodeIsOpeningTagNumber(buffer.buffer, len, 5))
		result = baAsn1.decodeTagNumberAndValue(buffer.buffer, len)
		len += result.len
		const notificationClass = baAsn1.decodeUnsigned(
			buffer.buffer,
			len,
			result.value,
		)
		len += notificationClass.len
		assert.strictEqual(notificationClass.value, 0)
		assert.strictEqual(len, buffer.offset)
	})
})

test.describe('GetEnrollmentSummaryAcknowledge', () => {
	test('should successfully encode and decode', (t) => {
		const buffer = utils.getBuffer()
		GetEnrollmentSummary.encodeAcknowledge(buffer, [
			{
				objectId: { type: 12, instance: 120 },
				eventType: 3,
				eventState: 2,
				priority: 18,
				notificationClass: 11,
			},
		])
		const result = GetEnrollmentSummary.decodeAcknowledge(
			buffer.buffer,
			0,
			buffer.offset,
		)
		delete result.len
		assert.deepStrictEqual(result, {
			enrollmentSummaries: [
				{
					objectId: { type: 12, instance: 120 },
					eventType: 3,
					eventState: 2,
					priority: 18,
					notificationClass: 11,
				},
			],
		})
	})

	test('should decode acknowledge payload when notification class is omitted', () => {
		const buffer = utils.getBuffer()
		GetEnrollmentSummary.encodeAcknowledge(buffer, [
			{
				objectId: { type: 12, instance: 120 },
				eventType: 3,
				eventState: 2,
				priority: 18,
			},
			{
				objectId: { type: 8, instance: 18 },
				eventType: 1,
				eventState: 0,
				priority: 7,
				notificationClass: 4,
			},
		])
		const result = GetEnrollmentSummary.decodeAcknowledge(
			buffer.buffer,
			0,
			buffer.offset,
		)
		delete result.len
		assert.deepStrictEqual(result, {
			enrollmentSummaries: [
				{
					objectId: { type: 12, instance: 120 },
					eventType: 3,
					eventState: 2,
					priority: 18,
				},
				{
					objectId: { type: 8, instance: 18 },
					eventType: 1,
					eventState: 0,
					priority: 7,
					notificationClass: 4,
				},
			],
		})
	})
})
