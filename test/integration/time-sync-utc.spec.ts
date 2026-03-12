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
