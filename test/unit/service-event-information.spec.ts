import test from 'node:test'
import assert from 'node:assert'

import * as utils from './utils'
import * as baAsn1 from '../../src/lib/asn1'
import { EventInformation } from '../../src/lib/services'
import { EventState, NotifyType } from '../../src'

test.describe('bacnet - Services layer EventInformation unit', () => {
	test('should successfully encode and decode', (t) => {
		const buffer = utils.getBuffer()
		const date1 = new Date()
		date1.setMilliseconds(990)
		const date2 = new Date()
		date2.setMilliseconds(990)
		const date3 = new Date()
		date3.setMilliseconds(990)
		EventInformation.encode(
			buffer,
			[
				{
					objectId: { type: 0, instance: 32 },
					eventState: EventState.NORMAL,
					acknowledgedTransitions: { value: [14], bitsUsed: 6 },
					eventTimeStamps: [date1, date2, date3],
					notifyType: NotifyType.EVENT,
					eventEnable: { value: [15], bitsUsed: 7 },
					eventPriorities: [2, 3, 4],
				},
			],
			false,
		)
		const result = EventInformation.decode(buffer.buffer, 0, buffer.offset)
		delete result.len
		assert.deepStrictEqual(result, {
			alarms: [
				{
					objectId: {
						type: 0,
						instance: 32,
					},
					eventState: EventState.NORMAL,
					acknowledgedTransitions: {
						bitsUsed: 6,
						value: [14],
					},
					eventTimeStamps: [date1, date2, date3],
					notifyType: NotifyType.EVENT,
					eventEnable: {
						bitsUsed: 7,
						value: [15],
					},
					eventPriorities: [2, 3, 4],
				},
			],
			moreEvents: false,
		})
	})

	test('should decode empty payload with zero-length boolean false', () => {
		const buffer = utils.getBuffer()
		baAsn1.encodeOpeningTag(buffer, 0)
		baAsn1.encodeClosingTag(buffer, 0)
		baAsn1.encodeTag(buffer, 1, true, 0)

		const result = EventInformation.decode(buffer.buffer, 0, buffer.offset)
		assert.ok(result)
		assert.deepStrictEqual(result.alarms, [])
		assert.strictEqual(result.moreEvents, false)
		assert.strictEqual(result.len, buffer.offset)
	})
})
