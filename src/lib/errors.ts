import { ConfirmedServiceChoice } from './enum'

/**
 * Thrown before any packet is sent when an encoded confirmed request APDU
 * exceeds the maximum APDU length it must fit into. The limit may come from
 * the caller-supplied remote maximum (see
 * {@link SegmentedRequestOptions.remoteMaxApduLength}) or from the local
 * transport buffer.
 */
export class ApduTooLargeError extends Error {
	readonly encodedLength: number

	readonly maximumLength: number

	readonly service: ConfirmedServiceChoice

	readonly invokeId?: number

	/**
	 * Whether this library could carry the request as a segmented
	 * transfer if the caller explicitly enables segmentation.
	 */
	readonly segmentationAvailable?: boolean

	constructor(options: {
		encodedLength: number
		maximumLength: number
		service: ConfirmedServiceChoice
		invokeId?: number
		segmentationAvailable?: boolean
	}) {
		super(
			`ERR_APDU_TOO_LARGE - encoded APDU of ${options.encodedLength} octets exceeds maximum of ${options.maximumLength} octets`,
		)
		this.name = 'ApduTooLargeError'
		this.encodedLength = options.encodedLength
		this.maximumLength = options.maximumLength
		this.service = options.service
		this.invokeId = options.invokeId
		this.segmentationAvailable = options.segmentationAvailable
	}
}

/**
 * Thrown before any packet is sent when a confirmed request supplies an
 * invoke ID that is still pending toward the same peer. ASHRAE 135 - 5.4.4:
 * an invoke ID must be unique among the active transactions with one peer,
 * although the same invoke ID may be in flight to different peers.
 */
export class InvokeIdInUseError extends Error {
	/** Identity key of the peer the invoke ID is already pending toward */
	readonly peer: string

	readonly invokeId: number

	readonly service: ConfirmedServiceChoice

	constructor(options: {
		peer: string
		invokeId: number
		service: ConfirmedServiceChoice
	}) {
		super(
			`ERR_INVOKE_ID_IN_USE - invokeId ${options.invokeId} is still pending toward peer ${options.peer}`,
		)
		this.name = 'InvokeIdInUseError'
		this.peer = options.peer
		this.invokeId = options.invokeId
		this.service = options.service
	}
}

/**
 * Thrown before any packet is sent when the caller-supplied
 * segmented-request options are invalid or unusable.
 */
export class InvalidSegmentedRequestError extends Error {
	/** Name of the offending option, e.g. 'remoteMaxApduLength' */
	readonly option: string

	readonly value: unknown

	readonly service: ConfirmedServiceChoice

	readonly invokeId?: number

	constructor(options: {
		option: string
		value: unknown
		reason: string
		service: ConfirmedServiceChoice
		invokeId?: number
	}) {
		super(
			`ERR_INVALID_SEGMENTED_REQUEST - ${options.option}: ${options.reason}`,
		)
		this.name = 'InvalidSegmentedRequestError'
		this.option = options.option
		this.value = options.value
		this.service = options.service
		this.invokeId = options.invokeId
	}
}

/**
 * Thrown before any packet is sent when a segmented request would require
 * more segments than the remote device accepts.
 */
export class SegmentCountExceededError extends Error {
	readonly requiredSegments: number

	readonly maximumSegments: number

	readonly service: ConfirmedServiceChoice

	readonly invokeId?: number

	constructor(options: {
		requiredSegments: number
		maximumSegments: number
		service: ConfirmedServiceChoice
		invokeId?: number
	}) {
		super(
			`ERR_SEGMENT_COUNT_EXCEEDED - request requires ${options.requiredSegments} segments but remote device accepts at most ${options.maximumSegments}`,
		)
		this.name = 'SegmentCountExceededError'
		this.requiredSegments = options.requiredSegments
		this.maximumSegments = options.maximumSegments
		this.service = options.service
		this.invokeId = options.invokeId
	}
}

/**
 * Thrown when an active segmented request transfer fails because the remote
 * device did not acknowledge a segment window within the configured timeout
 * and retry budget, or kept rejecting segments.
 */
export class SegmentAckTimeoutError extends Error {
	readonly service: ConfirmedServiceChoice

	readonly invokeId: number

	readonly retries: number

	constructor(options: {
		service: ConfirmedServiceChoice
		invokeId: number
		retries: number
	}) {
		super(
			`ERR_SEGMENT_ACK_TIMEOUT - no valid SegmentACK after ${options.retries} retries`,
		)
		this.name = 'SegmentAckTimeoutError'
		this.service = options.service
		this.invokeId = options.invokeId
		this.retries = options.retries
	}
}
