/**
 * End-to-end test for BACnet segmentation against a real device.
 *
 * Exercises both directions of segmentation plus the local validation
 * added by the caller-controlled segmented-request transport:
 *  - segmented ComplexACK responses (forced via a small local max APDU)
 *  - segmented Confirmed Requests (large WriteProperty / WPM payloads)
 *  - structured local errors (ApduTooLargeError, SegmentCountExceededError)
 *  - proposed window sizes > 1 and equivalence with unsegmented writes
 *
 * Reuses the same Schedule (and optionally Calendar) objects as
 * schedule-calendar-e2e.ts - no additional device objects are required.
 *
 * Usage:
 *   node --require esbuild-register examples/segmentation-e2e.ts \
 *     <targetAddress> <scheduleInstance> [--deviceInstance <n>] \
 *     [--remoteMaxApdu 480] [--windowSize 8] [--mode smoke|full] \
 *     [--steps 1,3,6] [--localPort 47809] [--timeoutMs 30000]
 */
import Bacnet, {
	ASN1_ARRAY_ALL,
	ASN1_NO_PRIORITY,
	ApduTooLargeError,
	ApplicationTag,
	type BACNetAddress,
	type BACNetAppData,
	type BACNetExceptionSchedulePayload,
	type BACNetObjectID,
	type BACNetTimeValueEntry,
	type BACNetWeeklySchedulePayload,
	MaxApduLengthAccepted,
	ObjectType,
	PropertyIdentifier,
	SegmentCountExceededError,
	Segmentation,
	type SegmentedRequestOptions,
	type WritePropertyMultipleObject,
} from '../src'

type Mode = 'smoke' | 'full'

interface CliConfig {
	targetAddress: string
	scheduleInstance: number
	deviceInstance?: number
	remoteMaxApdu: number
	windowSize: number
	exceptionCount: number
	tuplesPerException: number
	weeklyRowsPerDay: number
	mode: Mode
	timeoutMs: number
	localPort?: number
	selectedSteps: Set<number> | null
}

interface StepResult {
	name: string
	status: 'PASS' | 'FAIL' | 'SKIP'
	latencyMs: number
	details?: string
}

interface DeviceCapabilities {
	segmentationSupported?: number
	maxApduLengthAccepted?: number
	maxSegmentsAccepted?: number
	apduSegmentTimeout?: number
}

interface StepContext {
	client: Bacnet
	address: BACNetAddress
	scheduleObject: BACNetObjectID
	config: CliConfig
	valueTag: number
	capabilities: DeviceCapabilities
	/** Effective remote APDU limit used for segmented requests */
	remoteMaxApdu: number
}

class SkipStep extends Error {}

const argMap = parseArgs(process.argv.slice(2))
const config = buildConfig(argMap)

const address: BACNetAddress = {
	address: config.targetAddress.includes(':')
		? config.targetAddress
		: `${config.targetAddress}:47808`,
}

const client = new Bacnet(
	config.localPort
		? { apduTimeout: config.timeoutMs, port: config.localPort }
		: { apduTimeout: config.timeoutMs },
)

client.on('error', (err: Error) => {
	console.error('[CLIENT_ERROR]', err.message)
})

void main().catch((err) => {
	console.error(
		'[FATAL]',
		err instanceof Error ? err.stack || err.message : err,
	)
	client.close()
	process.exitCode = 1
})

