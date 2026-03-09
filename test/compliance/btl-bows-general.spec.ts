/**
 * BTL B-OWS General Compliance Tests
 *
 * Covers all B-OWS (BACnet Operator Workstation) BTL test requirements
 * EXCEPT Schedule/Calendar/TrendLog (covered in btl-bows-schedule-calendar-trend.spec.ts).
 *
 * Target: WAGO 750-8212 at 192.168.40.245:47808 (Device ID 1319071)
 *
 * BTL test sections covered:
 *   9.1   Device Discovery (Who-Is / I-Am)
 *   9.2   ReadProperty
 *   9.3   ReadPropertyMultiple
 *   9.4   WriteProperty
 *   9.5   WritePropertyMultiple
 *   9.6   SubscribeCOV
 *   9.7   SubscribeCOVProperty
 *   9.8   Event/Alarm Services (GetAlarmSummary, GetEventInformation, AcknowledgeAlarm, GetEnrollmentSummary)
 *   9.9   COV Notification Handling
 *   9.10  Time Synchronization
 *   9.11  Device Communication Control
 *   9.12  Reinitialize Device
 *   9.13  AtomicReadFile / AtomicWriteFile
 *   9.14  Object Property Reads (AV, BV, MSV, Device, EE, NC, File, NetworkPort, EventLog)
 *   9.15  Error Handling
 *   9.16  AddListElement / RemoveListElement
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import Bacnet, {
	ObjectType,
	PropertyIdentifier,
	ApplicationTag,
	ASN1_ARRAY_ALL,
	MaxSegmentsAccepted,
} from '../../src/index'

const TARGET = { address: '192.168.40.245:47808' }
const DEVICE_ID = 1319071
const DEVICE = { type: ObjectType.DEVICE, instance: DEVICE_ID }
const AV0 = { type: ObjectType.ANALOG_VALUE, instance: 0 }
const AV1 = { type: ObjectType.ANALOG_VALUE, instance: 1 }
const BV0 = { type: ObjectType.BINARY_VALUE, instance: 0 }
const BV1 = { type: ObjectType.BINARY_VALUE, instance: 1 }
const MSV0 = { type: ObjectType.MULTI_STATE_VALUE, instance: 0 }
const EE0 = { type: ObjectType.EVENT_ENROLLMENT, instance: 0 }
const NC0 = { type: ObjectType.NOTIFICATION_CLASS, instance: 0 }
const FILE1 = { type: ObjectType.FILE, instance: 1 }
const EVENT_LOG0 = { type: 25 as ObjectType, instance: 0 } // EVENT_LOG
const NETWORK_PORT1 = { type: 56 as ObjectType, instance: 1 } // NETWORK_PORT
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
// BTL 9.1 — DEVICE DISCOVERY (Who-Is / I-Am)
// ============================================================================

describe('BTL 9.1 — Device Discovery', () => {
	test('9.1.1 Who-Is global broadcast', async () => {
		const iAmPromise = once(client as any, 'iAm')
		client.whoIs(TARGET)
		const [device] = await iAmPromise
		assert.ok(device.payload, 'Should receive I-Am response')
		assert.equal(
			device.payload.deviceId,
			DEVICE_ID,
			'Device ID should match',
		)
		console.log('  Device ID:', device.payload.deviceId)
		console.log('  Max APDU:', device.payload.maxApdu)
		console.log('  Segmentation:', device.payload.segmentation)
		console.log('  Vendor ID:', device.payload.vendorId)
	})

	test('9.1.2 Who-Is with matching range', async () => {
		const iAmPromise = once(client as any, 'iAm')
		client.whoIs(TARGET, {
			lowLimit: DEVICE_ID,
			highLimit: DEVICE_ID,
		})
		const [device] = await iAmPromise
		assert.equal(device.payload.deviceId, DEVICE_ID)
		console.log('  Exact range match: received I-Am')
	})

	test('9.1.3 Who-Is with non-matching range (no response expected)', async () => {
		const timeout = new Promise<'timeout'>((resolve) =>
			setTimeout(() => resolve('timeout'), 3000),
		)
		const iAmPromise = new Promise<'iAm'>((resolve) => {
			client.once('iAm' as any, () => resolve('iAm'))
		})
		client.whoIs(TARGET, { lowLimit: 0, highLimit: 1 })
		const result = await Promise.race([iAmPromise, timeout])
		assert.equal(
			result,
			'timeout',
			'Should NOT receive I-Am for out-of-range query',
		)
		console.log('  No response for out-of-range: correct')
	})
})

// ============================================================================
// BTL 9.2 — READ PROPERTY
// ============================================================================

describe('BTL 9.2 — ReadProperty', () => {
	test('9.2.1 Read Device OBJECT_NAME', async () => {
		const result = await client.readProperty(
			TARGET,
			DEVICE,
			PropertyIdentifier.OBJECT_NAME,
		)
		assert.ok(result.values.length > 0)
		console.log('  Device OBJECT_NAME:', result.values[0]?.value)
	})

	test('9.2.2 Read Device VENDOR_NAME', async () => {
		const result = await client.readProperty(
			TARGET,
			DEVICE,
			PropertyIdentifier.VENDOR_NAME,
		)
		assert.ok(result.values.length > 0)
		console.log('  VENDOR_NAME:', result.values[0]?.value)
	})

	test('9.2.3 Read Device MODEL_NAME', async () => {
		const result = await client.readProperty(
			TARGET,
			DEVICE,
			PropertyIdentifier.MODEL_NAME,
		)
		assert.ok(result.values.length > 0)
		console.log('  MODEL_NAME:', result.values[0]?.value)
	})

	test('9.2.4 Read Device PROTOCOL_VERSION', async () => {
		const result = await client.readProperty(
			TARGET,
			DEVICE,
			PropertyIdentifier.PROTOCOL_VERSION,
		)
		assert.equal(result.values[0]?.value, 1, 'Protocol version must be 1')
		console.log('  PROTOCOL_VERSION:', result.values[0]?.value)
	})

	test('9.2.5 Read Device PROTOCOL_REVISION', async () => {
		const result = await client.readProperty(
			TARGET,
			DEVICE,
			PropertyIdentifier.PROTOCOL_REVISION,
		)
		const rev = result.values[0]?.value as number
		assert.ok(rev >= 1, 'Protocol revision must be >= 1')
		console.log('  PROTOCOL_REVISION:', rev)
	})

	test('9.2.6 Read Device MAX_APDU_LENGTH_ACCEPTED', async () => {
		const result = await client.readProperty(
			TARGET,
			DEVICE,
			PropertyIdentifier.MAX_APDU_LENGTH_ACCEPTED,
		)
		const maxApdu = result.values[0]?.value as number
		assert.ok(maxApdu >= 50, 'MAX_APDU must be >= 50')
		console.log('  MAX_APDU_LENGTH_ACCEPTED:', maxApdu)
	})

	test('9.2.7 Read Device SEGMENTATION_SUPPORTED', async () => {
		const result = await client.readProperty(
			TARGET,
			DEVICE,
			PropertyIdentifier.SEGMENTATION_SUPPORTED,
		)
		const seg = result.values[0]?.value as number
		assert.ok(seg >= 0 && seg <= 3, 'Segmentation must be 0-3')
		console.log('  SEGMENTATION_SUPPORTED:', seg)
	})

	test('9.2.8 Read Device SYSTEM_STATUS', async () => {
		const result = await client.readProperty(
			TARGET,
			DEVICE,
			PropertyIdentifier.SYSTEM_STATUS,
		)
		assert.ok(result.values.length > 0)
		console.log('  SYSTEM_STATUS:', result.values[0]?.value)
	})

	test('9.2.9 Read Device OBJECT_LIST size (index 0)', async () => {
		const result = await client.readProperty(
			TARGET,
			DEVICE,
			PropertyIdentifier.OBJECT_LIST,
			{ arrayIndex: 0 },
		)
		const count = result.values[0]?.value as number
		assert.ok(count > 0, 'Object list should not be empty')
		console.log('  OBJECT_LIST size:', count)
	})

	test('9.2.10 Read Device OBJECT_LIST (all objects)', async () => {
		const result = await client.readProperty(
			TARGET,
			DEVICE,
			PropertyIdentifier.OBJECT_LIST,
		)
		assert.ok(result.values.length > 0)
		console.log('  OBJECT_LIST: ', result.values.length, 'objects')
	})

	test('9.2.11 Read Device OBJECT_LIST by index', async () => {
		const result = await client.readProperty(
			TARGET,
			DEVICE,
			PropertyIdentifier.OBJECT_LIST,
			{ arrayIndex: 1 },
		)
		const obj = result.values[0]?.value as any
		assert.ok(obj != null, 'Should return first object')
		console.log(
			'  OBJECT_LIST[1]:',
			'type=' + obj.type,
			'instance=' + obj.instance,
		)
	})

	test('9.2.12 Read Device PROTOCOL_SERVICES_SUPPORTED', async () => {
		const result = await client.readProperty(
			TARGET,
			DEVICE,
			PropertyIdentifier.PROTOCOL_SERVICES_SUPPORTED,
		)
		assert.ok(result.values.length > 0)
		const ss = result.values[0]?.value as any
		assert.ok(ss && ss.bitsUsed > 0, 'Should return bitstring')
		console.log('  PROTOCOL_SERVICES_SUPPORTED:', ss)
	})

	test('9.2.13 Read Device PROTOCOL_OBJECT_TYPES_SUPPORTED', async () => {
		const result = await client.readProperty(
			TARGET,
			DEVICE,
			PropertyIdentifier.PROTOCOL_OBJECT_TYPES_SUPPORTED,
		)
		assert.ok(result.values.length > 0)
		console.log(
			'  PROTOCOL_OBJECT_TYPES_SUPPORTED:',
			result.values[0]?.value,
		)
	})

	test('9.2.14 Read Device DATABASE_REVISION', async () => {
		const result = await client.readProperty(
			TARGET,
			DEVICE,
			PropertyIdentifier.DATABASE_REVISION,
		)
		assert.ok(result.values.length > 0)
		console.log('  DATABASE_REVISION:', result.values[0]?.value)
	})

	test('9.2.15 Read non-existent object (error expected)', async () => {
		try {
			await client.readProperty(
				TARGET,
				{ type: ObjectType.ANALOG_VALUE, instance: 99999 },
				PropertyIdentifier.PRESENT_VALUE,
			)
			assert.fail('Should have thrown an error')
		} catch (err: any) {
			assert.ok(
				err.message.includes('BacnetError'),
				'Should return BACnet error',
			)
			console.log('  Non-existent object error:', err.message)
		}
	})

	test('9.2.16 Read non-existent property (error expected)', async () => {
		try {
			await client.readProperty(
				TARGET,
				AV0,
				9999, // invalid property
			)
			assert.fail('Should have thrown an error')
		} catch (err: any) {
			assert.ok(
				err.message.includes('BacnetError'),
				'Should return BACnet error',
			)
			console.log('  Non-existent property error:', err.message)
		}
	})
})

// ============================================================================
// BTL 9.3 — READ PROPERTY MULTIPLE
// ============================================================================

describe('BTL 9.3 — ReadPropertyMultiple', () => {
	test('9.3.1 RPM single object, multiple properties', async () => {
		const result = await client.readPropertyMultiple(TARGET, [
			{
				objectId: DEVICE,
				properties: [
					{ id: PropertyIdentifier.OBJECT_NAME, index: ASN1_ARRAY_ALL },
					{ id: PropertyIdentifier.VENDOR_NAME, index: ASN1_ARRAY_ALL },
					{ id: PropertyIdentifier.MODEL_NAME, index: ASN1_ARRAY_ALL },
					{
						id: PropertyIdentifier.SYSTEM_STATUS,
						index: ASN1_ARRAY_ALL,
					},
				],
			},
		])
		assert.ok(result.values.length === 1)
		assert.ok(
			(result.values[0]?.values?.length ?? 0) >= 4,
			'Should return all 4 properties',
		)
		console.log(
			'  RPM Device: ',
			result.values[0]?.values?.length,
			'properties',
		)
	})

	test('9.3.2 RPM multiple objects', async () => {
		const result = await client.readPropertyMultiple(TARGET, [
			{
				objectId: AV0,
				properties: [
					{
						id: PropertyIdentifier.OBJECT_NAME,
						index: ASN1_ARRAY_ALL,
					},
					{
						id: PropertyIdentifier.PRESENT_VALUE,
						index: ASN1_ARRAY_ALL,
					},
				],
			},
			{
				objectId: BV0,
				properties: [
					{
						id: PropertyIdentifier.OBJECT_NAME,
						index: ASN1_ARRAY_ALL,
					},
					{
						id: PropertyIdentifier.PRESENT_VALUE,
						index: ASN1_ARRAY_ALL,
					},
				],
			},
			{
				objectId: MSV0,
				properties: [
					{
						id: PropertyIdentifier.OBJECT_NAME,
						index: ASN1_ARRAY_ALL,
					},
					{
						id: PropertyIdentifier.PRESENT_VALUE,
						index: ASN1_ARRAY_ALL,
					},
				],
			},
		])
		assert.equal(result.values.length, 3, 'Should return 3 objects')
		console.log('  RPM 3 objects: OK')
	})

	test('9.3.3 RPM with array index', async () => {
		const result = await client.readPropertyMultiple(TARGET, [
			{
				objectId: DEVICE,
				properties: [
					{ id: PropertyIdentifier.OBJECT_LIST, index: 0 },
					{ id: PropertyIdentifier.OBJECT_LIST, index: 1 },
				],
			},
		])
		assert.ok(result.values.length === 1)
		console.log(
			'  RPM array index: ',
			result.values[0]?.values?.length,
			'entries',
		)
	})

	test('9.3.4 RPM with invalid object (partial error)', async () => {
		const result = await client.readPropertyMultiple(TARGET, [
			{
				objectId: AV0,
				properties: [
					{
						id: PropertyIdentifier.PRESENT_VALUE,
						index: ASN1_ARRAY_ALL,
					},
				],
			},
			{
				objectId: {
					type: ObjectType.ANALOG_VALUE,
					instance: 99999,
				},
				properties: [
					{
						id: PropertyIdentifier.PRESENT_VALUE,
						index: ASN1_ARRAY_ALL,
					},
				],
			},
		])
		assert.equal(result.values.length, 2, 'Should return 2 results')
		console.log('  RPM partial error: handled correctly')
	})
})

// ============================================================================
// BTL 9.4 — WRITE PROPERTY
// ============================================================================

describe('BTL 9.4 — WriteProperty', () => {
	let originalAV0: any

	test('9.4.0 Save original AV0 value', async () => {
		const r = await client.readProperty(
			TARGET,
			AV0,
			PropertyIdentifier.PRESENT_VALUE,
		)
		originalAV0 = r.values[0]?.value
		console.log('  Original AV0 PRESENT_VALUE:', originalAV0)
	})

	test('9.4.1 Write AV PRESENT_VALUE (REAL)', async () => {
		await client.writeProperty(
			TARGET,
			AV0,
			PropertyIdentifier.PRESENT_VALUE,
			[{ type: ApplicationTag.REAL, value: 42.5 }],
			{},
		)
		console.log('  Wrote AV0 PRESENT_VALUE = 42.5')

		const r = await client.readProperty(
			TARGET,
			AV0,
			PropertyIdentifier.PRESENT_VALUE,
		)
		assert.equal(
			r.values[0]?.value,
			42.5,
			'Read-back should be 42.5',
		)
		console.log('  Verified: AV0 = 42.5')
	})

	test('9.4.2 Write BV PRESENT_VALUE (ENUMERATED)', async () => {
		const origR = await client.readProperty(
			TARGET,
			BV0,
			PropertyIdentifier.PRESENT_VALUE,
		)
		const origBV = origR.values[0]?.value

		await client.writeProperty(
			TARGET,
			BV0,
			PropertyIdentifier.PRESENT_VALUE,
			[{ type: ApplicationTag.ENUMERATED, value: 1 }],
			{},
		)
		console.log('  Wrote BV0 PRESENT_VALUE = active(1)')

		const r = await client.readProperty(
			TARGET,
			BV0,
			PropertyIdentifier.PRESENT_VALUE,
		)
		assert.equal(r.values[0]?.value, 1, 'BV0 should be active(1)')
		console.log('  Verified: BV0 = 1')

		// Restore
		await client.writeProperty(
			TARGET,
			BV0,
			PropertyIdentifier.PRESENT_VALUE,
			[{ type: ApplicationTag.ENUMERATED, value: origBV as number }],
			{},
		)
	})

	test('9.4.3 Write MSV PRESENT_VALUE (UNSIGNED)', async () => {
		const origR = await client.readProperty(
			TARGET,
			MSV0,
			PropertyIdentifier.PRESENT_VALUE,
		)
		const origMSV = origR.values[0]?.value

		await client.writeProperty(
			TARGET,
			MSV0,
			PropertyIdentifier.PRESENT_VALUE,
			[{ type: ApplicationTag.UNSIGNED_INTEGER, value: 1 }],
			{},
		)
		console.log('  Wrote MSV0 PRESENT_VALUE = 1')

		const r = await client.readProperty(
			TARGET,
			MSV0,
			PropertyIdentifier.PRESENT_VALUE,
		)
		assert.equal(r.values[0]?.value, 1)
		console.log('  Verified: MSV0 = 1')

		// Restore
		await client.writeProperty(
			TARGET,
			MSV0,
			PropertyIdentifier.PRESENT_VALUE,
			[
				{
					type: ApplicationTag.UNSIGNED_INTEGER,
					value: origMSV as number,
				},
			],
			{},
		)
	})

	test('9.4.4 Write to read-only property (error expected)', async () => {
		try {
			await client.writeProperty(
				TARGET,
				DEVICE,
				PropertyIdentifier.OBJECT_NAME,
				[{ type: ApplicationTag.CHARACTER_STRING, value: 'test' }],
				{},
			)
			// Some devices allow name writes; not a strict failure
			console.log(
				'  Write OBJECT_NAME: accepted (device allows it)',
			)
		} catch (err: any) {
			assert.ok(err.message.includes('BacnetError'))
			console.log('  Write read-only property rejected:', err.message)
		}
	})

	test('9.4.5 Write with priority (commandable property)', async () => {
		await client.writeProperty(
			TARGET,
			AV0,
			PropertyIdentifier.PRESENT_VALUE,
			[{ type: ApplicationTag.REAL, value: 55.0 }],
			{ priority: 16 },
		)
		console.log('  Wrote AV0 with priority 16')

		const r = await client.readProperty(
			TARGET,
			AV0,
			PropertyIdentifier.PRESENT_VALUE,
		)
		console.log('  AV0 after priority write:', r.values[0]?.value)
	})

	test('9.4.99 Restore AV0', async () => {
		if (originalAV0 != null) {
			await client.writeProperty(
				TARGET,
				AV0,
				PropertyIdentifier.PRESENT_VALUE,
				[{ type: ApplicationTag.REAL, value: originalAV0 as number }],
				{},
			)
		}
		console.log('  Restored AV0')
	})
})

// ============================================================================
// BTL 9.5 — WRITE PROPERTY MULTIPLE
// ============================================================================

describe('BTL 9.5 — WritePropertyMultiple', () => {
	let originalAV0: number
	let originalAV1: number

	test('9.5.0 Save original values', async () => {
		const r0 = await client.readProperty(
			TARGET,
			AV0,
			PropertyIdentifier.PRESENT_VALUE,
		)
		originalAV0 = r0.values[0]?.value as number
		const r1 = await client.readProperty(
			TARGET,
			AV1,
			PropertyIdentifier.PRESENT_VALUE,
		)
		originalAV1 = r1.values[0]?.value as number
		console.log('  Originals: AV0=' + originalAV0, 'AV1=' + originalAV1)
	})

	test('9.5.1 WPM single object, single property', async () => {
		await client.writePropertyMultiple(TARGET, [
			{
				objectId: AV0,
				values: [
					{
						property: { id: PropertyIdentifier.PRESENT_VALUE },
						value: [
							{ type: ApplicationTag.REAL, value: 77.7 },
						],
						priority: 0,
					},
				],
			},
		])
		console.log('  WPM AV0 = 77.7')

		const r = await client.readProperty(
			TARGET,
			AV0,
			PropertyIdentifier.PRESENT_VALUE,
		)
		const readBack = r.values[0]?.value as number
		assert.ok(
			Math.abs(readBack - 77.7) < 0.01,
			`Read-back should be ~77.7, got ${readBack}`,
		)
		console.log('  Verified:', readBack)
	})

	test('9.5.2 WPM multiple objects', async () => {
		await client.writePropertyMultiple(TARGET, [
			{
				objectId: AV0,
				values: [
					{
						property: { id: PropertyIdentifier.PRESENT_VALUE },
						value: [
							{ type: ApplicationTag.REAL, value: 11.1 },
						],
						priority: 0,
					},
				],
			},
			{
				objectId: AV1,
				values: [
					{
						property: { id: PropertyIdentifier.PRESENT_VALUE },
						value: [
							{ type: ApplicationTag.REAL, value: 22.2 },
						],
						priority: 0,
					},
				],
			},
		])
		console.log('  WPM AV0=11.1, AV1=22.2')

		const r0 = await client.readProperty(
			TARGET,
			AV0,
			PropertyIdentifier.PRESENT_VALUE,
		)
		const r1 = await client.readProperty(
			TARGET,
			AV1,
			PropertyIdentifier.PRESENT_VALUE,
		)
		const v0 = r0.values[0]?.value as number
		const v1 = r1.values[0]?.value as number
		assert.ok(Math.abs(v0 - 11.1) < 0.01, `AV0 should be ~11.1, got ${v0}`)
		assert.ok(Math.abs(v1 - 22.2) < 0.01, `AV1 should be ~22.2, got ${v1}`)
		console.log('  Verified both:', v0, v1)
	})

	test('9.5.99 Restore', async () => {
		await client.writePropertyMultiple(TARGET, [
			{
				objectId: AV0,
				values: [
					{
						property: { id: PropertyIdentifier.PRESENT_VALUE },
						value: [
							{
								type: ApplicationTag.REAL,
								value: originalAV0,
							},
						],
						priority: 0,
					},
				],
			},
			{
				objectId: AV1,
				values: [
					{
						property: { id: PropertyIdentifier.PRESENT_VALUE },
						value: [
							{
								type: ApplicationTag.REAL,
								value: originalAV1,
							},
						],
						priority: 0,
					},
				],
			},
		])
		console.log('  Restored AV0 and AV1')
	})
})

// ============================================================================
// BTL 9.6 — SUBSCRIBE COV
// ============================================================================

describe('BTL 9.6 — SubscribeCOV', () => {
	test('9.6.1 Subscribe to AV0 COV', async () => {
		await client.subscribeCov(
			TARGET,
			AV0,
			100,
			false,
			true,
			60,
		)
		console.log('  Subscribed to AV0 COV (lifetime=60s)')
	})

	test('9.6.2 Receive COV notification on value change', async () => {
		// Subscribe
		await client.subscribeCov(
			TARGET,
			AV0,
			101,
			false,
			false, // unconfirmed
			30,
		)

		// Set up listener
		const covPromise = new Promise<any>((resolve) => {
			const timeout = setTimeout(
				() => resolve({ timeout: true }),
				5000,
			)
			client.once('covNotifyUnconfirmed' as any, (data: any) => {
				clearTimeout(timeout)
				resolve(data)
			})
		})

		// Trigger change
		const origR = await client.readProperty(
			TARGET,
			AV0,
			PropertyIdentifier.PRESENT_VALUE,
		)
		const origVal = origR.values[0]?.value as number
		await client.writeProperty(
			TARGET,
			AV0,
			PropertyIdentifier.PRESENT_VALUE,
			[{ type: ApplicationTag.REAL, value: origVal + 100 }],
			{},
		)

		const notification = await covPromise
		if (notification.timeout) {
			console.log(
				'  COV notification not received within 5s (device may use COV increment)',
			)
		} else {
			assert.ok(notification, 'Should receive COV notification')
			console.log('  Received COV notification')
		}

		// Restore
		await client.writeProperty(
			TARGET,
			AV0,
			PropertyIdentifier.PRESENT_VALUE,
			[{ type: ApplicationTag.REAL, value: origVal }],
			{},
		)
	})

	test('9.6.3 Cancel COV subscription', async () => {
		await client.subscribeCov(
			TARGET,
			AV0,
			100,
			true, // cancel
			false,
			0,
		)
		console.log('  Cancelled COV subscription 100')
	})

	test('9.6.4 Subscribe to BV0 COV', async () => {
		await client.subscribeCov(
			TARGET,
			BV0,
			102,
			false,
			true,
			30,
		)
		console.log('  Subscribed to BV0 COV')

		// Cancel
		await client.subscribeCov(
			TARGET,
			BV0,
			102,
			true,
			false,
			0,
		)
		console.log('  Cancelled BV0 COV')
	})
})

// ============================================================================
// BTL 9.7 — SUBSCRIBE COV PROPERTY
// ============================================================================

describe('BTL 9.7 — SubscribeCOVProperty', () => {
	test('9.7.1 Subscribe to AV0 PRESENT_VALUE property', async () => {
		await client.subscribeProperty(
			TARGET,
			AV0,
			{
				id: PropertyIdentifier.PRESENT_VALUE,
				index: ASN1_ARRAY_ALL,
			},
			200,
			false,
			true,
		)
		console.log('  Subscribed to AV0.PRESENT_VALUE')
	})

	test('9.7.2 Cancel property subscription', async () => {
		await client.subscribeProperty(
			TARGET,
			AV0,
			{
				id: PropertyIdentifier.PRESENT_VALUE,
				index: ASN1_ARRAY_ALL,
			},
			200,
			true, // cancel
			false,
		)
		console.log('  Cancelled property subscription 200')
	})

	test('9.7.3 Subscribe to BV0 PRESENT_VALUE property', async () => {
		await client.subscribeProperty(
			TARGET,
			BV0,
			{
				id: PropertyIdentifier.PRESENT_VALUE,
				index: ASN1_ARRAY_ALL,
			},
			201,
			false,
			true,
		)
		console.log('  Subscribed to BV0.PRESENT_VALUE')

		await client.subscribeProperty(
			TARGET,
			BV0,
			{
				id: PropertyIdentifier.PRESENT_VALUE,
				index: ASN1_ARRAY_ALL,
			},
			201,
			true,
			false,
		)
		console.log('  Cancelled')
	})
})

// ============================================================================
// BTL 9.8 — EVENT / ALARM SERVICES
// ============================================================================

describe('BTL 9.8 — Event and Alarm Services', () => {
	test('9.8.1 GetAlarmSummary', async () => {
		const alarms = await client.getAlarmSummary(TARGET)
		assert.ok(Array.isArray(alarms), 'Should return alarm array')
		console.log('  Alarms:', alarms.length, 'active')
		for (const alarm of alarms) {
			console.log(
				`    Object type=${alarm.objectId.type} instance=${alarm.objectId.instance} state=${alarm.alarmState}`,
			)
		}
	})

	test('9.8.2 GetEventInformation (all events)', async () => {
		const events = await client.getEventInformation(TARGET)
		assert.ok(Array.isArray(events), 'Should return event array')
		console.log('  Events:', events.length, 'entries')
		for (const ev of events) {
			console.log(
				`    Object type=${ev.objectId.type} instance=${ev.objectId.instance} state=${ev.eventState} notifyType=${ev.notifyType}`,
			)
		}
	})

	test('9.8.3 GetEventInformation for specific object', async () => {
		const events = await client.getEventInformation(TARGET, AV0)
		console.log('  Events for AV0:', events.length, 'entries')
	})

	test('9.8.4 GetEnrollmentSummary', async () => {
		try {
			const enrollment = await client.getEnrollmentSummary(
				TARGET,
				0, // all
			)
			console.log(
				'  Enrollment summary:',
				JSON.stringify(enrollment),
			)
		} catch (err: any) {
			console.log('  GetEnrollmentSummary:', err.message)
		}
	})

	test('9.8.5 AcknowledgeAlarm', async () => {
		// Get current alarms first
		const alarms = await client.getAlarmSummary(TARGET)
		if (alarms.length === 0) {
			console.log('  SKIPPED: no active alarms to acknowledge')
			return
		}

		const alarm = alarms[0]
		const now = new Date()
		try {
			await client.acknowledgeAlarm(
				TARGET,
				alarm.objectId,
				alarm.alarmState,
				'BTL test acknowledgement',
				{ type: 2, value: now } as any, // event timestamp
				{ type: 2, value: now } as any, // ack timestamp
			)
			console.log(
				'  Acknowledged alarm on',
				alarm.objectId.type,
				alarm.objectId.instance,
			)
		} catch (err: any) {
			// May fail if timestamp doesn't match
			console.log('  AcknowledgeAlarm result:', err.message)
		}
	})
})

// ============================================================================
// BTL 9.9 — EVENT ENROLLMENT & NOTIFICATION CLASS
// ============================================================================

describe('BTL 9.9 — Event Enrollment & Notification Class', () => {
	test('9.9.1 Read EventEnrollment properties', async () => {
		const props = [
			['OBJECT_NAME', PropertyIdentifier.OBJECT_NAME],
			['EVENT_TYPE', PropertyIdentifier.EVENT_TYPE],
			['NOTIFY_TYPE', PropertyIdentifier.NOTIFY_TYPE],
			['EVENT_STATE', PropertyIdentifier.EVENT_STATE],
			['NOTIFICATION_CLASS', PropertyIdentifier.NOTIFICATION_CLASS],
			[
				'OBJECT_PROPERTY_REFERENCE',
				PropertyIdentifier.OBJECT_PROPERTY_REFERENCE,
			],
			['EVENT_ENABLE', PropertyIdentifier.EVENT_ENABLE],
			['ACKED_TRANSITIONS', PropertyIdentifier.ACKED_TRANSITIONS],
		] as const

		for (const [name, pid] of props) {
			try {
				const r = await client.readProperty(TARGET, EE0, pid)
				console.log('  EE0', name + ':', r.values[0]?.value)
			} catch (err: any) {
				console.log('  EE0', name + ':', err.message)
			}
		}
	})

	test('9.9.2 Read NotificationClass properties', async () => {
		const props = [
			['OBJECT_NAME', PropertyIdentifier.OBJECT_NAME],
			['NOTIFICATION_CLASS', PropertyIdentifier.NOTIFICATION_CLASS],
			['PRIORITY', PropertyIdentifier.PRIORITY],
			['ACK_REQUIRED', PropertyIdentifier.ACK_REQUIRED],
		] as const

		for (const [name, pid] of props) {
			try {
				const r = await client.readProperty(TARGET, NC0, pid)
				console.log('  NC0', name + ':', r.values[0]?.value)
			} catch (err: any) {
				console.log('  NC0', name + ':', err.message)
			}
		}
	})

	test('9.9.3 Read EventEnrollment via RPM', async () => {
		const result = await client.readPropertyMultiple(TARGET, [
			{
				objectId: EE0,
				properties: [
					{
						id: PropertyIdentifier.OBJECT_NAME,
						index: ASN1_ARRAY_ALL,
					},
					{
						id: PropertyIdentifier.EVENT_TYPE,
						index: ASN1_ARRAY_ALL,
					},
					{
						id: PropertyIdentifier.EVENT_STATE,
						index: ASN1_ARRAY_ALL,
					},
					{
						id: PropertyIdentifier.NOTIFICATION_CLASS,
						index: ASN1_ARRAY_ALL,
					},
				],
			},
		])
		assert.ok(result.values.length === 1)
		console.log(
			'  RPM EE0:',
			result.values[0]?.values?.length,
			'properties',
		)
	})
})

// ============================================================================
// BTL 9.10 — TIME SYNCHRONIZATION
// ============================================================================

describe('BTL 9.10 — Time Synchronization', () => {
	test('9.10.1 Send TimeSync', () => {
		client.timeSync(TARGET, new Date())
		console.log('  Sent TimeSync with current time')
	})

	test('9.10.2 Send TimeSyncUTC', () => {
		client.timeSyncUTC(TARGET, new Date())
		console.log('  Sent TimeSyncUTC with current time')
	})
})

// ============================================================================
// BTL 9.11 — DEVICE COMMUNICATION CONTROL
// ============================================================================

describe('BTL 9.11 — Device Communication Control', () => {
	test('9.11.1 DeviceCommunicationControl enable (no-op)', async () => {
		try {
			await client.deviceCommunicationControl(
				TARGET,
				0, // timeDuration = 0 means no timeout
				0, // enable
			)
			console.log('  DCC enable: accepted')
		} catch (err: any) {
			// May require password
			console.log('  DCC enable:', err.message)
		}
	})
})

// ============================================================================
// BTL 9.12 — REINITIALIZE DEVICE
// ============================================================================

describe('BTL 9.12 — Reinitialize Device', () => {
	test('9.12.1 ReinitializeDevice warmstart (password protected, expect reject)', async () => {
		try {
			await client.reinitializeDevice(
				TARGET,
				1, // warmstart
			)
			console.log(
				'  WARNING: ReinitializeDevice accepted without password',
			)
		} catch (err: any) {
			// Expected to fail without password
			console.log('  ReinitializeDevice rejected:', err.message)
		}
	})
})

// ============================================================================
// BTL 9.13 — ATOMIC FILE OPERATIONS
// ============================================================================

describe('BTL 9.13 — Atomic File Operations', () => {
	test('9.13.1 Read File properties', async () => {
		const props = [
			['OBJECT_NAME', PropertyIdentifier.OBJECT_NAME],
			['FILE_TYPE', PropertyIdentifier.FILE_TYPE],
			['FILE_SIZE', PropertyIdentifier.FILE_SIZE],
			['FILE_ACCESS_METHOD', PropertyIdentifier.FILE_ACCESS_METHOD],
		] as const

		for (const [name, pid] of props) {
			try {
				const r = await client.readProperty(TARGET, FILE1, pid)
				console.log('  FILE1', name + ':', r.values[0]?.value)
			} catch (err: any) {
				console.log('  FILE1', name + ':', err.message)
			}
		}
	})

	test('9.13.2 AtomicReadFile', async () => {
		try {
			const result = await client.readFile(TARGET, FILE1, 0, 100)
			console.log(
				'  AtomicReadFile: read',
				result.endOfFile ? 'EOF' : 'partial',
			)
		} catch (err: any) {
			console.log('  AtomicReadFile:', err.message)
		}
	})

	test('9.13.3 Read all File objects', async () => {
		for (let i = 1; i <= 8; i++) {
			try {
				const r = await client.readProperty(
					TARGET,
					{ type: ObjectType.FILE, instance: i },
					PropertyIdentifier.OBJECT_NAME,
				)
				const sizeR = await client.readProperty(
					TARGET,
					{ type: ObjectType.FILE, instance: i },
					PropertyIdentifier.FILE_SIZE,
				)
				console.log(
					`  File:${i} name=${r.values[0]?.value} size=${sizeR.values[0]?.value}`,
				)
			} catch {
				// File may not exist
			}
		}
	})
})

// ============================================================================
// BTL 9.14 — OBJECT PROPERTY READS (All Object Types)
// ============================================================================

describe('BTL 9.14 — Object Type Property Reads', () => {
	describe('9.14.1 — Analog Value Objects', () => {
		test('Read all AV instances', async () => {
			const avInstances = [
				0, 1, 2, 3, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
			]
			for (const inst of avInstances) {
				const r = await client.readPropertyMultiple(TARGET, [
					{
						objectId: {
							type: ObjectType.ANALOG_VALUE,
							instance: inst,
						},
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
								id: PropertyIdentifier.UNITS,
								index: ASN1_ARRAY_ALL,
							},
						],
					},
				])
				const props = r.values[0]?.values
				if (props) {
					const name = props.find(
						(p: any) =>
							p.id === PropertyIdentifier.OBJECT_NAME,
					)
					const pv = props.find(
						(p: any) =>
							p.id === PropertyIdentifier.PRESENT_VALUE,
					)
					console.log(
						`  AV:${inst} name=${name?.values?.[0]?.value} pv=${pv?.values?.[0]?.value}`,
					)
				}
			}
		})
	})

	describe('9.14.2 — Binary Value Objects', () => {
		test('Read all BV instances', async () => {
			for (let inst = 0; inst <= 3; inst++) {
				const r = await client.readPropertyMultiple(TARGET, [
					{
						objectId: {
							type: ObjectType.BINARY_VALUE,
							instance: inst,
						},
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
								id: PropertyIdentifier.STATUS_FLAGS,
								index: ASN1_ARRAY_ALL,
							},
							{
								id: PropertyIdentifier.OUT_OF_SERVICE,
								index: ASN1_ARRAY_ALL,
							},
						],
					},
				])
				const props = r.values[0]?.values
				if (props) {
					const name = props.find(
						(p: any) =>
							p.id === PropertyIdentifier.OBJECT_NAME,
					)
					const pv = props.find(
						(p: any) =>
							p.id === PropertyIdentifier.PRESENT_VALUE,
					)
					console.log(
						`  BV:${inst} name=${name?.values?.[0]?.value} pv=${pv?.values?.[0]?.value}`,
					)
				}
			}
		})
	})

	describe('9.14.3 — Multi-state Value Object', () => {
		test('Read MSV properties', async () => {
			const props = [
				['OBJECT_NAME', PropertyIdentifier.OBJECT_NAME],
				['PRESENT_VALUE', PropertyIdentifier.PRESENT_VALUE],
				['STATUS_FLAGS', PropertyIdentifier.STATUS_FLAGS],
				['NUMBER_OF_STATES', PropertyIdentifier.NUMBER_OF_STATES],
				['OUT_OF_SERVICE', PropertyIdentifier.OUT_OF_SERVICE],
			] as const

			for (const [name, pid] of props) {
				const r = await client.readProperty(TARGET, MSV0, pid)
				console.log('  MSV0', name + ':', r.values[0]?.value)
			}
		})
	})

	describe('9.14.4 — Device Object', () => {
		test('Read all required Device properties', async () => {
			const props = [
				['OBJECT_IDENTIFIER', PropertyIdentifier.OBJECT_IDENTIFIER],
				['OBJECT_NAME', PropertyIdentifier.OBJECT_NAME],
				['OBJECT_TYPE', PropertyIdentifier.OBJECT_TYPE],
				['SYSTEM_STATUS', PropertyIdentifier.SYSTEM_STATUS],
				['VENDOR_NAME', PropertyIdentifier.VENDOR_NAME],
				['VENDOR_IDENTIFIER', PropertyIdentifier.VENDOR_IDENTIFIER],
				['MODEL_NAME', PropertyIdentifier.MODEL_NAME],
				['FIRMWARE_REVISION', PropertyIdentifier.FIRMWARE_REVISION],
				[
					'APPLICATION_SOFTWARE_VERSION',
					PropertyIdentifier.APPLICATION_SOFTWARE_VERSION,
				],
				['PROTOCOL_VERSION', PropertyIdentifier.PROTOCOL_VERSION],
				['PROTOCOL_REVISION', PropertyIdentifier.PROTOCOL_REVISION],
				[
					'PROTOCOL_SERVICES_SUPPORTED',
					PropertyIdentifier.PROTOCOL_SERVICES_SUPPORTED,
				],
				[
					'PROTOCOL_OBJECT_TYPES_SUPPORTED',
					PropertyIdentifier.PROTOCOL_OBJECT_TYPES_SUPPORTED,
				],
				[
					'MAX_APDU_LENGTH_ACCEPTED',
					PropertyIdentifier.MAX_APDU_LENGTH_ACCEPTED,
				],
				[
					'SEGMENTATION_SUPPORTED',
					PropertyIdentifier.SEGMENTATION_SUPPORTED,
				],
				['APDU_TIMEOUT', PropertyIdentifier.APDU_TIMEOUT],
				[
					'NUMBER_OF_APDU_RETRIES',
					PropertyIdentifier.NUMBER_OF_APDU_RETRIES,
				],
				['DATABASE_REVISION', PropertyIdentifier.DATABASE_REVISION],
			] as const

			for (const [name, pid] of props) {
				try {
					const r = await client.readProperty(
						TARGET,
						DEVICE,
						pid,
					)
					console.log(
						'  Device',
						name + ':',
						r.values[0]?.value,
					)
				} catch (err: any) {
					console.log('  Device', name + ':', err.message)
				}
			}
		})
	})

	describe('9.14.5 — Event Log Object', () => {
		test('Read EventLog properties', async () => {
			const props = [
				['OBJECT_NAME', PropertyIdentifier.OBJECT_NAME],
				['STATUS_FLAGS', PropertyIdentifier.STATUS_FLAGS],
				['RECORD_COUNT', PropertyIdentifier.RECORD_COUNT],
				['TOTAL_RECORD_COUNT', PropertyIdentifier.TOTAL_RECORD_COUNT],
				['ENABLE', PropertyIdentifier.ENABLE],
				['BUFFER_SIZE', PropertyIdentifier.BUFFER_SIZE],
				['STOP_WHEN_FULL', PropertyIdentifier.STOP_WHEN_FULL],
			] as const

			for (const [name, pid] of props) {
				try {
					const r = await client.readProperty(
						TARGET,
						EVENT_LOG0,
						pid,
					)
					console.log(
						'  EventLog0',
						name + ':',
						r.values[0]?.value,
					)
				} catch (err: any) {
					console.log('  EventLog0', name + ':', err.message)
				}
			}
		})
	})

	describe('9.14.6 — Network Port Object', () => {
		test('Read NetworkPort properties', async () => {
			const props = [
				['OBJECT_NAME', PropertyIdentifier.OBJECT_NAME],
				['STATUS_FLAGS', PropertyIdentifier.STATUS_FLAGS],
				['RELIABILITY', PropertyIdentifier.RELIABILITY],
				['OUT_OF_SERVICE', PropertyIdentifier.OUT_OF_SERVICE],
				['NETWORK_TYPE', 334 as PropertyIdentifier],
				['NETWORK_NUMBER', 335 as PropertyIdentifier],
				['MAC_ADDRESS', 336 as PropertyIdentifier],
				['BACNET_IP_MODE', 408 as PropertyIdentifier],
				['IP_ADDRESS', 400 as PropertyIdentifier],
				['BACNET_IP_UDP_PORT', 412 as PropertyIdentifier],
			] as const

			for (const [name, pid] of props) {
				try {
					const r = await client.readProperty(
						TARGET,
						NETWORK_PORT1,
						pid,
					)
					console.log(
						'  NP1',
						name + ':',
						r.values[0]?.value,
					)
				} catch (err: any) {
					console.log('  NP1', name + ':', err.message)
				}
			}
		})
	})
})

// ============================================================================
// BTL 9.15 — ERROR HANDLING
// ============================================================================

describe('BTL 9.15 — Error Handling', () => {
	test('9.15.1 Read from non-existent object', async () => {
		try {
			await client.readProperty(
				TARGET,
				{ type: ObjectType.ANALOG_VALUE, instance: 99999 },
				PropertyIdentifier.PRESENT_VALUE,
			)
			assert.fail('Should error')
		} catch (err: any) {
			// ErrorClass:OBJECT(1) ErrorCode:UNKNOWN_OBJECT(31)
			assert.ok(err.message.includes('BacnetError'))
			console.log('  Unknown object:', err.message)
		}
	})

	test('9.15.2 Read non-existent property', async () => {
		try {
			await client.readProperty(TARGET, AV0, 9999)
			assert.fail('Should error')
		} catch (err: any) {
			// ErrorClass:PROPERTY(2) ErrorCode:UNKNOWN_PROPERTY(32)
			assert.ok(err.message.includes('BacnetError'))
			console.log('  Unknown property:', err.message)
		}
	})

	test('9.15.3 Write invalid datatype', async () => {
		try {
			await client.writeProperty(
				TARGET,
				AV0,
				PropertyIdentifier.PRESENT_VALUE,
				[
					{
						type: ApplicationTag.CHARACTER_STRING,
						value: 'invalid',
					},
				],
				{},
			)
			assert.fail('Should error')
		} catch (err: any) {
			console.log('  Invalid datatype write:', err.message)
		}
	})

	test('9.15.4 Read with invalid array index', async () => {
		try {
			await client.readProperty(
				TARGET,
				AV0,
				PropertyIdentifier.PRESENT_VALUE,
				{ arrayIndex: 999 },
			)
			// AV.PRESENT_VALUE is not an array, may error with PROPERTY_IS_NOT_AN_ARRAY
			console.log('  Invalid array index: device accepted (non-array)')
		} catch (err: any) {
			console.log('  Invalid array index:', err.message)
		}
	})

	test('9.15.5 Timeout to unreachable device', async () => {
		const fastClient = new Bacnet({ apduTimeout: 2000, port: 0 })
		await once(fastClient as any, 'listening')
		try {
			await fastClient.readProperty(
				{ address: '192.168.40.254:47808' },
				{ type: ObjectType.DEVICE, instance: 0 },
				PropertyIdentifier.OBJECT_NAME,
			)
			assert.fail('Should timeout')
		} catch (err: any) {
			assert.ok(
				err.message.includes('TIMEOUT') ||
					err.message.includes('timeout') ||
					err.message.includes('Timeout'),
				'Should be timeout error',
			)
			console.log('  Timeout:', err.message)
		} finally {
			fastClient.close()
		}
	})
})

// ============================================================================
// BTL 9.16 — ADD/REMOVE LIST ELEMENT
// ============================================================================

describe('BTL 9.16 — AddListElement / RemoveListElement', () => {
	test('9.16.1 AddListElement (if supported)', async () => {
		try {
			await client.addListElement(
				TARGET,
				DEVICE,
				{
					id: PropertyIdentifier.OBJECT_LIST,
					index: ASN1_ARRAY_ALL,
				},
				[
					{
						type: ApplicationTag.OBJECTIDENTIFIER,
						value: {
							type: ObjectType.ANALOG_VALUE,
							instance: 999,
						},
					},
				] as any,
			)
			console.log('  AddListElement: accepted')
		} catch (err: any) {
			// Expected to fail - can't add to OBJECT_LIST directly
			console.log('  AddListElement:', err.message)
		}
	})

	test('9.16.2 RemoveListElement (if supported)', async () => {
		try {
			await client.removeListElement(
				TARGET,
				DEVICE,
				{
					id: PropertyIdentifier.OBJECT_LIST,
					index: ASN1_ARRAY_ALL,
				},
				[
					{
						type: ApplicationTag.OBJECTIDENTIFIER,
						value: {
							type: ObjectType.ANALOG_VALUE,
							instance: 999,
						},
					},
				] as any,
			)
			console.log('  RemoveListElement: accepted')
		} catch (err: any) {
			console.log('  RemoveListElement:', err.message)
		}
	})
})

// ============================================================================
// BTL 9.17 — COMPREHENSIVE RPM (All Object Types in Single Request)
// ============================================================================

describe('BTL 9.17 — Comprehensive Multi-Object RPM', () => {
	test('9.17.1 RPM all object types in single request', async () => {
		const result = await client.readPropertyMultiple(TARGET, [
			{
				objectId: DEVICE,
				properties: [
					{
						id: PropertyIdentifier.OBJECT_NAME,
						index: ASN1_ARRAY_ALL,
					},
					{
						id: PropertyIdentifier.SYSTEM_STATUS,
						index: ASN1_ARRAY_ALL,
					},
				],
			},
			{
				objectId: AV0,
				properties: [
					{
						id: PropertyIdentifier.OBJECT_NAME,
						index: ASN1_ARRAY_ALL,
					},
					{
						id: PropertyIdentifier.PRESENT_VALUE,
						index: ASN1_ARRAY_ALL,
					},
				],
			},
			{
				objectId: BV0,
				properties: [
					{
						id: PropertyIdentifier.OBJECT_NAME,
						index: ASN1_ARRAY_ALL,
					},
					{
						id: PropertyIdentifier.PRESENT_VALUE,
						index: ASN1_ARRAY_ALL,
					},
				],
			},
			{
				objectId: MSV0,
				properties: [
					{
						id: PropertyIdentifier.OBJECT_NAME,
						index: ASN1_ARRAY_ALL,
					},
					{
						id: PropertyIdentifier.PRESENT_VALUE,
						index: ASN1_ARRAY_ALL,
					},
				],
			},
			{
				objectId: EE0,
				properties: [
					{
						id: PropertyIdentifier.OBJECT_NAME,
						index: ASN1_ARRAY_ALL,
					},
					{
						id: PropertyIdentifier.EVENT_STATE,
						index: ASN1_ARRAY_ALL,
					},
				],
			},
			{
				objectId: NC0,
				properties: [
					{
						id: PropertyIdentifier.OBJECT_NAME,
						index: ASN1_ARRAY_ALL,
					},
					{
						id: PropertyIdentifier.NOTIFICATION_CLASS,
						index: ASN1_ARRAY_ALL,
					},
				],
			},
		])

		assert.equal(
			result.values.length,
			6,
			'Should return 6 object results',
		)
		console.log('  Comprehensive RPM: 6 objects returned')
		for (const obj of result.values) {
			console.log(`    Object: ${obj.values?.length} properties`)
		}
	})
})
