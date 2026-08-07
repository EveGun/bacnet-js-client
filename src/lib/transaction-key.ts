import { DEFAULT_BACNET_PORT } from './enum'
import { type BACNetAddress } from './types'

/** Peer-key component used when no usable address information is available */
export const UNKNOWN_PEER_KEY = 'unknown'

/**
 * Normalizes a `host[:port]` address string to canonical `host:port` form,
 * appending the default BACnet port when no port is present.
 *
 * Returns `null` for empty or malformed input, unless `strictPort` is set,
 * in which case malformed input (including a missing port) throws instead.
 */
export function normalizeAddress(
	address?: string,
	strictPort = false,
): string | null {
	const value = String(address ?? '').trim()
	if (!value) return null

	const parts = value.split(':')
	if (parts.length > 2) {
		if (strictPort) throw new Error(`Invalid receiver.address "${value}"`)
		return null
	}

	const host = parts[0]?.trim()
	if (!host) {
		if (strictPort) throw new Error(`Invalid receiver.address "${value}"`)
		return null
	}

	if (parts.length === 1) {
		if (strictPort) throw new Error(`Invalid receiver.address "${value}"`)
		return `${host}:${DEFAULT_BACNET_PORT}`
	}

	const portRaw = parts[1]?.trim()
	if (!portRaw) {
		if (strictPort) throw new Error(`Invalid receiver.address "${value}"`)
		return `${host}:${DEFAULT_BACNET_PORT}`
	}

	const port = Number(portRaw)
	const isValidPort = Number.isInteger(port) && port >= 1 && port <= 65535
	if (!isValidPort) {
		if (strictPort) throw new Error(`Invalid receiver.address "${value}"`)
		return null
	}

	return `${host}:${port}`
}

/**
 * Builds the identity key of a BACnet peer for transaction correlation.
 *
 * ASHRAE 135 - 5.4: a Transaction State Machine instance is identified by
 * the peer BACnet address together with the invoke ID, so the key includes
 * every component that distinguishes one peer from another sharing the
 * same link-level address:
 *
 * - `address`   — the BACnet/IP address the datagram is exchanged with
 * - `forwardedFrom` — the originating device behind a BBMD (Annex J
 *   Forwarded-NPDU), distinguishing devices reached through the same BBMD
 * - `net`/`adr` — the routed network number and MAC (NPDU DADR/SADR),
 *   distinguishing devices behind the same router
 *
 * `distributeBroadcastToNetwork` and `type` are delivery options rather
 * than identity and are deliberately excluded.
 */
export function getPeerKey(peer?: BACNetAddress | null): string {
	if (!peer) return UNKNOWN_PEER_KEY
	let key = normalizeAddress(peer.address) ?? UNKNOWN_PEER_KEY
	if (peer.forwardedFrom) {
		key += `|fwd=${normalizeAddress(peer.forwardedFrom) ?? peer.forwardedFrom}`
	}
	if (peer.net !== undefined) {
		key += `|net=${peer.net}|adr=${(peer.adr ?? []).join(',')}`
	}
	return key
}

/**
 * Builds the key identifying one confirmed transaction: the peer identity
 * plus the 8-bit invoke ID. The same invoke ID may be active concurrently
 * toward different peers; toward the same peer it must be unique.
 */
export function getTransactionKey(
	peer: BACNetAddress | null | undefined,
	invokeId: number,
): string {
	return `${getPeerKey(peer)}#${invokeId}`
}
