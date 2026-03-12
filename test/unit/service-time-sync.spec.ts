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
})