async function main() {
	console.log('=== Segmentation E2E ===')
	console.log(JSON.stringify(config, null, 2))

	const context: StepContext = {
		client,
		address,
		scheduleObject: {
			type: ObjectType.SCHEDULE,
			instance: config.scheduleInstance,
		},
		config,
		valueTag: ApplicationTag.UNSIGNED_INTEGER,
		capabilities: {},
		remoteMaxApdu: config.remoteMaxApdu,
	}

	context.valueTag = await inferValueTag(context)
	console.log(`[INFO] valueTag=${context.valueTag}`)

	const allSteps: Array<{ id: number; run: () => Promise<StepResult> }> = [
		{
			id: 1,
			run: () =>
				runStep(
					'1) Read device segmentation capabilities',
					context,
					stepDeviceCapabilities,
				),
		},
		{
			id: 2,
			run: () =>
				runStep(
					'2) Baseline unsegmented write + read (WEEKLY_SCHEDULE)',
					context,
					stepBaselineUnsegmented,
				),
		},
		{
			id: 3,
			run: () =>
				runStep(
					'3) Segmented ComplexACK response (RP with 128 octet local APDU)',
					context,
					stepSegmentedResponse,
				),
		},
		{
			id: 4,
			run: () =>
				runStep(
					'4) Oversized unsegmented write throws ApduTooLargeError locally',
					context,
					stepApduTooLarge,
				),
		},
		{
			id: 5,
			run: () =>
				runStep(
					'5) remoteMaxSegmentsAccepted exceeded throws locally',
					context,
					stepSegmentCountExceeded,
				),
		},
		{
			id: 6,
			run: () =>
				runStep(
					'6) Segmented WriteProperty, window size 1 (EXCEPTION_SCHEDULE)',
					context,
					stepSegmentedWpWindow1,
				),
		},
		{
			id: 7,
			run: () =>
				runStep(
					`7) Segmented WriteProperty, window size ${config.windowSize}`,
					context,
					stepSegmentedWpWindowN,
				),
		},
		{
			id: 8,
			run: () =>
				runStep(
					'8) Segmented WritePropertyMultiple (repeated size writes)',
					context,
					stepSegmentedWpm,
				),
		},
		{
			id: 9,
			run: () =>
				runStep(
					'9) Segmented write equals indexed unsegmented write',
					context,
					stepSegmentedVsIndexedEquivalence,
				),
		},
		{
			id: 10,
			run: () =>
				runStep(
					'10) Segmented write to missing object is rejected by device',
					context,
					stepSegmentedWriteRejected,
				),
		},
		{
			id: 11,
			run: () =>
				runStep('11) Restore small schedules', context, stepRestore),
		},
	]

	const steps = config.selectedSteps
		? allSteps.filter((entry) => config.selectedSteps?.has(entry.id))
		: allSteps

	const results: StepResult[] = []
	for (const step of steps) {
		results.push(await step.run())
	}

	const passed = results.filter((x) => x.status === 'PASS')
	const failed = results.filter((x) => x.status === 'FAIL')
	const skipped = results.filter((x) => x.status === 'SKIP')
	console.log('\n=== Summary ===')
	console.log(`PASS: ${passed.length}`)
	console.log(`FAIL: ${failed.length}`)
	console.log(`SKIP: ${skipped.length}`)
	if (failed.length > 0) {
		for (const fail of failed) {
			console.log(`- ${fail.name}: ${fail.details || 'No details'}`)
		}
		process.exitCode = 1
	}

	client.close()
}

async function runStep(
	name: string,
	context: StepContext,
	fn: (context: StepContext) => Promise<string>,
): Promise<StepResult> {
	const started = Date.now()
	try {
		const details = await withTimeout(
			fn(context),
			context.config.timeoutMs,
			`${name} timed out`,
		)
		const result: StepResult = {
			name,
			status: 'PASS',
			latencyMs: Date.now() - started,
			details,
		}
		console.log(`[PASS] ${name} (${result.latencyMs} ms) :: ${details}`)
		return result
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error)
		if (error instanceof SkipStep) {
			console.log(`[SKIP] ${name} :: ${msg}`)
			return {
				name,
				status: 'SKIP',
				latencyMs: Date.now() - started,
				details: msg,
			}
		}
		const result: StepResult = {
			name,
			status: 'FAIL',
			latencyMs: Date.now() - started,
			details: msg,
		}
		console.error(`[FAIL] ${name} (${result.latencyMs} ms) :: ${msg}`)
		return result
	}
}

function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	message: string,
): Promise<T> {
	let timer: NodeJS.Timeout | undefined
	const timeout = new Promise<T>((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), timeoutMs)
	})
	return Promise.race([promise, timeout]).finally(() => {
		if (timer) clearTimeout(timer)
	}) as Promise<T>
}

