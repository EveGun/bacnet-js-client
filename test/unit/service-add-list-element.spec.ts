import test from 'node:test'
import assert from 'node:assert'

import * as utils from './utils'
import { AddListElement } from '../../src/lib/services'
import {
	ApplicationTag,
	ObjectType,
	PropertyIdentifier,
	ASN1_ARRAY_ALL,
} from '../../src/lib/enum'

test.describe('bacnet - Services layer AddListElement unit', () => {
	test('should successfully encode and decode', () => {
		const buffer = utils.getBuffer()
		AddListElement.encode(buffer, { type: 11, instance: 560 }, 85, 2, [
			{ type: 1, value: false },
			{ type: 2, value: 1 },
		])
		const result = AddListElement.decode(buffer.buffer, 0, buffer.offset)
		delete result.len
		assert.deepStrictEqual(result, {
			objectId: { type: 11, instance: 560 },
			property: { id: 85, index: 2 },
			values: [
				{ type: 1, value: false },
				{ type: 2, value: 1 },
			],
		})
	})

	test('encodes Calendar Date_List elements as BACnetCalendarEntry CHOICEs and decodes them back', () => {
		const buffer = utils.getBuffer()
		// One wildcard date (any year, Jan 10), one date range, one WeekNDay —
		// the constructed encoding WriteProperty uses, not application tags.
		AddListElement.encode(
			buffer,
			{ type: ObjectType.CALENDAR, instance: 3 },
			PropertyIdentifier.DATE_LIST,
			ASN1_ARRAY_ALL,
			[
				{
					type: ApplicationTag.DATE,
					value: null,
					raw: { year: 255, month: 1, day: 10, wday: 255 },
				},
				{
					type: ApplicationTag.DATERANGE,
					value: [
						{ type: ApplicationTag.DATE, value: new Date(2026, 6, 1) },
						{ type: ApplicationTag.DATE, value: new Date(2026, 6, 31) },
					],
				},
				{
					type: ApplicationTag.WEEKNDAY,
					value: { month: 13, week: 6, wday: 255 },
				},
			] as any,
		)
		const result = AddListElement.decode(buffer.buffer, 0, buffer.offset)
		assert.ok(result, 'decodes')
		assert.deepStrictEqual(result.objectId, {
			type: ObjectType.CALENDAR,
			instance: 3,
		})
		assert.strictEqual(result.property.id, PropertyIdentifier.DATE_LIST)
		// The property-aware context decoder returns the calendar entries in a
		// single decoded wrapper.
		const entries = result.values[0].value
		assert.strictEqual(entries.length, 3)
		// decodeCalendar's flat entry shapes: date octets straight on the entry.
		assert.deepStrictEqual(
			{ ...entries[0], len: undefined },
			{ year: 255, month: 1, day: 10, wday: 255, len: undefined },
		)
		assert.deepStrictEqual(entries[1].startDate.raw, {
			year: 126,
			month: 7,
			day: 1,
			wday: 3,
		})
		assert.deepStrictEqual(entries[1].endDate.raw, {
			year: 126,
			month: 7,
			day: 31,
			wday: 5,
		})
		assert.deepStrictEqual(
			{ ...entries[2], len: undefined },
			{ month: 13, week: 6, wday: 255, len: undefined },
		)
	})
})
