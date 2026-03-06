import test from 'node:test'
import assert from 'node:assert'

import * as utils from './utils'
import * as baAsn1 from '../../src/lib/asn1'
import {
	AccessEvent,
	ApplicationTag,
	AuthenticationFactorType,
	BACNetObjectID,
	CovType,
	EventType,
	NotifyType,
	TimeStamp,
} from '../../src'
import { EventNotifyData } from '../../src/lib/services'

test.describe('bacnet - Services layer EventNotifyData unit', () => {
	const encodeAlarmHeader = (
		buffer: ReturnType<typeof utils.getBuffer>,
		eventType: EventType,
		timeStamp: { type: TimeStamp; value: Date | number },
	) => {
		baAsn1.encodeContextUnsigned(buffer, 0, 9)
		baAsn1.encodeContextObjectId(buffer, 1, 8, 1319071)
		baAsn1.encodeContextObjectId(buffer, 2, 13, 42)
		baAsn1.bacappEncodeContextTimestamp(buffer, 3, timeStamp)
		baAsn1.encodeContextUnsigned(buffer, 4, 1)
		baAsn1.encodeContextUnsigned(buffer, 5, 16)
		baAsn1.encodeContextEnumerated(buffer, 6, eventType)
		baAsn1.encodeContextEnumerated(buffer, 8, NotifyType.ALARM)
		baAsn1.encodeContextBoolean(buffer, 9, true)
		baAsn1.encodeContextEnumerated(buffer, 10, 2)
		baAsn1.encodeContextEnumerated(buffer, 11, 3)
	}

	test('should successfully encode and decode a change of bitstring event', (t) => {
		const buffer = utils.getBuffer()
		const date = new Date()
		date.setMilliseconds(880)
		EventNotifyData.encode(buffer, {
			processId: 3,
			initiatingObjectId: { type: 60, instance: 12 },
			eventObjectId: { type: 61, instance: 1121 },
			timeStamp: { type: 2, value: date },
			notificationClass: 9,
			priority: 7,
			eventType: 0,
			messageText: 'Test1234$',
			notifyType: 1,
			ackRequired: true,
			fromState: 5,
			toState: 6,
			changeOfBitstringReferencedBitString: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
			changeOfBitstringStatusFlags: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
		})
		const result = EventNotifyData.decode(buffer.buffer, 0)
		delete result.len
		assert.deepStrictEqual(result, {
			processId: 3,
			initiatingObjectId: { type: 60, instance: 12 },
			eventObjectId: { type: 61, instance: 1121 },
			timeStamp: { type: 2, value: date },
			notificationClass: 9,
			priority: 7,
			eventType: 0,
			messageText: 'Test1234$',
			notifyType: 1,
			ackRequired: true,
			fromState: 5,
			toState: 6,
			changeOfBitstringReferencedBitString: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
			changeOfBitstringStatusFlags: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
		})
	})

	test('should successfully encode and decode a change of state event', (t) => {
		const buffer = utils.getBuffer()
		const date = new Date()
		date.setMilliseconds(880)
		EventNotifyData.encode(buffer, {
			processId: 3,
			initiatingObjectId: {} as BACNetObjectID,
			eventObjectId: {} as BACNetObjectID,
			timeStamp: { type: 2, value: date },
			notificationClass: 9,
			priority: 7,
			eventType: 1,
			messageText: 'Test1234$',
			notifyType: 1,
			ackRequired: false,
			fromState: 1,
			toState: 2,
			changeOfStateNewState: { type: 2, state: 2 },
			changeOfStateStatusFlags: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
		})
		const result = EventNotifyData.decode(buffer.buffer, 0)
		delete result.len
		assert.deepStrictEqual(result, {
			processId: 3,
			initiatingObjectId: { type: 0, instance: 0 },
			eventObjectId: { type: 0, instance: 0 },
			timeStamp: { type: 2, value: date },
			notificationClass: 9,
			priority: 7,
			eventType: 1,
			messageText: 'Test1234$',
			notifyType: 1,
			ackRequired: false,
			fromState: 1,
			toState: 2,
			changeOfStateNewState: { type: 2, state: 2 },
			changeOfStateStatusFlags: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
		})
	})

	test('should successfully encode and decode a change of value event', (t) => {
		const buffer = utils.getBuffer()
		const date = new Date()
		date.setMilliseconds(880)
		EventNotifyData.encode(buffer, {
			processId: 3,
			initiatingObjectId: {} as BACNetObjectID,
			eventObjectId: {} as BACNetObjectID,
			timeStamp: { type: 2, value: date },
			notificationClass: 9,
			priority: 7,
			eventType: 2,
			messageText: 'Test1234$',
			notifyType: 1,
			changeOfValueTag: CovType.REAL,
			changeOfValueChangeValue: 90,
			changeOfValueStatusFlags: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
			ackRequired: false,
			fromState: 0,
			toState: 0,
		})
		const result = EventNotifyData.decode(buffer.buffer, 0)
		delete result.len
		assert.deepStrictEqual(result, {
			processId: 3,
			initiatingObjectId: { type: 0, instance: 0 },
			eventObjectId: { type: 0, instance: 0 },
			timeStamp: { type: 2, value: date },
			notificationClass: 9,
			priority: 7,
			eventType: 2,
			messageText: 'Test1234$',
			notifyType: 1,
			ackRequired: false,
			fromState: 0,
			toState: 0,
			changeOfValueTag: CovType.REAL,
			changeOfValueChangeValue: 90,
			changeOfValueStatusFlags: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
		})
	})

	test('should successfully encode and decode a floating limit event', (t) => {
		const buffer = utils.getBuffer()
		const date = new Date()
		date.setMilliseconds(880)
		EventNotifyData.encode(buffer, {
			processId: 3,
			initiatingObjectId: {} as BACNetObjectID,
			eventObjectId: {} as BACNetObjectID,
			timeStamp: { type: 2, value: date },
			notificationClass: 9,
			priority: 7,
			eventType: 4,
			messageText: 'Test1234$',
			notifyType: 1,
			ackRequired: true,
			fromState: 19,
			toState: 12,
			floatingLimitReferenceValue: 121,
			floatingLimitStatusFlags: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
			floatingLimitSetPointValue: 120,
			floatingLimitErrorLimit: 120,
		})
		const result = EventNotifyData.decode(buffer.buffer, 0)
		delete result.len
		assert.deepStrictEqual(result, {
			processId: 3,
			initiatingObjectId: { type: 0, instance: 0 },
			eventObjectId: { type: 0, instance: 0 },
			timeStamp: { type: 2, value: date },
			notificationClass: 9,
			priority: 7,
			eventType: 4,
			messageText: 'Test1234$',
			notifyType: 1,
			ackRequired: true,
			fromState: 19,
			toState: 12,
			floatingLimitReferenceValue: 121,
			floatingLimitStatusFlags: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
			floatingLimitSetPointValue: 120,
			floatingLimitErrorLimit: 120,
		})
	})

	// Remaining tests follow the same pattern...
	test('should successfully encode and decode an out of range event', (t) => {
		const buffer = utils.getBuffer()
		const date = new Date()
		date.setMilliseconds(880)
		EventNotifyData.encode(buffer, {
			processId: 3,
			initiatingObjectId: {} as BACNetObjectID,
			eventObjectId: {} as BACNetObjectID,
			timeStamp: { type: 2, value: date },
			notificationClass: 9,
			priority: 7,
			eventType: 5,
			messageText: 'Test1234$',
			notifyType: 1,
			outOfRangeExceedingValue: 155,
			outOfRangeStatusFlags: { bitsUsed: 24, value: [0xaa, 0xaa, 0xaa] },
			outOfRangeDeadband: 50,
			outOfRangeExceededLimit: 150,
			ackRequired: false,
			fromState: 0,
			toState: 0,
		})
		const result = EventNotifyData.decode(buffer.buffer, 0)
		delete result.len
		assert.deepStrictEqual(result, {
			processId: 3,
			initiatingObjectId: { type: 0, instance: 0 },
			eventObjectId: { type: 0, instance: 0 },
			timeStamp: { type: 2, value: date },
			notificationClass: 9,
			priority: 7,
			eventType: 5,
			messageText: 'Test1234$',
			notifyType: 1,
			ackRequired: false,
			fromState: 0,
			toState: 0,
			outOfRangeExceedingValue: 155,
			outOfRangeStatusFlags: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
			outOfRangeDeadband: 50,
			outOfRangeExceededLimit: 150,
		})
	})

	// I'll continue with the remaining test cases in the same pattern
	test('should successfully encode and decode a change of life-safety event', (t) => {
		const buffer = utils.getBuffer()
		const date = new Date()
		date.setMilliseconds(880)
		EventNotifyData.encode(buffer, {
			processId: 3,
			initiatingObjectId: {} as BACNetObjectID,
			eventObjectId: {} as BACNetObjectID,
			timeStamp: { type: 2, value: date },
			notificationClass: 9,
			priority: 7,
			eventType: 8,
			messageText: 'Test1234$',
			notifyType: 1,
			changeOfLifeSafetyNewState: 8,
			changeOfLifeSafetyNewMode: 9,
			changeOfLifeSafetyStatusFlags: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
			changeOfLifeSafetyOperationExpected: 2,
			ackRequired: false,
			fromState: 0,
			toState: 0,
		})
		const result = EventNotifyData.decode(buffer.buffer, 0)
		delete result.len
		assert.deepStrictEqual(result, {
			processId: 3,
			initiatingObjectId: { type: 0, instance: 0 },
			eventObjectId: { type: 0, instance: 0 },
			timeStamp: { type: 2, value: date },
			notificationClass: 9,
			priority: 7,
			eventType: 8,
			messageText: 'Test1234$',
			notifyType: 1,
			ackRequired: false,
			fromState: 0,
			toState: 0,
			changeOfLifeSafetyNewState: 8,
			changeOfLifeSafetyNewMode: 9,
			changeOfLifeSafetyStatusFlags: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
			changeOfLifeSafetyOperationExpected: 2,
		})
	})

	test('should successfully encode and decode a buffer ready event', (t) => {
		const buffer = utils.getBuffer()
		const date = new Date()
		date.setMilliseconds(880)
		EventNotifyData.encode(buffer, {
			processId: 3,
			initiatingObjectId: {} as BACNetObjectID,
			eventObjectId: {} as BACNetObjectID,
			timeStamp: { type: 2, value: date },
			notificationClass: 9,
			priority: 7,
			eventType: 10,
			messageText: 'Test1234$',
			notifyType: 1,
			bufferReadyBufferProperty: {
				objectId: { type: 0, instance: 2 },
				id: 85,
				arrayIndex: 3,
				deviceIndentifier: { type: 8, instance: 443 },
			},
			bufferReadyPreviousNotification: 121,
			bufferReadyCurrentNotification: 281,
			ackRequired: false,
			fromState: 0,
			toState: 0,
		})
		const result = EventNotifyData.decode(buffer.buffer, 0)
		delete result.len
		assert.deepStrictEqual(result, {
			processId: 3,
			initiatingObjectId: { type: 0, instance: 0 },
			eventObjectId: { type: 0, instance: 0 },
			timeStamp: { type: 2, value: date },
			notificationClass: 9,
			priority: 7,
			eventType: 10,
			messageText: 'Test1234$',
			notifyType: 1,
			ackRequired: false,
			fromState: 0,
			toState: 0,
			bufferReadyBufferProperty: {
				objectId: { type: 0, instance: 2 },
				id: 85,
				arrayIndex: 3,
				deviceIndentifier: { type: 8, instance: 443 },
			},
			bufferReadyPreviousNotification: 121,
			bufferReadyCurrentNotification: 281,
		})
	})

	test('should successfully encode and decode a unsigned range event', (t) => {
		const buffer = utils.getBuffer()
		const date = new Date()
		date.setMilliseconds(880)
		EventNotifyData.encode(buffer, {
			processId: 3,
			initiatingObjectId: {} as BACNetObjectID,
			eventObjectId: {} as BACNetObjectID,
			timeStamp: { type: 2, value: date },
			notificationClass: 9,
			priority: 7,
			eventType: 11,
			messageText: 'Test1234$',
			notifyType: 1,
			unsignedRangeExceedingValue: 101,
			unsignedRangeStatusFlags: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
			unsignedRangeExceededLimit: 100,
			ackRequired: false,
			fromState: 0,
			toState: 0,
		})
		const result = EventNotifyData.decode(buffer.buffer, 0)
		delete result.len
		assert.deepStrictEqual(result, {
			processId: 3,
			initiatingObjectId: { type: 0, instance: 0 },
			eventObjectId: { type: 0, instance: 0 },
			timeStamp: {
				type: 2,
				value: date,
			},
			notificationClass: 9,
			priority: 7,
			eventType: 11,
			messageText: 'Test1234$',
			notifyType: 1,
			ackRequired: false,
			fromState: 0,
			toState: 0,
			unsignedRangeExceedingValue: 101,
			unsignedRangeStatusFlags: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
			unsignedRangeExceededLimit: 100,
		})
	})

	test('should decode BACnetPropertyStates in event values for ALARM notifications', (t) => {
		const buffer = utils.getBuffer()
		const date = new Date()
		date.setMilliseconds(880)
		EventNotifyData.encode(buffer, {
			processId: 7,
			initiatingObjectId: { type: 8, instance: 1319071 },
			eventObjectId: { type: 13, instance: 42 },
			timeStamp: { type: 2, value: date },
			notificationClass: 1,
			priority: 16,
			eventType: EventType.CHANGE_OF_STATE,
			notifyType: NotifyType.ALARM,
			ackRequired: true,
			fromState: 2,
			toState: 3,
			changeOfStateNewState: { type: 11, state: 1234 },
			changeOfStateStatusFlags: {
				bitsUsed: 4,
				value: [0b00001111],
			},
		})
		const result = EventNotifyData.decode(buffer.buffer, 0)
		delete result.len
		assert.deepStrictEqual(result, {
			processId: 7,
			initiatingObjectId: { type: 8, instance: 1319071 },
			eventObjectId: { type: 13, instance: 42 },
			timeStamp: { type: 2, value: date },
			notificationClass: 1,
			priority: 16,
			eventType: EventType.CHANGE_OF_STATE,
			notifyType: NotifyType.ALARM,
			ackRequired: true,
			fromState: 2,
			toState: 3,
			changeOfStateNewState: { type: 11, state: 1234 },
			changeOfStateStatusFlags: {
				bitsUsed: 4,
				value: [0b00001111],
			},
		})
	})

	test('should decode timestamp with TIME choice', () => {
		const buffer = utils.getBuffer()
		const timeStamp = new Date(baAsn1.ZERO_DATE)
		timeStamp.setHours(12, 13, 14, 150)
		EventNotifyData.encode(buffer, {
			processId: 3,
			initiatingObjectId: { type: 60, instance: 12 },
			eventObjectId: { type: 61, instance: 1121 },
			timeStamp: { type: TimeStamp.TIME, value: timeStamp },
			notificationClass: 9,
			priority: 7,
			eventType: EventType.CHANGE_OF_BITSTRING,
			notifyType: NotifyType.EVENT,
			ackRequired: true,
			fromState: 5,
			toState: 6,
			changeOfBitstringReferencedBitString: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
			changeOfBitstringStatusFlags: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
		})
		const result = EventNotifyData.decode(buffer.buffer, 0)
		assert.ok(result)
		assert.deepStrictEqual(result.timeStamp, {
			type: TimeStamp.TIME,
			value: timeStamp,
		})
	})

	test('should decode timestamp with SEQUENCE_NUMBER choice', () => {
		const buffer = utils.getBuffer()
		EventNotifyData.encode(buffer, {
			processId: 3,
			initiatingObjectId: { type: 60, instance: 12 },
			eventObjectId: { type: 61, instance: 1121 },
			timeStamp: { type: TimeStamp.SEQUENCE_NUMBER, value: 77 },
			notificationClass: 9,
			priority: 7,
			eventType: EventType.CHANGE_OF_BITSTRING,
			notifyType: NotifyType.EVENT,
			ackRequired: true,
			fromState: 5,
			toState: 6,
			changeOfBitstringReferencedBitString: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
			changeOfBitstringStatusFlags: {
				bitsUsed: 24,
				value: [0xaa, 0xaa, 0xaa],
			},
		})
		const result = EventNotifyData.decode(buffer.buffer, 0)
		assert.ok(result)
		assert.deepStrictEqual(result.timeStamp, {
			type: TimeStamp.SEQUENCE_NUMBER,
			value: 77,
		})
	})

	test('should decode command-failure event values', () => {
		const buffer = utils.getBuffer()
		const eventDate = new Date(2026, 0, 5, 14, 15, 16, 170)
		encodeAlarmHeader(buffer, EventType.COMMAND_FAILURE, {
			type: TimeStamp.DATETIME,
			value: eventDate,
		})
		baAsn1.encodeOpeningTag(buffer, 12)
		baAsn1.encodeOpeningTag(buffer, 3)
		baAsn1.encodeContextSigned(buffer, 0, -11)
		baAsn1.encodeContextBitstring(buffer, 1, {
			bitsUsed: 4,
			value: [0b00001101],
		})
		baAsn1.encodeContextUnsigned(buffer, 2, 42)
		baAsn1.encodeClosingTag(buffer, 3)
		baAsn1.encodeClosingTag(buffer, 12)

		const result = EventNotifyData.decode(buffer.buffer, 0)
		assert.ok(result)
		assert.strictEqual(result.eventType, EventType.COMMAND_FAILURE)
		assert.ok(Buffer.isBuffer(result.commandFailureCommandValue))
		assert.ok(result.commandFailureCommandValue?.length)
		assert.ok(result.commandFailureCommandValueDecoded)
		assert.deepStrictEqual(result.commandFailureStatusFlags, {
			bitsUsed: 4,
			value: [0b00001101],
		})
		assert.ok(Buffer.isBuffer(result.commandFailureFeedbackValue))
		assert.ok(result.commandFailureFeedbackValue?.length)
		assert.ok(result.commandFailureFeedbackValueDecoded)
	})

	test('should decode signed-out-of-range event values', () => {
		const buffer = utils.getBuffer()
		const eventDate = new Date(2026, 0, 6, 8, 9, 10, 110)
		encodeAlarmHeader(buffer, EventType.SIGNED_OUT_OF_RANGE, {
			type: TimeStamp.DATETIME,
			value: eventDate,
		})
		baAsn1.encodeOpeningTag(buffer, 12)
		baAsn1.encodeOpeningTag(buffer, 15)
		baAsn1.encodeContextSigned(buffer, 0, -21)
		baAsn1.encodeContextBitstring(buffer, 1, {
			bitsUsed: 4,
			value: [0b00000111],
		})
		baAsn1.encodeContextUnsigned(buffer, 2, 4)
		baAsn1.encodeContextSigned(buffer, 3, -17)
		baAsn1.encodeClosingTag(buffer, 15)
		baAsn1.encodeClosingTag(buffer, 12)

		const result = EventNotifyData.decode(buffer.buffer, 0)
		assert.ok(result)
		assert.strictEqual(result.eventType, EventType.SIGNED_OUT_OF_RANGE)
		assert.strictEqual(result.signedOutOfRangeExceedingValue, -21)
		assert.deepStrictEqual(result.signedOutOfRangeStatusFlags, {
			bitsUsed: 4,
			value: [0b00000111],
		})
		assert.strictEqual(result.signedOutOfRangeDeadband, 4)
		assert.strictEqual(result.signedOutOfRangeExceededLimit, -17)
	})

	test('should decode change-of-discrete-value with datetime choice', () => {
		const buffer = utils.getBuffer()
		const eventDate = new Date(2026, 0, 7, 8, 9, 10, 120)
		const discreteDateTime = new Date(2026, 0, 7, 11, 12, 13, 140)
		encodeAlarmHeader(buffer, EventType.CHANGE_OF_DISCRETE_VALUE, {
			type: TimeStamp.DATETIME,
			value: eventDate,
		})
		baAsn1.encodeOpeningTag(buffer, 12)
		baAsn1.encodeOpeningTag(buffer, 21)
		baAsn1.encodeOpeningTag(buffer, 0)
		baAsn1.encodeOpeningTag(buffer, 0)
		baAsn1.encodeApplicationDate(buffer, discreteDateTime)
		baAsn1.encodeApplicationTime(buffer, discreteDateTime)
		baAsn1.encodeClosingTag(buffer, 0)
		baAsn1.encodeClosingTag(buffer, 0)
		baAsn1.encodeContextBitstring(buffer, 1, {
			bitsUsed: 4,
			value: [0b00001111],
		})
		baAsn1.encodeClosingTag(buffer, 21)
		baAsn1.encodeClosingTag(buffer, 12)

		const result = EventNotifyData.decode(buffer.buffer, 0)
		assert.ok(result)
		assert.strictEqual(result.eventType, EventType.CHANGE_OF_DISCRETE_VALUE)
		assert.deepStrictEqual(result.changeOfDiscreteValueNewValue, {
			type: ApplicationTag.DATETIME,
			value: discreteDateTime,
		})
		assert.deepStrictEqual(result.changeOfDiscreteValueStatusFlags, {
			bitsUsed: 4,
			value: [0b00001111],
		})
	})

	test('should decode change-of-timer event values with optional fields', () => {
		const buffer = utils.getBuffer()
		const eventDate = new Date(2026, 0, 8, 8, 9, 10, 130)
		const updateTime = new Date(2026, 0, 8, 12, 13, 14, 150)
		const expirationTime = new Date(2026, 0, 8, 13, 14, 15, 160)
		encodeAlarmHeader(buffer, EventType.CHANGE_OF_TIMER, {
			type: TimeStamp.DATETIME,
			value: eventDate,
		})
		baAsn1.encodeOpeningTag(buffer, 12)
		baAsn1.encodeOpeningTag(buffer, 22)
		baAsn1.encodeContextEnumerated(buffer, 0, 1)
		baAsn1.encodeContextBitstring(buffer, 1, {
			bitsUsed: 4,
			value: [0b00000101],
		})
		baAsn1.encodeOpeningTag(buffer, 2)
		baAsn1.encodeApplicationDate(buffer, updateTime)
		baAsn1.encodeApplicationTime(buffer, updateTime)
		baAsn1.encodeClosingTag(buffer, 2)
		baAsn1.encodeContextEnumerated(buffer, 3, 4)
		baAsn1.encodeContextUnsigned(buffer, 4, 300)
		baAsn1.encodeOpeningTag(buffer, 5)
		baAsn1.encodeApplicationDate(buffer, expirationTime)
		baAsn1.encodeApplicationTime(buffer, expirationTime)
		baAsn1.encodeClosingTag(buffer, 5)
		baAsn1.encodeClosingTag(buffer, 22)
		baAsn1.encodeClosingTag(buffer, 12)

		const result = EventNotifyData.decode(buffer.buffer, 0)
		assert.ok(result)
		assert.strictEqual(result.eventType, EventType.CHANGE_OF_TIMER)
		assert.strictEqual(result.changeOfTimerNewState, 1)
		assert.deepStrictEqual(result.changeOfTimerStatusFlags, {
			bitsUsed: 4,
			value: [0b00000101],
		})
		assert.deepStrictEqual(result.changeOfTimerUpdateTime, updateTime)
		assert.strictEqual(result.changeOfTimerLastStateChange, 4)
		assert.strictEqual(result.changeOfTimerInitialTimeout, 300)
		assert.deepStrictEqual(
			result.changeOfTimerExpirationTime,
			expirationTime,
		)
	})

	test('should decode access-event event values with authentication factor', () => {
		const buffer = utils.getBuffer()
		const eventDate = new Date(2026, 0, 9, 8, 9, 10, 140)
		const authValue = Buffer.from([0xde, 0xad, 0xbe, 0xef])
		encodeAlarmHeader(buffer, EventType.ACCESS_EVENT, {
			type: TimeStamp.DATETIME,
			value: eventDate,
		})
		baAsn1.encodeOpeningTag(buffer, 12)
		baAsn1.encodeOpeningTag(buffer, 13)
		baAsn1.encodeContextEnumerated(buffer, 0, AccessEvent.GRANTED)
		baAsn1.encodeContextBitstring(buffer, 1, {
			bitsUsed: 4,
			value: [0b00001001],
		})
		baAsn1.encodeContextUnsigned(buffer, 2, 55)
		baAsn1.bacappEncodeContextTimestamp(buffer, 3, {
			type: TimeStamp.SEQUENCE_NUMBER,
			value: 88,
		})
		baAsn1.encodeOpeningTag(buffer, 4)
		baAsn1.encodeContextObjectId(buffer, 0, 8, 1319071)
		baAsn1.encodeContextObjectId(buffer, 1, 32, 987)
		baAsn1.encodeClosingTag(buffer, 4)
		baAsn1.encodeOpeningTag(buffer, 5)
		baAsn1.encodeContextEnumerated(
			buffer,
			0,
			AuthenticationFactorType.SIMPLE_NUMBER32,
		)
		baAsn1.encodeContextUnsigned(buffer, 1, 1)
		baAsn1.encodeTag(buffer, 2, true, authValue.length)
		authValue.copy(buffer.buffer, buffer.offset)
		buffer.offset += authValue.length
		baAsn1.encodeClosingTag(buffer, 5)
		baAsn1.encodeClosingTag(buffer, 13)
		baAsn1.encodeClosingTag(buffer, 12)

		const result = EventNotifyData.decode(buffer.buffer, 0)
		assert.ok(result)
		assert.strictEqual(result.eventType, EventType.ACCESS_EVENT)
		assert.strictEqual(result.accessEventAccessEvent, AccessEvent.GRANTED)
		assert.deepStrictEqual(result.accessEventStatusFlags, {
			bitsUsed: 4,
			value: [0b00001001],
		})
		assert.strictEqual(result.accessEventTag, 55)
		assert.deepStrictEqual(result.accessEventTime, {
			type: TimeStamp.SEQUENCE_NUMBER,
			value: 88,
		})
		assert.deepStrictEqual(result.accessEventAccessCredential, {
			deviceIdentifier: { type: 8, instance: 1319071 },
			objectIdentifier: { type: 32, instance: 987 },
		})
		assert.deepStrictEqual(result.accessEventAuthenticationFactor, {
			formatType: AuthenticationFactorType.SIMPLE_NUMBER32,
			formatClass: 1,
			value: authValue,
		})
	})
})