function parseArgs(args: string[]): Map<string, string> {
	const map = new Map<string, string>()
	const positional: string[] = []
	for (let i = 0; i < args.length; i++) {
		const token = args[i]
		if (token.startsWith('--')) {
			const key = token.slice(2)
			const maybeValue = args[i + 1]
			if (!maybeValue || maybeValue.startsWith('--')) {
				map.set(key, 'true')
			} else {
				map.set(key, maybeValue)
				i++
			}
		} else {
			positional.push(token)
		}
	}
	if (positional[0] && !map.has('targetAddress'))
		map.set('targetAddress', positional[0])
	if (positional[1] && !map.has('scheduleInstance'))
		map.set('scheduleInstance', positional[1])
	if (positional[2] && !map.has('localPort'))
		map.set('localPort', positional[2])
	return map
}

function buildConfig(argValues: Map<string, string>): CliConfig {
	const mode = (
		(argValues.get('mode') || 'full').toLowerCase() === 'smoke'
			? 'smoke'
			: 'full'
	) as Mode

	const defaultException = mode === 'smoke' ? 12 : 24
	const defaultTuples = mode === 'smoke' ? 4 : 8
	const defaultWeeklyRows = mode === 'smoke' ? 12 : 32
	const defaultTimeout = mode === 'smoke' ? 20000 : 60000

	const localPortValue = argValues.get('localPort')
	const deviceInstanceValue = argValues.get('deviceInstance')

	return {
		targetAddress: argValues.get('targetAddress') || '192.168.40.245:47808',
		scheduleInstance: parseNumber(argValues.get('scheduleInstance'), 0),
		deviceInstance: deviceInstanceValue
			? parseNumber(deviceInstanceValue, NaN)
			: undefined,
		remoteMaxApdu: parseNumber(argValues.get('remoteMaxApdu'), 480),
		windowSize: parseNumber(argValues.get('windowSize'), 8),
		exceptionCount: parseNumber(
			argValues.get('exceptionCount'),
			defaultException,
		),
		tuplesPerException: parseNumber(
			argValues.get('tuplesPerException'),
			defaultTuples,
		),
		weeklyRowsPerDay: parseNumber(
			argValues.get('weeklyRowsPerDay'),
			defaultWeeklyRows,
		),
		mode,
		timeoutMs: parseNumber(argValues.get('timeoutMs'), defaultTimeout),
		localPort: localPortValue
			? parseNumber(localPortValue, NaN)
			: undefined,
		selectedSteps: parseSteps(argValues.get('steps')),
	}
}

function parseNumber(value: string | undefined, fallback: number): number {
	if (!value) return fallback
	const parsed = Number.parseInt(value, 10)
	return Number.isFinite(parsed) ? parsed : fallback
}

function parseSteps(value: string | undefined): Set<number> | null {
	if (!value) return null
	const parsed = value
		.split(',')
		.map((v) => Number.parseInt(v.trim(), 10))
		.filter((n) => Number.isInteger(n) && n > 0)
	return parsed.length > 0 ? new Set(parsed) : null
}

function segmentedOptions(
	context: StepContext,
	overrides: Partial<SegmentedRequestOptions> = {},
): SegmentedRequestOptions {
	return {
		enabled: true,
		remoteMaxApduLength: context.remoteMaxApdu,
		proposedWindowSize: 1,
		...overrides,
	}
}

async function inferValueTag(context: StepContext): Promise<number> {
	try {
		const weeklyValue = await readViaRp(
			context,
			context.scheduleObject,
			PropertyIdentifier.WEEKLY_SCHEDULE,
			ASN1_ARRAY_ALL,
		)
		const weekly = extractWeeklyEntries(weeklyValue)
		const first = weekly[0]?.[0]?.value
		if (first?.type !== undefined) return first.type
	} catch {}
	return ApplicationTag.UNSIGNED_INTEGER
}

function buildAppValue(tag: number, seed: number): BACNetAppData {
	switch (tag) {
		case ApplicationTag.BOOLEAN:
			return { type: ApplicationTag.BOOLEAN, value: seed % 2 === 0 }
		case ApplicationTag.REAL:
			return { type: ApplicationTag.REAL, value: seed + 0.25 }
		case ApplicationTag.ENUMERATED:
			return { type: ApplicationTag.ENUMERATED, value: seed % 16 }
		case ApplicationTag.SIGNED_INTEGER:
			return { type: ApplicationTag.SIGNED_INTEGER, value: seed - 100 }
		case ApplicationTag.UNSIGNED_INTEGER:
			return { type: ApplicationTag.UNSIGNED_INTEGER, value: seed }
		default:
			return { type: ApplicationTag.UNSIGNED_INTEGER, value: seed }
	}
}

