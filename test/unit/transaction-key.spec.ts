import test from 'node:test'
import assert from 'node:assert'

import {
	getLinkKey,
	getPeerKey,
	getTransactionKey,
	isRoutedPeer,
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

		test('treats net 0, null, undefined and 0xffff as the local/no-route peer', () => {
			// npdu.encode only puts a routed destination on the wire for
			// net > 0, so these must all produce the same peer identity.
			const plain = getPeerKey({ address: '1.2.3.4:47808' })
			assert.strictEqual(
				getPeerKey({ address: '1.2.3.4', net: 0 }),
				plain,
			)
			assert.strictEqual(
				getPeerKey({ address: '1.2.3.4', net: 0, adr: [] }),
				plain,
			)
			assert.strictEqual(
				getPeerKey({ address: '1.2.3.4', net: null, adr: null } as any),
				plain,
			)
			assert.strictEqual(
				getPeerKey({ address: '1.2.3.4', net: 0xffff }),
				plain,
			)
			assert.notStrictEqual(
				getPeerKey({ address: '1.2.3.4', net: 1, adr: [1] }),
				plain,
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

	test.describe('getLinkKey', () => {
		test('is the normalized ip:port endpoint', () => {
			assert.strictEqual(
				getLinkKey({ address: '1.2.3.4' }),
				'1.2.3.4:47808',
			)
			assert.strictEqual(getLinkKey(undefined), UNKNOWN_PEER_KEY)
			assert.strictEqual(getLinkKey({}), UNKNOWN_PEER_KEY)
		})

		test('prefers the forwarded originating address over the BBMD address', () => {
			assert.strictEqual(
				getLinkKey({
					address: '10.0.0.1:47808',
					forwardedFrom: '10.0.0.5',
				}),
				'10.0.0.5:47808',
			)
		})

		test('ignores the routed net/adr component', () => {
			assert.strictEqual(
				getLinkKey({ address: '10.0.0.1', net: 100, adr: [1] }),
				getLinkKey({ address: '10.0.0.1' }),
			)
		})
	})

	test.describe('isRoutedPeer', () => {
		test('is true only for wire-encoded routed destinations', () => {
			assert.strictEqual(isRoutedPeer({ address: 'a', net: 1 }), true)
			assert.strictEqual(isRoutedPeer({ address: 'a', net: 0 }), false)
			assert.strictEqual(
				isRoutedPeer({ address: 'a', net: 0xffff }),
				false,
			)
			assert.strictEqual(isRoutedPeer({ address: 'a' }), false)
			assert.strictEqual(isRoutedPeer(undefined), false)
		})
	})

	test.describe('getTransactionKey', () => {
		test('is link-scoped: net/adr never contributes (INVARIANT)', () => {
			// Coupled with link-scoped invokeId allocation in the client —
			// see the INVARIANT note in transaction-key.ts.
			const router = '10.0.0.1:47808'
			assert.strictEqual(
				getTransactionKey({ address: router, net: 100, adr: [1] }, 9),
				getTransactionKey({ address: router }, 9),
			)
			assert.strictEqual(
				getTransactionKey({ address: router, net: 100, adr: [2] }, 9),
				getTransactionKey({ address: router, net: 100, adr: [1] }, 9),
			)
		})

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
