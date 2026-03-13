import * as baAsn1 from '../asn1'
import {
	ASN1_ARRAY_ALL,
	ASN1_NO_PRIORITY,
	ApplicationTag,
	ObjectType,
	PropertyIdentifier,
} from '../enum'
import {
	EncodeBuffer,
	BACNetObjectID,
	BACNetPropertyID,
	BACNetAppData,
	Tag,
	WritePropertyMultipleValue,
	Decode,
	ObjectId,
	WritePropertyMultipleObject,
} from '../types'
import { BacnetService } from './AbstractServices'
import WriteProperty from './WriteProperty'

export default class WritePropertyMultiple extends BacnetService {
	private static pickIndexedEntry<T>(
		items: T[],
		arrayIndex: number,
	): T | undefined {
		if (items.length === 1) return items[0]
		const idx = arrayIndex - 1
		return idx >= 0 && idx < items.length ? items[idx] : undefined
	}

	private static pickIndexedWeeklyDay(
		days: unknown[],
		arrayIndex: number,
	): unknown[] | undefined {
		if (days.length === 0) return undefined
		const allDays = days.every((d) => Array.isArray(d))
		if (!allDays) return undefined
		const idx = arrayIndex - 1
		if (idx >= 0 && idx < days.length) {
			const requested = days[idx] as unknown[]
			if (requested.length > 0) return requested
		}
		const nonEmptyDays = (days as unknown[][]).filter((d) => d.length > 0)
		// Many devices return a single indexed day payload encoded as day[0] only.
		if (nonEmptyDays.length <= 1) return days[0] as unknown[]
		return idx >= 0 && idx < days.length ? (days[idx] as unknown[]) : undefined
	}

	public static encode(
		buffer: EncodeBuffer,
		objectId: BACNetObjectID,
		values: WritePropertyMultipleValue[],
	) {
		baAsn1.encodeContextObjectId(
			buffer,
			0,
			objectId.type,
			objectId.instance,
		)
		baAsn1.encodeOpeningTag(buffer, 1)
		values.forEach((pValue) => {
			const propertyIndex = pValue.property.index ?? ASN1_ARRAY_ALL
			if (
				objectId.type === ObjectType.SCHEDULE &&
				pValue.property.id === PropertyIdentifier.EFFECTIVE_PERIOD &&
				propertyIndex !== ASN1_ARRAY_ALL
			) {
				throw new Error(
					'Could not encode: effective period does not support indexed access',
				)
			}
			if (
				objectId.type === ObjectType.CALENDAR &&
				pValue.property.id === PropertyIdentifier.DATE_LIST &&
				propertyIndex !== ASN1_ARRAY_ALL
			) {
				throw new Error(
					'Could not encode: date list does not support indexed access',
				)
			}
			baAsn1.encodeContextEnumerated(buffer, 0, pValue.property.id)
			if (propertyIndex !== ASN1_ARRAY_ALL) {
				baAsn1.encodeContextUnsigned(buffer, 1, propertyIndex)
			}
			baAsn1.encodeOpeningTag(buffer, 2)
			WriteProperty.encodePropertyValuePayload(
				buffer,
				objectId.type,
				pValue.property.id,
				propertyIndex,
				pValue.value as any,
			)
			baAsn1.encodeClosingTag(buffer, 2)
			if (pValue.priority !== ASN1_NO_PRIORITY) {
				baAsn1.encodeContextUnsigned(buffer, 3, pValue.priority)
			}
		})
		baAsn1.encodeClosingTag(buffer, 1)
	}

