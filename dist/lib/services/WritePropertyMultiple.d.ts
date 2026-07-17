import { ObjectType } from '../enum';
import { EncodeBuffer, BACNetObjectID, WritePropertyMultipleValue, WritePropertyMultipleObject } from '../types';
import { BacnetService } from './AbstractServices';
export default class WritePropertyMultiple extends BacnetService {
    private static pickIndexedEntry;
    private static pickIndexedWeeklyDay;
    static encode(buffer: EncodeBuffer, objectId: BACNetObjectID, values: WritePropertyMultipleValue[]): void;
    static decode(buffer: Buffer, offset: number, apduLen: number): {
        len: number;
        objectId: {
            type: ObjectType;
            instance: number;
        };
        values: any[];
    };
    static encodeObject(buffer: EncodeBuffer, values: WritePropertyMultipleObject[]): void;
}
