import * as baAsn1 from '../asn1'
import {
	ASN1_ARRAY_ALL,
	CovType,
	EventType,
	NotifyType,
	PropertyStates,
	TimeStamp,
} from '../enum'
import {
	BACNetDevObjRef,
	BACNetPropertyState,
	EncodeBuffer,
	EventNotifyDataParams,
	EventNotifyDataResult,
} from '../types'
import { BacnetService } from './AbstractServices'

export default class EventNotifyData extends BacnetService {
	private static decodeOpeningTag(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): number | undefined {
		if (!baAsn1.decodeIsOpeningTagNumber(buffer, offset, tagNumber)) {
			return undefined
		}
		return baAsn1.decodeTagNumberAndValue(buffer, offset).len
	}

	private static decodeClosingTag(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): number | undefined {
		if (!baAsn1.decodeIsClosingTagNumber(buffer, offset, tagNumber)) {
			return undefined
		}
		return baAsn1.decodeTagNumberAndValue(buffer, offset).len
	}

	private static decodeContextUnsigned(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): { len: number; value: number } | undefined {
		if (!baAsn1.decodeIsContextTag(buffer, offset, tagNumber))
			return undefined
		const result = baAsn1.decodeTagNumberAndValue(buffer, offset)
		const decodedValue = baAsn1.decodeUnsigned(
			buffer,
			offset + result.len,
			result.value,
		)
		return {
			len: result.len + decodedValue.len,
			value: decodedValue.value,
		}
	}

	private static decodeContextEnumerated(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): { len: number; value: number } | undefined {
		if (!baAsn1.decodeIsContextTag(buffer, offset, tagNumber))
			return undefined
		const result = baAsn1.decodeTagNumberAndValue(buffer, offset)
		const decodedValue = baAsn1.decodeEnumerated(
			buffer,
			offset + result.len,
			result.value,
		)
		return {
			len: result.len + decodedValue.len,
			value: decodedValue.value,
		}
	}

	private static decodeContextBoolean(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): { len: number; value: boolean } | undefined {
		if (!baAsn1.decodeIsContextTag(buffer, offset, tagNumber))
			return undefined
		const result = baAsn1.decodeTagNumberAndValue(buffer, offset)
		if (result.value === 0) {
			return {
				len: result.len,
				value: false,
			}
		}
		const decodedValue = baAsn1.decodeUnsigned(
			buffer,
			offset + result.len,
			result.value,
		)
		return {
			len: result.len + decodedValue.len,
			value: decodedValue.value > 0,
		}
	}

	private static decodeContextBitstring(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	):
		| {
				len: number
				value: EventNotifyDataParams['changeOfBitstringStatusFlags']
		  }
		| undefined {
		if (!baAsn1.decodeIsContextTag(buffer, offset, tagNumber))
			return undefined
		const result = baAsn1.decodeTagNumberAndValue(buffer, offset)
		const decodedValue = baAsn1.decodeBitstring(
			buffer,
			offset + result.len,
			result.value,
		)
		return {
			len: result.len + decodedValue.len,
			value: decodedValue.value,
		}
	}

	private static decodeContextReal(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): { len: number; value: number } | undefined {
		if (!baAsn1.decodeIsContextTag(buffer, offset, tagNumber))
			return undefined
		const result = baAsn1.decodeTagNumberAndValue(buffer, offset)
		if (result.value !== 4) return undefined
		if (offset + result.len + result.value > buffer.length) return undefined
		return {
			len: result.len + result.value,
			value: buffer.readFloatBE(offset + result.len),
		}
	}

	private static decodeContextObjectId(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): { len: number; value: { type: number; instance: number } } | undefined {
		const objectId = baAsn1.decodeContextObjectId(buffer, offset, tagNumber)
		if (!objectId) return undefined
		return {
			len: objectId.len,
			value: {
				type: objectId.objectType,
				instance: objectId.instance,
			},
		}
	}

