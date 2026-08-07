import test from 'node:test'
import assert from 'node:assert'

import {
	getPeerKey,
	getTransactionKey,
	normalizeAddress,
	UNKNOWN_PEER_KEY,
} from '../../src/lib/transaction-key'

test.describe('bacnet - transaction key helpers', () => {
	test.describe('normalizeAddress', () => {
		test('appends the default BACnet port when missing', () => {
			assert.strictEqual(normalizeAddress('1.2.3.4'), '1.2.3.4:47808')
		})

		test('keeps an explicit port', () => {
			assert.strictEqual(normalizeAddress('1.2.3.4:1234'), '1.2.3.4:1234')
		})

		test('returns null for empty or malformed input', () => {
			assert.strictEqual(normalizeAddress(undefined), null)
			assert.strictEqual(normalizeAddress(''), null)
			assert.strictEqual(normalizeAddress('a:b:c'), null)
			assert.strictEqual(normalizeAddress('1.2.3.4:0'), null)
			assert.strictEqual(normalizeAddress('1.2.3.4:x'), null)
		})

		test('throws in strictPort mode when the port is missing or invalid', () => {
			assert.throws(() => normalizeAddress('1.2.3.4', true))
			assert.throws(() => normalizeAddress('1.2.3.4:0', true))
			assert.strictEqual(
				normalizeAddress('1.2.3.4:1234', true),
				'1.2.3.4:1234',
			)
		})
	})

	test.describe('getPeerKey', () => {
		test('returns the unknown key without address information', () => {
			assert.strictEqual(getPeerKey(undefined), UNKNOWN_PEER_KEY)
			assert.strictEqual(getPeerKey(null), UNKNOWN_PEER_KEY)
			assert.strictEqual(getPeerKey({}), UNKNOWN_PEER_KEY)
		})

		test('normalizes the address port', () => {
			assert.strictEqual(
				getPeerKey({ address: '1.2.3.4' }),
				getPeerKey({ address: '1.2.3.4:47808' }),
			)
			assert.notStrictEqual(
				getPeerKey({ address: '1.2.3.4:47809' }),
				getPeerKey({ address: '1.2.3.4:47808' }),
			)
		})

		test('distinguishes devices behind the same BBMD by forwardedFrom', () => {
			const bbmd = '10.0.0.1:47808'
			const devA = getPeerKey({
				address: bbmd,
				forwardedFrom: '10.0.0.5',
			})
			const devB = getPeerKey({
				address: bbmd,
				forwardedFrom: '10.0.0.6',
			})
			assert.notStrictEqual(devA, devB)
			assert.notStrictEqual(devA, getPeerKey({ address: bbmd }))
			// The BVLC decoder omits the default port from originatingIP, so
			// forwardedFrom must be normalized like the address itself.
			assert.strictEqual(
				devA,
				getPeerKey({ address: bbmd, forwardedFrom: '10.0.0.5:47808' }),
			)
		})

		test('distinguishes routed devices behind the same router by net/adr', () => {
			const router = '10.0.0.1:47808'
			const devA = getPeerKey({ address: router, net: 100, adr: [1] })
			const devB = getPeerKey({ address: router, net: 100, adr: [2] })
			const devC = getPeerKey({ address: router, net: 200, adr: [1] })
			assert.notStrictEqual(devA, devB)
			assert.notStrictEqual(devA, devC)
			assert.notStrictEqual(devA, getPeerKey({ address: router }))
			assert.strictEqual(
				devA,
				getPeerKey({ address: router, net: 100, adr: [1] }),
			)
		})

		test('ignores delivery options that are not peer identity', () => {
			assert.strictEqual(
				getPeerKey({ address: '1.2.3.4', type: 1 }),
				getPeerKey({
					address: '1.2.3.4',
					distributeBroadcastToNetwork: true,
				}),
			)
		})
	})

	test.describe('getTransactionKey', () => {
		test('separates transactions by invokeId for the same peer', () => {
			const peer = { address: '1.2.3.4' }
			assert.notStrictEqual(
				getTransactionKey(peer, 1),
				getTransactionKey(peer, 2),
			)
		})

		test('separates transactions by peer for the same invokeId', () => {
			assert.notStrictEqual(
				getTransactionKey({ address: '1.2.3.4' }, 1),
				getTransactionKey({ address: '1.2.3.5' }, 1),
			)
		})
	})
})
