import { type NetworkOpResult } from './types';
export declare class RequestManager {
    #private;
    constructor(delay: number, _setTimeout?: typeof setTimeout);
    add(key: string): Promise<NetworkOpResult>;
    resolve(key: string, err: Error, result?: undefined): boolean;
    resolve(key: string, err: null | undefined, result: NetworkOpResult): boolean;
    clear: (force?: boolean) => void;
}