	private static decodePropertyState(
		buffer: Buffer,
		offset: number,
	): { len: number; value: BACNetPropertyState } | undefined {
		let len = 0
		const result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
		len += result.len
		let stateValue = 0
		switch (result.tagNumber) {
			case PropertyStates.BOOLEAN_VALUE: {
				if (result.value === 0) {
					stateValue = 0
					break
				}
				const decodedValue = baAsn1.decodeUnsigned(
					buffer,
					offset + len,
					result.value,
				)
				len += decodedValue.len
				stateValue = decodedValue.value > 0 ? 1 : 0
				break
			}
			case PropertyStates.UNSIGNED_VALUE: {
				const decodedValue = baAsn1.decodeUnsigned(
					buffer,
					offset + len,
					result.value,
				)
				len += decodedValue.len
				stateValue = decodedValue.value
				break
			}
			default: {
				const decodedValue = baAsn1.decodeEnumerated(
					buffer,
					offset + len,
					result.value,
				)
				len += decodedValue.len
				stateValue = decodedValue.value
				break
			}
		}
		return {
			len,
			value: {
				type: result.tagNumber,
				state: stateValue,
			},
		}
	}

	private static skipOpeningTag(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): number | undefined {
		const openingTagLen = EventNotifyData.decodeOpeningTag(
			buffer,
			offset,
			tagNumber,
		)
		if (openingTagLen == null) return undefined
		let len = 0
		let depth = 0
		while (offset + len < buffer.length) {
			const result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
			const isOpening = baAsn1.decodeIsOpeningTag(buffer, offset + len)
			const isClosing = baAsn1.decodeIsClosingTag(buffer, offset + len)
			len += result.len
			if (isOpening) {
				depth += 1
				continue
			}
			if (isClosing) {
				depth -= 1
				if (depth === 0) return len
				continue
			}
			len += result.value
		}
		return undefined
	}

	private static decodeDeviceObjectPropertyRef(
		buffer: Buffer,
		offset: number,
	): { len: number; value: BACNetDevObjRef } | undefined {
		let len = 0
		const openingTag0 = EventNotifyData.decodeOpeningTag(
			buffer,
			offset + len,
			0,
		)
		if (openingTag0 == null) return undefined
		len += openingTag0

		const objectId = EventNotifyData.decodeContextObjectId(
			buffer,
			offset + len,
			0,
		)
		if (!objectId) return undefined
		len += objectId.len

		const propertyId = EventNotifyData.decodeContextEnumerated(
			buffer,
			offset + len,
			1,
		)
		if (!propertyId) return undefined
		len += propertyId.len

		let arrayIndex = ASN1_ARRAY_ALL
		const propertyIndex = EventNotifyData.decodeContextUnsigned(
			buffer,
			offset + len,
			2,
		)
		if (propertyIndex) {
			len += propertyIndex.len
			arrayIndex = propertyIndex.value
		}

		let deviceIndentifier = { type: 0, instance: 0 }
		const deviceObjectId = EventNotifyData.decodeContextObjectId(
			buffer,
			offset + len,
			3,
		)
		if (deviceObjectId) {
			len += deviceObjectId.len
			deviceIndentifier = deviceObjectId.value
		}

		const closingTag0 = EventNotifyData.decodeClosingTag(
			buffer,
			offset + len,
			0,
		)
		if (closingTag0 == null) return undefined
		len += closingTag0

		return {
			len,
			value: {
				objectId: objectId.value,
				id: propertyId.value,
				arrayIndex,
				deviceIndentifier,
			},
		}
	}

	private static decodeEventValues(
		buffer: Buffer,
		offset: number,
		eventData: EventNotifyDataResult,
	): number | undefined {
		switch (eventData.eventType) {
			case EventType.CHANGE_OF_BITSTRING:
			case EventType.CHANGE_OF_STATE:
			case EventType.CHANGE_OF_VALUE:
			case EventType.FLOATING_LIMIT:
			case EventType.OUT_OF_RANGE:
			case EventType.CHANGE_OF_LIFE_SAFETY:
			case EventType.BUFFER_READY:
			case EventType.UNSIGNED_RANGE:
				break
			default:
				return EventNotifyData.skipOpeningTag(buffer, offset, 12)
		}

		let len = 0
		const openingTag12 = EventNotifyData.decodeOpeningTag(
			buffer,
			offset + len,
			12,
		)
		if (openingTag12 == null) return undefined
		len += openingTag12

		switch (eventData.eventType) {
			case EventType.CHANGE_OF_BITSTRING: {
				const openingTag0 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					0,
				)
				if (openingTag0 == null) return undefined
				len += openingTag0

				const referencedBitstring =
					EventNotifyData.decodeContextBitstring(
						buffer,
						offset + len,
						0,
					)
				if (!referencedBitstring) return undefined
				len += referencedBitstring.len
				eventData.changeOfBitstringReferencedBitString =
					referencedBitstring.value

				const statusFlags = EventNotifyData.decodeContextBitstring(
					buffer,
					offset + len,
					1,
				)
				if (!statusFlags) return undefined
				len += statusFlags.len
				eventData.changeOfBitstringStatusFlags = statusFlags.value

				const closingTag0 = EventNotifyData.decodeClosingTag(
					buffer,
					offset + len,
					0,
				)
				if (closingTag0 == null) return undefined
				len += closingTag0
				break
			}
			case EventType.CHANGE_OF_STATE: {
				const openingTag1 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					1,
				)
				if (openingTag1 == null) return undefined
				len += openingTag1

				const openingTag0 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					0,
				)
				if (openingTag0 == null) return undefined
				len += openingTag0

