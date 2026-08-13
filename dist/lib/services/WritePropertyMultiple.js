"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const baAsn1 = __importStar(require("../asn1"));
const enum_1 = require("../enum");
const AbstractServices_1 = require("./AbstractServices");
const WriteProperty_1 = __importDefault(require("./WriteProperty"));
class WritePropertyMultiple extends AbstractServices_1.BacnetService {
    static pickIndexedEntry(items, arrayIndex) {
        if (items.length === 1)
            return items[0];
        const idx = arrayIndex - 1;
        return idx >= 0 && idx < items.length ? items[idx] : undefined;
    }
    static pickIndexedWeeklyDay(days, arrayIndex) {
        if (days.length === 0)
            return undefined;
        const allDays = days.every((d) => Array.isArray(d));
        if (!allDays)
            return undefined;
        const idx = arrayIndex - 1;
        if (idx >= 0 && idx < days.length) {
            const requested = days[idx];
            if (requested.length > 0)
                return requested;
        }
        const nonEmptyDays = days.filter((d) => d.length > 0);
        if (nonEmptyDays.length <= 1)
            return days[0];
        return idx >= 0 && idx < days.length ? days[idx] : undefined;
    }
    static encode(buffer, objectId, values) {
        baAsn1.encodeContextObjectId(buffer, 0, objectId.type, objectId.instance);
        baAsn1.encodeOpeningTag(buffer, 1);
        values.forEach((pValue) => {
            const propertyIndex = pValue.property.index ?? enum_1.ASN1_ARRAY_ALL;
            if (objectId.type === enum_1.ObjectType.SCHEDULE &&
                pValue.property.id === enum_1.PropertyIdentifier.EFFECTIVE_PERIOD &&
                propertyIndex !== enum_1.ASN1_ARRAY_ALL) {
                throw new Error('Could not encode: effective period does not support indexed access');
            }
            if (objectId.type === enum_1.ObjectType.CALENDAR &&
                pValue.property.id === enum_1.PropertyIdentifier.DATE_LIST &&
                propertyIndex !== enum_1.ASN1_ARRAY_ALL) {
                throw new Error('Could not encode: date list does not support indexed access');
            }
            baAsn1.encodeContextEnumerated(buffer, 0, pValue.property.id);
            if (propertyIndex !== enum_1.ASN1_ARRAY_ALL) {
                baAsn1.encodeContextUnsigned(buffer, 1, propertyIndex);
            }
            baAsn1.encodeOpeningTag(buffer, 2);
            WriteProperty_1.default.encodePropertyValuePayload(buffer, objectId.type, pValue.property.id, propertyIndex, pValue.value);
            baAsn1.encodeClosingTag(buffer, 2);
            if (pValue.priority !== enum_1.ASN1_NO_PRIORITY) {
                baAsn1.encodeContextUnsigned(buffer, 3, pValue.priority);
            }
        });
        baAsn1.encodeClosingTag(buffer, 1);
    }
    static decode(buffer, offset, apduLen) {
        let len = 0;
        let result;
        let decodedValue;
        result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
        len += result.len;
        if (result.tagNumber !== 0 || apduLen <= len)
            return undefined;
        apduLen -= len;
        if (apduLen < 4)
            return undefined;
        decodedValue = baAsn1.decodeObjectId(buffer, offset + len);
        len += decodedValue.len;
        const objectId = {
            type: decodedValue.objectType,
            instance: decodedValue.instance,
        };
        if (!baAsn1.decodeIsOpeningTagNumber(buffer, offset + len, 1))
            return undefined;
        len++;
        const _values = [];
        while (apduLen - len > 1) {
            const newEntry = {};
            result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
            len += result.len;
            if (result.tagNumber !== 0)
                return undefined;
            decodedValue = baAsn1.decodeEnumerated(buffer, offset + len, result.value);
            len += decodedValue.len;
            const propertyId = decodedValue.value;
            let arrayIndex = enum_1.ASN1_ARRAY_ALL;
            result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
            len += result.len;
            if (result.tagNumber === 1) {
                decodedValue = baAsn1.decodeUnsigned(buffer, offset + len, result.value);
                len += decodedValue.len;
                arrayIndex = decodedValue.value;
                result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
                len += result.len;
            }
            newEntry.property = { id: propertyId, index: arrayIndex };
            if (objectId.type === enum_1.ObjectType.SCHEDULE &&
                propertyId === enum_1.PropertyIdentifier.EFFECTIVE_PERIOD &&
                arrayIndex !== enum_1.ASN1_ARRAY_ALL) {
                return undefined;
            }
            if (objectId.type === enum_1.ObjectType.CALENDAR &&
                propertyId === enum_1.PropertyIdentifier.DATE_LIST &&
                arrayIndex !== enum_1.ASN1_ARRAY_ALL) {
                return undefined;
            }
            if (result.tagNumber !== 2 ||
                !baAsn1.decodeIsOpeningTag(buffer, offset + len - 1))
                return undefined;
            const values = [];
            let handledScheduleCalendar = false;
            if (objectId.type === enum_1.ObjectType.SCHEDULE &&
                propertyId === enum_1.PropertyIdentifier.WEEKLY_SCHEDULE &&
                arrayIndex === enum_1.ASN1_ARRAY_ALL) {
                const decodedWeekly = baAsn1.decodeWeeklySchedule(buffer, offset + len, apduLen - len, 2);
                if (!decodedWeekly)
                    return undefined;
                values.push({
                    type: enum_1.ApplicationTag.WEEKLY_SCHEDULE,
                    value: decodedWeekly.value,
                });
                len += decodedWeekly.len;
                handledScheduleCalendar = true;
            }
            else if (objectId.type === enum_1.ObjectType.SCHEDULE &&
                propertyId === enum_1.PropertyIdentifier.WEEKLY_SCHEDULE &&
                arrayIndex !== enum_1.ASN1_ARRAY_ALL &&
                arrayIndex !== 0) {
                const decodedWeekly = baAsn1.decodeWeeklySchedule(buffer, offset + len, apduLen - len, 2);
                if (!decodedWeekly || !Array.isArray(decodedWeekly.value)) {
                    return undefined;
                }
                const selected = WritePropertyMultiple.pickIndexedWeeklyDay(decodedWeekly.value, arrayIndex);
                if (!Array.isArray(selected))
                    return undefined;
                values.push({
                    type: enum_1.ApplicationTag.WEEKLY_SCHEDULE,
                    value: selected,
                });
                len += decodedWeekly.len;
                handledScheduleCalendar = true;
            }
            else if (objectId.type === enum_1.ObjectType.SCHEDULE &&
                propertyId === enum_1.PropertyIdentifier.EXCEPTION_SCHEDULE &&
                arrayIndex === enum_1.ASN1_ARRAY_ALL) {
                const decodedException = baAsn1.decodeExceptionSchedule(buffer, offset + len, apduLen - len, 2);
                if (!decodedException)
                    return undefined;
                values.push({
                    type: enum_1.ApplicationTag.SPECIAL_EVENT,
                    value: decodedException.value,
                });
                len += decodedException.len;
                handledScheduleCalendar = true;
            }
            else if (objectId.type === enum_1.ObjectType.SCHEDULE &&
                propertyId === enum_1.PropertyIdentifier.EXCEPTION_SCHEDULE &&
                arrayIndex !== enum_1.ASN1_ARRAY_ALL &&
                arrayIndex !== 0) {
                const decodedException = baAsn1.decodeExceptionSchedule(buffer, offset + len, apduLen - len, 2);
                if (!decodedException || !Array.isArray(decodedException.value)) {
                    return undefined;
                }
                const selected = WritePropertyMultiple.pickIndexedEntry(decodedException.value, arrayIndex);
                if (selected == null)
                    return undefined;
                values.push({
                    type: enum_1.ApplicationTag.SPECIAL_EVENT,
                    value: selected,
                });
                len += decodedException.len;
                handledScheduleCalendar = true;
            }
            else if (objectId.type === enum_1.ObjectType.SCHEDULE &&
                propertyId === enum_1.PropertyIdentifier.EFFECTIVE_PERIOD &&
                arrayIndex === enum_1.ASN1_ARRAY_ALL) {
                const decodedEffective = baAsn1.decodeScheduleEffectivePeriod(buffer, offset + len, apduLen - len, 2, 2);
                if (!decodedEffective)
                    return undefined;
                values.push({
                    type: enum_1.ApplicationTag.DATERANGE,
                    value: decodedEffective.value,
                });
                len += decodedEffective.len;
                handledScheduleCalendar = true;
            }
            else if (objectId.type === enum_1.ObjectType.CALENDAR &&
                propertyId === enum_1.PropertyIdentifier.DATE_LIST &&
                arrayIndex === enum_1.ASN1_ARRAY_ALL) {
                const decodedDateList = baAsn1.decodeCalendarDatelist(buffer, offset + len, apduLen - len, 2, 2);
                if (!decodedDateList)
                    return undefined;
                values.push({
                    type: enum_1.ApplicationTag.CALENDAR_ENTRY,
                    value: decodedDateList.value,
                });
                len += decodedDateList.len;
                handledScheduleCalendar = true;
            }
            if (!handledScheduleCalendar) {
                while (len + offset <= buffer.length &&
                    !baAsn1.decodeIsClosingTag(buffer, offset + len)) {
                    const value = baAsn1.bacappDecodeApplicationData(buffer, offset + len, apduLen + offset, objectId.type, propertyId);
                    if (!value)
                        return undefined;
                    len += value.len;
                    delete value.len;
                    values.push(value);
                }
                len++;
            }
            newEntry.value = values;
            let priority = enum_1.ASN1_NO_PRIORITY;
            result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
            len += result.len;
            if (result.tagNumber === 3) {
                decodedValue = baAsn1.decodeUnsigned(buffer, offset + len, result.value);
                len += decodedValue.len;
                priority = decodedValue.value;
            }
            else {
                len--;
            }
            newEntry.priority = priority;
            _values.push(newEntry);
        }
        if (!baAsn1.decodeIsClosingTagNumber(buffer, offset + len, 1))
            return undefined;
        len++;
        return {
            len,
            objectId,
            values: _values,
        };
    }
    static encodeObject(buffer, values) {
        values.forEach((object) => WritePropertyMultiple.encode(buffer, object.objectId, object.values));
    }
}
exports.default = WritePropertyMultiple;
//# sourceMappingURL=WritePropertyMultiple.js.map