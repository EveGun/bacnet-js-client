import { EncodeBuffer, BACNetObjectID, DecodeAcknowledgeSingleResult, ReadPropertyRequest } from '../types';
import { BacnetService } from './AbstractServices';
export default class ReadProperty extends BacnetService {
    private static pickIndexedEntry;
    private static pickIndexedWeeklyDay;
    static encode(buffer: EncodeBuffer, objectType: number, objectInstance: number, propertyId: number, arrayIndex: number): void;
    static decode(buffer: Buffer, offset: number, apduLen: number): ReadPropertyRequest | undefined;
    static encodeAcknowledge(buffer: EncodeBuffer, objectId: BACNetObjectID, propertyId: number, arrayIndex: number, values: any[]): void;
    static decodeAcknowledge(buffer: Buffer, offset: number, apduLen: number): DecodeAcknowledgeSingleResult | undefined;
}
