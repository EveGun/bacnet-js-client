import test from 'node:test'
import assert from 'node:assert'

import * as utils from './utils'

class CaptureTransport extends utils.TransportStub {
	public sentPackets: Buffer[] = []

	send(buffer: Buffer, offset: number): void {
		this.sentPackets.push(Buffer.from(buffer.subarray(0, offset)))
	}
}

test.describe('bacnet - timeSyncUTC integration', () => {
	test('should encode UTC values on the wire for utcTimeSynchronization', () => {
		const transport = new CaptureTransport()
		const client = new utils.BacnetClient({ transport, apduTimeout: 200 })
		const input = new Date('2026-02-24T23:30:00.000Z')

		client.timeSyncUTC({ address: '127.0.0.2' }, input)
		client.close()

		assert.strictEqual(transport.sentPackets.length, 1)
		const packet = transport.sentPackets[0]
		const utcPayload = Array.from(packet.subarray(packet.length - 10))
		assert.deepStrictEqual(utcPayload, [
			0xa4, // Date tag
			0x7e, // year: 2026-1900
			0x02, // month: February
			0x18, // day: 24
			0x02, // weekday: Tuesday
			0xb4, // Time tag
			0x17, // hour: 23
			0x1e, // minute: 30
			0x00, // second: 0
			0x00, // hundredths: 0
		])
	})
})
