import test from 'node:test'
import assert from 'node:assert'

import * as utils from './utils'
import { TimeSync } from '../../src/lib/services'

test.describe('bacnet - Services layer TimeSync unit', () => {
	test('should successfully encode and decode', (t) => {
		const buffer = utils.getBuffer()
		const date = new Date()
		date.setMilliseconds(990)
		TimeSync.encode(buffer, date)
		const result = TimeSync.decode(buffer.buffer, 0)
		delete result.len
		assert.deepStrictEqual(result, {
			value: date,
		})
	})

	test('should encode UTC date/time using UTC components', () => {
		const buffer = utils.getBuffer()
		const date = new Date('2026-02-24T23:30:00.000Z')
		TimeSync.encodeUtc(buffer, date)
		assert.deepStrictEqual(Array.from(buffer.buffer.subarray(0, buffer.offset)), [
			0xa4,
			0x7e,
			0x02,
			0x18,
			0x02,
			0xb4,
			0x17,
			0x1e,
			0x00,
			0x00,
		])
	})

	test('should decode UTC date/time to UTC instant', () => {
		const buffer = utils.getBuffer()
		const date = new Date('2026-02-24T23:30:00.120Z')
		TimeSync.encodeUtc(buffer, date)
		const result = TimeSync.decodeUtc(buffer.buffer, 0)
		assert.ok(result)
		assert.equal(result.value.toISOString(), '2026-02-24T23:30:00.120Z')
	})

	test('should reject invalid UTC date input', () => {
		const buffer = utils.getBuffer()
		const invalidDate = new Date('invalid')
		assert.throws(() => {
			TimeSync.encodeUtc(buffer, invalidDate)
		}, /invalid date/)
	})

	test('should round UTC hundredths instead of truncating', () => {
		const buffer = utils.getBuffer()
		const date = new Date('2026-02-24T23:30:00.125Z')
		TimeSync.encodeUtc(buffer, date)
		const bytes = Array.from(buffer.buffer.subarray(0, buffer.offset))
		// DATE tag(0xa4) + 4 date bytes + TIME tag(0xb4) + hh mm ss hundredths
		assert.equal(bytes[9], 13)
	})
})
