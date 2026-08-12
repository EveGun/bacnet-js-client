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
 * True when the destination carries a routed network address that is
 * actually encoded on the wire (npdu.encode only emits DADR for net > 0;
 * 0xffff is the global broadcast network and never a specific peer).
 */
export function isRoutedPeer(peer?: BACNetAddress | null): boolean {
	return typeof peer?.net === 'number' && peer.net > 0 && peer.net !== 0xffff
}

/**
 * Identity of the BACnet/IP link a datagram for this peer is exchanged
 * over: the normalized `ip:port` endpoint. For devices behind a BBMD the
 * originating address (`forwardedFrom`) is the link — replies may arrive
 * either forwarded through the BBMD or directly from the device, and
 * response correlation tries both the sender address and the forwarded
 * address as link candidates. The routed net/adr component is deliberately
 * NOT part of the link: many MS/TP gateways answer without an NPDU SADR,
 * so replies from routed devices can only be correlated at link level.
 */
export function getLinkKey(peer?: BACNetAddress | null): string {
	if (!peer) return UNKNOWN_PEER_KEY
	if (peer.forwardedFrom) {
		const forwarded = normalizeAddress(peer.forwardedFrom)
		if (forwarded) return forwarded
	}
	return normalizeAddress(peer.address) ?? UNKNOWN_PEER_KEY
}

/**
 * Builds the full identity key of a BACnet peer, including the routed
 * net/adr component. Used for server-role segment reassembly, where two
 * devices behind one router may legitimately use the same invokeId in
 * requests toward us and their SADR is always present. Client-side
 * transaction state is keyed by `getTransactionKey()` (link + invokeId)
 * instead — see the INVARIANT note there.
 */
export function getPeerKey(peer?: BACNetAddress | null): string {
	if (!peer) return UNKNOWN_PEER_KEY
	let key = normalizeAddress(peer.address) ?? UNKNOWN_PEER_KEY
	if (peer.forwardedFrom) {
		key += `|fwd=${normalizeAddress(peer.forwardedFrom) ?? peer.forwardedFrom}`
	}
	// Mirror the wire semantics of npdu.encode: a routed destination is only
	// encoded when net > 0, so NET 0 (local network), null/undefined and
	// 0xffff (global broadcast, never a source address) carry no routed
	// component and must all map to the same peer identity.
	if (isRoutedPeer(peer)) {
		key += `|net=${peer.net}|adr=${(peer.adr ?? []).join(',')}`
	}
	return key
}

/**
 * Builds the key identifying one of OUR confirmed transactions: the link
 * plus the 8-bit invoke ID.
 *
 * INVARIANT: correlating responses on (link, invokeId) alone — without the
 * routed net/adr — is only safe because invokeId ALLOCATION is also
 * link-scoped (`BACnetClient._getInvokeId` skips ids pending toward any
 * peer on the link), which guarantees that (link, invokeId) is unique
 * among pending requests. Field reality forces this: MS/TP gateways that
 * proxy devices often reply without an NPDU SADR, so a reply cannot be
 * attributed to a specific routed peer — only to the link. Allocation and
 * correlation must therefore stay coupled; never change one without the
 * other. The coupling is locked by tests in client-transactions.spec.ts.
 */
export function getTransactionKey(
	peer: BACNetAddress | null | undefined,
	invokeId: number,
): string {
	return `${getLinkKey(peer)}#${invokeId}`
}