function buildWeeklySchedule(
	rowsPerDay: number,
	valueTag: number,
): BACNetWeeklySchedulePayload {
	const weekly: BACNetWeeklySchedulePayload = []
	for (let day = 0; day < 7; day++) {
		const rows: BACNetTimeValueEntry[] = []
		for (let row = 0; row < rowsPerDay; row++) {
			rows.push({
				time: {
					type: ApplicationTag.TIME,
					value: new Date(
						2024,
						0,
						1 + day,
						Math.floor(row / 2),
						(row % 2) * 30,
						0,
						0,
					),
				},
				value: buildAppValue(valueTag, day * 1000 + row),
			})
		}
		weekly.push(rows)
	}
	return weekly
}

function buildExceptionSchedule(
	count: number,
	tuplesPerEntry: number,
	valueTag: number,
): BACNetExceptionSchedulePayload {
	const entries: BACNetExceptionSchedulePayload = []
	for (let i = 0; i < count; i++) {
		const events: BACNetTimeValueEntry[] = []
		for (let t = 0; t < tuplesPerEntry; t++) {
			events.push({
				time: {
					type: ApplicationTag.TIME,
					value: new Date(2026, 0, 1, t % 24, (t * 5) % 60, 0, 0),
				},
				value: buildAppValue(valueTag, i * 100 + t),
			})
		}
		entries.push({
			date: {
				type: ApplicationTag.DATE,
				value: new Date(2026, i % 12, (i % 27) + 1),
			},
			events,
			priority: {
				type: ApplicationTag.UNSIGNED_INTEGER,
				value: (i % 16) + 1,
			},
		})
	}
	return entries
}

async function writeViaWp(
	context: StepContext,
	objectId: BACNetObjectID,
	propertyId: number,
	value: unknown,
	arrayIndex: number = ASN1_ARRAY_ALL,
	segmentedRequest?: SegmentedRequestOptions,
) {
	await context.client.writeProperty(
		context.address,
		objectId,
		propertyId,
		value as never,
		{
			arrayIndex,
			priority: ASN1_NO_PRIORITY,
			segmentedRequest,
		},
	)
}

async function readViaRp(
	context: StepContext,
	objectId: BACNetObjectID,
	propertyId: number,
	arrayIndex: number = ASN1_ARRAY_ALL,
	maxApdu?: number,
): Promise<BACNetAppData> {
	const response = await context.client.readProperty(
		context.address,
		objectId,
		propertyId,
		maxApdu !== undefined ? { arrayIndex, maxApdu } : { arrayIndex },
	)
	const value = response.values[0]
	if (!value) throw new Error('RP decode returned no values')
	return value
}

function extractWeeklyEntries(value: BACNetAppData): BACNetTimeValueEntry[][] {
	assertTrue(
		value.type === ApplicationTag.WEEKLY_SCHEDULE,
		`Expected WEEKLY_SCHEDULE, got type=${value.type}`,
	)
	return value.value as BACNetTimeValueEntry[][]
}

function extractExceptionEntries(value: BACNetAppData): any[] {
	assertTrue(
		value.type === ApplicationTag.SPECIAL_EVENT,
		`Expected SPECIAL_EVENT, got type=${value.type}`,
	)
	return value.value as any[]
}

function assertTrue(condition: boolean, message: string) {
	if (!condition) throw new Error(message)
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
	if (actual !== expected) {
		throw new Error(
			`${message}. expected=${String(expected)} actual=${String(actual)}`,
		)
	}
}

function normalize(value: unknown): unknown {
	if (value instanceof Date) return { __date: value.toISOString() }
	if (Array.isArray(value)) return value.map(normalize)
	if (Buffer.isBuffer(value)) return { __buffer: value.toString('hex') }
	if (value && typeof value === 'object') {
		const source = value as Record<string, unknown>
		const out: Record<string, unknown> = {}
		for (const key of Object.keys(source).sort()) {
			if (key === 'len') continue
			out[key] = normalize(source[key])
		}
		return out
	}
	return value
}

function semanticEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}

async function expectFailure(
	label: string,
	fn: () => Promise<unknown>,
): Promise<Error> {
	try {
		await fn()
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error))
	}
	throw new Error(`${label}: expected failure, but operation succeeded`)
}

