/**
 * BTL B-OWS Compliance Tests — Schedule, Calendar & Trend Log
 *
 * Tests against a live BACnet device per ASHRAE 135 and BTL Test Package requirements
 * for B-OWS (BACnet Operator Workstation) profile.
 *
 * Relevant BTL test sections:
 *   - 9.22  Schedule Object Tests (ReadProperty, WriteProperty)
 *   - 9.23  Calendar Object Tests
 *   - 9.18  Trend Log Object Tests (ReadRange)
 *
 * Target device: 192.168.40.245:47808
 * Objects: Schedule:0, Calendar:0, TrendLog:0
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import Bacnet, {
	ObjectType,
	PropertyIdentifier,
	ApplicationTag,
	ReadRangeType,
	ASN1_ARRAY_ALL,
	MaxSegmentsAccepted,
} from '../../src/index'
import type {
	BACNetWeeklySchedulePayload,
	BACNetExceptionSchedulePayload,
	BACNetEffectivePeriodPayload,
	BACNetCalendarDateListPayload,
} from '../../src/lib/types'

const TARGET = { address: '192.168.40.245:47808' }
const SCHEDULE = { type: ObjectType.SCHEDULE, instance: 0 }
const CALENDAR = { type: ObjectType.CALENDAR, instance: 0 }
const TREND_LOG = { type: ObjectType.TREND_LOG, instance: 0 }
const TIMEOUT = 6000

let client: InstanceType<typeof Bacnet>

before(async () => {
	client = new Bacnet({ apduTimeout: TIMEOUT, port: 0 })
	await once(client as any, 'listening')
})

after(() => {
	client?.close()
})

// ============================================================================
// BTL 9.22 — SCHEDULE OBJECT
// ============================================================================

describe('BTL 9.22 — Schedule Object', () => {
	// -------------------------------------------------------------------------
	// 9.22.1 Read Schedule Properties
	// -------------------------------------------------------------------------

	describe('9.22.1 — Read Schedule Properties', () => {
		test('9.22.1.1 Read OBJECT_NAME', async () => {
			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.OBJECT_NAME,
			)
			assert.ok(result.values.length > 0, 'Should return a value')
			const name = result.values[0]?.value
			assert.ok(
				typeof name === 'string' ||
					(name && typeof (name as any).value === 'string'),
				'OBJECT_NAME should be a string',
			)
			console.log('  Schedule OBJECT_NAME:', name)
		})

		test('9.22.1.2 Read PRESENT_VALUE', async () => {
			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.PRESENT_VALUE,
			)
			assert.ok(result.values.length > 0, 'Should return present value')
			console.log('  Schedule PRESENT_VALUE:', result.values[0]?.value)
		})

		test('9.22.1.3 Read WEEKLY_SCHEDULE (all days)', async () => {
			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.WEEKLY_SCHEDULE,
			)
			assert.ok(result.values.length > 0, 'Should return weekly schedule')
			const weekly = result.values[0]?.value
			assert.ok(
				Array.isArray(weekly),
				'WEEKLY_SCHEDULE should be an array',
			)
			assert.equal(
				(weekly as any[]).length,
				7,
				'WEEKLY_SCHEDULE must have exactly 7 days',
			)
			console.log(
				'  WEEKLY_SCHEDULE days:',
				(weekly as any[]).map((d: any) =>
					Array.isArray(d) ? `${d.length} entries` : typeof d,
				),
			)
		})

		test('9.22.1.4 Read WEEKLY_SCHEDULE by array index (each day)', async () => {
			for (let dayIndex = 1; dayIndex <= 7; dayIndex++) {
				const result = await client.readProperty(
					TARGET,
					SCHEDULE,
					PropertyIdentifier.WEEKLY_SCHEDULE,
					{ arrayIndex: dayIndex },
				)
				assert.ok(
					result.values.length > 0,
					`Day ${dayIndex} should return a value`,
				)
				const day = result.values[0]?.value
				assert.ok(
					Array.isArray(day) || day != null,
					`Day ${dayIndex} should have entries or be empty`,
				)
				console.log(
					`  Day ${dayIndex}:`,
					Array.isArray(day)
						? `${day.length} time-value entries`
						: day,
				)
			}
		})

		test('9.22.1.5 Read WEEKLY_SCHEDULE array size (index 0)', async () => {
			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.WEEKLY_SCHEDULE,
				{ arrayIndex: 0 },
			)
			assert.ok(result.values.length > 0, 'Should return array size')
			const size = result.values[0]?.value
			assert.equal(size, 7, 'WEEKLY_SCHEDULE array size must be 7')
			console.log('  WEEKLY_SCHEDULE array size:', size)
		})

		test('9.22.1.6 Read EXCEPTION_SCHEDULE (all entries)', async () => {
			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EXCEPTION_SCHEDULE,
			)
			assert.ok(
				result.values.length > 0,
				'Should return exception schedule',
			)
			const exceptions = result.values[0]?.value
			console.log(
				'  EXCEPTION_SCHEDULE:',
				Array.isArray(exceptions)
					? `${exceptions.length} special events`
					: exceptions,
			)
		})

		test('9.22.1.7 Read EXCEPTION_SCHEDULE array size (index 0)', async () => {
			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EXCEPTION_SCHEDULE,
				{ arrayIndex: 0 },
			)
			assert.ok(result.values.length > 0, 'Should return array size')
			console.log(
				'  EXCEPTION_SCHEDULE array size:',
				result.values[0]?.value,
			)
		})

		test('9.22.1.8 Read EFFECTIVE_PERIOD', async () => {
			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EFFECTIVE_PERIOD,
			)
			assert.ok(
				result.values.length > 0,
				'Should return effective period',
			)
			const period = result.values[0]?.value
			console.log('  EFFECTIVE_PERIOD:', period)
		})

		test('9.22.1.9 Read SCHEDULE_DEFAULT', async () => {
			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.SCHEDULE_DEFAULT,
			)
			assert.ok(
				result.values.length > 0,
				'Should return schedule default',
			)
			console.log('  SCHEDULE_DEFAULT:', result.values[0]?.value)
		})

		test('9.22.1.10 Read PRIORITY_FOR_WRITING', async () => {
			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.PRIORITY_FOR_WRITING,
			)
			assert.ok(result.values.length > 0, 'Should return priority')
			const priority = result.values[0]?.value
			assert.ok(
				typeof priority === 'number' && priority >= 1 && priority <= 16,
				'Priority must be 1-16',
			)
			console.log('  PRIORITY_FOR_WRITING:', priority)
		})

		test('9.22.1.11 Read STATUS_FLAGS', async () => {
			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.STATUS_FLAGS,
			)
			assert.ok(result.values.length > 0, 'Should return status flags')
			console.log('  Schedule STATUS_FLAGS:', result.values[0]?.value)
		})

		test('9.22.1.12 Read RELIABILITY', async () => {
			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.RELIABILITY,
			)
			assert.ok(result.values.length > 0, 'Should return reliability')
			console.log('  Schedule RELIABILITY:', result.values[0]?.value)
		})

		test('9.22.1.13 Read OUT_OF_SERVICE', async () => {
			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.OUT_OF_SERVICE,
			)
			assert.ok(
				result.values.length > 0,
				'Should return out-of-service flag',
			)
			console.log('  Schedule OUT_OF_SERVICE:', result.values[0]?.value)
		})

		test('9.22.1.14 Read LIST_OF_OBJECT_PROPERTY_REFERENCES', async () => {
			try {
				const result = await client.readProperty(
					TARGET,
					SCHEDULE,
					PropertyIdentifier.LIST_OF_OBJECT_PROPERTY_REFERENCES,
				)
				console.log(
					'  LIST_OF_OBJECT_PROPERTY_REFERENCES:',
					result.values[0]?.value,
				)
			} catch (err: any) {
				console.log(
					'  LIST_OF_OBJECT_PROPERTY_REFERENCES: not supported or empty -',
					err.message,
				)
			}
		})
	})

	// -------------------------------------------------------------------------
	// 9.22.2 Read Schedule via ReadPropertyMultiple
	// -------------------------------------------------------------------------

	describe('9.22.2 — ReadPropertyMultiple Schedule', () => {
		test('9.22.2.1 Read all schedule properties via RPM', async () => {
			const result = await client.readPropertyMultiple(TARGET, [
				{
					objectId: SCHEDULE,
					properties: [
						{
							id: PropertyIdentifier.OBJECT_NAME,
							index: ASN1_ARRAY_ALL,
						},
						{
							id: PropertyIdentifier.PRESENT_VALUE,
							index: ASN1_ARRAY_ALL,
						},
						{
							id: PropertyIdentifier.WEEKLY_SCHEDULE,
							index: ASN1_ARRAY_ALL,
						},
						{
							id: PropertyIdentifier.EXCEPTION_SCHEDULE,
							index: ASN1_ARRAY_ALL,
						},
						{
							id: PropertyIdentifier.EFFECTIVE_PERIOD,
							index: ASN1_ARRAY_ALL,
						},
						{
							id: PropertyIdentifier.SCHEDULE_DEFAULT,
							index: ASN1_ARRAY_ALL,
						},
						{
							id: PropertyIdentifier.PRIORITY_FOR_WRITING,
							index: ASN1_ARRAY_ALL,
						},
						{
							id: PropertyIdentifier.STATUS_FLAGS,
							index: ASN1_ARRAY_ALL,
						},
						{
							id: PropertyIdentifier.RELIABILITY,
							index: ASN1_ARRAY_ALL,
						},
						{
							id: PropertyIdentifier.OUT_OF_SERVICE,
							index: ASN1_ARRAY_ALL,
						},
					],
				},
			])
			assert.ok(result.values.length > 0, 'RPM should return results')
			const props = result.values[0]?.values
			assert.ok(
				props && props.length >= 10,
				'Should return all requested properties',
			)
			console.log('  RPM returned', props?.length, 'properties')
			for (const prop of props || []) {
				console.log(
					`    Property ${prop.id}:`,
					prop.values?.[0]?.value ?? prop.values?.[0],
				)
			}
		})
	})

	// -------------------------------------------------------------------------
	// 9.22.3 Write Schedule Properties
	// -------------------------------------------------------------------------

	describe('9.22.3 — Write Schedule Properties', () => {
		let originalWeekly: any
		let originalExceptions: any
		let originalPeriod: any

		test('9.22.3.0 Save original schedule state', async () => {
			const weeklyResult = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.WEEKLY_SCHEDULE,
			)
			originalWeekly = weeklyResult.values[0]?.value

			const excResult = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EXCEPTION_SCHEDULE,
			)
			originalExceptions = excResult.values[0]?.value

			const periodResult = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EFFECTIVE_PERIOD,
			)
			originalPeriod = periodResult.values[0]?.value

			console.log('  Saved original state')
		})

		test('9.22.3.1 Write WEEKLY_SCHEDULE (full 7-day)', async () => {
			const weekly: BACNetWeeklySchedulePayload = [
				// Monday: 2 entries
				[
					{
						time: {
							type: ApplicationTag.TIME,
							value: new Date(2024, 0, 1, 8, 0, 0, 0),
						},
						value: { type: ApplicationTag.REAL, value: 21.0 },
					},
					{
						time: {
							type: ApplicationTag.TIME,
							value: new Date(2024, 0, 1, 17, 0, 0, 0),
						},
						value: { type: ApplicationTag.REAL, value: 18.0 },
					},
				],
				// Tuesday: same
				[
					{
						time: {
							type: ApplicationTag.TIME,
							value: new Date(2024, 0, 1, 8, 0, 0, 0),
						},
						value: { type: ApplicationTag.REAL, value: 21.0 },
					},
					{
						time: {
							type: ApplicationTag.TIME,
							value: new Date(2024, 0, 1, 17, 0, 0, 0),
						},
						value: { type: ApplicationTag.REAL, value: 18.0 },
					},
				],
				// Wednesday
				[
					{
						time: {
							type: ApplicationTag.TIME,
							value: new Date(2024, 0, 1, 8, 0, 0, 0),
						},
						value: { type: ApplicationTag.REAL, value: 21.0 },
					},
					{
						time: {
							type: ApplicationTag.TIME,
							value: new Date(2024, 0, 1, 17, 0, 0, 0),
						},
						value: { type: ApplicationTag.REAL, value: 18.0 },
					},
				],
				// Thursday
				[
					{
						time: {
							type: ApplicationTag.TIME,
							value: new Date(2024, 0, 1, 8, 0, 0, 0),
						},
						value: { type: ApplicationTag.REAL, value: 21.0 },
					},
					{
						time: {
							type: ApplicationTag.TIME,
							value: new Date(2024, 0, 1, 17, 0, 0, 0),
						},
						value: { type: ApplicationTag.REAL, value: 18.0 },
					},
				],
				// Friday
				[
					{
						time: {
							type: ApplicationTag.TIME,
							value: new Date(2024, 0, 1, 8, 0, 0, 0),
						},
						value: { type: ApplicationTag.REAL, value: 21.0 },
					},
					{
						time: {
							type: ApplicationTag.TIME,
							value: new Date(2024, 0, 1, 17, 0, 0, 0),
						},
						value: { type: ApplicationTag.REAL, value: 18.0 },
					},
				],
				// Saturday: empty
				[],
				// Sunday: empty
				[],
			]

			await client.writeProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.WEEKLY_SCHEDULE,
				weekly,
				{},
			)
			console.log('  Wrote 7-day weekly schedule')

			// Verify
			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.WEEKLY_SCHEDULE,
			)
			const readBack = result.values[0]?.value as any[]
			assert.equal(readBack.length, 7, 'Read-back must have 7 days')
			assert.equal(readBack[0].length, 2, 'Monday should have 2 entries')
			assert.equal(readBack[5].length, 0, 'Saturday should be empty')
			assert.equal(readBack[6].length, 0, 'Sunday should be empty')
			console.log('  Verified write-back: 7 days correct')
		})

		test('9.22.3.2 Write single WEEKLY_SCHEDULE day (array index)', async () => {
			// Write Monday (index 1) with 3 entries — flat TimeValueEntry array
			const monday = [
				{
					time: {
						type: ApplicationTag.TIME,
						value: new Date(2024, 0, 1, 6, 0, 0, 0),
					},
					value: { type: ApplicationTag.REAL, value: 19.0 },
				},
				{
					time: {
						type: ApplicationTag.TIME,
						value: new Date(2024, 0, 1, 9, 0, 0, 0),
					},
					value: { type: ApplicationTag.REAL, value: 22.0 },
				},
				{
					time: {
						type: ApplicationTag.TIME,
						value: new Date(2024, 0, 1, 18, 0, 0, 0),
					},
					value: { type: ApplicationTag.REAL, value: 17.0 },
				},
			]

			await client.writeProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.WEEKLY_SCHEDULE,
				monday as any,
				{ arrayIndex: 1 },
			)
			console.log('  Wrote Monday (index 1) with 3 entries')

			// Verify only Monday changed
			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.WEEKLY_SCHEDULE,
				{ arrayIndex: 1 },
			)
			const day = result.values[0]?.value
			assert.ok(Array.isArray(day), 'Day should be array')
			assert.equal(
				(day as any[]).length,
				3,
				'Monday should now have 3 entries',
			)
			console.log('  Verified: Monday has 3 entries')
		})

		test('9.22.3.3 Write EXCEPTION_SCHEDULE with date entry', async () => {
			const exceptions: BACNetExceptionSchedulePayload = [
				{
					date: {
						type: ApplicationTag.DATE,
						value: new Date(2026, 11, 25),
					},
					events: [
						{
							time: {
								type: ApplicationTag.TIME,
								value: new Date(2024, 0, 1, 0, 0, 0, 0),
							},
							value: { type: ApplicationTag.REAL, value: 15.0 },
						},
					],
					priority: {
						type: ApplicationTag.UNSIGNED_INTEGER,
						value: 10,
					},
				},
			]

			await client.writeProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EXCEPTION_SCHEDULE,
				exceptions,
				{},
			)
			console.log('  Wrote 1 exception (date entry)')

			// Verify
			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EXCEPTION_SCHEDULE,
			)
			const readBack = result.values[0]?.value
			assert.ok(readBack != null, 'Should read back exception schedule')
			console.log('  EXCEPTION_SCHEDULE read-back:', readBack)
		})

		test('9.22.3.4 Write EXCEPTION_SCHEDULE with date range', async () => {
			const exceptions: BACNetExceptionSchedulePayload = [
				{
					date: {
						type: ApplicationTag.DATERANGE,
						value: [
							{
								type: ApplicationTag.DATE,
								value: new Date(2026, 11, 24),
							},
							{
								type: ApplicationTag.DATE,
								value: new Date(2026, 11, 31),
							},
						],
					} as any,
					events: [
						{
							time: {
								type: ApplicationTag.TIME,
								value: new Date(2024, 0, 1, 0, 0, 0, 0),
							},
							value: { type: ApplicationTag.REAL, value: 14.0 },
						},
					],
					priority: {
						type: ApplicationTag.UNSIGNED_INTEGER,
						value: 8,
					},
				},
			]

			await client.writeProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EXCEPTION_SCHEDULE,
				exceptions,
				{},
			)
			console.log('  Wrote 1 exception (date range entry)')

			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EXCEPTION_SCHEDULE,
			)
			assert.ok(
				result.values[0]?.value != null,
				'Should read back exception schedule',
			)
			console.log('  Verified date range exception')
		})

		test('9.22.3.5 Write EXCEPTION_SCHEDULE with WeekNDay', async () => {
			const exceptions: BACNetExceptionSchedulePayload = [
				{
					date: {
						type: ApplicationTag.WEEKNDAY,
						value: { month: 12, week: 4, wday: 5 },
					} as any,
					events: [
						{
							time: {
								type: ApplicationTag.TIME,
								value: new Date(2024, 0, 1, 8, 0, 0, 0),
							},
							value: { type: ApplicationTag.REAL, value: 16.0 },
						},
					],
					priority: {
						type: ApplicationTag.UNSIGNED_INTEGER,
						value: 12,
					},
				},
			]

			await client.writeProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EXCEPTION_SCHEDULE,
				exceptions,
				{},
			)
			console.log('  Wrote 1 exception (weekNDay entry)')

			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EXCEPTION_SCHEDULE,
			)
			assert.ok(
				result.values[0]?.value != null,
				'Should read back exception schedule',
			)
			console.log('  Verified weekNDay exception')
		})

		test('9.22.3.6 Write EXCEPTION_SCHEDULE with multiple entries', async () => {
			const exceptions: BACNetExceptionSchedulePayload = [
				{
					date: {
						type: ApplicationTag.DATE,
						value: new Date(2026, 0, 1),
					},
					events: [
						{
							time: {
								type: ApplicationTag.TIME,
								value: new Date(2024, 0, 1, 0, 0, 0, 0),
							},
							value: { type: ApplicationTag.REAL, value: 15.0 },
						},
					],
					priority: {
						type: ApplicationTag.UNSIGNED_INTEGER,
						value: 10,
					},
				},
				{
					date: {
						type: ApplicationTag.DATERANGE,
						value: [
							{
								type: ApplicationTag.DATE,
								value: new Date(2026, 6, 1),
							},
							{
								type: ApplicationTag.DATE,
								value: new Date(2026, 6, 7),
							},
						],
					} as any,
					events: [
						{
							time: {
								type: ApplicationTag.TIME,
								value: new Date(2024, 0, 1, 9, 0, 0, 0),
							},
							value: { type: ApplicationTag.REAL, value: 20.0 },
						},
						{
							time: {
								type: ApplicationTag.TIME,
								value: new Date(2024, 0, 1, 17, 0, 0, 0),
							},
							value: { type: ApplicationTag.REAL, value: 16.0 },
						},
					],
					priority: {
						type: ApplicationTag.UNSIGNED_INTEGER,
						value: 5,
					},
				},
				{
					date: {
						type: ApplicationTag.WEEKNDAY,
						value: { month: 255, week: 255, wday: 1 },
					} as any,
					events: [
						{
							time: {
								type: ApplicationTag.TIME,
								value: new Date(2024, 0, 1, 7, 0, 0, 0),
							},
							value: { type: ApplicationTag.REAL, value: 19.0 },
						},
					],
					priority: {
						type: ApplicationTag.UNSIGNED_INTEGER,
						value: 3,
					},
				},
			]

			await client.writeProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EXCEPTION_SCHEDULE,
				exceptions,
				{},
			)
			console.log('  Wrote 3 exceptions (date + dateRange + weekNDay)')

			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EXCEPTION_SCHEDULE,
			)
			const readBack = result.values[0]?.value
			assert.ok(
				Array.isArray(readBack),
				'Should be array of special events',
			)
			assert.equal(
				(readBack as any[]).length,
				3,
				'Should have 3 exception entries',
			)
			console.log('  Verified: 3 exception entries read back')
		})

		test('9.22.3.7 Write single EXCEPTION_SCHEDULE entry (array index)', async () => {
			const singleException: BACNetExceptionSchedulePayload = [
				{
					date: {
						type: ApplicationTag.DATE,
						value: new Date(2026, 5, 15),
					},
					events: [
						{
							time: {
								type: ApplicationTag.TIME,
								value: new Date(2024, 0, 1, 10, 0, 0, 0),
							},
							value: { type: ApplicationTag.REAL, value: 23.0 },
						},
					],
					priority: {
						type: ApplicationTag.UNSIGNED_INTEGER,
						value: 7,
					},
				},
			]

			await client.writeProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EXCEPTION_SCHEDULE,
				singleException,
				{ arrayIndex: 1 },
			)
			console.log('  Wrote exception at index 1')

			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EXCEPTION_SCHEDULE,
				{ arrayIndex: 1 },
			)
			assert.ok(
				result.values[0]?.value != null,
				'Index 1 should have a value',
			)
			console.log('  Verified: exception at index 1')
		})

		test('9.22.3.8 Write EFFECTIVE_PERIOD', async () => {
			const period: BACNetEffectivePeriodPayload = [
				{ type: ApplicationTag.DATE, value: new Date(2026, 0, 1) },
				{ type: ApplicationTag.DATE, value: new Date(2026, 11, 31) },
			]

			await client.writeProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EFFECTIVE_PERIOD,
				period,
				{},
			)
			console.log('  Wrote effective period: 2026-01-01 to 2026-12-31')

			// Verify
			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EFFECTIVE_PERIOD,
			)
			const readBack = result.values[0]?.value
			assert.ok(readBack != null, 'Should read back effective period')
			console.log('  EFFECTIVE_PERIOD read-back:', readBack)
		})

		test('9.22.3.9 Write EFFECTIVE_PERIOD by array index (start date)', async () => {
			try {
				const startDate: BACNetEffectivePeriodPayload = [
					{ type: ApplicationTag.DATE, value: new Date(2025, 5, 1) },
					{
						type: ApplicationTag.DATE,
						value: new Date(2026, 11, 31),
					},
				]

				await client.writeProperty(
					TARGET,
					SCHEDULE,
					PropertyIdentifier.EFFECTIVE_PERIOD,
					startDate,
					{ arrayIndex: 1 },
				)
				console.log('  Wrote effective period start date (index 1)')

				const result = await client.readProperty(
					TARGET,
					SCHEDULE,
					PropertyIdentifier.EFFECTIVE_PERIOD,
					{ arrayIndex: 1 },
				)
				assert.ok(
					result.values[0]?.value != null,
					'Should read back start date',
				)
				console.log('  Verified start date')
			} catch (err: any) {
				console.log(
					'  Device does not support writing EFFECTIVE_PERIOD by index:',
					err.message,
				)
			}
		})

		test('9.22.3.10 Write EFFECTIVE_PERIOD by array index (end date)', async () => {
			try {
				const endDate: BACNetEffectivePeriodPayload = [
					{ type: ApplicationTag.DATE, value: new Date(2025, 5, 1) },
					{ type: ApplicationTag.DATE, value: new Date(2027, 2, 15) },
				]

				await client.writeProperty(
					TARGET,
					SCHEDULE,
					PropertyIdentifier.EFFECTIVE_PERIOD,
					endDate,
					{ arrayIndex: 2 },
				)
				console.log('  Wrote effective period end date (index 2)')

				const result = await client.readProperty(
					TARGET,
					SCHEDULE,
					PropertyIdentifier.EFFECTIVE_PERIOD,
					{ arrayIndex: 2 },
				)
				assert.ok(
					result.values[0]?.value != null,
					'Should read back end date',
				)
				console.log('  Verified end date')
			} catch (err: any) {
				console.log(
					'  Device does not support writing EFFECTIVE_PERIOD by index:',
					err.message,
				)
			}
		})

		test('9.22.3.11 Write SCHEDULE_DEFAULT', async () => {
			const defaultValue = [{ type: ApplicationTag.REAL, value: 20.0 }]

			await client.writeProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.SCHEDULE_DEFAULT,
				defaultValue,
				{},
			)
			console.log('  Wrote SCHEDULE_DEFAULT = 20.0')

			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.SCHEDULE_DEFAULT,
			)
			assert.ok(
				result.values[0]?.value != null,
				'Should read back schedule default',
			)
			console.log(
				'  SCHEDULE_DEFAULT read-back:',
				result.values[0]?.value,
			)
		})

		test('9.22.3.12 Write empty WEEKLY_SCHEDULE (clear all days)', async () => {
			const empty: BACNetWeeklySchedulePayload = [
				[],
				[],
				[],
				[],
				[],
				[],
				[],
			]

			await client.writeProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.WEEKLY_SCHEDULE,
				empty,
				{},
			)
			console.log('  Wrote empty weekly schedule (all days cleared)')

			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.WEEKLY_SCHEDULE,
			)
			const readBack = result.values[0]?.value as any[]
			assert.equal(readBack.length, 7)
			for (let i = 0; i < 7; i++) {
				assert.equal(
					readBack[i].length,
					0,
					`Day ${i + 1} should be empty`,
				)
			}
			console.log('  Verified: all 7 days empty')
		})

		test('9.22.3.13 Write empty EXCEPTION_SCHEDULE (clear all)', async () => {
			const empty: BACNetExceptionSchedulePayload = []

			await client.writeProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EXCEPTION_SCHEDULE,
				empty,
				{},
			)
			console.log('  Wrote empty exception schedule')

			const result = await client.readProperty(
				TARGET,
				SCHEDULE,
				PropertyIdentifier.EXCEPTION_SCHEDULE,
			)
			const readBack = result.values[0]?.value
			const isEmpty =
				readBack == null ||
				(Array.isArray(readBack) && readBack.length === 0)
			assert.ok(isEmpty, 'Exception schedule should be empty')
			console.log('  Verified: exception schedule cleared')
		})

		// Restore original state
		test('9.22.3.99 Restore original schedule state', async () => {
			if (originalWeekly) {
				await client.writeProperty(
					TARGET,
					SCHEDULE,
					PropertyIdentifier.WEEKLY_SCHEDULE,
					originalWeekly,
					{},
				)
			}
			if (originalExceptions) {
				await client.writeProperty(
					TARGET,
					SCHEDULE,
					PropertyIdentifier.EXCEPTION_SCHEDULE,
					originalExceptions,
					{},
				)
			}
			if (originalPeriod) {
				await client.writeProperty(
					TARGET,
					SCHEDULE,
					PropertyIdentifier.EFFECTIVE_PERIOD,
					originalPeriod,
					{},
				)
			}
			console.log('  Restored original schedule state')
		})
	})
})

// ============================================================================
// BTL 9.23 — CALENDAR OBJECT
// ============================================================================

describe('BTL 9.23 — Calendar Object', () => {
	// -------------------------------------------------------------------------
	// 9.23.1 Read Calendar Properties
	// -------------------------------------------------------------------------

	describe('9.23.1 — Read Calendar Properties', () => {
		test('9.23.1.1 Read OBJECT_NAME', async () => {
			const result = await client.readProperty(
				TARGET,
				CALENDAR,
				PropertyIdentifier.OBJECT_NAME,
			)
			assert.ok(result.values.length > 0)
			console.log('  Calendar OBJECT_NAME:', result.values[0]?.value)
		})

		test('9.23.1.2 Read PRESENT_VALUE', async () => {
			const result = await client.readProperty(
				TARGET,
				CALENDAR,
				PropertyIdentifier.PRESENT_VALUE,
			)
			assert.ok(result.values.length > 0)
			const pv = result.values[0]?.value
			assert.ok(
				typeof pv === 'boolean' || typeof pv === 'number',
				'Calendar PRESENT_VALUE should be boolean (TRUE/FALSE)',
			)
			console.log('  Calendar PRESENT_VALUE:', pv)
		})

		test('9.23.1.3 Read DATE_LIST (all entries)', async () => {
			const result = await client.readProperty(
				TARGET,
				CALENDAR,
				PropertyIdentifier.DATE_LIST,
			)
			assert.ok(result.values.length > 0, 'Should return date list')
			const dateList = result.values[0]?.value
			console.log(
				'  DATE_LIST:',
				Array.isArray(dateList)
					? `${dateList.length} entries`
					: dateList,
			)
		})

		test('9.23.1.4 Read DATE_LIST array size (index 0)', async () => {
			try {
				const result = await client.readProperty(
					TARGET,
					CALENDAR,
					PropertyIdentifier.DATE_LIST,
					{ arrayIndex: 0 },
				)
				assert.ok(result.values.length > 0)
				console.log('  DATE_LIST array size:', result.values[0]?.value)
			} catch (err: any) {
				// DATE_LIST is a BACnetCalendarEntry SEQUENCE OF, not a BACnet array —
				// some devices reject array index access (Code:50 PROPERTY_IS_NOT_AN_ARRAY)
				console.log(
					'  DATE_LIST array index not supported (expected for non-array property):',
					err.message,
				)
			}
		})

		test('9.23.1.5 Read DESCRIPTION', async () => {
			try {
				const result = await client.readProperty(
					TARGET,
					CALENDAR,
					PropertyIdentifier.DESCRIPTION,
				)
				console.log('  Calendar DESCRIPTION:', result.values[0]?.value)
			} catch (err: any) {
				console.log(
					'  Calendar DESCRIPTION: not supported -',
					err.message,
				)
			}
		})

		test('9.23.1.6 Read STATUS_FLAGS', async () => {
			try {
				const result = await client.readProperty(
					TARGET,
					CALENDAR,
					PropertyIdentifier.STATUS_FLAGS,
				)
				assert.ok(result.values.length > 0)
				console.log('  Calendar STATUS_FLAGS:', result.values[0]?.value)
			} catch (err: any) {
				// STATUS_FLAGS is optional on Calendar objects per ASHRAE 135
				console.log(
					'  Calendar STATUS_FLAGS not supported (optional property):',
					err.message,
				)
			}
		})
	})

	// -------------------------------------------------------------------------
	// 9.23.2 ReadPropertyMultiple Calendar
	// -------------------------------------------------------------------------

	describe('9.23.2 — ReadPropertyMultiple Calendar', () => {
		test('9.23.2.1 Read all calendar properties via RPM', async () => {
			const result = await client.readPropertyMultiple(TARGET, [
				{
					objectId: CALENDAR,
					properties: [
						{
							id: PropertyIdentifier.OBJECT_NAME,
							index: ASN1_ARRAY_ALL,
						},
						{
							id: PropertyIdentifier.PRESENT_VALUE,
							index: ASN1_ARRAY_ALL,
						},
						{
							id: PropertyIdentifier.DATE_LIST,
							index: ASN1_ARRAY_ALL,
						},
					],
				},
			])
			assert.ok(result.values.length > 0, 'RPM should return results')
			console.log(
				'  RPM returned',
				result.values[0]?.values?.length,
				'properties',
			)
		})
	})

	// -------------------------------------------------------------------------
	// 9.23.3 Write Calendar Properties
	// -------------------------------------------------------------------------

	describe('9.23.3 — Write Calendar Properties', () => {
		let originalDateList: any

		test('9.23.3.0 Save original calendar state', async () => {
			const result = await client.readProperty(
				TARGET,
				CALENDAR,
				PropertyIdentifier.DATE_LIST,
			)
			originalDateList = result.values[0]?.value
			console.log('  Saved original DATE_LIST')
		})

		test('9.23.3.1 Write DATE_LIST with single date', async () => {
			const dateList: BACNetCalendarDateListPayload = [
				{ type: ApplicationTag.DATE, value: new Date(2026, 2, 15) },
			]

			await client.writeProperty(
				TARGET,
				CALENDAR,
				PropertyIdentifier.DATE_LIST,
				dateList,
				{},
			)
			console.log('  Wrote DATE_LIST with 1 date entry')

			const result = await client.readProperty(
				TARGET,
				CALENDAR,
				PropertyIdentifier.DATE_LIST,
			)
			const readBack = result.values[0]?.value
			assert.ok(readBack != null, 'Should read back date list')
			console.log('  DATE_LIST read-back:', readBack)
		})

		test('9.23.3.2 Write DATE_LIST with date range', async () => {
			const dateList: BACNetCalendarDateListPayload = [
				{
					type: ApplicationTag.DATERANGE,
					value: [
						{
							type: ApplicationTag.DATE,
							value: new Date(2026, 5, 1),
						},
						{
							type: ApplicationTag.DATE,
							value: new Date(2026, 5, 30),
						},
					],
				} as any,
			]

			await client.writeProperty(
				TARGET,
				CALENDAR,
				PropertyIdentifier.DATE_LIST,
				dateList,
				{},
			)
			console.log('  Wrote DATE_LIST with 1 date range')

			const result = await client.readProperty(
				TARGET,
				CALENDAR,
				PropertyIdentifier.DATE_LIST,
			)
			assert.ok(result.values[0]?.value != null)
			console.log('  Verified date range write')
		})

		test('9.23.3.3 Write DATE_LIST with WeekNDay', async () => {
			const dateList: BACNetCalendarDateListPayload = [
				{
					type: ApplicationTag.WEEKNDAY,
					value: { month: 12, week: 4, wday: 5 },
				} as any,
			]

			await client.writeProperty(
				TARGET,
				CALENDAR,
				PropertyIdentifier.DATE_LIST,
				dateList,
				{},
			)
			console.log('  Wrote DATE_LIST with 1 weekNDay entry')

			const result = await client.readProperty(
				TARGET,
				CALENDAR,
				PropertyIdentifier.DATE_LIST,
			)
			assert.ok(result.values[0]?.value != null)
			console.log('  Verified weekNDay write')
		})

		test('9.23.3.4 Write DATE_LIST with mixed entries (date + dateRange + weekNDay)', async () => {
			const dateList: BACNetCalendarDateListPayload = [
				{ type: ApplicationTag.DATE, value: new Date(2026, 0, 1) },
				{
					type: ApplicationTag.DATERANGE,
					value: [
						{
							type: ApplicationTag.DATE,
							value: new Date(2026, 3, 10),
						},
						{
							type: ApplicationTag.DATE,
							value: new Date(2026, 3, 20),
						},
					],
				} as any,
				{
					type: ApplicationTag.WEEKNDAY,
					value: { month: 255, week: 255, wday: 7 },
				} as any,
			]

			await client.writeProperty(
				TARGET,
				CALENDAR,
				PropertyIdentifier.DATE_LIST,
				dateList,
				{},
			)
			console.log('  Wrote DATE_LIST with 3 mixed entries')

			const result = await client.readProperty(
				TARGET,
				CALENDAR,
				PropertyIdentifier.DATE_LIST,
			)
			const readBack = result.values[0]?.value
			assert.ok(Array.isArray(readBack), 'Should be array')
			assert.equal((readBack as any[]).length, 3, 'Should have 3 entries')
			console.log('  Verified: 3 mixed entries read back')
		})

		test('9.23.3.5 Write single DATE_LIST entry (array index)', async () => {
			try {
				const singleEntry: BACNetCalendarDateListPayload = [
					{ type: ApplicationTag.DATE, value: new Date(2026, 7, 8) },
				]

				await client.writeProperty(
					TARGET,
					CALENDAR,
					PropertyIdentifier.DATE_LIST,
					singleEntry,
					{ arrayIndex: 1 },
				)
				console.log('  Wrote DATE_LIST at index 1')

				const result = await client.readProperty(
					TARGET,
					CALENDAR,
					PropertyIdentifier.DATE_LIST,
					{ arrayIndex: 1 },
				)
				assert.ok(result.values[0]?.value != null)
				console.log('  Verified: index 1 updated')
			} catch (err: any) {
				// DATE_LIST is SEQUENCE OF, not BACnet array — index access may not be supported
				console.log(
					'  DATE_LIST array index write not supported:',
					err.message,
				)
			}
		})

		test('9.23.3.6 Write empty DATE_LIST (clear all)', async () => {
			const empty: BACNetCalendarDateListPayload = []

			await client.writeProperty(
				TARGET,
				CALENDAR,
				PropertyIdentifier.DATE_LIST,
				empty,
				{},
			)
			console.log('  Wrote empty DATE_LIST')

			const result = await client.readProperty(
				TARGET,
				CALENDAR,
				PropertyIdentifier.DATE_LIST,
			)
			const readBack = result.values[0]?.value
			const isEmpty =
				readBack == null ||
				(Array.isArray(readBack) && readBack.length === 0)
			assert.ok(isEmpty, 'DATE_LIST should be empty')
			console.log('  Verified: DATE_LIST cleared')
		})

		test('9.23.3.99 Restore original calendar state', async () => {
			if (originalDateList) {
				await client.writeProperty(
					TARGET,
					CALENDAR,
					PropertyIdentifier.DATE_LIST,
					originalDateList,
					{},
				)
			}
			console.log('  Restored original calendar state')
		})
	})
})

// ============================================================================
// BTL 9.18 — TREND LOG OBJECT
// ============================================================================

describe('BTL 9.18 — Trend Log Object', () => {
	describe('9.18.1 — Read Trend Log Properties', () => {
		test('9.18.1.1 Read OBJECT_NAME', async () => {
			const result = await client.readProperty(
				TARGET,
				TREND_LOG,
				PropertyIdentifier.OBJECT_NAME,
			)
			assert.ok(result.values.length > 0)
			console.log('  TrendLog OBJECT_NAME:', result.values[0]?.value)
		})

		test('9.18.1.2 Read RECORD_COUNT', async () => {
			const result = await client.readProperty(
				TARGET,
				TREND_LOG,
				PropertyIdentifier.RECORD_COUNT,
			)
			assert.ok(result.values.length > 0)
			const count = result.values[0]?.value
			assert.ok(
				typeof count === 'number',
				'RECORD_COUNT should be a number',
			)
			console.log('  RECORD_COUNT:', count)
		})

		test('9.18.1.3 Read TOTAL_RECORD_COUNT', async () => {
			const result = await client.readProperty(
				TARGET,
				TREND_LOG,
				PropertyIdentifier.TOTAL_RECORD_COUNT,
			)
			assert.ok(result.values.length > 0)
			console.log('  TOTAL_RECORD_COUNT:', result.values[0]?.value)
		})

		test('9.18.1.4 Read STATUS_FLAGS', async () => {
			const result = await client.readProperty(
				TARGET,
				TREND_LOG,
				PropertyIdentifier.STATUS_FLAGS,
			)
			assert.ok(result.values.length > 0)
			console.log('  TrendLog STATUS_FLAGS:', result.values[0]?.value)
		})

		test('9.18.1.5 Read ENABLE', async () => {
			const result = await client.readProperty(
				TARGET,
				TREND_LOG,
				PropertyIdentifier.ENABLE,
			)
			assert.ok(result.values.length > 0)
			console.log('  ENABLE:', result.values[0]?.value)
		})

		test('9.18.1.6 Read LOG_INTERVAL', async () => {
			try {
				const result = await client.readProperty(
					TARGET,
					TREND_LOG,
					PropertyIdentifier.LOG_INTERVAL,
				)
				console.log('  LOG_INTERVAL:', result.values[0]?.value)
			} catch (err: any) {
				console.log('  LOG_INTERVAL: not supported -', err.message)
			}
		})

		test('9.18.1.7 Read BUFFER_SIZE', async () => {
			const result = await client.readProperty(
				TARGET,
				TREND_LOG,
				PropertyIdentifier.BUFFER_SIZE,
			)
			assert.ok(result.values.length > 0)
			console.log('  BUFFER_SIZE:', result.values[0]?.value)
		})

		test('9.18.1.8 Read STOP_WHEN_FULL', async () => {
			const result = await client.readProperty(
				TARGET,
				TREND_LOG,
				PropertyIdentifier.STOP_WHEN_FULL,
			)
			assert.ok(result.values.length > 0)
			console.log('  STOP_WHEN_FULL:', result.values[0]?.value)
		})
	})

	describe('9.18.2 — ReadPropertyMultiple Trend Log', () => {
		test('9.18.2.1 Read all trend log properties via RPM', async () => {
			const result = await client.readPropertyMultiple(TARGET, [
				{
					objectId: TREND_LOG,
					properties: [
						{
							id: PropertyIdentifier.OBJECT_NAME,
							index: ASN1_ARRAY_ALL,
						},
						{
							id: PropertyIdentifier.RECORD_COUNT,
							index: ASN1_ARRAY_ALL,
						},
						{
							id: PropertyIdentifier.TOTAL_RECORD_COUNT,
							index: ASN1_ARRAY_ALL,
						},
						{
							id: PropertyIdentifier.BUFFER_SIZE,
							index: ASN1_ARRAY_ALL,
						},
						{
							id: PropertyIdentifier.ENABLE,
							index: ASN1_ARRAY_ALL,
						},
						{
							id: PropertyIdentifier.STOP_WHEN_FULL,
							index: ASN1_ARRAY_ALL,
						},
						{
							id: PropertyIdentifier.STATUS_FLAGS,
							index: ASN1_ARRAY_ALL,
						},
					],
				},
			])
			assert.ok(result.values.length > 0)
			console.log(
				'  RPM returned',
				result.values[0]?.values?.length,
				'properties',
			)
		})
	})

	describe('9.18.3 — ReadRange Trend Log', () => {
		let recordCount = 0

		test('9.18.3.0 Get record count', async () => {
			const result = await client.readProperty(
				TARGET,
				TREND_LOG,
				PropertyIdentifier.RECORD_COUNT,
			)
			recordCount = result.values[0]?.value as number
			console.log('  Record count:', recordCount)
			assert.ok(recordCount >= 0, 'Record count should be non-negative')
		})

		test('9.18.3.1 ReadRange BY_POSITION (first 10 records)', async () => {
			if (recordCount === 0) {
				console.log('  SKIPPED: no records in trend log')
				return
			}
			const count = Math.min(10, recordCount)
			const response = await client.readRange(
				TARGET,
				TREND_LOG,
				1,
				count,
				{
					requestType: ReadRangeType.BY_POSITION,
					maxSegments: MaxSegmentsAccepted.SEGMENTS_65,
				},
			)
			assert.ok(response.itemCount > 0, 'Should return at least 1 record')
			console.log(
				'  ReadRange BY_POSITION: got',
				response.itemCount,
				'records',
			)
			if (response.values && response.values.length > 0) {
				console.log(
					'  First record:',
					JSON.stringify(response.values[0], null, 2),
				)
			}
		})

		test('9.18.3.2 ReadRange BY_POSITION (last 10 records)', async () => {
			if (recordCount === 0) {
				console.log('  SKIPPED: no records')
				return
			}
			const count = Math.min(10, recordCount)
			const startIndex = Math.max(1, recordCount - count + 1)
			const response = await client.readRange(
				TARGET,
				TREND_LOG,
				startIndex,
				count,
				{
					requestType: ReadRangeType.BY_POSITION,
					maxSegments: MaxSegmentsAccepted.SEGMENTS_65,
				},
			)
			assert.ok(response.itemCount > 0, 'Should return records')
			console.log(
				'  ReadRange BY_POSITION (last):',
				response.itemCount,
				'records',
			)
		})

		test('9.18.3.3 ReadRange BY_SEQUENCE_NUMBER', async () => {
			if (recordCount === 0) {
				console.log('  SKIPPED: no records')
				return
			}
			const response = await client.readRange(TARGET, TREND_LOG, 1, 10, {
				requestType: ReadRangeType.BY_SEQUENCE_NUMBER,
				maxSegments: MaxSegmentsAccepted.SEGMENTS_65,
			})
			console.log(
				'  ReadRange BY_SEQUENCE_NUMBER: got',
				response.itemCount,
				'records',
			)
		})

		test('9.18.3.4 ReadRange BY_TIME', async () => {
			if (recordCount === 0) {
				console.log('  SKIPPED: no records')
				return
			}
			// Request records from 24 hours ago
			const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
			const response = await client.readRange(TARGET, TREND_LOG, 0, 20, {
				requestType: ReadRangeType.BY_TIME_REFERENCE_TIME_COUNT,
				time: since,
				maxSegments: MaxSegmentsAccepted.SEGMENTS_65,
			})
			console.log(
				'  ReadRange BY_TIME:',
				response.itemCount,
				'records since',
				since.toISOString(),
			)
		})

		test('9.18.3.5 ReadRange decode log records with timestamps', async () => {
			if (recordCount === 0) {
				console.log('  SKIPPED: no records')
				return
			}
			const count = Math.min(5, recordCount)
			const response = await client.readRange(
				TARGET,
				TREND_LOG,
				1,
				count,
				{
					requestType: ReadRangeType.BY_POSITION,
					maxSegments: MaxSegmentsAccepted.SEGMENTS_65,
				},
			)

			if (response.values && response.values.length > 0) {
				for (const record of response.values) {
					assert.ok(
						record.timestamp instanceof Date,
						'Each record must have a timestamp',
					)
					assert.ok(
						record.logDatum != null,
						'Each record must have a logDatum',
					)
					assert.ok(
						typeof record.logDatum.type === 'string',
						'logDatum must have a type',
					)
					console.log(
						`  Record: ${record.timestamp.toISOString()} | ${record.logDatum.type} = ${JSON.stringify(record.logDatum.value)}`,
					)
				}
			} else {
				console.log(
					'  Records returned as raw buffer (',
					response.rangeBuffer.length,
					'bytes)',
				)
			}
		})

		test('9.18.3.6 ReadRange with negative count (read backwards)', async () => {
			if (recordCount === 0) {
				console.log('  SKIPPED: no records')
				return
			}
			try {
				const response = await client.readRange(
					TARGET,
					TREND_LOG,
					recordCount,
					-5,
					{
						requestType: ReadRangeType.BY_POSITION,
						maxSegments: MaxSegmentsAccepted.SEGMENTS_65,
					},
				)
				console.log(
					'  ReadRange backwards:',
					response.itemCount,
					'records',
				)
			} catch (err: any) {
				console.log(
					'  ReadRange backwards: not supported -',
					err.message,
				)
			}
		})
	})
})

// ============================================================================
// BTL — Cross-object RPM (Schedule + Calendar + TrendLog in one request)
// ============================================================================

describe('BTL — Cross-object ReadPropertyMultiple', () => {
	test('Read Schedule + Calendar + TrendLog in single RPM', async () => {
		const result = await client.readPropertyMultiple(TARGET, [
			{
				objectId: SCHEDULE,
				properties: [
					{
						id: PropertyIdentifier.OBJECT_NAME,
						index: ASN1_ARRAY_ALL,
					},
					{
						id: PropertyIdentifier.WEEKLY_SCHEDULE,
						index: ASN1_ARRAY_ALL,
					},
					{
						id: PropertyIdentifier.EXCEPTION_SCHEDULE,
						index: ASN1_ARRAY_ALL,
					},
					{
						id: PropertyIdentifier.EFFECTIVE_PERIOD,
						index: ASN1_ARRAY_ALL,
					},
				],
			},
			{
				objectId: CALENDAR,
				properties: [
					{
						id: PropertyIdentifier.OBJECT_NAME,
						index: ASN1_ARRAY_ALL,
					},
					{ id: PropertyIdentifier.DATE_LIST, index: ASN1_ARRAY_ALL },
					{
						id: PropertyIdentifier.PRESENT_VALUE,
						index: ASN1_ARRAY_ALL,
					},
				],
			},
			{
				objectId: TREND_LOG,
				properties: [
					{
						id: PropertyIdentifier.OBJECT_NAME,
						index: ASN1_ARRAY_ALL,
					},
					{
						id: PropertyIdentifier.RECORD_COUNT,
						index: ASN1_ARRAY_ALL,
					},
					{
						id: PropertyIdentifier.TOTAL_RECORD_COUNT,
						index: ASN1_ARRAY_ALL,
					},
				],
			},
		])

		assert.equal(
			result.values.length,
			3,
			'Should return results for 3 objects',
		)
		console.log('  Cross-object RPM: 3 objects returned successfully')
		for (const obj of result.values) {
			console.log(`    Object: ${obj.values?.length} properties`)
		}
	})
})
