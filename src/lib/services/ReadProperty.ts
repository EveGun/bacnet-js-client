import * as baAsn1 from '../asn1'
import {
	ObjectType,
	PropertyIdentifier,
	ApplicationTag,
	ASN1_MAX_OBJECT,
	ASN1_MAX_PROPERTY_ID,
	ASN1_ARRAY_ALL,
} from '../enum'
import {
	EncodeBuffer,
	BACNetObjectID,
	ApplicationData,
	DecodeAcknowledgeSingleResult,
	BACNetPropertyID,
	ReadPropertyRequest,
} from '../types'
import { BacnetService } from './AbstractServices'

export default class ReadProperty extends BacnetService {
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
		const nonEmptyDays = (days as unknown[][]).filter((d) => d.length > 0)
		// Many devices return a single indexed day payload encoded as day[0] only.
		if (nonEmptyDays.length <= 1) return days[0] as unknown[]
		const idx = arrayIndex - 1
		return idx >= 0 && idx < days.length ? (days[idx] as unknown[]) : undefined
	}

	public static encode(
		buffer: EncodeBuffer,
		objectType: number,
		objectInstance: number,
		propertyId: number,
		arrayIndex: number,
	) {
		if (
			objectType === ObjectType.SCHEDULE &&
			propertyId === PropertyIdentifier.EFFECTIVE_PERIOD &&
			arrayIndex !== ASN1_ARRAY_ALL
		) {
			throw new Error(
				'Could not encode: effective period does not support indexed access',
			)
		}
		if (
			objectType === ObjectType.CALENDAR &&
			propertyId === PropertyIdentifier.DATE_LIST &&
			arrayIndex !== ASN1_ARRAY_ALL
		) {
			throw new Error(
				'Could not encode: date list does not support indexed access',
			)
		}
		if (objectType <= ASN1_MAX_OBJECT) {
			baAsn1.encodeContextObjectId(buffer, 0, objectType, objectInstance)
		}
		if (propertyId <= ASN1_MAX_PROPERTY_ID) {
			baAsn1.encodeContextEnumerated(buffer, 1, propertyId)
		}
		if (arrayIndex !== ASN1_ARRAY_ALL) {
			baAsn1.encodeContextUnsigned(buffer, 2, arrayIndex)
		}
	}

	public static decode(
		buffer: Buffer,
		offset: number,
		apduLen: number,
	): ReadPropertyRequest | undefined {
		let len = 0

		if (apduLen < 7) return undefined
		if (!baAsn1.decodeIsContextTag(buffer, offset + len, 0))
			return undefined

		len++
		const objectIdResult = baAsn1.decodeObjectId(buffer, offset + len)
		len += objectIdResult.len

		const objectId: BACNetObjectID = {
			type: objectIdResult.objectType,
			instance: objectIdResult.instance,
		}

		const property: BACNetPropertyID = {
			id: 0,
			index: ASN1_ARRAY_ALL,
		}

		const result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
		len += result.len

		if (result.tagNumber !== 1) return undefined

		const enumResult = baAsn1.decodeEnumerated(
			buffer,
			offset + len,
			result.value,
		)
		len += enumResult.len
		property.id = enumResult.value

		if (len < apduLen) {
			const tagResult = baAsn1.decodeTagNumberAndValue(
				buffer,
				offset + len,
			)
			len += tagResult.len

			if (tagResult.tagNumber === 2 && len < apduLen) {
				const unsignedResult = baAsn1.decodeUnsigned(
					buffer,
					offset + len,
					tagResult.value,
				)
				len += unsignedResult.len
				property.index = unsignedResult.value
			} else {
				return undefined
			}
		}

		if (len < apduLen) return undefined

		return {
			len,
			objectId,
			property,
		}
	}

	public static encodeAcknowledge(
		buffer: EncodeBuffer,
		objectId: BACNetObjectID,
		propertyId: number,
		arrayIndex: number,
		values: any[],
	) {
		baAsn1.encodeContextObjectId(
			buffer,
			0,
			objectId.type,
			objectId.instance,
		)
		baAsn1.encodeContextEnumerated(buffer, 1, propertyId)
		if (arrayIndex !== ASN1_ARRAY_ALL) {
			baAsn1.encodeContextUnsigned(buffer, 2, arrayIndex)
		}
		baAsn1.encodeOpeningTag(buffer, 3)
		values.forEach((value) =>
			baAsn1.bacappEncodeApplicationData(buffer, value),
		)
		baAsn1.encodeClosingTag(buffer, 3)
	}

	public static decodeAcknowledge(
		buffer: Buffer,
		offset: number,
		apduLen: number,
	): DecodeAcknowledgeSingleResult | undefined {
		const objectId: BACNetObjectID = { type: 0, instance: 0 }
		const property: BACNetPropertyID = { id: 0, index: ASN1_ARRAY_ALL }

		if (!baAsn1.decodeIsContextTag(buffer, offset, 0)) return undefined
		let len = 1

		const objectIdResult = baAsn1.decodeObjectId(buffer, offset + len)
		len += objectIdResult.len
		objectId.type = objectIdResult.objectType
		objectId.instance = objectIdResult.instance

		const tagResult = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
		len += tagResult.len
		if (tagResult.tagNumber !== 1) return undefined

		const enumResult = baAsn1.decodeEnumerated(
			buffer,
			offset + len,
			tagResult.value,
		)
		len += enumResult.len
		property.id = enumResult.value

		const indexTagResult = baAsn1.decodeTagNumberAndValue(
			buffer,
			offset + len,
		)
		if (indexTagResult.tagNumber === 2) {
			len += indexTagResult.len
			const unsignedResult = baAsn1.decodeUnsigned(
				buffer,
				offset + len,
				indexTagResult.value,
			)
			len += unsignedResult.len
			property.index = unsignedResult.value
		} else {
			property.index = ASN1_ARRAY_ALL
		}
		if (
			objectId.type === ObjectType.SCHEDULE &&
			property.id === PropertyIdentifier.EFFECTIVE_PERIOD &&
			property.index !== ASN1_ARRAY_ALL
		) {
			return undefined
		}
		if (
			objectId.type === ObjectType.CALENDAR &&
			property.id === PropertyIdentifier.DATE_LIST &&
			property.index !== ASN1_ARRAY_ALL
		) {
			return undefined
		}
		const values: ApplicationData[] = []
		if (!baAsn1.decodeIsOpeningTagNumber(buffer, offset + len, 3)) return
		len++
		if (
			objectId.type === ObjectType.SCHEDULE &&
			property.id === PropertyIdentifier.WEEKLY_SCHEDULE &&
			property.index === ASN1_ARRAY_ALL
		) {
			const result = baAsn1.decodeWeeklySchedule(
				buffer,
				offset + len,
				apduLen - len,
			)
			if (!result) return undefined
			values.push({
				type: ApplicationTag.WEEKLY_SCHEDULE,
				value: result.value,
			} as ApplicationData)
			len += result.len
		} else if (
			objectId.type === ObjectType.SCHEDULE &&
			property.id === PropertyIdentifier.WEEKLY_SCHEDULE &&
			property.index !== ASN1_ARRAY_ALL &&
			property.index !== 0
		) {
			const result = baAsn1.decodeWeeklySchedule(
				buffer,
				offset + len,
				apduLen - len,
			)
			if (!result || !Array.isArray(result.value)) {
				return undefined
			}
			const selected = ReadProperty.pickIndexedWeeklyDay(
				result.value as any[],
				property.index,
			)
			if (!Array.isArray(selected)) return undefined
			values.push({
				type: ApplicationTag.WEEKLY_SCHEDULE,
				value: selected,
			} as ApplicationData)
			len += result.len
		} else if (
			objectId.type === ObjectType.SCHEDULE &&
			property.id === PropertyIdentifier.EXCEPTION_SCHEDULE &&
			property.index === ASN1_ARRAY_ALL
		) {
			const result = baAsn1.decodeExceptionSchedule(
				buffer,
				offset + len,
				apduLen - len,
			)
			if (!result) return undefined
			values.push({
				type: ApplicationTag.SPECIAL_EVENT,
				value: result.value,
			} as ApplicationData)
			len += result.len
		} else if (
			objectId.type === ObjectType.SCHEDULE &&
			property.id === PropertyIdentifier.EXCEPTION_SCHEDULE &&
			property.index !== ASN1_ARRAY_ALL &&
			property.index !== 0
		) {
			const result = baAsn1.decodeExceptionSchedule(
				buffer,
				offset + len,
				apduLen - len,
			)
			if (!result || !Array.isArray(result.value)) {
				return undefined
			}
			const selected = ReadProperty.pickIndexedEntry(
				result.value as any[],
				property.index,
			)
			if (selected == null) return undefined
			values.push({
				type: ApplicationTag.SPECIAL_EVENT,
				value: selected,
			} as ApplicationData)
			len += result.len
		} else if (
			objectId.type === ObjectType.SCHEDULE &&
			property.id === PropertyIdentifier.EFFECTIVE_PERIOD &&
			property.index === ASN1_ARRAY_ALL
		) {
			const result = baAsn1.decodeScheduleEffectivePeriod(
				buffer,
				offset + len,
				apduLen - len,
			)
			if (!result) return undefined
			values.push({
				type: ApplicationTag.DATERANGE,
				value: result.value,
			} as ApplicationData)
			len += result.len
		} else if (
			objectId.type === ObjectType.CALENDAR &&
			property.id === PropertyIdentifier.DATE_LIST &&
			property.index === ASN1_ARRAY_ALL
		) {
			const result = baAsn1.decodeCalendarDatelist(
				buffer,
				offset + len,
				apduLen - len,
			)
			if (!result) return undefined
			values.push({
				type: ApplicationTag.CALENDAR_ENTRY,
				value: result.value,
			} as ApplicationData)
			len += result.len
		} else {
			while (apduLen - len > 1) {
				const result = baAsn1.bacappDecodeApplicationData(
					buffer,
					offset + len,
					apduLen + offset,
					objectId.type,
					property.id,
				)
				if (!result) return undefined
				len += result.len
				delete result.len
				values.push(result)
			}
			if (!baAsn1.decodeIsClosingTagNumber(buffer, offset + len, 3))
				return
			len++
		}
		return {
			len,
			objectId,
			property,
			values,
		}
	}
}