// --- Steps -----------------------------------------------------------------

async function stepDeviceCapabilities(context: StepContext): Promise<string> {
	if (context.config.deviceInstance === undefined) {
		throw new SkipStep(
			'pass --deviceInstance <n> to read segmentation capabilities from the device object',
		)
	}
	const deviceObject: BACNetObjectID = {
		type: ObjectType.DEVICE,
		instance: context.config.deviceInstance,
	}
	const readNumber = async (propertyId: number) => {
		const value = await readViaRp(context, deviceObject, propertyId)
		return Number(value.value)
	}
	const capabilities: DeviceCapabilities = {
		segmentationSupported: await readNumber(
			PropertyIdentifier.SEGMENTATION_SUPPORTED,
		),
		maxApduLengthAccepted: await readNumber(
			PropertyIdentifier.MAX_APDU_LENGTH_ACCEPTED,
		),
	}
	try {
		capabilities.maxSegmentsAccepted = await readNumber(
			PropertyIdentifier.MAX_SEGMENTS_ACCEPTED,
		)
	} catch {}
	try {
		capabilities.apduSegmentTimeout = await readNumber(
			PropertyIdentifier.APDU_SEGMENT_TIMEOUT,
		)
	} catch {}
	context.capabilities = capabilities

	if (capabilities.maxApduLengthAccepted) {
		context.remoteMaxApdu = Math.min(
			context.remoteMaxApdu,
			capabilities.maxApduLengthAccepted,
		)
	}

	const canReceiveSegments =
		capabilities.segmentationSupported === Segmentation.SEGMENTED_BOTH ||
		capabilities.segmentationSupported === Segmentation.SEGMENTED_RECEIVE
	const canTransmitSegments =
		capabilities.segmentationSupported === Segmentation.SEGMENTED_BOTH ||
		capabilities.segmentationSupported === Segmentation.SEGMENTED_TRANSMIT
	if (!canReceiveSegments) {
		console.warn(
			'[WARN] device does not support receiving segmented requests; steps 6-10 are expected to fail',
		)
	}
	if (!canTransmitSegments) {
		console.warn(
			'[WARN] device does not support transmitting segmented responses; step 3 is expected to fail',
		)
	}

	return `segmentationSupported=${capabilities.segmentationSupported} maxApdu=${capabilities.maxApduLengthAccepted} maxSegments=${capabilities.maxSegmentsAccepted} segmentTimeout=${capabilities.apduSegmentTimeout} effectiveRemoteMaxApdu=${context.remoteMaxApdu}`
}

async function stepBaselineUnsegmented(context: StepContext): Promise<string> {
	const weekly = buildWeeklySchedule(4, context.valueTag)
	await writeViaWp(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		weekly,
	)
	const readBack = await readViaRp(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
	)
	const days = extractWeeklyEntries(readBack)
	assertEqual(days.length, 7, 'Weekly schedule day count mismatch')
	assertEqual(days[0].length, 4, 'Day 0 row count mismatch')
	return 'unsegmented write/read OK (rowsPerDay=4)'
}

async function stepSegmentedResponse(context: StepContext): Promise<string> {
	// Populate enough data that the response cannot fit in 50 octets.
	const weekly = buildWeeklySchedule(
		Math.max(4, Math.min(context.config.weeklyRowsPerDay, 8)),
		context.valueTag,
	)
	await writeViaWp(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		weekly,
	)
	const normalRead = await readViaRp(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
	)
	// Advertising a 128 octet local APDU forces the device to answer with
	// a segmented ComplexACK, exercising incoming reassembly. (OCTETS_50
	// cannot be used: its enum value 0 is treated as "not provided".)
	const segmentedRead = await readViaRp(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		ASN1_ARRAY_ALL,
		MaxApduLengthAccepted.OCTETS_128,
	)
	assertTrue(
		semanticEqual(normalRead, segmentedRead),
		'Segmented response differs from unsegmented response',
	)
	const days = extractWeeklyEntries(segmentedRead)
	assertEqual(days.length, 7, 'Weekly schedule day count mismatch')
	return `segmented ComplexACK reassembled, day0Rows=${days[0].length}`
}

