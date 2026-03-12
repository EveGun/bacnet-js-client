import test from 'node:test'
import assert from 'node:assert'

import * as utils from './utils'
import { TimeStamp } from '../../src'
import { AlarmAcknowledge } from '../../src/lib/services'
import { ZERO_DATE } from '../../src/lib/asn1'

test.describe('bacnet - Services layer AlarmAcknowledge unit', () => {
	test('should successfully encode and decode with time timestamp', () => {
		const buffer = utils.getBuffer()
		const eventTime = new Date(ZERO_DATE)
		eventTime.setMilliseconds(990)
		const ackTime = new Date(ZERO_DATE)
		ackTime.setMilliseconds(880)
		AlarmAcknowledge.encode(
			buffer,
			57,
			{ type: 0, instance: 33 },
			5,
			'Alarm Acknowledge Test',
			{ value: eventTime, type: TimeStamp.TIME },
			{ value: ackTime, type: TimeStamp.TIME },
		)
		const result = AlarmAcknowledge.decode(buffer.buffer, 0, buffer.offset)
		delete result.len
		assert.deepStrictEqual(result, {
			acknowledgedProcessId: 57,
			eventObjectId: {
				type: 0,
				instance: 33,
			},
			eventStateAcknowledged: 5,
			acknowledgeSource: 'Alarm Acknowledge Test',
			eventTimeStamp: eventTime,
			acknowledgeTimeStamp: ackTime,
		})
	})

	test('should successfully encode and decode with sequence timestamp', () => {
		const buffer = utils.getBuffer()
		const eventTime = 5
		const ackTime = 6
		AlarmAcknowledge.encode(
			buffer,
			57,
			{ type: 0, instance: 33 },
			5,
			'Alarm Acknowledge Test',
			{ value: eventTime, type: TimeStamp.SEQUENCE_NUMBER },
			{ value: ackTime, type: TimeStamp.SEQUENCE_NUMBER },
		)
		const result = AlarmAcknowledge.decode(buffer.buffer, 0, buffer.offset)
		delete result.len
		assert.deepStrictEqual(result, {
			acknowledgedProcessId: 57,
			eventObjectId: {
				type: 0,
				instance: 33,
			},
			eventStateAcknowledged: 5,
			acknowledgeSource: 'Alarm Acknowledge Test',
			eventTimeStamp: eventTime,
			acknowledgeTimeStamp: ackTime,
		})
	})

	test('should successfully encode and decode with datetime timestamp', () => {
		const buffer = utils.getBuffer()
		const eventTime = new Date(1, 1, 1)
		eventTime.setMilliseconds(990)
		const ackTime = new Date(1, 1, 2)
		ackTime.setMilliseconds(880)
		AlarmAcknowledge.encode(
			buffer,
			57,
			{ type: 0, instance: 33 },
			5,
			'Alarm Acknowledge Test',
			{ value: eventTime, type: TimeStamp.DATETIME },
			{ value: ackTime, type: TimeStamp.DATETIME },
		)
		const result = AlarmAcknowledge.decode(buffer.buffer, 0, buffer.offset)
		delete result.len
		assert.deepStrictEqual(result, {
			acknowledgedProcessId: 57,
			eventObjectId: {
				type: 0,
				instance: 33,
			},
			eventStateAcknowledged: 5,
			acknowledgeSource: 'Alarm Acknowledge Test',
			eventTimeStamp: eventTime,
			acknowledgeTimeStamp: ackTime,
		})
	})

	test('should decode correctly when payload starts at non-zero offset', () => {
		const ack = utils.getBuffer()
		const eventTime = new Date(ZERO_DATE)
		eventTime.setHours(12, 1, 2, 130)
		const ackTime = new Date(ZERO_DATE)
		ackTime.setHours(13, 2, 3, 140)
		AlarmAcknowledge.encode(
			ack,
			77,
			{ type: 2, instance: 44 },
			3,
			'Ack Source',
			{ value: eventTime, type: TimeStamp.TIME },
			{ value: ackTime, type: TimeStamp.TIME },
		)

		const prefix = Buffer.from([0xaa, 0xbb, 0xcc])
		const combined = Buffer.concat([prefix, ack.buffer.slice(0, ack.offset)])
		const result = AlarmAcknowledge.decode(
			combined,
			prefix.length,
			ack.offset,
		)
		delete result.len

		assert.deepStrictEqual(result, {
			acknowledgedProcessId: 77,
			eventObjectId: { type: 2, instance: 44 },
			eventStateAcknowledged: 3,
			acknowledgeSource: 'Ack Source',
			eventTimeStamp: eventTime,
			acknowledgeTimeStamp: ackTime,
		})
	})
})
