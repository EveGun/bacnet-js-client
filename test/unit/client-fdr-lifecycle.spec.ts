import test from 'node:test'
import assert from 'node:assert'
import { EventEmitter } from 'events'

import BACnetClient from '../../src/lib/client'
import * as baNpdu from '../../src/lib/npdu'
import * as baApdu from '../../src/lib/apdu'
import * as baBvlc from '../../src/lib/bvlc'
import {
	BvlcResultFormat,
	BvlcResultPurpose,
	NpduControlPriority,
	PduType,
	UnconfirmedServiceChoice,
} from '../../src'

class TransportStub extends EventEmitter {
	getBroadcastAddress() {
		return '255.255.255.255'
	}
	getMaxPayload() {
		return 1482
	}
	send() {}
	open() {}
	close() {}
}

const BVLC_FWD_HEADER_LENGTH = 10

const makeForwardedWhoIs = (): Buffer => {
	const buf = { buffer: Buffer.alloc(64), offset: BVLC_FWD_HEADER_LENGTH }
	baNpdu.encode(buf, NpduControlPriority.NORMAL_MESSAGE, null)
	baApdu.encodeUnconfirmedServiceRequest(
		buf,
		PduType.UNCONFIRMED_REQUEST,
		UnconfirmedServiceChoice.WHO_IS,
	)
	baBvlc.encode(
		buf.buffer,
		BvlcResultPurpose.FORWARDED_NPDU,
		buf.offset,
		'10.0.0.9:47808',
	)
	return buf.buffer.subarray(0, buf.offset)
}

test.describe('bacnet - FDR lifecycle and forwarded NPDU guard', () => {
	test('should process FORWARDED_NPDU without active FDR by default', (t, done) => {
		const transport = new TransportStub()
		const client = new BACnetClient({ transport })
		t.after(() => client.close())

		client.on('forwardedNpduDroppedNoFdr', () => {
			done(new Error('packet should not be dropped by default'))
		})
		client.on('whoIs', (content) => {
			assert.equal(content.header?.sender?.forwardedFrom, '10.0.0.9')
			done()
		})

		transport.emit('message', makeForwardedWhoIs(), '192.168.1.50:47808')
	})

	test('should drop FORWARDED_NPDU without active FDR when opted in', (t, done) => {
		const transport = new TransportStub()
		const client = new BACnetClient({
			transport,
			requireActiveFdrForForwardedNpdu: true,
		})
		t.after(() => client.close())

		client.on('whoIs', () => {
			done(new Error('packet should have been dropped'))
		})
		client.on('forwardedNpduDroppedNoFdr', (content) => {
			assert.equal(content.payload.address, '192.168.1.50:47808')
			done()
		})

		transport.emit('message', makeForwardedWhoIs(), '192.168.1.50:47808')
	})

	test('should emit fdrRegistered, fdrExpiring and fdrExpired over the TTL', async () => {
		const client = Object.create(BACnetClient.prototype) as BACnetClient & {
			_settings: { apduTimeout: number }
			_getApduBuffer: () => { buffer: Buffer; offset: number }
			_send: (
				buffer: { buffer: Buffer; offset: number },
				receiver?: { address?: string },
			) => void
		}
		client._settings = { apduTimeout: 100 }
		client._getApduBuffer = () => ({
			buffer: Buffer.alloc(64),
			offset: 4,
		})
		client._send = (buffer, receiver) => {
			setImmediate(() => {
				client.emit('bvlcResult', {
					header: { sender: { address: receiver?.address } },
					payload: {
						resultCode: BvlcResultFormat.SUCCESSFUL_COMPLETION,
					},
				})
			})
		}

		const events: string[] = []
		const expired = new Promise<void>((resolve) => {
			client.on('fdrRegistered', (content) => {
				events.push('registered')
				assert.equal(content.payload.address, '127.0.0.1:47808')
				assert.equal(content.payload.ttl, 1)
			})
			client.on('fdrExpiring', () => events.push('expiring'))
			client.on('fdrExpired', (content) => {
				events.push('expired')
				assert.equal(content.payload.address, '127.0.0.1:47808')
				resolve()
			})
		})

		await client.registerForeignDevice({ address: '127.0.0.1:47808' }, 1)
		await expired

		assert.deepStrictEqual(events, ['registered', 'expiring', 'expired'])
	})
})