async function stepApduTooLarge(context: StepContext): Promise<string> {
	const exceptions = buildExceptionSchedule(
		context.config.exceptionCount,
		context.config.tuplesPerException,
		context.valueTag,
	)
	const error = await expectFailure('oversized unsegmented write', () =>
		writeViaWp(
			context,
			context.scheduleObject,
			PropertyIdentifier.EXCEPTION_SCHEDULE,
			exceptions,
			ASN1_ARRAY_ALL,
			{ enabled: false, remoteMaxApduLength: context.remoteMaxApdu },
		),
	)
	assertTrue(
		error instanceof ApduTooLargeError,
		`Expected ApduTooLargeError, got ${error.name}: ${error.message}`,
	)
	const apduError = error as ApduTooLargeError
	assertTrue(
		apduError.encodedLength > apduError.maximumLength,
		'ApduTooLargeError fields inconsistent',
	)
	// The device must not have received anything and must still respond.
	const readBack = await readViaRp(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
	)
	const days = extractWeeklyEntries(readBack)
	return `ApduTooLargeError encoded=${apduError.encodedLength} max=${apduError.maximumLength} deviceStillResponsive=days:${days.length}`
}

async function stepSegmentCountExceeded(context: StepContext): Promise<string> {
	const exceptions = buildExceptionSchedule(
		context.config.exceptionCount,
		context.config.tuplesPerException,
		context.valueTag,
	)
	const error = await expectFailure('segment count exceeded', () =>
		writeViaWp(
			context,
			context.scheduleObject,
			PropertyIdentifier.EXCEPTION_SCHEDULE,
			exceptions,
			ASN1_ARRAY_ALL,
			segmentedOptions(context, { remoteMaxSegmentsAccepted: 1 }),
		),
	)
	assertTrue(
		error instanceof SegmentCountExceededError,
		`Expected SegmentCountExceededError, got ${error.name}: ${error.message}`,
	)
	const countError = error as SegmentCountExceededError
	return `required=${countError.requiredSegments} allowed=${countError.maximumSegments}`
}

async function stepSegmentedWpWindow1(context: StepContext): Promise<string> {
	const exceptions = buildExceptionSchedule(
		context.config.exceptionCount,
		context.config.tuplesPerException,
		context.valueTag,
	)
	await writeViaWp(
		context,
		context.scheduleObject,
		PropertyIdentifier.EXCEPTION_SCHEDULE,
		exceptions,
		ASN1_ARRAY_ALL,
		segmentedOptions(context, { proposedWindowSize: 1 }),
	)
	const readBack = await readViaRp(
		context,
		context.scheduleObject,
		PropertyIdentifier.EXCEPTION_SCHEDULE,
	)
	const entries = extractExceptionEntries(readBack)
	assertEqual(
		entries.length,
		context.config.exceptionCount,
		'Exception entry count mismatch after segmented write',
	)
	assertEqual(
		entries[0]?.events?.length,
		context.config.tuplesPerException,
		'Tuple count mismatch on first entry',
	)
	assertEqual(
		entries[entries.length - 1]?.events?.length,
		context.config.tuplesPerException,
		'Tuple count mismatch on last entry',
	)
	return `entries=${entries.length} remoteMaxApdu=${context.remoteMaxApdu} window=1`
}

async function stepSegmentedWpWindowN(context: StepContext): Promise<string> {
	const exceptions = buildExceptionSchedule(
		context.config.exceptionCount,
		context.config.tuplesPerException,
		context.valueTag,
	)
	await writeViaWp(
		context,
		context.scheduleObject,
		PropertyIdentifier.EXCEPTION_SCHEDULE,
		exceptions,
		ASN1_ARRAY_ALL,
		segmentedOptions(context, {
			proposedWindowSize: context.config.windowSize,
		}),
	)
	const readBack = await readViaRp(
		context,
		context.scheduleObject,
		PropertyIdentifier.EXCEPTION_SCHEDULE,
	)
	const entries = extractExceptionEntries(readBack)
	assertEqual(
		entries.length,
		context.config.exceptionCount,
		'Exception entry count mismatch after windowed segmented write',
	)
	return `entries=${entries.length} proposedWindow=${context.config.windowSize}`
}