				const newState = EventNotifyData.decodePropertyState(
					buffer,
					offset + len,
				)
				if (!newState) return undefined
				len += newState.len
				eventData.changeOfStateNewState = newState.value

				const closingTag0 = EventNotifyData.decodeClosingTag(
					buffer,
					offset + len,
					0,
				)
				if (closingTag0 == null) return undefined
				len += closingTag0

				const statusFlags = EventNotifyData.decodeContextBitstring(
					buffer,
					offset + len,
					1,
				)
				if (!statusFlags) return undefined
				len += statusFlags.len
				eventData.changeOfStateStatusFlags = statusFlags.value

				const closingTag1 = EventNotifyData.decodeClosingTag(
					buffer,
					offset + len,
					1,
				)
				if (closingTag1 == null) return undefined
				len += closingTag1
				break
			}
			case EventType.CHANGE_OF_VALUE: {
				const openingTag2 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					2,
				)
				if (openingTag2 == null) return undefined
				len += openingTag2

				const openingTag0 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					0,
				)
				if (openingTag0 == null) return undefined
				len += openingTag0

				const changedBits = EventNotifyData.decodeContextBitstring(
					buffer,
					offset + len,
					0,
				)
				if (changedBits) {
					len += changedBits.len
					eventData.changeOfValueTag = CovType.BIT_STRING
					eventData.changeOfValueChangedBits = changedBits.value
				} else {
					const changeValue = EventNotifyData.decodeContextReal(
						buffer,
						offset + len,
						1,
					)
					if (!changeValue) return undefined
					len += changeValue.len
					eventData.changeOfValueTag = CovType.REAL
					eventData.changeOfValueChangeValue = changeValue.value
				}

				const closingTag0 = EventNotifyData.decodeClosingTag(
					buffer,
					offset + len,
					0,
				)
				if (closingTag0 == null) return undefined
				len += closingTag0

				const statusFlags = EventNotifyData.decodeContextBitstring(
					buffer,
					offset + len,
					1,
				)
				if (!statusFlags) return undefined
				len += statusFlags.len
				eventData.changeOfValueStatusFlags = statusFlags.value

				const closingTag2 = EventNotifyData.decodeClosingTag(
					buffer,
					offset + len,
					2,
				)
				if (closingTag2 == null) return undefined
				len += closingTag2
				break
			}
			case EventType.FLOATING_LIMIT: {
				const openingTag4 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					4,
				)
				if (openingTag4 == null) return undefined
				len += openingTag4

				const referenceValue = EventNotifyData.decodeContextReal(
					buffer,
					offset + len,
					0,
				)
				if (!referenceValue) return undefined
				len += referenceValue.len
				eventData.floatingLimitReferenceValue = referenceValue.value

				const statusFlags = EventNotifyData.decodeContextBitstring(
					buffer,
					offset + len,
					1,
				)
				if (!statusFlags) return undefined
				len += statusFlags.len
				eventData.floatingLimitStatusFlags = statusFlags.value

				const setpointValue = EventNotifyData.decodeContextReal(
					buffer,
					offset + len,
					2,
				)
				if (!setpointValue) return undefined
				len += setpointValue.len
				eventData.floatingLimitSetPointValue = setpointValue.value

				const errorLimit = EventNotifyData.decodeContextReal(
					buffer,
					offset + len,
					3,
				)
				if (!errorLimit) return undefined
				len += errorLimit.len
				eventData.floatingLimitErrorLimit = errorLimit.value

				const closingTag4 = EventNotifyData.decodeClosingTag(
					buffer,
					offset + len,
					4,
				)
				if (closingTag4 == null) return undefined
				len += closingTag4
				break
			}
			case EventType.OUT_OF_RANGE: {
				const openingTag5 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					5,
				)
				if (openingTag5 == null) return undefined
				len += openingTag5

				const exceedingValue = EventNotifyData.decodeContextReal(
					buffer,
					offset + len,
					0,
				)
				if (!exceedingValue) return undefined
				len += exceedingValue.len
				eventData.outOfRangeExceedingValue = exceedingValue.value

				const statusFlags = EventNotifyData.decodeContextBitstring(
					buffer,
					offset + len,
					1,
				)
				if (!statusFlags) return undefined
				len += statusFlags.len
				eventData.outOfRangeStatusFlags = statusFlags.value

				const deadband = EventNotifyData.decodeContextReal(
					buffer,
					offset + len,
					2,
				)
				if (!deadband) return undefined
				len += deadband.len
				eventData.outOfRangeDeadband = deadband.value

				const exceededLimit = EventNotifyData.decodeContextReal(
					buffer,
					offset + len,
					3,
				)
				if (!exceededLimit) return undefined
				len += exceededLimit.len
				eventData.outOfRangeExceededLimit = exceededLimit.value

				const closingTag5 = EventNotifyData.decodeClosingTag(
					buffer,
					offset + len,
					5,
				)
				if (closingTag5 == null) return undefined
				len += closingTag5
				break
			}
			case EventType.CHANGE_OF_LIFE_SAFETY: {
				const openingTag8 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					8,
				)
				if (openingTag8 == null) return undefined
				len += openingTag8

				const newState = EventNotifyData.decodeContextEnumerated(
					buffer,
					offset + len,
					0,
				)
				if (!newState) return undefined
				len += newState.len
				eventData.changeOfLifeSafetyNewState = newState.value

				const newMode = EventNotifyData.decodeContextEnumerated(
					buffer,
					offset + len,
					1,
				)
				if (!newMode) return undefined
				len += newMode.len
				eventData.changeOfLifeSafetyNewMode = newMode.value

				const statusFlags = EventNotifyData.decodeContextBitstring(
					buffer,
					offset + len,
					2,
				)
				if (!statusFlags) return undefined
				len += statusFlags.len
				eventData.changeOfLifeSafetyStatusFlags = statusFlags.value

				const operationExpected =
					EventNotifyData.decodeContextEnumerated(
						buffer,
						offset + len,
						3,
					)
				if (!operationExpected) return undefined
				len += operationExpected.len
				eventData.changeOfLifeSafetyOperationExpected =
					operationExpected.value

				const closingTag8 = EventNotifyData.decodeClosingTag(
					buffer,
					offset + len,
					8,
				)
				if (closingTag8 == null) return undefined
				len += closingTag8
				break
			}
			case EventType.BUFFER_READY: {
				const openingTag10 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					10,
				)
				if (openingTag10 == null) return undefined
				len += openingTag10

				const bufferProperty =
					EventNotifyData.decodeDeviceObjectPropertyRef(
						buffer,
						offset + len,
					)
				if (!bufferProperty) return undefined
				len += bufferProperty.len
				eventData.bufferReadyBufferProperty = bufferProperty.value

				const previousNotification =
					EventNotifyData.decodeContextUnsigned(
						buffer,
						offset + len,
						1,
					)
				if (!previousNotification) return undefined
				len += previousNotification.len
				eventData.bufferReadyPreviousNotification =
					previousNotification.value

				const currentNotification =
					EventNotifyData.decodeContextUnsigned(
						buffer,
						offset + len,
						2,
					)
				if (!currentNotification) return undefined
				len += currentNotification.len
				eventData.bufferReadyCurrentNotification =
					currentNotification.value

				const closingTag10 = EventNotifyData.decodeClosingTag(
					buffer,
					offset + len,
					10,
				)
				if (closingTag10 == null) return undefined
				len += closingTag10
				break
			}
			case EventType.UNSIGNED_RANGE: {
				const openingTag11 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					11,
				)
				if (openingTag11 == null) return undefined
				len += openingTag11

				const exceedingValue = EventNotifyData.decodeContextUnsigned(
					buffer,
					offset + len,
					0,
				)
				if (!exceedingValue) return undefined
				len += exceedingValue.len
				eventData.unsignedRangeExceedingValue = exceedingValue.value

				const statusFlags = EventNotifyData.decodeContextBitstring(
					buffer,
					offset + len,
					1,
				)
				if (!statusFlags) return undefined
				len += statusFlags.len
				eventData.unsignedRangeStatusFlags = statusFlags.value

				const exceededLimit = EventNotifyData.decodeContextUnsigned(
					buffer,
					offset + len,
					2,
				)
				if (!exceededLimit) return undefined
				len += exceededLimit.len
				eventData.unsignedRangeExceededLimit = exceededLimit.value

				const closingTag11 = EventNotifyData.decodeClosingTag(
					buffer,
					offset + len,
					11,
				)
				if (closingTag11 == null) return undefined
				len += closingTag11
				break
			}
		}

		const closingTag12 = EventNotifyData.decodeClosingTag(
			buffer,
			offset + len,
			12,
		)
		if (closingTag12 == null) return undefined
		len += closingTag12

		return len
	}

	/**
	 * EventNotifyData encode parameters as per BACnet standard
	 */

	public static encode(
		buffer: EncodeBuffer,
		data: EventNotifyDataParams,
	): void {
		baAsn1.encodeContextUnsigned(buffer, 0, data.processId)
		baAsn1.encodeContextObjectId(
			buffer,
			1,
			data.initiatingObjectId.type,
			data.initiatingObjectId.instance,
		)
		baAsn1.encodeContextObjectId(
			buffer,
			2,
			data.eventObjectId.type,
			data.eventObjectId.instance,
		)
		baAsn1.bacappEncodeContextTimestamp(buffer, 3, data.timeStamp)
		baAsn1.encodeContextUnsigned(buffer, 4, data.notificationClass)
		baAsn1.encodeContextUnsigned(buffer, 5, data.priority)
		baAsn1.encodeContextEnumerated(buffer, 6, data.eventType)

		if (data.messageText && data.messageText !== '') {
			baAsn1.encodeContextCharacterString(buffer, 7, data.messageText)
		}

		baAsn1.encodeContextEnumerated(buffer, 8, data.notifyType)

		switch (data.notifyType) {
			case NotifyType.ALARM:
			case NotifyType.EVENT:
				baAsn1.encodeContextBoolean(buffer, 9, data.ackRequired)
				baAsn1.encodeContextEnumerated(buffer, 10, data.fromState)
				break
			default:
				break
		}

		baAsn1.encodeContextEnumerated(buffer, 11, data.toState)

		switch (data.notifyType) {
			case NotifyType.ALARM:
			case NotifyType.EVENT:
				baAsn1.encodeOpeningTag(buffer, 12)

				switch (data.eventType) {
					case EventType.CHANGE_OF_BITSTRING:
						baAsn1.encodeOpeningTag(buffer, 0)
						baAsn1.encodeContextBitstring(
							buffer,
							0,
							data.changeOfBitstringReferencedBitString,
						)
						baAsn1.encodeContextBitstring(
							buffer,
							1,
							data.changeOfBitstringStatusFlags,
						)
						baAsn1.encodeClosingTag(buffer, 0)
						break

					case EventType.CHANGE_OF_STATE:
						baAsn1.encodeOpeningTag(buffer, 1)
						baAsn1.encodeOpeningTag(buffer, 0)
						baAsn1.bacappEncodePropertyState(
							buffer,
							data.changeOfStateNewState,
						)
						baAsn1.encodeClosingTag(buffer, 0)
						baAsn1.encodeContextBitstring(
							buffer,
							1,
							data.changeOfStateStatusFlags,
						)
						baAsn1.encodeClosingTag(buffer, 1)
						break

					case EventType.CHANGE_OF_VALUE:
						baAsn1.encodeOpeningTag(buffer, 2)
						baAsn1.encodeOpeningTag(buffer, 0)

						switch (data.changeOfValueTag) {
							case CovType.REAL:
								baAsn1.encodeContextReal(
									buffer,
									1,
									data.changeOfValueChangeValue,
								)
								break
							case CovType.BIT_STRING:
								baAsn1.encodeContextBitstring(
									buffer,
									0,
									data.changeOfValueChangedBits,
								)
								break
							default:
								throw new Error('NotImplemented')
						}

						baAsn1.encodeClosingTag(buffer, 0)
						baAsn1.encodeContextBitstring(
							buffer,
							1,
							data.changeOfValueStatusFlags,
						)
						baAsn1.encodeClosingTag(buffer, 2)
						break

					case EventType.FLOATING_LIMIT:
						baAsn1.encodeOpeningTag(buffer, 4)
						baAsn1.encodeContextReal(
							buffer,
							0,
							data.floatingLimitReferenceValue,
						)
						baAsn1.encodeContextBitstring(
							buffer,
							1,
							data.floatingLimitStatusFlags,
						)
						baAsn1.encodeContextReal(
							buffer,
							2,
							data.floatingLimitSetPointValue,
						)
						baAsn1.encodeContextReal(
							buffer,
							3,
							data.floatingLimitErrorLimit,
						)
						baAsn1.encodeClosingTag(buffer, 4)
						break

					case EventType.OUT_OF_RANGE:
						baAsn1.encodeOpeningTag(buffer, 5)
						baAsn1.encodeContextReal(
							buffer,
							0,
							data.outOfRangeExceedingValue,
						)
						baAsn1.encodeContextBitstring(
							buffer,
							1,
							data.outOfRangeStatusFlags,
						)
						baAsn1.encodeContextReal(
							buffer,
							2,
							data.outOfRangeDeadband,
						)
						baAsn1.encodeContextReal(
							buffer,
							3,
							data.outOfRangeExceededLimit,
						)
						baAsn1.encodeClosingTag(buffer, 5)
						break

					case EventType.CHANGE_OF_LIFE_SAFETY:
						baAsn1.encodeOpeningTag(buffer, 8)
						baAsn1.encodeContextEnumerated(
							buffer,
							0,
							data.changeOfLifeSafetyNewState,
						)
						baAsn1.encodeContextEnumerated(
							buffer,
							1,
							data.changeOfLifeSafetyNewMode,
						)
						baAsn1.encodeContextBitstring(
							buffer,
							2,
							data.changeOfLifeSafetyStatusFlags,
						)
						baAsn1.encodeContextEnumerated(
							buffer,
							3,
							data.changeOfLifeSafetyOperationExpected,
						)
						baAsn1.encodeClosingTag(buffer, 8)
						break

					case EventType.BUFFER_READY:
						baAsn1.encodeOpeningTag(buffer, 10)
						baAsn1.bacappEncodeContextDeviceObjPropertyRef(
							buffer,
							0,
							data.bufferReadyBufferProperty,
						)
						baAsn1.encodeContextUnsigned(
							buffer,
							1,
							data.bufferReadyPreviousNotification,
						)
						baAsn1.encodeContextUnsigned(
							buffer,
							2,
							data.bufferReadyCurrentNotification,
						)
						baAsn1.encodeClosingTag(buffer, 10)
						break

					case EventType.UNSIGNED_RANGE:
						baAsn1.encodeOpeningTag(buffer, 11)
						baAsn1.encodeContextUnsigned(
							buffer,
							0,
							data.unsignedRangeExceedingValue,
						)
						baAsn1.encodeContextBitstring(
							buffer,
							1,
							data.unsignedRangeStatusFlags,
						)
						baAsn1.encodeContextUnsigned(
							buffer,
							2,
							data.unsignedRangeExceededLimit,
						)
						baAsn1.encodeClosingTag(buffer, 11)
						break

					case EventType.EXTENDED:
					case EventType.COMMAND_FAILURE:
						throw new Error('NotImplemented')

					default:
						throw new Error('NotImplemented')
				}

				baAsn1.encodeClosingTag(buffer, 12)
				break

			case NotifyType.ACK_NOTIFICATION:
				throw new Error('NotImplemented')

			default:
				break
		}
	}

	public static decode(
		buffer: Buffer,
		offset: number,
	): EventNotifyDataResult | undefined {
		let len = 0
		let result: any
		let decodedValue: any
		const eventData = {} as EventNotifyDataResult

		if (!baAsn1.decodeIsContextTag(buffer, offset + len, 0))
			return undefined
		result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
		len += result.len
		decodedValue = baAsn1.decodeUnsigned(buffer, offset + len, result.value)
		len += decodedValue.len
		eventData.processId = decodedValue.value

		if (!baAsn1.decodeIsContextTag(buffer, offset + len, 1))
			return undefined
		result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
		len += result.len
		decodedValue = baAsn1.decodeObjectId(buffer, offset + len)
		len += decodedValue.len
		eventData.initiatingObjectId = {
			type: decodedValue.objectType,
			instance: decodedValue.instance,
		}

		if (!baAsn1.decodeIsContextTag(buffer, offset + len, 2))
			return undefined
		result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
		len += result.len
		decodedValue = baAsn1.decodeObjectId(buffer, offset + len)
		len += decodedValue.len
		eventData.eventObjectId = {
			type: decodedValue.objectType,
			instance: decodedValue.instance,
		}

		if (!baAsn1.decodeIsContextTag(buffer, offset + len, 3))
			return undefined
		len += 2
		decodedValue = baAsn1.decodeApplicationDate(buffer, offset + len)
		len += decodedValue.len
		const date = decodedValue.value
		decodedValue = baAsn1.decodeApplicationTime(buffer, offset + len)
		len += decodedValue.len
		const time = decodedValue.value
		eventData.timeStamp = {
			type: TimeStamp.DATETIME,
			value: new Date(
				date.getFullYear(),
				date.getMonth(),
				date.getDate(),
				time.getHours(),
				time.getMinutes(),
				time.getSeconds(),
				time.getMilliseconds(),
			),
		}
		len += 2

		if (!baAsn1.decodeIsContextTag(buffer, offset + len, 4))
			return undefined
		result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
		len += result.len
		decodedValue = baAsn1.decodeUnsigned(buffer, offset + len, result.value)
		len += decodedValue.len
		eventData.notificationClass = decodedValue.value

		if (!baAsn1.decodeIsContextTag(buffer, offset + len, 5))
			return undefined
		result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
		len += result.len
		decodedValue = baAsn1.decodeUnsigned(buffer, offset + len, result.value)
		len += decodedValue.len
		eventData.priority = decodedValue.value
		if (eventData.priority > 0xff) return undefined

		if (!baAsn1.decodeIsContextTag(buffer, offset + len, 6))
			return undefined
		result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
		len += result.len
		decodedValue = baAsn1.decodeEnumerated(
			buffer,
			offset + len,
			result.value,
		)
		len += decodedValue.len
		eventData.eventType = decodedValue.value

		if (baAsn1.decodeIsContextTag(buffer, offset + len, 7)) {
			decodedValue = baAsn1.decodeContextCharacterString(
				buffer,
				offset + len,
				20000,
				7,
			)
			len += decodedValue.len
			eventData.messageText = decodedValue.value
		}

		if (!baAsn1.decodeIsContextTag(buffer, offset + len, 8))
			return undefined
		result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
		len += result.len
		decodedValue = baAsn1.decodeEnumerated(
			buffer,
			offset + len,
			result.value,
		)
		len += decodedValue.len
		eventData.notifyType = decodedValue.value

		switch (eventData.notifyType) {
			case NotifyType.ALARM:
			case NotifyType.EVENT:
				decodedValue = EventNotifyData.decodeContextBoolean(
					buffer,
					offset + len,
					9,
				)
				if (!decodedValue) return undefined
				len += decodedValue.len
				eventData.ackRequired = decodedValue.value

				decodedValue = EventNotifyData.decodeContextEnumerated(
					buffer,
					offset + len,
					10,
				)
				if (!decodedValue) return undefined
				len += decodedValue.len
				eventData.fromState = decodedValue.value
				break

			default:
				break
		}

		if (!baAsn1.decodeIsContextTag(buffer, offset + len, 11))
			return undefined
		result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
		len += result.len
		decodedValue = baAsn1.decodeEnumerated(
			buffer,
			offset + len,
			result.value,
		)
		len += decodedValue.len
		eventData.toState = decodedValue.value

		if (
			eventData.notifyType === NotifyType.ALARM ||
			eventData.notifyType === NotifyType.EVENT
		) {
			const eventValuesLen = EventNotifyData.decodeEventValues(
				buffer,
				offset + len,
				eventData,
			)
			if (eventValuesLen == null) return undefined
			len += eventValuesLen
		}

		eventData.len = len
		return eventData
	}
}
