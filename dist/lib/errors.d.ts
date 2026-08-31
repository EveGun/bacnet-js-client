import { ConfirmedServiceChoice } from './enum';
export declare class ApduTooLargeError extends Error {
    readonly encodedLength: number;
    readonly maximumLength: number;
    readonly service: ConfirmedServiceChoice;
    readonly invokeId?: number;
    readonly segmentationAvailable?: boolean;
    constructor(options: {
        encodedLength: number;
        maximumLength: number;
        service: ConfirmedServiceChoice;
        invokeId?: number;
        segmentationAvailable?: boolean;
    });
}
export declare class InvokeIdInUseError extends Error {
    readonly peer: string;
    readonly invokeId: number;
    readonly service: ConfirmedServiceChoice;
    constructor(options: {
        peer: string;
        invokeId: number;
        service: ConfirmedServiceChoice;
    });
}
export declare class InvalidSegmentedRequestError extends Error {
    readonly option: string;
    readonly value: unknown;
    readonly service: ConfirmedServiceChoice;
    readonly invokeId?: number;
    constructor(options: {
        option: string;
        value: unknown;
        reason: string;
        service: ConfirmedServiceChoice;
        invokeId?: number;
    });
}
export declare class SegmentCountExceededError extends Error {
    readonly requiredSegments: number;
    readonly maximumSegments: number;
    readonly service: ConfirmedServiceChoice;
    readonly invokeId?: number;
    constructor(options: {
        requiredSegments: number;
        maximumSegments: number;
        service: ConfirmedServiceChoice;
        invokeId?: number;
    });
}
export declare class SegmentAckTimeoutError extends Error {
    readonly service: ConfirmedServiceChoice;
    readonly invokeId: number;
    readonly retries: number;
    constructor(options: {
        service: ConfirmedServiceChoice;
        invokeId: number;
        retries: number;
    });
}
