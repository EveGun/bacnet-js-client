import Bacnet, {
	ASN1_ARRAY_ALL,
	ASN1_NO_PRIORITY,
	ApplicationTag,
	type BACNetAddress,
	type BACNetAppData,
	type BACNetCalendarDateListPayload,
	type BACNetEffectivePeriodPayload,
	type BACNetExceptionSchedulePayload,
	type BACNetObjectID,
	type BACNetTimeValueEntry,
	type BACNetWeeklySchedulePayload,
	ObjectType,
	PropertyIdentifier,
	type ReadAccessProperty,
	type WritePropertyMultipleObject,
} from '../src'

type Mode = 'smoke' | 'full'

interface CliConfig {
	targetAddress: string
	scheduleInstance: number
	calendarInstance: number
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
	status: 'PASS' | 'FAIL'
	latencyMs: number
	details?: string
}

interface StepContext {
	client: Bacnet
	address: BACNetAddress
	scheduleObject: BACNetObjectID
	calendarObject: BACNetObjectID
	config: CliConfig
	valueTag: number
}

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
	console.error('[FATAL]', err instanceof Error ? err.stack || err.message : err)
	client.close()
	process.exitCode = 1
})

async function main() {
	console.log('=== Schedule/Calendar E2E ===')
	console.log(JSON.stringify(config, null, 2))

	const context: StepContext = {
		client,
		address,
		scheduleObject: { type: ObjectType.SCHEDULE, instance: config.scheduleInstance },
		calendarObject: { type: ObjectType.CALENDAR, instance: config.calendarInstance },
		config,
		valueTag: ApplicationTag.UNSIGNED_INTEGER,
	}

	context.valueTag = await inferValueTag(context)
	console.log(`[INFO] valueTag=${context.valueTag}`)

	const allSteps: Array<{ id: number; run: () => Promise<StepResult> }> = [
		{ id: 1, run: () => runStep('1) WP full write + RP verify (WEEKLY_SCHEDULE)', context, stepWeeklyWpRp) },
		{ id: 2, run: () => runStep('2) WPM full write + RPM verify (WEEKLY_SCHEDULE)', context, stepWeeklyWpmRpm) },
		{ id: 3, run: () => runStep('3) WP indexed day write + RP indexed read (WEEKLY_SCHEDULE)', context, stepWeeklyIndexedWpRp) },
		{ id: 4, run: () => runStep('4) WPM indexed day write + RPM indexed read (WEEKLY_SCHEDULE)', context, stepWeeklyIndexedWpmRpm) },
		{ id: 5, run: () => runStep('5) WP array size write + RP read size (WEEKLY_SCHEDULE)', context, stepWeeklySizeWpRp) },
		{ id: 6, run: () => runStep('6) WPM array size write + RPM read size (WEEKLY_SCHEDULE)', context, stepWeeklySizeWpmRpm) },
		{ id: 7, run: () => runStep('7) WP full write + RP verify (EXCEPTION_SCHEDULE)', context, stepExceptionWpRp) },
		{ id: 8, run: () => runStep('8) WPM full write + RPM verify (EXCEPTION_SCHEDULE)', context, stepExceptionWpmRpm) },
		{ id: 9, run: () => runStep('9) WP indexed exception write + RP indexed read', context, stepExceptionIndexedWpRp) },
		{ id: 10, run: () => runStep('10) WPM indexed exception write + RPM indexed read', context, stepExceptionIndexedWpmRpm) },
		{ id: 11, run: () => runStep('11) Calendar reference in exception schedule', context, stepCalendarReference) },
		{ id: 12, run: () => runStep('12) DATE_LIST write/read via WP/RP', context, stepDateListWpRp) },
		{ id: 13, run: () => runStep('13) DATE_LIST write/read via WPM/RPM', context, stepDateListWpmRpm) },
		{ id: 14, run: () => runStep('14) EFFECTIVE_PERIOD write/read via WP/RP', context, stepEffectivePeriodWpRp) },
		{ id: 15, run: () => runStep('15) EFFECTIVE_PERIOD write/read via WPM/RPM', context, stepEffectivePeriodWpmRpm) },
		{ id: 16, run: () => runStep('16) Negative compliance checks', context, stepNegativeCompliance) },
		{ id: 17, run: () => runStep('17) Consistency check RP vs RPM', context, stepConsistencyRpVsRpm) },
		{ id: 18, run: () => runStep('18) Consistency check WP vs WPM', context, stepConsistencyWpVsWpm) },
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
	console.log('\n=== Summary ===')
	console.log(`PASS: ${passed.length}`)
	console.log(`FAIL: ${failed.length}`)
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
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
	if (positional[0] && !map.has('targetAddress')) map.set('targetAddress', positional[0])
	if (positional[1] && !map.has('scheduleInstance')) map.set('scheduleInstance', positional[1])
	if (positional[2] && !map.has('calendarInstance')) map.set('calendarInstance', positional[2])
	if (positional[3] && !map.has('localPort')) map.set('localPort', positional[3])
	return map
}

function buildConfig(argValues: Map<string, string>): CliConfig {
	const mode = ((argValues.get('mode') || 'full').toLowerCase() === 'smoke'
		? 'smoke'
		: 'full') as Mode

	const providedExceptionCount = argValues.get('exceptionCount')
	const providedTuples = argValues.get('tuplesPerException')
	const providedWeeklyRows = argValues.get('weeklyRowsPerDay')

	const defaultException = mode === 'smoke' ? 12 : 254
	const defaultTuples = mode === 'smoke' ? 4 : 12
	const defaultWeeklyRows = mode === 'smoke' ? 8 : 32
	const defaultTimeout = mode === 'smoke' ? 20000 : 180000

	const localPortValue = argValues.get('localPort')

	return {
		targetAddress: argValues.get('targetAddress') || '192.168.40.245:47808',
		scheduleInstance: parseNumber(argValues.get('scheduleInstance'), 0),
		calendarInstance: parseNumber(argValues.get('calendarInstance'), 0),
		exceptionCount: parseNumber(providedExceptionCount, defaultException),
		tuplesPerException: parseNumber(providedTuples, defaultTuples),
		weeklyRowsPerDay: parseNumber(providedWeeklyRows, defaultWeeklyRows),
		mode,
		timeoutMs: parseNumber(argValues.get('timeoutMs'), defaultTimeout),
		localPort: localPortValue ? parseNumber(localPortValue, NaN) : undefined,
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

function smallWeeklyRows(config: CliConfig): number {
	return Math.max(1, Math.min(config.weeklyRowsPerDay, config.mode === 'smoke' ? 4 : 8))
}

function smallExceptionCount(config: CliConfig): number {
	return Math.max(1, Math.min(config.exceptionCount, config.mode === 'smoke' ? 4 : 8))
}

function smallTupleCount(config: CliConfig): number {
	return Math.max(1, Math.min(config.tuplesPerException, config.mode === 'smoke' ? 3 : 4))
}

async function inferValueTag(context: StepContext): Promise<number> {
	try {
		const fromWeekly = await readViaRp(
			context,
			context.scheduleObject,
			PropertyIdentifier.WEEKLY_SCHEDULE,
			ASN1_ARRAY_ALL,
		)
		const weekly = extractWeeklyEntries(fromWeekly)
		const first = weekly[0]?.[0]?.value
		if (first?.type !== undefined) return first.type
	} catch {}

	try {
		const fromException = await readViaRp(
			context,
			context.scheduleObject,
			PropertyIdentifier.EXCEPTION_SCHEDULE,
			ASN1_ARRAY_ALL,
		)
		const entries = extractExceptionEntries(fromException)
		const first = entries[0]?.events?.[0]?.value
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

function buildWeeklySchedule(rowsPerDay: number, valueTag: number): BACNetWeeklySchedulePayload {
	const weekly: BACNetWeeklySchedulePayload = []
	for (let day = 0; day < 7; day++) {
		const rows: BACNetTimeValueEntry[] = []
		for (let row = 0; row < rowsPerDay; row++) {
			rows.push({
				time: {
					type: ApplicationTag.TIME,
					value: new Date(2024, 0, 1 + day, Math.floor(row / 2), (row % 2) * 30, 0, 0),
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
		const dateKind = i % 3
		const date: BACNetExceptionSchedulePayload[number]['date'] =
			dateKind === 0
				? {
						type: ApplicationTag.DATE,
						value: new Date(2026, i % 12, (i % 27) + 1),
				  }
				: dateKind === 1
					? {
							type: ApplicationTag.DATERANGE,
							value: [
								{ type: ApplicationTag.DATE, value: new Date(2026, i % 12, 1) },
								{ type: ApplicationTag.DATE, value: new Date(2026, i % 12, 15) },
							],
					  }
					: {
							type: ApplicationTag.WEEKNDAY,
							value: { month: ((i % 12) + 1) as number, week: ((i % 4) + 1) as number, wday: ((i % 7) + 1) as number },
					  }

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
			date,
			events,
			priority: { type: ApplicationTag.UNSIGNED_INTEGER, value: (i % 16) + 1 },
		})
	}
	return entries
}

function buildExceptionWithCalendarReference(
	calendarObject: BACNetObjectID,
	tuplesPerEntry: number,
	valueTag: number,
): BACNetExceptionSchedulePayload {
	const events: BACNetTimeValueEntry[] = []
	for (let i = 0; i < tuplesPerEntry; i++) {
		events.push({
			time: {
				type: ApplicationTag.TIME,
				value: new Date(2026, 5, 1, i % 24, (i * 10) % 60, 0, 0),
			},
			value: buildAppValue(valueTag, 9000 + i),
		})
	}

	return [
		{
			date: {
				type: ApplicationTag.OBJECTIDENTIFIER,
				value: {
					type: calendarObject.type,
					instance: calendarObject.instance,
				},
			},
			events,
			priority: { type: ApplicationTag.UNSIGNED_INTEGER, value: 7 },
		},
	]
}

function buildDateList(): BACNetCalendarDateListPayload {
	return [
		{ type: ApplicationTag.DATE, value: new Date(2026, 0, 5) },
		{
			type: ApplicationTag.DATERANGE,
			value: [
				{ type: ApplicationTag.DATE, value: new Date(2026, 1, 1) },
				{ type: ApplicationTag.DATE, value: new Date(2026, 1, 15) },
			],
		},
		{ type: ApplicationTag.WEEKNDAY, value: { month: 4, week: 2, wday: 2 } },
	]
}

function buildEffectivePeriod(): BACNetEffectivePeriodPayload {
	return [
		{ type: ApplicationTag.DATE, value: new Date(2026, 0, 1) },
		{ type: ApplicationTag.DATE, value: new Date(2026, 11, 31) },
	]
}

async function writeViaWp(
	context: StepContext,
	objectId: BACNetObjectID,
	propertyId: number,
	value: unknown,
	arrayIndex: number = ASN1_ARRAY_ALL,
) {
	await context.client.writeProperty(context.address, objectId, propertyId, value as never, {
		arrayIndex,
		priority: ASN1_NO_PRIORITY,
	})
}

async function writeViaWpm(
	context: StepContext,
	objectId: BACNetObjectID,
	propertyId: number,
	value: unknown,
	arrayIndex: number = ASN1_ARRAY_ALL,
) {
	const payload: WritePropertyMultipleObject[] = [
		{
			objectId,
			values: [
				{
					property: { id: propertyId, index: arrayIndex },
					value: value as never,
					priority: ASN1_NO_PRIORITY,
				},
			],
		},
	]
	await context.client.writePropertyMultiple(context.address, payload, {})
}

async function readViaRp(
	context: StepContext,
	objectId: BACNetObjectID,
	propertyId: number,
	arrayIndex: number = ASN1_ARRAY_ALL,
): Promise<BACNetAppData> {
	const response = await context.client.readProperty(context.address, objectId, propertyId, {
		arrayIndex,
	})
	const value = response.values[0]
	if (!value) throw new Error('RP decode returned no values')
	return value
}

async function readViaRpm(
	context: StepContext,
	objectId: BACNetObjectID,
	propertyId: number,
	arrayIndex: number = ASN1_ARRAY_ALL,
): Promise<BACNetAppData> {
	const response = await context.client.readPropertyMultiple(
		context.address,
		[
			{
				objectId,
				properties: [{ id: propertyId, index: arrayIndex }],
			},
		],
		{},
	)
	const propertyResult = response.values?.[0]?.values?.[0] as ReadAccessProperty | undefined
	if (!propertyResult || !propertyResult.value?.[0]) {
		throw new Error('RPM decode returned no property value')
	}
	return propertyResult.value[0]
}

async function writeIndexedWeeklyLarge(
	context: StepContext,
	mode: 'wp' | 'wpm',
): Promise<void> {
	const weekly = buildWeeklySchedule(context.config.weeklyRowsPerDay, context.valueTag)
	const writer = mode === 'wp' ? writeViaWp : writeViaWpm
	await writer(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		7,
		0,
	)
	for (let day = 0; day < 7; day++) {
		await writer(
			context,
			context.scheduleObject,
			PropertyIdentifier.WEEKLY_SCHEDULE,
			weekly[day],
			day + 1,
		)
	}
}

async function writeIndexedExceptionLarge(
	context: StepContext,
	mode: 'wp' | 'wpm',
): Promise<void> {
	const entries = buildExceptionSchedule(
		context.config.exceptionCount,
		context.config.tuplesPerException,
		context.valueTag,
	)
	const writer = mode === 'wp' ? writeViaWp : writeViaWpm
	await writer(
		context,
		context.scheduleObject,
		PropertyIdentifier.EXCEPTION_SCHEDULE,
		context.config.exceptionCount,
		0,
	)
	for (let i = 0; i < entries.length; i++) {
		await writer(
			context,
			context.scheduleObject,
			PropertyIdentifier.EXCEPTION_SCHEDULE,
			entries[i],
			i + 1,
		)
	}
}

function extractWeeklyEntries(value: BACNetAppData): BACNetTimeValueEntry[][] {
	assertTrue(value.type === ApplicationTag.WEEKLY_SCHEDULE, `Expected WEEKLY_SCHEDULE, got type=${value.type}`)
	return value.value as BACNetTimeValueEntry[][]
}

function unwrapIndexedWeeklyRows(weekly: BACNetTimeValueEntry[][]): BACNetTimeValueEntry[] {
	if (weekly.length === 1 && Array.isArray(weekly[0])) return weekly[0]
	return weekly as unknown as BACNetTimeValueEntry[]
}

function extractExceptionEntries(value: BACNetAppData): any[] {
	assertTrue(value.type === ApplicationTag.SPECIAL_EVENT, `Expected SPECIAL_EVENT, got type=${value.type}`)
	const raw = value.value as unknown
	if (Array.isArray(raw)) return raw
	if (raw && typeof raw === 'object') return [raw]
	throw new Error('Expected SPECIAL_EVENT value as object or array')
}

function extractDateListEntries(value: BACNetAppData): any[] {
	assertTrue(value.type === ApplicationTag.CALENDAR_ENTRY, `Expected CALENDAR_ENTRY, got type=${value.type}`)
	return value.value as any[]
}

function extractEffectivePeriod(value: BACNetAppData): any[] {
	assertTrue(value.type === ApplicationTag.DATERANGE, `Expected DATERANGE, got type=${value.type}`)
	return value.value as any[]
}

function assertTrue(condition: boolean, message: string) {
	if (!condition) throw new Error(message)
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
	if (actual !== expected) {
		throw new Error(`${message}. expected=${String(expected)} actual=${String(actual)}`)
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

async function assertRpRpmConsistency(
	context: StepContext,
	objectId: BACNetObjectID,
	propertyId: number,
	arrayIndex: number,
	label: string,
) {
	const rp = await readViaRp(context, objectId, propertyId, arrayIndex)
	const rpm = await readViaRpm(context, objectId, propertyId, arrayIndex)
	if (!semanticEqual(rp, rpm)) {
		throw new Error(
			`${label} mismatch RP vs RPM. rp=${JSON.stringify(normalize(rp)).slice(0, 300)} rpm=${JSON.stringify(normalize(rpm)).slice(0, 300)}`,
		)
	}
}

async function expectFailure(label: string, fn: () => Promise<unknown>) {
	try {
		await fn()
	} catch {
		return
	}
	throw new Error(`${label}: expected failure, but operation succeeded`)
}

async function stepWeeklyWpRp(context: StepContext): Promise<string> {
	const rowsPerDay = smallWeeklyRows(context.config)
	const weekly = buildWeeklySchedule(rowsPerDay, context.valueTag)
	await writeViaWp(context, context.scheduleObject, PropertyIdentifier.WEEKLY_SCHEDULE, weekly)
	const readBack = await readViaRp(context, context.scheduleObject, PropertyIdentifier.WEEKLY_SCHEDULE)
	const days = extractWeeklyEntries(readBack)
	assertEqual(days.length, 7, 'Weekly schedule day count mismatch')
	for (let i = 0; i < 7; i++) {
		assertEqual(days[i].length, rowsPerDay, `Day ${i} row count mismatch`)
	}
	await assertRpRpmConsistency(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		ASN1_ARRAY_ALL,
		'weekly full write',
	)
	return `writtenDays=7 rowsPerDay=${rowsPerDay}`
}

async function stepWeeklyWpmRpm(context: StepContext): Promise<string> {
	const rowsPerDay = smallWeeklyRows(context.config)
	const weekly = buildWeeklySchedule(rowsPerDay, context.valueTag)
	await writeViaWpm(context, context.scheduleObject, PropertyIdentifier.WEEKLY_SCHEDULE, weekly)
	const readBack = await readViaRpm(context, context.scheduleObject, PropertyIdentifier.WEEKLY_SCHEDULE)
	const days = extractWeeklyEntries(readBack)
	assertEqual(days.length, 7, 'Weekly schedule day count mismatch')
	assertEqual(days[0].length, rowsPerDay, 'Day 0 row count mismatch')
	assertEqual(days[6].length, rowsPerDay, 'Day 6 row count mismatch')
	await assertRpRpmConsistency(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		ASN1_ARRAY_ALL,
		'weekly full write (WPM)',
	)
	return `verifiedVia=RPM day0Rows=${days[0].length}`
}

async function stepWeeklyIndexedWpRp(context: StepContext): Promise<string> {
	const dayIndex = 3
	await writeIndexedWeeklyLarge(context, 'wp')
	const readBack = await readViaRp(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		dayIndex,
	)
	const rows = unwrapIndexedWeeklyRows(extractWeeklyEntries(readBack))
	assertEqual(rows.length, context.config.weeklyRowsPerDay, 'Indexed day row count mismatch')
	await assertRpRpmConsistency(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		dayIndex,
		'weekly indexed write',
	)
	return `mode=indexed-large dayIndex=${dayIndex} rows=${rows.length}`
}

async function stepWeeklyIndexedWpmRpm(context: StepContext): Promise<string> {
	const dayIndex = 5
	await writeIndexedWeeklyLarge(context, 'wpm')
	const readBack = await readViaRpm(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		dayIndex,
	)
	const rows = unwrapIndexedWeeklyRows(extractWeeklyEntries(readBack))
	assertEqual(rows.length, context.config.weeklyRowsPerDay, 'Indexed day row count mismatch')
	await assertRpRpmConsistency(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		dayIndex,
		'weekly indexed write (WPM)',
	)
	return `mode=indexed-large dayIndex=${dayIndex} rows=${rows.length}`
}

async function stepWeeklySizeWpRp(context: StepContext): Promise<string> {
	const expected = 7
	await writeViaWp(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		expected,
		0,
	)
	const readBack = await readViaRp(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		0,
	)
	assertEqual(readBack.type, ApplicationTag.UNSIGNED_INTEGER, 'Expected UNSIGNED_INTEGER for array size')
	assertEqual(readBack.value, expected, 'Weekly size mismatch')
	await assertRpRpmConsistency(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		0,
		'weekly size write',
	)
	return `size=${String(readBack.value)}`
}

async function stepWeeklySizeWpmRpm(context: StepContext): Promise<string> {
	const expected = 7
	await writeViaWpm(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		expected,
		0,
	)
	const readBack = await readViaRpm(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		0,
	)
	assertEqual(readBack.type, ApplicationTag.UNSIGNED_INTEGER, 'Expected UNSIGNED_INTEGER for array size')
	assertEqual(readBack.value, expected, 'Weekly size mismatch')
	await assertRpRpmConsistency(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		0,
		'weekly size write (WPM)',
	)
	return `size=${String(readBack.value)}`
}

async function stepExceptionWpRp(context: StepContext): Promise<string> {
	const entryCount = smallExceptionCount(context.config)
	const tupleCount = smallTupleCount(context.config)
	const exceptions = buildExceptionSchedule(
		entryCount,
		tupleCount,
		context.valueTag,
	)
	await writeViaWp(context, context.scheduleObject, PropertyIdentifier.EXCEPTION_SCHEDULE, exceptions)
	const readBack = await readViaRp(context, context.scheduleObject, PropertyIdentifier.EXCEPTION_SCHEDULE)
	const entries = extractExceptionEntries(readBack)
	assertEqual(entries.length, entryCount, 'Exception entry count mismatch')
	assertEqual(entries[0]?.events?.length, tupleCount, 'Tuple count mismatch on first entry')
	assertEqual(
		entries[entries.length - 1]?.events?.length,
		tupleCount,
		'Tuple count mismatch on last entry',
	)
	await assertRpRpmConsistency(
		context,
		context.scheduleObject,
		PropertyIdentifier.EXCEPTION_SCHEDULE,
		ASN1_ARRAY_ALL,
		'exception full write',
	)
	return `entries=${entries.length} tuples=${tupleCount}`
}

async function stepExceptionWpmRpm(context: StepContext): Promise<string> {
	const entryCount = smallExceptionCount(context.config)
	const tupleCount = smallTupleCount(context.config)
	const exceptions = buildExceptionSchedule(
		entryCount,
		tupleCount,
		context.valueTag,
	)
	await writeViaWpm(context, context.scheduleObject, PropertyIdentifier.EXCEPTION_SCHEDULE, exceptions)
	const readBack = await readViaRpm(context, context.scheduleObject, PropertyIdentifier.EXCEPTION_SCHEDULE)
	const entries = extractExceptionEntries(readBack)
	assertEqual(entries.length, entryCount, 'Exception entry count mismatch')
	assertEqual(entries[0]?.events?.length, tupleCount, 'Tuple count mismatch on first entry')
	await assertRpRpmConsistency(
		context,
		context.scheduleObject,
		PropertyIdentifier.EXCEPTION_SCHEDULE,
		ASN1_ARRAY_ALL,
		'exception full write (WPM)',
	)
	return `entries=${entries.length} tuples=${tupleCount}`
}

async function stepExceptionIndexedWpRp(context: StepContext): Promise<string> {
	await writeIndexedExceptionLarge(context, 'wp')
	const index = Math.max(1, Math.min(2, context.config.exceptionCount))
	const readBack = await readViaRp(
		context,
		context.scheduleObject,
		PropertyIdentifier.EXCEPTION_SCHEDULE,
		index,
	)
	const entries = extractExceptionEntries(readBack)
	assertEqual(entries.length, 1, 'Indexed exception should return one entry')
	assertEqual(entries[0]?.events?.length, context.config.tuplesPerException, 'Indexed tuple count mismatch')
	assertEqual(entries[0]?.priority?.value, index, 'Indexed exception priority mismatch')
	await assertRpRpmConsistency(
		context,
		context.scheduleObject,
		PropertyIdentifier.EXCEPTION_SCHEDULE,
		index,
		'exception indexed write',
	)
	return `mode=indexed-large index=${index} tuples=${entries[0]?.events?.length || 0}`
}

async function stepExceptionIndexedWpmRpm(context: StepContext): Promise<string> {
	await writeIndexedExceptionLarge(context, 'wpm')
	const index = Math.max(1, Math.min(3, context.config.exceptionCount))
	const readBack = await readViaRpm(
		context,
		context.scheduleObject,
		PropertyIdentifier.EXCEPTION_SCHEDULE,
		index,
	)
	const entries = extractExceptionEntries(readBack)
	assertEqual(entries.length, 1, 'Indexed exception should return one entry')
	assertEqual(entries[0]?.events?.length, context.config.tuplesPerException, 'Indexed tuple count mismatch')
	assertEqual(entries[0]?.priority?.value, index, 'Indexed exception priority mismatch')
	await assertRpRpmConsistency(
		context,
		context.scheduleObject,
		PropertyIdentifier.EXCEPTION_SCHEDULE,
		index,
		'exception indexed write (WPM)',
	)
	return `mode=indexed-large index=${index} tuples=${entries[0]?.events?.length || 0}`
}

async function stepCalendarReference(context: StepContext): Promise<string> {
	const payload = buildExceptionWithCalendarReference(
		context.calendarObject,
		Math.max(1, Math.min(context.config.tuplesPerException, 4)),
		context.valueTag,
	)
	await writeViaWp(context, context.scheduleObject, PropertyIdentifier.EXCEPTION_SCHEDULE, payload)
	const readBack = await readViaRp(context, context.scheduleObject, PropertyIdentifier.EXCEPTION_SCHEDULE)
	const entries = extractExceptionEntries(readBack)
	const calendarRef = entries.find(
		(entry) =>
			entry?.date?.type === ApplicationTag.OBJECTIDENTIFIER &&
			entry?.date?.value?.type === ObjectType.CALENDAR,
	)
	assertTrue(Boolean(calendarRef), 'Expected calendar reference entry in exception schedule')
	assertEqual(calendarRef.date.value.instance, context.calendarObject.instance, 'Calendar reference instance mismatch')
	await assertRpRpmConsistency(
		context,
		context.scheduleObject,
		PropertyIdentifier.EXCEPTION_SCHEDULE,
		ASN1_ARRAY_ALL,
		'calendar reference readback',
	)
	return `calendarInstance=${calendarRef.date.value.instance}`
}

async function stepDateListWpRp(context: StepContext): Promise<string> {
	const dateList = buildDateList()
	await writeViaWp(context, context.calendarObject, PropertyIdentifier.DATE_LIST, dateList)
	const readBack = await readViaRp(context, context.calendarObject, PropertyIdentifier.DATE_LIST)
	const entries = extractDateListEntries(readBack)
	assertTrue(entries.length >= 3, 'Expected at least 3 date-list entries')
	await assertRpRpmConsistency(
		context,
		context.calendarObject,
		PropertyIdentifier.DATE_LIST,
		ASN1_ARRAY_ALL,
		'date-list WP/RP',
	)
	return `entries=${entries.length}`
}

async function stepDateListWpmRpm(context: StepContext): Promise<string> {
	const dateList = buildDateList()
	await writeViaWpm(context, context.calendarObject, PropertyIdentifier.DATE_LIST, dateList)
	const readBack = await readViaRpm(context, context.calendarObject, PropertyIdentifier.DATE_LIST)
	const entries = extractDateListEntries(readBack)
	assertTrue(entries.length >= 3, 'Expected at least 3 date-list entries')
	await assertRpRpmConsistency(
		context,
		context.calendarObject,
		PropertyIdentifier.DATE_LIST,
		ASN1_ARRAY_ALL,
		'date-list WPM/RPM',
	)
	return `entries=${entries.length}`
}

async function stepEffectivePeriodWpRp(context: StepContext): Promise<string> {
	const period = buildEffectivePeriod()
	await writeViaWp(context, context.scheduleObject, PropertyIdentifier.EFFECTIVE_PERIOD, period)
	const readBack = await readViaRp(context, context.scheduleObject, PropertyIdentifier.EFFECTIVE_PERIOD)
	const parsed = extractEffectivePeriod(readBack)
	assertEqual(parsed.length, 2, 'Effective period should contain exactly 2 dates')
	await assertRpRpmConsistency(
		context,
		context.scheduleObject,
		PropertyIdentifier.EFFECTIVE_PERIOD,
		ASN1_ARRAY_ALL,
		'effective period WP/RP',
	)
	return `periodEntries=${parsed.length}`
}

async function stepEffectivePeriodWpmRpm(context: StepContext): Promise<string> {
	const period = buildEffectivePeriod()
	await writeViaWpm(context, context.scheduleObject, PropertyIdentifier.EFFECTIVE_PERIOD, period)
	const readBack = await readViaRpm(context, context.scheduleObject, PropertyIdentifier.EFFECTIVE_PERIOD)
	const parsed = extractEffectivePeriod(readBack)
	assertEqual(parsed.length, 2, 'Effective period should contain exactly 2 dates')
	await assertRpRpmConsistency(
		context,
		context.scheduleObject,
		PropertyIdentifier.EFFECTIVE_PERIOD,
		ASN1_ARRAY_ALL,
		'effective period WPM/RPM',
	)
	return `periodEntries=${parsed.length}`
}

async function stepNegativeCompliance(context: StepContext): Promise<string> {
	await expectFailure('RP indexed read for EFFECTIVE_PERIOD', () =>
		context.client.readProperty(
			context.address,
			context.scheduleObject,
			PropertyIdentifier.EFFECTIVE_PERIOD,
			{ arrayIndex: 1 },
		),
	)
	await expectFailure('RP indexed read for DATE_LIST', () =>
		context.client.readProperty(
			context.address,
			context.calendarObject,
			PropertyIdentifier.DATE_LIST,
			{ arrayIndex: 1 },
		),
	)
	await expectFailure('WP indexed write for EFFECTIVE_PERIOD', () =>
		context.client.writeProperty(
			context.address,
			context.scheduleObject,
			PropertyIdentifier.EFFECTIVE_PERIOD,
			{ type: ApplicationTag.DATE, value: new Date(2026, 0, 1) },
			{ arrayIndex: 1, priority: ASN1_NO_PRIORITY },
		),
	)
	await expectFailure('WP indexed write for DATE_LIST', () =>
		context.client.writeProperty(
			context.address,
			context.calendarObject,
			PropertyIdentifier.DATE_LIST,
			{ type: ApplicationTag.DATE, value: new Date(2026, 0, 1) },
			{ arrayIndex: 1, priority: ASN1_NO_PRIORITY },
		),
	)
	await expectFailure('WPM indexed write for EFFECTIVE_PERIOD', () =>
		writeViaWpm(
			context,
			context.scheduleObject,
			PropertyIdentifier.EFFECTIVE_PERIOD,
			{ type: ApplicationTag.DATE, value: new Date(2026, 0, 1) },
			1,
		),
	)
	await expectFailure('WPM indexed write for DATE_LIST', () =>
		writeViaWpm(
			context,
			context.calendarObject,
			PropertyIdentifier.DATE_LIST,
			{ type: ApplicationTag.DATE, value: new Date(2026, 0, 1) },
			1,
		),
	)
	return 'indexed access correctly rejected for DATE_LIST/EFFECTIVE_PERIOD'
}

async function stepConsistencyRpVsRpm(context: StepContext): Promise<string> {
	await assertRpRpmConsistency(
		context,
		context.scheduleObject,
		PropertyIdentifier.WEEKLY_SCHEDULE,
		0,
		'consistency weekly array-size',
	)
	await assertRpRpmConsistency(
		context,
		context.scheduleObject,
		PropertyIdentifier.EXCEPTION_SCHEDULE,
		1,
		'consistency exception indexed entry',
	)
	await assertRpRpmConsistency(
		context,
		context.calendarObject,
		PropertyIdentifier.DATE_LIST,
		ASN1_ARRAY_ALL,
		'consistency date-list',
	)
	await assertRpRpmConsistency(
		context,
		context.scheduleObject,
		PropertyIdentifier.EFFECTIVE_PERIOD,
		ASN1_ARRAY_ALL,
		'consistency effective-period',
	)
	return 'RP/RPM semantic parity OK'
}

async function stepConsistencyWpVsWpm(context: StepContext): Promise<string> {
	const weekly = buildWeeklySchedule(smallWeeklyRows(context.config), context.valueTag)
	await writeViaWp(context, context.scheduleObject, PropertyIdentifier.WEEKLY_SCHEDULE, weekly)
	const weeklyWp = await readViaRp(context, context.scheduleObject, PropertyIdentifier.WEEKLY_SCHEDULE)
	await writeViaWpm(context, context.scheduleObject, PropertyIdentifier.WEEKLY_SCHEDULE, weekly)
	const weeklyWpm = await readViaRp(context, context.scheduleObject, PropertyIdentifier.WEEKLY_SCHEDULE)
	assertTrue(semanticEqual(weeklyWp, weeklyWpm), 'WP/WPM mismatch for WEEKLY_SCHEDULE')

	const exception = buildExceptionSchedule(
		smallExceptionCount(context.config),
		smallTupleCount(context.config),
		context.valueTag,
	)
	await writeViaWp(context, context.scheduleObject, PropertyIdentifier.EXCEPTION_SCHEDULE, exception)
	const exceptionWp = await readViaRp(context, context.scheduleObject, PropertyIdentifier.EXCEPTION_SCHEDULE)
	await writeViaWpm(context, context.scheduleObject, PropertyIdentifier.EXCEPTION_SCHEDULE, exception)
	const exceptionWpm = await readViaRp(context, context.scheduleObject, PropertyIdentifier.EXCEPTION_SCHEDULE)
	assertTrue(semanticEqual(exceptionWp, exceptionWpm), 'WP/WPM mismatch for EXCEPTION_SCHEDULE')

	const dateList = buildDateList()
	await writeViaWp(context, context.calendarObject, PropertyIdentifier.DATE_LIST, dateList)
	const dateListWp = await readViaRp(context, context.calendarObject, PropertyIdentifier.DATE_LIST)
	await writeViaWpm(context, context.calendarObject, PropertyIdentifier.DATE_LIST, dateList)
	const dateListWpm = await readViaRp(context, context.calendarObject, PropertyIdentifier.DATE_LIST)
	assertTrue(semanticEqual(dateListWp, dateListWpm), 'WP/WPM mismatch for DATE_LIST')

	const period = buildEffectivePeriod()
	await writeViaWp(context, context.scheduleObject, PropertyIdentifier.EFFECTIVE_PERIOD, period)
	const periodWp = await readViaRp(context, context.scheduleObject, PropertyIdentifier.EFFECTIVE_PERIOD)
	await writeViaWpm(context, context.scheduleObject, PropertyIdentifier.EFFECTIVE_PERIOD, period)
	const periodWpm = await readViaRp(context, context.scheduleObject, PropertyIdentifier.EFFECTIVE_PERIOD)
	assertTrue(semanticEqual(periodWp, periodWpm), 'WP/WPM mismatch for EFFECTIVE_PERIOD')

	return 'WP/WPM semantic parity OK'
}
