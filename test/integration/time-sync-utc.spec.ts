import test from 'node:test'
import assert from 'node:assert'

import * as utils from './utils'
import { TimeSync } from '../../src/lib/services'

test.describe('bacnet - timeSyncUTC integration', () => {
	test('should encode UTC date/time components for UTC sync', () => {
		const transport = new utils.TransportStub()
		const client = new utils.BacnetClient({ transport, apduTimeout: 200 })
		const input = new Date('2026-02-24T23:30:00.123Z')

		let captured: Date | null = null
		const originalEncode = TimeSync.encode
		;(TimeSync as any).encode = (buffer: any, value: Date) => {
			captured = value
			return originalEncode(buffer, value)
		}

		try {
			client.timeSyncUTC({ address: '127.0.0.2' }, input)
		} finally {
			;(TimeSync as any).encode = originalEncode
			client.close()
		}

		assert.ok(captured instanceof Date)
		assert.strictEqual(captured.getFullYear(), input.getUTCFullYear())
		assert.strictEqual(captured.getMonth(), input.getUTCMonth())
		assert.strictEqual(captured.getDate(), input.getUTCDate())
		assert.strictEqual(captured.getHours(), input.getUTCHours())
		assert.strictEqual(captured.getMinutes(), input.getUTCMinutes())
		assert.strictEqual(captured.getSeconds(), input.getUTCSeconds())
		assert.strictEqual(captured.getMilliseconds(), input.getUTCMilliseconds())
	})
})
