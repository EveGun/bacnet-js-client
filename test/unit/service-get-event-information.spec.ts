import test from 'node:test'
import assert from 'node:assert'

import * as utils from './utils'
import * as baAsn1 from '../../src/lib/asn1'
import { EventState, NotifyType, TimeStamp } from '../../src'
import { GetEventInformation } from '../../src/lib/services'

test.describe('bacnet - Services layer GetEventInformation unit', () => {
	test('should encode and decode request with lastReceivedObjectId', () => {
		const buffer = utils.getBuffer()
		GetEventInformation.encode(buffer, { type: 5, instance: 33 })
		const payload = Buffer.from(buffer.buffer.subarray(0, buffer.offset))
		const result = GetEventInformation.decode(payload, 0)
		assert.deepStrictEqual(result, {
			len: buffer.offset,
			lastReceivedObjectId: {
				type: 5,
				instance: 33,
			},
		})
	})

	test('should decode request without optional lastReceivedObjectId', () => {
		const buffer = utils.getBuffer()
		const payload = Buffer.from(buffer.buffer.subarray(0, buffer.offset))
		const result = GetEventInformation.decode(payload, 0)
		assert.deepStrictEqual(result, {
			len: 0,
			lastReceivedObjectId: null,
		})
	})

	test('should encode and decode acknowledge payload with moreEvents=true', () => {
		const buffer = utils.getBuffer()
		GetEventInformation.encodeAcknowledge(
			buffer,
			[
				{
					objectId: { type: 12, instance: 120 },
					eventState: EventState.NORMAL,
					acknowledgedTransitions: { value: [0b101], bitsUsed: 3 },
					eventTimeStamps: [
						{ type: TimeStamp.SEQUENCE_NUMBER, value: 9 },
						{ type: TimeStamp.SEQUENCE_NUMBER, value: 10 },
						{ type: TimeStamp.SEQUENCE_NUMBER, value: 11 },
					],
					notifyType: NotifyType.EVENT,
					eventEnable: { value: [0b111], bitsUsed: 3 },
					eventPriorities: [1, 2, 3],
				},
			],
			true,
		)

		const result = GetEventInformation.decodeAcknowledge(
			buffer.buffer,
			0,
			buffer.offset,
		)

		assert.ok(result)
		assert.strictEqual(result.moreEvents, true)
		assert.strictEqual(result.events.length, 1)
		assert.deepStrictEqual(result.events[0].objectId, {
			type: 12,
			instance: 120,
		})
		assert.strictEqual(result.events[0].eventState, EventState.NORMAL)
		assert.strictEqual(result.events[0].notifyType, NotifyType.EVENT)
		assert.deepStrictEqual(result.events[0].eventPriorities, [1, 2, 3])
	})

	test('should encode and decode acknowledge payload with moreEvents=false', () => {
		const buffer = utils.getBuffer()
		GetEventInformation.encodeAcknowledge(
			buffer,
			[
				{
					objectId: { type: 12, instance: 120 },
					eventState: EventState.NORMAL,
					acknowledgedTransitions: { value: [0b001], bitsUsed: 3 },
					eventTimeStamps: [
						{ type: TimeStamp.SEQUENCE_NUMBER, value: 1 },
						{ type: TimeStamp.SEQUENCE_NUMBER, value: 2 },
						{ type: TimeStamp.SEQUENCE_NUMBER, value: 3 },
					],
					notifyType: NotifyType.EVENT,
					eventEnable: { value: [0b111], bitsUsed: 3 },
					eventPriorities: [9, 8, 7],
				},
			],
			false,
		)

		const result = GetEventInformation.decodeAcknowledge(
			buffer.buffer,
			0,
			buffer.offset,
		)

		assert.ok(result)
		assert.strictEqual(result.moreEvents, false)
		assert.strictEqual(result.events.length, 1)
	})

	test('should decode acknowledge payload with boolean false encoded as zero-length context tag', () => {
		const buffer = utils.getBuffer()
		baAsn1.encodeOpeningTag(buffer, 0)
		baAsn1.encodeClosingTag(buffer, 0)
		baAsn1.encodeTag(buffer, 1, true, 0)

		const result = GetEventInformation.decodeAcknowledge(
			buffer.buffer,
			0,
			buffer.offset,
		)
		assert.ok(result)
		assert.strictEqual(result.moreEvents, false)
		assert.strictEqual(result.events.length, 0)
		assert.strictEqual(result.len, buffer.offset)
	})
})
