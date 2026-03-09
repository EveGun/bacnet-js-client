import * as baAsn1 from '../asn1'
import {
	ASN1_ARRAY_ALL,
	ApplicationTag,
	CovType,
	EventType,
	NotifyType,
	PropertyStates,
	TimeStamp,
} from '../enum'
import {
	BACNetAppData,
	BACNetAuthenticationFactor,
	BACNetDeviceObjectReference,
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

	private static decodeContextNumeric(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
		decodeFn: (buf: Buffer, off: number, len: number) => { len: number; value: number },
	): { len: number; value: number } | undefined {
		if (!baAsn1.decodeIsContextTag(buffer, offset, tagNumber))
			return undefined
		const result = baAsn1.decodeTagNumberAndValue(buffer, offset)
		const decodedValue = decodeFn(buffer, offset + result.len, result.value)
		return {
			len: result.len + decodedValue.len,
			value: decodedValue.value,
		}
	}

	private static decodeContextUnsigned(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): { len: number; value: number } | undefined {
		return EventNotifyData.decodeContextNumeric(buffer, offset, tagNumber, baAsn1.decodeUnsigned)
	}

	private static decodeContextEnumerated(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): { len: number; value: number } | undefined {
		return EventNotifyData.decodeContextNumeric(buffer, offset, tagNumber, baAsn1.decodeEnumerated)
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

	private static decodeContextDouble(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): { len: number; value: number } | undefined {
		if (!baAsn1.decodeIsContextTag(buffer, offset, tagNumber))
			return undefined
		const result = baAsn1.decodeTagNumberAndValue(buffer, offset)
		if (result.value !== 8) return undefined
		if (offset + result.len + result.value > buffer.length) return undefined
		return {
			len: result.len + result.value,
			value: buffer.readDoubleBE(offset + result.len),
		}
	}

	private static decodeContextSigned(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): { len: number; value: number } | undefined {
		if (!baAsn1.decodeIsContextTag(buffer, offset, tagNumber))
			return undefined
		const result = baAsn1.decodeTagNumberAndValue(buffer, offset)
		if (result.value < 1 || result.value > 6) return undefined
		if (offset + result.len + result.value > buffer.length) return undefined
		const decodedValue = baAsn1.decodeSigned(
			buffer,
			offset + result.len,
			result.value,
		)
		return {
			len: result.len + decodedValue.len,
			value: decodedValue.value,
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

	private static decodeContextCharacterString(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): { len: number; value: string } | undefined {
		const decodedValue = baAsn1.decodeContextCharacterString(
			buffer,
			offset,
			20000,
			tagNumber,
		)
		if (!decodedValue) return undefined
		return {
			len: decodedValue.len,
			value: decodedValue.value,
		}
	}

	private static toAppData(
		value: Pick<BACNetAppData, 'type' | 'value' | 'encoding'>,
	): BACNetAppData {
		return {
			type: value.type,
			value: value.value,
			encoding: value.encoding,
		}
	}

	private static decodeContextDateTime(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): { len: number; value: Date } | undefined {
		let len = 0
		const openingTag = EventNotifyData.decodeOpeningTag(
			buffer,
			offset + len,
			tagNumber,
		)
		if (openingTag == null) return undefined
		len += openingTag

		const rawDate = baAsn1.decodeApplicationDate(buffer, offset + len)
		if (!rawDate) return undefined
		len += rawDate.len

		const rawTime = baAsn1.decodeApplicationTime(buffer, offset + len)
		if (!rawTime) return undefined
		len += rawTime.len

		const closingTag = EventNotifyData.decodeClosingTag(
			buffer,
			offset + len,
			tagNumber,
		)
		if (closingTag == null) return undefined
		len += closingTag

		const date = rawDate.value
		const time = rawTime.value
		return {
			len,
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
	}

	private static decodeTimeStampChoice(
		buffer: Buffer,
		offset: number,
	):
		| {
				len: number
				value: EventNotifyDataParams['timeStamp']
		  }
		| undefined {
		if (baAsn1.decodeIsContextTag(buffer, offset, TimeStamp.TIME)) {
			const tagValue = baAsn1.decodeTagNumberAndValue(buffer, offset)
			if (tagValue.value !== 4) return undefined
			if (offset + tagValue.len + tagValue.value > buffer.length)
				return undefined
			const decodedValue = baAsn1.decodeBacnetTime(
				buffer,
				offset + tagValue.len,
			)
			return {
				len: tagValue.len + decodedValue.len,
				value: {
					type: TimeStamp.TIME,
					value: decodedValue.value,
				},
			}
		}

		if (
			baAsn1.decodeIsContextTag(buffer, offset, TimeStamp.SEQUENCE_NUMBER)
		) {
			const decodedValue = EventNotifyData.decodeContextUnsigned(
				buffer,
				offset,
				TimeStamp.SEQUENCE_NUMBER,
			)
			if (!decodedValue) return undefined
			return {
				len: decodedValue.len,
				value: {
					type: TimeStamp.SEQUENCE_NUMBER,
					value: decodedValue.value,
				},
			}
		}

		const decodedValue = EventNotifyData.decodeContextDateTime(
			buffer,
			offset,
			TimeStamp.DATETIME,
		)
		if (!decodedValue) return undefined
		return {
			len: decodedValue.len,
			value: {
				type: TimeStamp.DATETIME,
				value: decodedValue.value,
			},
		}
	}

	private static decodeContextTimeStamp(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	):
		| {
				len: number
				value: EventNotifyDataParams['timeStamp']
		  }
		| undefined {
		let len = 0
		const openingTag = EventNotifyData.decodeOpeningTag(
			buffer,
			offset + len,
			tagNumber,
		)
		if (openingTag == null) return undefined
		len += openingTag

		const timeStamp = EventNotifyData.decodeTimeStampChoice(
			buffer,
			offset + len,
		)
		if (!timeStamp) return undefined
		len += timeStamp.len

		const closingTag = EventNotifyData.decodeClosingTag(
			buffer,
			offset + len,
			tagNumber,
		)
		if (closingTag == null) return undefined
		len += closingTag

		return {
			len,
			value: timeStamp.value,
		}
	}

	private static decodeContextRawValue(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): { len: number; value: Buffer } | undefined {
		const openingTag = EventNotifyData.decodeOpeningTag(
			buffer,
			offset,
			tagNumber,
		)
		if (openingTag != null) {
			const totalLen = EventNotifyData.skipOpeningTag(
				buffer,
				offset,
				tagNumber,
			)
			if (totalLen == null) return undefined
			return {
				len: totalLen,
				value: buffer.subarray(offset, offset + totalLen),
			}
		}

		if (!baAsn1.decodeIsContextTag(buffer, offset, tagNumber))
			return undefined
		const result = baAsn1.decodeTagNumberAndValue(buffer, offset)
		if (offset + result.len + result.value > buffer.length) return undefined
		return {
			len: result.len + result.value,
			value: buffer.subarray(offset, offset + result.len + result.value),
		}
	}

	private static decodeContextOctetString(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): { len: number; value: Buffer } | undefined {
		if (!baAsn1.decodeIsContextTag(buffer, offset, tagNumber))
			return undefined
		const result = baAsn1.decodeTagNumberAndValue(buffer, offset)
		if (offset + result.len + result.value > buffer.length) return undefined
		return {
			len: result.len + result.value,
			value: buffer.subarray(
				offset + result.len,
				offset + result.len + result.value,
			),
		}
	}

	private static decodeContextUnknownValue(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	):
		| {
				len: number
				raw: Buffer
				decoded?: BACNetAppData
		  }
		| undefined {
		const rawValue = EventNotifyData.decodeContextRawValue(
			buffer,
			offset,
			tagNumber,
		)
		if (!rawValue) return undefined

		const decodedValue = baAsn1.bacappDecodeApplicationData(
			buffer,
			offset,
			offset + rawValue.len,
			0,
			0,
		)
		if (decodedValue && decodedValue.len === rawValue.len) {
			return {
				len: rawValue.len,
				raw: rawValue.value,
				decoded: EventNotifyData.toAppData(decodedValue),
			}
		}

		return {
			len: rawValue.len,
			raw: rawValue.value,
		}
	}

	private static decodeDeviceObjectReference(
		buffer: Buffer,
		offset: number,
	):
		| {
				len: number
				value: BACNetDeviceObjectReference
		  }
		| undefined {
		let len = 0
		const value = {} as BACNetDeviceObjectReference

		const deviceIdentifier = EventNotifyData.decodeContextObjectId(
			buffer,
			offset + len,
			0,
		)
		if (deviceIdentifier) {
			len += deviceIdentifier.len
			value.deviceIdentifier = deviceIdentifier.value
		}

		const objectIdentifier = EventNotifyData.decodeContextObjectId(
			buffer,
			offset + len,
			1,
		)
		if (!objectIdentifier) return undefined
		len += objectIdentifier.len
		value.objectIdentifier = objectIdentifier.value

		return {
			len,
			value,
		}
	}

	private static decodeContextDeviceObjectReference(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	):
		| {
				len: number
				value: BACNetDeviceObjectReference
		  }
		| undefined {
		let len = 0
		const openingTag = EventNotifyData.decodeOpeningTag(
			buffer,
			offset + len,
			tagNumber,
		)
		if (openingTag == null) return undefined
		len += openingTag

		const reference = EventNotifyData.decodeDeviceObjectReference(
			buffer,
			offset + len,
		)
		if (!reference) return undefined
		len += reference.len

		const closingTag = EventNotifyData.decodeClosingTag(
			buffer,
			offset + len,
			tagNumber,
		)
		if (closingTag == null) return undefined
		len += closingTag

		return {
			len,
			value: reference.value,
		}
	}

	private static decodeAuthenticationFactor(
		buffer: Buffer,
		offset: number,
	):
		| {
				len: number
				value: BACNetAuthenticationFactor
		  }
		| undefined {
		let len = 0
		const formatType = EventNotifyData.decodeContextEnumerated(
			buffer,
			offset + len,
			0,
		)
		if (!formatType) return undefined
		len += formatType.len

		const formatClass = EventNotifyData.decodeContextUnsigned(
			buffer,
			offset + len,
			1,
		)
		if (!formatClass) return undefined
		len += formatClass.len

		const value = EventNotifyData.decodeContextOctetString(
			buffer,
			offset + len,
			2,
		)
		if (!value) return undefined
		len += value.len

		return {
			len,
			value: {
				formatType: formatType.value,
				formatClass: formatClass.value,
				value: value.value,
			},
		}
	}

	private static decodeContextAuthenticationFactor(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	):
		| {
				len: number
				value: BACNetAuthenticationFactor
		  }
		| undefined {
		let len = 0
		const openingTag = EventNotifyData.decodeOpeningTag(
			buffer,
			offset + len,
			tagNumber,
		)
		if (openingTag == null) return undefined
		len += openingTag

		const factor = EventNotifyData.decodeAuthenticationFactor(
			buffer,
			offset + len,
		)
		if (!factor) return undefined
		len += factor.len

		const closingTag = EventNotifyData.decodeClosingTag(
			buffer,
			offset + len,
			tagNumber,
		)
		if (closingTag == null) return undefined
		len += closingTag

		return {
			len,
			value: factor.value,
		}
	}

	private static decodeDiscreteValueChoice(
		buffer: Buffer,
		offset: number,
	): { len: number; value: BACNetAppData } | undefined {
		const dateTime = EventNotifyData.decodeContextDateTime(
			buffer,
			offset,
			0,
		)
		if (dateTime) {
			return {
				len: dateTime.len,
				value: {
					type: ApplicationTag.DATETIME,
					value: dateTime.value,
				},
			}
		}

		const decodedValue = baAsn1.bacappDecodeApplicationData(
			buffer,
			offset,
			buffer.length,
			0,
			0,
		)
		if (!decodedValue) return undefined
		return {
			len: decodedValue.len,
			value: EventNotifyData.toAppData(decodedValue),
		}
	}

	private static encodeRawValue(
		buffer: EncodeBuffer,
		rawValue: Buffer,
	): void {
		buffer.offset += rawValue.copy(buffer.buffer, buffer.offset)
	}

	private static encodeContextDouble(
		buffer: EncodeBuffer,
		tagNumber: number,
		value: number,
	): void {
		baAsn1.encodeTag(buffer, tagNumber, true, 8)
		buffer.buffer.writeDoubleBE(value, buffer.offset)
		buffer.offset += 8
	}

	private static encodeContextDateTime(
		buffer: EncodeBuffer,
		tagNumber: number,
		value: Date,
	): void {
		baAsn1.encodeOpeningTag(buffer, tagNumber)
		baAsn1.encodeApplicationDate(buffer, value)
		baAsn1.encodeApplicationTime(buffer, value)
		baAsn1.encodeClosingTag(buffer, tagNumber)
	}

	private static encodeContextOctetString(
		buffer: EncodeBuffer,
		tagNumber: number,
		value: Buffer,
	): void {
		baAsn1.encodeTag(buffer, tagNumber, true, value.length)
		buffer.offset += value.copy(buffer.buffer, buffer.offset)
	}

	private static encodeContextUnknownValue(
		buffer: EncodeBuffer,
		tagNumber: number,
		rawValue?: Buffer,
		decodedValue?: BACNetAppData,
	): void {
		if (rawValue) {
			EventNotifyData.encodeRawValue(buffer, rawValue)
			return
		}

		if (decodedValue) {
			baAsn1.encodeOpeningTag(buffer, tagNumber)
			baAsn1.bacappEncodeApplicationData(buffer, decodedValue)
			baAsn1.encodeClosingTag(buffer, tagNumber)
			return
		}

		throw new Error(`Missing value for context tag ${tagNumber}`)
	}

	private static encodeContextDeviceObjectReference(
		buffer: EncodeBuffer,
		tagNumber: number,
		value: BACNetDeviceObjectReference,
	): void {
		baAsn1.encodeOpeningTag(buffer, tagNumber)
		if (value.deviceIdentifier) {
			baAsn1.encodeContextObjectId(
				buffer,
				0,
				value.deviceIdentifier.type,
				value.deviceIdentifier.instance,
			)
		}
		baAsn1.encodeContextObjectId(
			buffer,
			1,
			value.objectIdentifier.type,
			value.objectIdentifier.instance,
		)
		baAsn1.encodeClosingTag(buffer, tagNumber)
	}

	private static encodeContextAuthenticationFactor(
		buffer: EncodeBuffer,
		tagNumber: number,
		value: BACNetAuthenticationFactor,
	): void {
		baAsn1.encodeOpeningTag(buffer, tagNumber)
		baAsn1.encodeContextEnumerated(buffer, 0, value.formatType)
		baAsn1.encodeContextUnsigned(buffer, 1, value.formatClass)
		EventNotifyData.encodeContextOctetString(buffer, 2, value.value)
		baAsn1.encodeClosingTag(buffer, tagNumber)
	}

	private static encodeOutOfRangePattern(
		buffer: EncodeBuffer,
		outerTag: number,
		exceedingValue: number,
		statusFlags: EventNotifyDataParams['changeOfBitstringStatusFlags'],
		deadband: number,
		exceededLimit: number,
		encodeValue: (buf: EncodeBuffer, tag: number, val: number) => void,
		encodeDeadband: (buf: EncodeBuffer, tag: number, val: number) => void,
	): void {
		baAsn1.encodeOpeningTag(buffer, outerTag)
		encodeValue(buffer, 0, exceedingValue)
		baAsn1.encodeContextBitstring(buffer, 1, statusFlags)
		encodeDeadband(buffer, 2, deadband)
		encodeValue(buffer, 3, exceededLimit)
		baAsn1.encodeClosingTag(buffer, outerTag)
	}

	private static encodeDiscreteValueChoice(
		buffer: EncodeBuffer,
		value: BACNetAppData,
	): void {
		if (value.type === ApplicationTag.DATETIME) {
			EventNotifyData.encodeContextDateTime(
				buffer,
				0,
				value.value as Date,
			)
			return
		}
		baAsn1.bacappEncodeApplicationData(buffer, value)
	}

	private static isSet<T>(value: T | null | undefined): value is T {
		return value !== undefined && value !== null
	}

	private static hasTypedEventValues(data: EventNotifyDataParams): boolean {
		switch (data.eventType) {
			case EventType.CHANGE_OF_BITSTRING:
				return (
					EventNotifyData.isSet(
						data.changeOfBitstringReferencedBitString,
					) &&
					EventNotifyData.isSet(data.changeOfBitstringStatusFlags)
				)
			case EventType.CHANGE_OF_STATE:
				return (
					EventNotifyData.isSet(data.changeOfStateNewState) &&
					EventNotifyData.isSet(data.changeOfStateStatusFlags)
				)
			case EventType.CHANGE_OF_VALUE:
				return (
					EventNotifyData.isSet(data.changeOfValueTag) &&
					EventNotifyData.isSet(data.changeOfValueStatusFlags) &&
					((data.changeOfValueTag === CovType.REAL &&
						EventNotifyData.isSet(data.changeOfValueChangeValue)) ||
						(data.changeOfValueTag === CovType.BIT_STRING &&
							EventNotifyData.isSet(
								data.changeOfValueChangedBits,
							)))
				)
			case EventType.COMMAND_FAILURE:
				return (
					(EventNotifyData.isSet(data.commandFailureCommandValue) ||
						EventNotifyData.isSet(
							data.commandFailureCommandValueDecoded,
						)) &&
					EventNotifyData.isSet(data.commandFailureStatusFlags) &&
					(EventNotifyData.isSet(data.commandFailureFeedbackValue) ||
						EventNotifyData.isSet(
							data.commandFailureFeedbackValueDecoded,
						))
				)
			case EventType.FLOATING_LIMIT:
				return (
					EventNotifyData.isSet(data.floatingLimitReferenceValue) &&
					EventNotifyData.isSet(data.floatingLimitStatusFlags) &&
					EventNotifyData.isSet(data.floatingLimitSetPointValue) &&
					EventNotifyData.isSet(data.floatingLimitErrorLimit)
				)
			case EventType.OUT_OF_RANGE:
				return (
					EventNotifyData.isSet(data.outOfRangeExceedingValue) &&
					EventNotifyData.isSet(data.outOfRangeStatusFlags) &&
					EventNotifyData.isSet(data.outOfRangeDeadband) &&
					EventNotifyData.isSet(data.outOfRangeExceededLimit)
				)
			case EventType.CHANGE_OF_LIFE_SAFETY:
				return (
					EventNotifyData.isSet(data.changeOfLifeSafetyNewState) &&
					EventNotifyData.isSet(data.changeOfLifeSafetyNewMode) &&
					EventNotifyData.isSet(data.changeOfLifeSafetyStatusFlags) &&
					EventNotifyData.isSet(
						data.changeOfLifeSafetyOperationExpected,
					)
				)
			case EventType.BUFFER_READY:
				return (
					EventNotifyData.isSet(data.bufferReadyBufferProperty) &&
					EventNotifyData.isSet(
						data.bufferReadyPreviousNotification,
					) &&
					EventNotifyData.isSet(data.bufferReadyCurrentNotification)
				)
			case EventType.UNSIGNED_RANGE:
				return (
					EventNotifyData.isSet(data.unsignedRangeExceedingValue) &&
					EventNotifyData.isSet(data.unsignedRangeStatusFlags) &&
					EventNotifyData.isSet(data.unsignedRangeExceededLimit)
				)
			case EventType.ACCESS_EVENT:
				return (
					EventNotifyData.isSet(data.accessEventAccessEvent) &&
					EventNotifyData.isSet(data.accessEventStatusFlags) &&
					EventNotifyData.isSet(data.accessEventTag) &&
					EventNotifyData.isSet(data.accessEventTime) &&
					EventNotifyData.isSet(data.accessEventAccessCredential)
				)
			case EventType.DOUBLE_OUT_OF_RANGE:
				return (
					EventNotifyData.isSet(
						data.doubleOutOfRangeExceedingValue,
					) &&
					EventNotifyData.isSet(data.doubleOutOfRangeStatusFlags) &&
					EventNotifyData.isSet(data.doubleOutOfRangeDeadband) &&
					EventNotifyData.isSet(data.doubleOutOfRangeExceededLimit)
				)
			case EventType.SIGNED_OUT_OF_RANGE:
				return (
					EventNotifyData.isSet(
						data.signedOutOfRangeExceedingValue,
					) &&
					EventNotifyData.isSet(data.signedOutOfRangeStatusFlags) &&
					EventNotifyData.isSet(data.signedOutOfRangeDeadband) &&
					EventNotifyData.isSet(data.signedOutOfRangeExceededLimit)
				)
			case EventType.UNSIGNED_OUT_OF_RANGE:
				return (
					EventNotifyData.isSet(
						data.unsignedOutOfRangeExceedingValue,
					) &&
					EventNotifyData.isSet(data.unsignedOutOfRangeStatusFlags) &&
					EventNotifyData.isSet(data.unsignedOutOfRangeDeadband) &&
					EventNotifyData.isSet(data.unsignedOutOfRangeExceededLimit)
				)
			case EventType.CHANGE_OF_CHARACTERSTRING:
				return (
					EventNotifyData.isSet(
						data.changeOfCharacterStringChangedValue,
					) &&
					EventNotifyData.isSet(
						data.changeOfCharacterStringStatusFlags,
					) &&
					EventNotifyData.isSet(
						data.changeOfCharacterStringAlarmValue,
					)
				)
			case EventType.CHANGE_OF_STATUS_FLAGS:
				return EventNotifyData.isSet(
					data.changeOfStatusFlagsReferencedFlags,
				)
			case EventType.CHANGE_OF_RELIABILITY:
				return (
					EventNotifyData.isSet(
						data.changeOfReliabilityReliability,
					) &&
					EventNotifyData.isSet(
						data.changeOfReliabilityStatusFlags,
					) &&
					(EventNotifyData.isSet(
						data.changeOfReliabilityPropertyValues,
					) ||
						EventNotifyData.isSet(
							data.changeOfReliabilityPropertyValuesDecoded,
						))
				)
			case EventType.CHANGE_OF_DISCRETE_VALUE:
				return (
					EventNotifyData.isSet(data.changeOfDiscreteValueNewValue) &&
					EventNotifyData.isSet(data.changeOfDiscreteValueStatusFlags)
				)
			case EventType.CHANGE_OF_TIMER:
				return (
					EventNotifyData.isSet(data.changeOfTimerNewState) &&
					EventNotifyData.isSet(data.changeOfTimerStatusFlags) &&
					EventNotifyData.isSet(data.changeOfTimerUpdateTime)
				)
			default:
				return false
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

	private static walkNestedTags(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): { totalLen: number; openingTagLen: number } | undefined {
		const openingTagLen = EventNotifyData.decodeOpeningTag(buffer, offset, tagNumber)
		if (openingTagLen == null) return undefined
		let len = openingTagLen
		let depth = 1
		while (offset + len < buffer.length) {
			const result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
			const isOpening = baAsn1.decodeIsOpeningTag(buffer, offset + len)
			const isClosing = baAsn1.decodeIsClosingTag(buffer, offset + len)
			len += result.len
			if (isClosing) {
				if (--depth === 0) return { totalLen: len, openingTagLen }
				continue
			}
			if (isOpening) {
				depth += 1
				continue
			}
			len += result.value
		}
		return undefined
	}

	private static skipOpeningTag(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): number | undefined {
		return EventNotifyData.walkNestedTags(buffer, offset, tagNumber)?.totalLen
	}

	private static decodeRawOpeningTagValue(
		buffer: Buffer,
		offset: number,
		tagNumber: number,
	): { len: number; raw: Buffer } | undefined {
		const walked = EventNotifyData.walkNestedTags(buffer, offset, tagNumber)
		if (!walked) return undefined
		const { totalLen, openingTagLen } = walked
		const closingTagLen = baAsn1.decodeTagNumberAndValue(buffer, offset + totalLen - 1).len
		return {
			len: totalLen,
			raw: Buffer.from(buffer.subarray(offset + openingTagLen, offset + totalLen - closingTagLen)),
		}
	}

	private static decodeOutOfRangePattern(
		buffer: Buffer,
		offset: number,
		outerTag: number,
		decodeValue: (buf: Buffer, off: number, tag: number) => { len: number; value: number } | undefined,
		decodeDeadband: (buf: Buffer, off: number, tag: number) => { len: number; value: number } | undefined,
	): { len: number; exceedingValue: number; statusFlags: EventNotifyDataParams['changeOfBitstringStatusFlags']; deadband: number; exceededLimit: number } | undefined {
		let len = 0
		const openingTag = EventNotifyData.decodeOpeningTag(buffer, offset + len, outerTag)
		if (openingTag == null) return undefined
		len += openingTag

		const exceedingValue = decodeValue(buffer, offset + len, 0)
		if (!exceedingValue) return undefined
		len += exceedingValue.len

		const statusFlags = EventNotifyData.decodeContextBitstring(buffer, offset + len, 1)
		if (!statusFlags) return undefined
		len += statusFlags.len

		const deadband = decodeDeadband(buffer, offset + len, 2)
		if (!deadband) return undefined
		len += deadband.len

		const exceededLimit = decodeValue(buffer, offset + len, 3)
		if (!exceededLimit) return undefined
		len += exceededLimit.len

		const closingTag = EventNotifyData.decodeClosingTag(buffer, offset + len, outerTag)
		if (closingTag == null) return undefined
		len += closingTag

		return {
			len,
			exceedingValue: exceedingValue.value,
			statusFlags: statusFlags.value,
			deadband: deadband.value,
			exceededLimit: exceededLimit.value,
		}
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
			case EventType.COMMAND_FAILURE:
			case EventType.FLOATING_LIMIT:
			case EventType.OUT_OF_RANGE:
			case EventType.CHANGE_OF_LIFE_SAFETY:
			case EventType.BUFFER_READY:
			case EventType.UNSIGNED_RANGE:
			case EventType.ACCESS_EVENT:
			case EventType.DOUBLE_OUT_OF_RANGE:
			case EventType.SIGNED_OUT_OF_RANGE:
			case EventType.UNSIGNED_OUT_OF_RANGE:
			case EventType.CHANGE_OF_CHARACTERSTRING:
			case EventType.CHANGE_OF_STATUS_FLAGS:
			case EventType.CHANGE_OF_RELIABILITY:
			case EventType.CHANGE_OF_DISCRETE_VALUE:
			case EventType.CHANGE_OF_TIMER:
				break
			case EventType.EXTENDED:
			default: {
				const rawValues = EventNotifyData.decodeRawOpeningTagValue(
					buffer,
					offset,
					12,
				)
				if (!rawValues) return undefined
				eventData.eventValuesRaw = rawValues.raw
				return rawValues.len
			}
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
			case EventType.COMMAND_FAILURE: {
				const openingTag3 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					3,
				)
				if (openingTag3 == null) return undefined
				len += openingTag3

				const commandValue = EventNotifyData.decodeContextUnknownValue(
					buffer,
					offset + len,
					0,
				)
				if (!commandValue) return undefined
				len += commandValue.len
				eventData.commandFailureCommandValue = commandValue.raw
				if (commandValue.decoded) {
					eventData.commandFailureCommandValueDecoded =
						commandValue.decoded
				}

				const statusFlags = EventNotifyData.decodeContextBitstring(
					buffer,
					offset + len,
					1,
				)
				if (!statusFlags) return undefined
				len += statusFlags.len
				eventData.commandFailureStatusFlags = statusFlags.value

				const feedbackValue = EventNotifyData.decodeContextUnknownValue(
					buffer,
					offset + len,
					2,
				)
				if (!feedbackValue) return undefined
				len += feedbackValue.len
				eventData.commandFailureFeedbackValue = feedbackValue.raw
				if (feedbackValue.decoded) {
					eventData.commandFailureFeedbackValueDecoded =
						feedbackValue.decoded
				}

				const closingTag3 = EventNotifyData.decodeClosingTag(
					buffer,
					offset + len,
					3,
				)
				if (closingTag3 == null) return undefined
				len += closingTag3
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
				const oor = EventNotifyData.decodeOutOfRangePattern(
					buffer, offset + len, 5,
					EventNotifyData.decodeContextReal.bind(EventNotifyData),
					EventNotifyData.decodeContextReal.bind(EventNotifyData),
				)
				if (!oor) return undefined
				len += oor.len
				eventData.outOfRangeExceedingValue = oor.exceedingValue
				eventData.outOfRangeStatusFlags = oor.statusFlags
				eventData.outOfRangeDeadband = oor.deadband
				eventData.outOfRangeExceededLimit = oor.exceededLimit
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
			case EventType.ACCESS_EVENT: {
				const openingTag13 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					13,
				)
				if (openingTag13 == null) return undefined
				len += openingTag13

				const accessEvent = EventNotifyData.decodeContextEnumerated(
					buffer,
					offset + len,
					0,
				)
				if (!accessEvent) return undefined
				len += accessEvent.len
				eventData.accessEventAccessEvent = accessEvent.value

				const statusFlags = EventNotifyData.decodeContextBitstring(
					buffer,
					offset + len,
					1,
				)
				if (!statusFlags) return undefined
				len += statusFlags.len
				eventData.accessEventStatusFlags = statusFlags.value

				const accessEventTag = EventNotifyData.decodeContextUnsigned(
					buffer,
					offset + len,
					2,
				)
				if (!accessEventTag) return undefined
				len += accessEventTag.len
				eventData.accessEventTag = accessEventTag.value

				const accessEventTime = EventNotifyData.decodeContextTimeStamp(
					buffer,
					offset + len,
					3,
				)
				if (!accessEventTime) return undefined
				len += accessEventTime.len
				eventData.accessEventTime = accessEventTime.value

				const accessCredential =
					EventNotifyData.decodeContextDeviceObjectReference(
						buffer,
						offset + len,
						4,
					)
				if (!accessCredential) return undefined
				len += accessCredential.len
				eventData.accessEventAccessCredential = accessCredential.value

				const authenticationFactor =
					EventNotifyData.decodeContextAuthenticationFactor(
						buffer,
						offset + len,
						5,
					)
				if (authenticationFactor) {
					len += authenticationFactor.len
					eventData.accessEventAuthenticationFactor =
						authenticationFactor.value
				}

				const closingTag13 = EventNotifyData.decodeClosingTag(
					buffer,
					offset + len,
					13,
				)
				if (closingTag13 == null) return undefined
				len += closingTag13
				break
			}
			case EventType.DOUBLE_OUT_OF_RANGE: {
				const oor = EventNotifyData.decodeOutOfRangePattern(
					buffer, offset + len, 14,
					EventNotifyData.decodeContextDouble.bind(EventNotifyData),
					EventNotifyData.decodeContextDouble.bind(EventNotifyData),
				)
				if (!oor) return undefined
				len += oor.len
				eventData.doubleOutOfRangeExceedingValue = oor.exceedingValue
				eventData.doubleOutOfRangeStatusFlags = oor.statusFlags
				eventData.doubleOutOfRangeDeadband = oor.deadband
				eventData.doubleOutOfRangeExceededLimit = oor.exceededLimit
				break
			}
			case EventType.SIGNED_OUT_OF_RANGE: {
				const oor = EventNotifyData.decodeOutOfRangePattern(
					buffer, offset + len, 15,
					EventNotifyData.decodeContextSigned.bind(EventNotifyData),
					EventNotifyData.decodeContextUnsigned.bind(EventNotifyData),
				)
				if (!oor) return undefined
				len += oor.len
				eventData.signedOutOfRangeExceedingValue = oor.exceedingValue
				eventData.signedOutOfRangeStatusFlags = oor.statusFlags
				eventData.signedOutOfRangeDeadband = oor.deadband
				eventData.signedOutOfRangeExceededLimit = oor.exceededLimit
				break
			}
			case EventType.UNSIGNED_OUT_OF_RANGE: {
				const oor = EventNotifyData.decodeOutOfRangePattern(
					buffer, offset + len, 16,
					EventNotifyData.decodeContextUnsigned.bind(EventNotifyData),
					EventNotifyData.decodeContextUnsigned.bind(EventNotifyData),
				)
				if (!oor) return undefined
				len += oor.len
				eventData.unsignedOutOfRangeExceedingValue = oor.exceedingValue
				eventData.unsignedOutOfRangeStatusFlags = oor.statusFlags
				eventData.unsignedOutOfRangeDeadband = oor.deadband
				eventData.unsignedOutOfRangeExceededLimit = oor.exceededLimit
				break
			}
			case EventType.CHANGE_OF_CHARACTERSTRING: {
				const openingTag17 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					17,
				)
				if (openingTag17 == null) return undefined
				len += openingTag17

				const changedValue =
					EventNotifyData.decodeContextCharacterString(
						buffer,
						offset + len,
						0,
					)
				if (!changedValue) return undefined
				len += changedValue.len
				eventData.changeOfCharacterStringChangedValue =
					changedValue.value

				const statusFlags = EventNotifyData.decodeContextBitstring(
					buffer,
					offset + len,
					1,
				)
				if (!statusFlags) return undefined
				len += statusFlags.len
				eventData.changeOfCharacterStringStatusFlags = statusFlags.value

				const alarmValue = EventNotifyData.decodeContextCharacterString(
					buffer,
					offset + len,
					2,
				)
				if (!alarmValue) return undefined
				len += alarmValue.len
				eventData.changeOfCharacterStringAlarmValue = alarmValue.value

				const closingTag17 = EventNotifyData.decodeClosingTag(
					buffer,
					offset + len,
					17,
				)
				if (closingTag17 == null) return undefined
				len += closingTag17
				break
			}
			case EventType.CHANGE_OF_STATUS_FLAGS: {
				const openingTag18 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					18,
				)
				if (openingTag18 == null) return undefined
				len += openingTag18

				const presentValue = EventNotifyData.decodeContextUnknownValue(
					buffer,
					offset + len,
					0,
				)
				if (presentValue) {
					len += presentValue.len
					eventData.changeOfStatusFlagsPresentValue = presentValue.raw
					if (presentValue.decoded) {
						eventData.changeOfStatusFlagsPresentValueDecoded =
							presentValue.decoded
					}
				}

				const referencedFlags = EventNotifyData.decodeContextBitstring(
					buffer,
					offset + len,
					1,
				)
				if (!referencedFlags) return undefined
				len += referencedFlags.len
				eventData.changeOfStatusFlagsReferencedFlags =
					referencedFlags.value

				const closingTag18 = EventNotifyData.decodeClosingTag(
					buffer,
					offset + len,
					18,
				)
				if (closingTag18 == null) return undefined
				len += closingTag18
				break
			}
			case EventType.CHANGE_OF_RELIABILITY: {
				const openingTag19 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					19,
				)
				if (openingTag19 == null) return undefined
				len += openingTag19

				const reliability = EventNotifyData.decodeContextEnumerated(
					buffer,
					offset + len,
					0,
				)
				if (!reliability) return undefined
				len += reliability.len
				eventData.changeOfReliabilityReliability = reliability.value

				const statusFlags = EventNotifyData.decodeContextBitstring(
					buffer,
					offset + len,
					1,
				)
				if (!statusFlags) return undefined
				len += statusFlags.len
				eventData.changeOfReliabilityStatusFlags = statusFlags.value

				const propertyValues =
					EventNotifyData.decodeContextUnknownValue(
						buffer,
						offset + len,
						2,
					)
				if (!propertyValues) return undefined
				len += propertyValues.len
				eventData.changeOfReliabilityPropertyValues = propertyValues.raw
				if (propertyValues.decoded) {
					eventData.changeOfReliabilityPropertyValuesDecoded =
						propertyValues.decoded
				}

				const closingTag19 = EventNotifyData.decodeClosingTag(
					buffer,
					offset + len,
					19,
				)
				if (closingTag19 == null) return undefined
				len += closingTag19
				break
			}
			case EventType.CHANGE_OF_DISCRETE_VALUE: {
				const openingTag21 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					21,
				)
				if (openingTag21 == null) return undefined
				len += openingTag21

				const openingTag0 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					0,
				)
				if (openingTag0 == null) return undefined
				len += openingTag0

				const newValue = EventNotifyData.decodeDiscreteValueChoice(
					buffer,
					offset + len,
				)
				if (!newValue) return undefined
				len += newValue.len
				eventData.changeOfDiscreteValueNewValue = newValue.value

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
				eventData.changeOfDiscreteValueStatusFlags = statusFlags.value

				const closingTag21 = EventNotifyData.decodeClosingTag(
					buffer,
					offset + len,
					21,
				)
				if (closingTag21 == null) return undefined
				len += closingTag21
				break
			}
			case EventType.CHANGE_OF_TIMER: {
				const openingTag22 = EventNotifyData.decodeOpeningTag(
					buffer,
					offset + len,
					22,
				)
				if (openingTag22 == null) return undefined
				len += openingTag22

				const newState = EventNotifyData.decodeContextEnumerated(
					buffer,
					offset + len,
					0,
				)
				if (!newState) return undefined
				len += newState.len
				eventData.changeOfTimerNewState = newState.value

				const statusFlags = EventNotifyData.decodeContextBitstring(
					buffer,
					offset + len,
					1,
				)
				if (!statusFlags) return undefined
				len += statusFlags.len
				eventData.changeOfTimerStatusFlags = statusFlags.value

				const updateTime = EventNotifyData.decodeContextDateTime(
					buffer,
					offset + len,
					2,
				)
				if (!updateTime) return undefined
				len += updateTime.len
				eventData.changeOfTimerUpdateTime = updateTime.value

				const lastStateChange = EventNotifyData.decodeContextEnumerated(
					buffer,
					offset + len,
					3,
				)
				if (lastStateChange) {
					len += lastStateChange.len
					eventData.changeOfTimerLastStateChange =
						lastStateChange.value
				}

				const initialTimeout = EventNotifyData.decodeContextUnsigned(
					buffer,
					offset + len,
					4,
				)
				if (initialTimeout) {
					len += initialTimeout.len
					eventData.changeOfTimerInitialTimeout = initialTimeout.value
				}

				const expirationTime = EventNotifyData.decodeContextDateTime(
					buffer,
					offset + len,
					5,
				)
				if (expirationTime) {
					len += expirationTime.len
					eventData.changeOfTimerExpirationTime = expirationTime.value
				}

				const closingTag22 = EventNotifyData.decodeClosingTag(
					buffer,
					offset + len,
					22,
				)
				if (closingTag22 == null) return undefined
				len += closingTag22
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

		if (EventNotifyData.isSet(data.ackRequired)) {
			baAsn1.encodeContextBoolean(buffer, 9, data.ackRequired)
		}
		if (EventNotifyData.isSet(data.fromState)) {
			baAsn1.encodeContextEnumerated(buffer, 10, data.fromState)
		}

		baAsn1.encodeContextEnumerated(buffer, 11, data.toState)

		const shouldEncodeEventValues =
			EventNotifyData.isSet(data.eventValuesRaw) ||
			EventNotifyData.hasTypedEventValues(data)
		if (shouldEncodeEventValues) {
			baAsn1.encodeOpeningTag(buffer, 12)

			if (EventNotifyData.isSet(data.eventValuesRaw)) {
				EventNotifyData.encodeRawValue(buffer, data.eventValuesRaw)
				baAsn1.encodeClosingTag(buffer, 12)
				return
			}

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
					EventNotifyData.encodeOutOfRangePattern(
						buffer, 5,
						data.outOfRangeExceedingValue, data.outOfRangeStatusFlags,
						data.outOfRangeDeadband, data.outOfRangeExceededLimit,
						baAsn1.encodeContextReal, baAsn1.encodeContextReal,
					)
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

				case EventType.COMMAND_FAILURE:
					baAsn1.encodeOpeningTag(buffer, 3)
					EventNotifyData.encodeContextUnknownValue(
						buffer,
						0,
						data.commandFailureCommandValue,
						data.commandFailureCommandValueDecoded,
					)
					baAsn1.encodeContextBitstring(
						buffer,
						1,
						data.commandFailureStatusFlags,
					)
					EventNotifyData.encodeContextUnknownValue(
						buffer,
						2,
						data.commandFailureFeedbackValue,
						data.commandFailureFeedbackValueDecoded,
					)
					baAsn1.encodeClosingTag(buffer, 3)
					break

				case EventType.ACCESS_EVENT:
					baAsn1.encodeOpeningTag(buffer, 13)
					baAsn1.encodeContextEnumerated(
						buffer,
						0,
						data.accessEventAccessEvent,
					)
					baAsn1.encodeContextBitstring(
						buffer,
						1,
						data.accessEventStatusFlags,
					)
					baAsn1.encodeContextUnsigned(buffer, 2, data.accessEventTag)
					baAsn1.bacappEncodeContextTimestamp(
						buffer,
						3,
						data.accessEventTime,
					)
					EventNotifyData.encodeContextDeviceObjectReference(
						buffer,
						4,
						data.accessEventAccessCredential,
					)
					if (data.accessEventAuthenticationFactor) {
						EventNotifyData.encodeContextAuthenticationFactor(
							buffer,
							5,
							data.accessEventAuthenticationFactor,
						)
					}
					baAsn1.encodeClosingTag(buffer, 13)
					break

				case EventType.DOUBLE_OUT_OF_RANGE:
					EventNotifyData.encodeOutOfRangePattern(
						buffer, 14,
						data.doubleOutOfRangeExceedingValue, data.doubleOutOfRangeStatusFlags,
						data.doubleOutOfRangeDeadband, data.doubleOutOfRangeExceededLimit,
						EventNotifyData.encodeContextDouble, EventNotifyData.encodeContextDouble,
					)
					break

				case EventType.SIGNED_OUT_OF_RANGE:
					EventNotifyData.encodeOutOfRangePattern(
						buffer, 15,
						data.signedOutOfRangeExceedingValue, data.signedOutOfRangeStatusFlags,
						data.signedOutOfRangeDeadband, data.signedOutOfRangeExceededLimit,
						baAsn1.encodeContextSigned, baAsn1.encodeContextUnsigned,
					)
					break

				case EventType.UNSIGNED_OUT_OF_RANGE:
					EventNotifyData.encodeOutOfRangePattern(
						buffer, 16,
						data.unsignedOutOfRangeExceedingValue, data.unsignedOutOfRangeStatusFlags,
						data.unsignedOutOfRangeDeadband, data.unsignedOutOfRangeExceededLimit,
						baAsn1.encodeContextUnsigned, baAsn1.encodeContextUnsigned,
					)
					break

				case EventType.CHANGE_OF_CHARACTERSTRING:
					baAsn1.encodeOpeningTag(buffer, 17)
					baAsn1.encodeContextCharacterString(
						buffer,
						0,
						data.changeOfCharacterStringChangedValue,
					)
					baAsn1.encodeContextBitstring(
						buffer,
						1,
						data.changeOfCharacterStringStatusFlags,
					)
					baAsn1.encodeContextCharacterString(
						buffer,
						2,
						data.changeOfCharacterStringAlarmValue,
					)
					baAsn1.encodeClosingTag(buffer, 17)
					break

				case EventType.CHANGE_OF_STATUS_FLAGS:
					baAsn1.encodeOpeningTag(buffer, 18)
					if (
						data.changeOfStatusFlagsPresentValue ||
						data.changeOfStatusFlagsPresentValueDecoded
					) {
						EventNotifyData.encodeContextUnknownValue(
							buffer,
							0,
							data.changeOfStatusFlagsPresentValue,
							data.changeOfStatusFlagsPresentValueDecoded,
						)
					}
					baAsn1.encodeContextBitstring(
						buffer,
						1,
						data.changeOfStatusFlagsReferencedFlags,
					)
					baAsn1.encodeClosingTag(buffer, 18)
					break

				case EventType.CHANGE_OF_RELIABILITY:
					baAsn1.encodeOpeningTag(buffer, 19)
					baAsn1.encodeContextEnumerated(
						buffer,
						0,
						data.changeOfReliabilityReliability,
					)
					baAsn1.encodeContextBitstring(
						buffer,
						1,
						data.changeOfReliabilityStatusFlags,
					)
					EventNotifyData.encodeContextUnknownValue(
						buffer,
						2,
						data.changeOfReliabilityPropertyValues,
						data.changeOfReliabilityPropertyValuesDecoded,
					)
					baAsn1.encodeClosingTag(buffer, 19)
					break

				case EventType.CHANGE_OF_DISCRETE_VALUE:
					baAsn1.encodeOpeningTag(buffer, 21)
					baAsn1.encodeOpeningTag(buffer, 0)
					EventNotifyData.encodeDiscreteValueChoice(
						buffer,
						data.changeOfDiscreteValueNewValue,
					)
					baAsn1.encodeClosingTag(buffer, 0)
					baAsn1.encodeContextBitstring(
						buffer,
						1,
						data.changeOfDiscreteValueStatusFlags,
					)
					baAsn1.encodeClosingTag(buffer, 21)
					break

				case EventType.CHANGE_OF_TIMER:
					baAsn1.encodeOpeningTag(buffer, 22)
					baAsn1.encodeContextEnumerated(
						buffer,
						0,
						data.changeOfTimerNewState,
					)
					baAsn1.encodeContextBitstring(
						buffer,
						1,
						data.changeOfTimerStatusFlags,
					)
					EventNotifyData.encodeContextDateTime(
						buffer,
						2,
						data.changeOfTimerUpdateTime,
					)
					if (data.changeOfTimerLastStateChange != null) {
						baAsn1.encodeContextEnumerated(
							buffer,
							3,
							data.changeOfTimerLastStateChange,
						)
					}
					if (data.changeOfTimerInitialTimeout != null) {
						baAsn1.encodeContextUnsigned(
							buffer,
							4,
							data.changeOfTimerInitialTimeout,
						)
					}
					if (data.changeOfTimerExpirationTime) {
						EventNotifyData.encodeContextDateTime(
							buffer,
							5,
							data.changeOfTimerExpirationTime,
						)
					}
					baAsn1.encodeClosingTag(buffer, 22)
					break

				case EventType.EXTENDED:
					throw new Error(
						'eventValuesRaw is required to encode EXTENDED event values',
					)

				default:
					throw new Error('NotImplemented')
			}

			baAsn1.encodeClosingTag(buffer, 12)
		}
	}

	public static decode(
		buffer: Buffer,
		offset: number,
	): EventNotifyDataResult | undefined {
		let len = 0
		const eventData = {} as EventNotifyDataResult

		const processId = EventNotifyData.decodeContextUnsigned(buffer, offset + len, 0)
		if (!processId) return undefined
		len += processId.len
		eventData.processId = processId.value

		const initiatingObjectId = EventNotifyData.decodeContextObjectId(buffer, offset + len, 1)
		if (!initiatingObjectId) return undefined
		len += initiatingObjectId.len
		eventData.initiatingObjectId = initiatingObjectId.value

		const eventObjectId = EventNotifyData.decodeContextObjectId(buffer, offset + len, 2)
		if (!eventObjectId) return undefined
		len += eventObjectId.len
		eventData.eventObjectId = eventObjectId.value

		const timeStamp = EventNotifyData.decodeContextTimeStamp(buffer, offset + len, 3)
		if (!timeStamp) return undefined
		len += timeStamp.len
		eventData.timeStamp = timeStamp.value

		const notificationClass = EventNotifyData.decodeContextUnsigned(buffer, offset + len, 4)
		if (!notificationClass) return undefined
		len += notificationClass.len
		eventData.notificationClass = notificationClass.value

		const priority = EventNotifyData.decodeContextUnsigned(buffer, offset + len, 5)
		if (!priority) return undefined
		len += priority.len
		eventData.priority = priority.value
		if (eventData.priority > 0xff) return undefined

		const eventType = EventNotifyData.decodeContextEnumerated(buffer, offset + len, 6)
		if (!eventType) return undefined
		len += eventType.len
		eventData.eventType = eventType.value

		const messageText = EventNotifyData.decodeContextCharacterString(buffer, offset + len, 7)
		if (messageText) {
			len += messageText.len
			eventData.messageText = messageText.value
		}

		const notifyType = EventNotifyData.decodeContextEnumerated(buffer, offset + len, 8)
		if (!notifyType) return undefined
		len += notifyType.len
		eventData.notifyType = notifyType.value

		const ackRequired = EventNotifyData.decodeContextBoolean(buffer, offset + len, 9)
		if (ackRequired) {
			len += ackRequired.len
			eventData.ackRequired = ackRequired.value
		}

		const fromState = EventNotifyData.decodeContextEnumerated(buffer, offset + len, 10)
		if (fromState) {
			len += fromState.len
			eventData.fromState = fromState.value
		}

		const toState = EventNotifyData.decodeContextEnumerated(buffer, offset + len, 11)
		if (!toState) return undefined
		len += toState.len
		eventData.toState = toState.value

		if (baAsn1.decodeIsOpeningTagNumber(buffer, offset + len, 12)) {
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
