import { type BACNetAddress } from './types';
export declare const UNKNOWN_PEER_KEY = "unknown";
export declare function normalizeAddress(address?: string, strictPort?: boolean): string | null;
export declare function isRoutedPeer(peer?: BACNetAddress | null): boolean;
export declare function getLinkKey(peer?: BACNetAddress | null): string;
export declare function getPeerKey(peer?: BACNetAddress | null): string;
export declare function getTransactionKey(peer: BACNetAddress | null | undefined, invokeId: number): string;
