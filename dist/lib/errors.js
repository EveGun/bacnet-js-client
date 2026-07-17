"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SegmentAckTimeoutError = exports.SegmentCountExceededError = exports.InvalidSegmentedRequestError = exports.ApduTooLargeError = void 0;
class ApduTooLargeError extends Error {
    encodedLength;
    maximumLength;
    service;
    invokeId;
    segmentationAvailable;
    constructor(options) {
        super(`ERR_APDU_TOO_LARGE - encoded APDU of ${options.encodedLength} octets exceeds maximum of ${options.maximumLength} octets`);
        this.name = 'ApduTooLargeError';
        this.encodedLength = options.encodedLength;
        this.maximumLength = options.maximumLength;
        this.service = options.service;
        this.invokeId = options.invokeId;
        this.segmentationAvailable = options.segmentationAvailable;
    }
}
exports.ApduTooLargeError = ApduTooLargeError;
class InvalidSegmentedRequestError extends Error {
    option;
    value;
    service;
    invokeId;
    constructor(options) {
        super(`ERR_INVALID_SEGMENTED_REQUEST - ${options.option}: ${options.reason}`);
        this.name = 'InvalidSegmentedRequestError';
        this.option = options.option;
        this.value = options.value;
        this.service = options.service;
        this.invokeId = options.invokeId;
    }
}
exports.InvalidSegmentedRequestError = InvalidSegmentedRequestError;
class SegmentCountExceededError extends Error {
    requiredSegments;
    maximumSegments;
    service;
    invokeId;
    constructor(options) {
        super(`ERR_SEGMENT_COUNT_EXCEEDED - request requires ${options.requiredSegments} segments but remote device accepts at most ${options.maximumSegments}`);
        this.name = 'SegmentCountExceededError';
        this.requiredSegments = options.requiredSegments;
        this.maximumSegments = options.maximumSegments;
        this.service = options.service;
        this.invokeId = options.invokeId;
    }
}
exports.SegmentCountExceededError = SegmentCountExceededError;
class SegmentAckTimeoutError extends Error {
    service;
    invokeId;
    retries;
    constructor(options) {
        super(`ERR_SEGMENT_ACK_TIMEOUT - no valid SegmentACK after ${options.retries} retries`);
        this.name = 'SegmentAckTimeoutError';
        this.service = options.service;
        this.invokeId = options.invokeId;
        this.retries = options.retries;
    }
}
exports.SegmentAckTimeoutError = SegmentAckTimeoutError;
//# sourceMappingURL=errors.js.map