	public static decode(buffer: Buffer, offset: number, apduLen: number) {
		let len = 0
		let result: Tag
		let decodedValue: Decode<number> | ObjectId
		result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
		len += result.len
		if (result.tagNumber !== 0 || apduLen <= len) return undefined
		apduLen -= len
		if (apduLen < 4) return undefined
		decodedValue = baAsn1.decodeObjectId(buffer, offset + len)
		len += decodedValue.len
		const objectId = {
			type: decodedValue.objectType,
			instance: decodedValue.instance,
		}
		if (!baAsn1.decodeIsOpeningTagNumber(buffer, offset + len, 1))
			return undefined
		len++
		const _values = []
		while (apduLen - len > 1) {
			const newEntry: any = {}
			result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
			len += result.len
			if (result.tagNumber !== 0) return undefined
			decodedValue = baAsn1.decodeEnumerated(
				buffer,
				offset + len,
				result.value,
			)
			len += decodedValue.len
			const propertyId = decodedValue.value
			let arrayIndex = ASN1_ARRAY_ALL
			result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
			len += result.len
			if (result.tagNumber === 1) {
				decodedValue = baAsn1.decodeUnsigned(
					buffer,
					offset + len,
					result.value,
				)
				len += decodedValue.len
				arrayIndex = decodedValue.value
				result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
				len += result.len
			}
			newEntry.property = { id: propertyId, index: arrayIndex }
			if (
				objectId.type === ObjectType.SCHEDULE &&
				propertyId === PropertyIdentifier.EFFECTIVE_PERIOD &&
				arrayIndex !== ASN1_ARRAY_ALL
			) {
				return undefined
			}
			if (
				objectId.type === ObjectType.CALENDAR &&
				propertyId === PropertyIdentifier.DATE_LIST &&
				arrayIndex !== ASN1_ARRAY_ALL
			) {
				return undefined
			}
			if (
				result.tagNumber !== 2 ||
				!baAsn1.decodeIsOpeningTag(buffer, offset + len - 1)
			)
				return undefined
			const values = []
			let handledScheduleCalendar = false
			if (
				objectId.type === ObjectType.SCHEDULE &&
				propertyId === PropertyIdentifier.WEEKLY_SCHEDULE &&
				arrayIndex === ASN1_ARRAY_ALL
			) {
				const decodedWeekly = baAsn1.decodeWeeklySchedule(
					buffer,
					offset + len,
					apduLen - len,
					2,
				)
				if (!decodedWeekly) return undefined
				values.push({
					type: ApplicationTag.WEEKLY_SCHEDULE,
					value: decodedWeekly.value,
				})
				len += decodedWeekly.len
				handledScheduleCalendar = true
			} else if (
				objectId.type === ObjectType.SCHEDULE &&
				propertyId === PropertyIdentifier.WEEKLY_SCHEDULE &&
				arrayIndex !== ASN1_ARRAY_ALL &&
				arrayIndex !== 0
			) {
				const decodedWeekly = baAsn1.decodeWeeklySchedule(
					buffer,
					offset + len,
					apduLen - len,
					2,
				)
				if (!decodedWeekly || !Array.isArray(decodedWeekly.value)) {
					return undefined
				}
				const selected = WritePropertyMultiple.pickIndexedWeeklyDay(
					decodedWeekly.value as any[],
					arrayIndex,
				)
				if (!Array.isArray(selected)) return undefined
				values.push({
					type: ApplicationTag.WEEKLY_SCHEDULE,
					value: selected,
				})
				len += decodedWeekly.len
				handledScheduleCalendar = true
			} else if (
				objectId.type === ObjectType.SCHEDULE &&
				propertyId === PropertyIdentifier.EXCEPTION_SCHEDULE &&
				arrayIndex === ASN1_ARRAY_ALL
			) {
				const decodedException = baAsn1.decodeExceptionSchedule(
					buffer,
					offset + len,
					apduLen - len,
					2,
				)
				if (!decodedException) return undefined
				values.push({
					type: ApplicationTag.SPECIAL_EVENT,
					value: decodedException.value,
				})
				len += decodedException.len
				handledScheduleCalendar = true
			} else if (
				objectId.type === ObjectType.SCHEDULE &&
				propertyId === PropertyIdentifier.EXCEPTION_SCHEDULE &&
				arrayIndex !== ASN1_ARRAY_ALL &&
				arrayIndex !== 0
			) {
				const decodedException = baAsn1.decodeExceptionSchedule(
					buffer,
					offset + len,
					apduLen - len,
					2,
				)
				if (!decodedException || !Array.isArray(decodedException.value)) {
					return undefined
				}
				const selected = WritePropertyMultiple.pickIndexedEntry(
					decodedException.value as any[],
					arrayIndex,
				)
				if (selected == null) return undefined
				values.push({
					type: ApplicationTag.SPECIAL_EVENT,
					value: selected,
				})
				len += decodedException.len
				handledScheduleCalendar = true
			} else if (
				objectId.type === ObjectType.SCHEDULE &&
				propertyId === PropertyIdentifier.EFFECTIVE_PERIOD &&
				arrayIndex === ASN1_ARRAY_ALL
			) {
				const decodedEffective = baAsn1.decodeScheduleEffectivePeriod(
					buffer,
					offset + len,
					apduLen - len,
					2,
					2,
				)
				if (!decodedEffective) return undefined
				values.push({
					type: ApplicationTag.DATERANGE,
					value: decodedEffective.value,
				})
				len += decodedEffective.len
				handledScheduleCalendar = true
			} else if (
				objectId.type === ObjectType.CALENDAR &&
				propertyId === PropertyIdentifier.DATE_LIST &&
				arrayIndex === ASN1_ARRAY_ALL
			) {
				const decodedDateList = baAsn1.decodeCalendarDatelist(
					buffer,
					offset + len,
					apduLen - len,
					2,
					2,
				)
				if (!decodedDateList) return undefined
				values.push({
					type: ApplicationTag.CALENDAR_ENTRY,
					value: decodedDateList.value,
				})
				len += decodedDateList.len
				handledScheduleCalendar = true
			}

			if (!handledScheduleCalendar) {
				while (
					len + offset <= buffer.length &&
					!baAsn1.decodeIsClosingTag(buffer, offset + len)
				) {
					const value = baAsn1.bacappDecodeApplicationData(
						buffer,
						offset + len,
						apduLen + offset,
						objectId.type,
						propertyId,
					)
					if (!value) return undefined
					len += value.len
					delete value.len
					values.push(value)
				}
				len++
			}
			newEntry.value = values
			let priority = ASN1_NO_PRIORITY
			result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
			len += result.len
			if (result.tagNumber === 3) {
				decodedValue = baAsn1.decodeUnsigned(
					buffer,
					offset + len,
					result.value,
				)
				len += decodedValue.len
				priority = decodedValue.value
			} else {
				len--
			}
			newEntry.priority = priority
			_values.push(newEntry)
		}
		if (!baAsn1.decodeIsClosingTagNumber(buffer, offset + len, 1))
			return undefined
		len++
		return {
			len,
			objectId,
			values: _values,
		}
	}

	public static encodeObject(
		buffer: EncodeBuffer,
		values: WritePropertyMultipleObject[],
	) {
		values.forEach((object) =>
			WritePropertyMultiple.encode(
				buffer,
				object.objectId,
				object.values,
			),
		)
	}
}
