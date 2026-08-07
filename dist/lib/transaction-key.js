"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNKNOWN_PEER_KEY = void 0;
exports.normalizeAddress = normalizeAddress;
exports.isRoutedPeer = isRoutedPeer;
exports.getLinkKey = getLinkKey;
exports.getPeerKey = getPeerKey;
exports.getTransactionKey = getTransactionKey;
const enum_1 = require("./enum");
exports.UNKNOWN_PEER_KEY = 'unknown';
function normalizeAddress(address, strictPort = false) {
    const value = String(address ?? '').trim();
    if (!value)
        return null;
    const parts = value.split(':');
    if (parts.length > 2) {
        if (strictPort)
            throw new Error(`Invalid receiver.address "${value}"`);
        return null;
    }
    const host = parts[0]?.trim();
    if (!host) {
        if (strictPort)
            throw new Error(`Invalid receiver.address "${value}"`);
        return null;
    }
    if (parts.length === 1) {
        if (strictPort)
            throw new Error(`Invalid receiver.address "${value}"`);
        return `${host}:${enum_1.DEFAULT_BACNET_PORT}`;
    }
    const portRaw = parts[1]?.trim();
    if (!portRaw) {
        if (strictPort)
            throw new Error(`Invalid receiver.address "${value}"`);
        return `${host}:${enum_1.DEFAULT_BACNET_PORT}`;
    }
    const port = Number(portRaw);
    const isValidPort = Number.isInteger(port) && port >= 1 && port <= 65535;
    if (!isValidPort) {
        if (strictPort)
            throw new Error(`Invalid receiver.address "${value}"`);
        return null;
    }
    return `${host}:${port}`;
}
function isRoutedPeer(peer) {
    return typeof peer?.net === 'number' && peer.net > 0 && peer.net !== 0xffff;
}
function getLinkKey(peer) {
    if (!peer)
        return exports.UNKNOWN_PEER_KEY;
    if (peer.forwardedFrom) {
        const forwarded = normalizeAddress(peer.forwardedFrom);
        if (forwarded)
            return forwarded;
    }
    return normalizeAddress(peer.address) ?? exports.UNKNOWN_PEER_KEY;
}
function getPeerKey(peer) {
    if (!peer)
        return exports.UNKNOWN_PEER_KEY;
    let key = normalizeAddress(peer.address) ?? exports.UNKNOWN_PEER_KEY;
    if (peer.forwardedFrom) {
        key += `|fwd=${normalizeAddress(peer.forwardedFrom) ?? peer.forwardedFrom}`;
    }
    if (isRoutedPeer(peer)) {
        key += `|net=${peer.net}|adr=${(peer.adr ?? []).join(',')}`;
    }
    return key;
}
function getTransactionKey(peer, invokeId) {
    return `${getLinkKey(peer)}#${invokeId}`;
}
//# sourceMappingURL=transaction-key.js.map