async function stepSegmentedWpm(context: StepContext): Promise<string> {
	// The generic WPM encoder on this branch has no schedule payload
	// special-casing, so the request is made large by repeating a harmless
	// idempotent write (WEEKLY_SCHEDULE array size stays 7) enough times
	// that the WPM request exceeds the remote APDU limit and must be
	// segmented.
	const repeats = Math.max(80, Math.ceil((context.remoteMaxApdu * 3) / 10))
	const payload: WritePropertyMultipleObject[] = [
		{
			objectId: context.scheduleObject,
			values: Array.from({ length: repeats }, () => ({
				property: {
					id: PropertyIdentifier.WEEKLY_SCHEDULE,
					index: 0,
				},
				value: [
					{
						type: ApplicationTag.UNSIGNED_INTEGER,
						value: 7,
					},
				] as never,
				priority: ASN1_NO_PRIORITY,
			})),
		},
	]
	await context.client.writePropertyMultiple(context.address, payload, {
		segmentedRequest: segmentedOptions(context, {
			proposedWindowSize: context.config.windowSize,
		}),
	})
	// Verify with a full read: the array-size writes must leave the
	// 7 day arrays intact. (Indexed size reads of schedule properties do
	// not decode on this branch, so the full read is the reliable check.)
	const readBack = await readViaRp(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
	)
	const days = extractWeeklyEntries(readBack)
	assertEqual(days.length, 7, 'Weekly schedule day count mismatch after WPM')
	return `segmented WPM with ${repeats} write-access-specs acknowledged`
}

async function stepSegmentedVsIndexedEquivalence(
	context: StepContext,
): Promise<string> {
	const exceptions = buildExceptionSchedule(
		context.config.exceptionCount,
		context.config.tuplesPerException,
		context.valueTag,
	)

	// Write the payload with a single segmented full write and read it back.
	await writeViaWp(
		context,
		context.scheduleObject,
		PropertyIdentifier.EXCEPTION_SCHEDULE,
		exceptions,
		ASN1_ARRAY_ALL,
		segmentedOptions(context),
	)
	const segmentedResult = await readViaRp(
		context,
		context.scheduleObject,
		PropertyIdentifier.EXCEPTION_SCHEDULE,
	)

	// Rewrite the identical payload with unsegmented indexed writes (one
	// entry per write), the pre-segmentation strategy for large schedules.
	// The segmented full write above already set the array size, and
	// array-resize writes for schedule properties are not supported by
	// this branch's encoder, so no resize is performed here.
	for (let i = 0; i < exceptions.length; i++) {
		await writeViaWp(
			context,
			context.scheduleObject,
			PropertyIdentifier.EXCEPTION_SCHEDULE,
			[exceptions[i]],
			i + 1,
		)
	}
	const indexedResult = await readViaRp(
		context,
		context.scheduleObject,
		PropertyIdentifier.EXCEPTION_SCHEDULE,
	)

	assertTrue(
		semanticEqual(segmentedResult, indexedResult),
		'Segmented full write and indexed unsegmented writes produced different data',
	)
	return `equivalent for ${exceptions.length} entries`
}

async function stepSegmentedWriteRejected(
	context: StepContext,
): Promise<string> {
	const missingSchedule: BACNetObjectID = {
		type: ObjectType.SCHEDULE,
		instance: 4194302,
	}
	const exceptions = buildExceptionSchedule(
		context.config.exceptionCount,
		context.config.tuplesPerException,
		context.valueTag,
	)
	const error = await expectFailure('segmented write to missing object', () =>
		writeViaWp(
			context,
			missingSchedule,
			PropertyIdentifier.EXCEPTION_SCHEDULE,
			exceptions,
			ASN1_ARRAY_ALL,
			segmentedOptions(context),
		),
	)
	assertTrue(
		/BacnetError|BacnetAbort/.test(error.message),
		`Expected a BACnet Error/Abort from the device, got: ${error.message}`,
	)
	return `device rejected with: ${error.message}`
}

async function stepRestore(context: StepContext): Promise<string> {
	const weekly = buildWeeklySchedule(2, context.valueTag)
	await writeViaWp(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		weekly,
	)
	const exceptions = buildExceptionSchedule(2, 2, context.valueTag)
	await writeViaWp(
		context,
		context.scheduleObject,
		PropertyIdentifier.EXCEPTION_SCHEDULE,
		exceptions,
	)
	return 'schedules restored to small defaults'
}
