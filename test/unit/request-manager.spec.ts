import { test, afterEach } from 'node:test'
import assert from 'node:assert'

import { RequestManager } from '../../src/lib/request-manager'
import { NetworkOpResult } from '../../src'

test.describe('RequestManager', () => {
	let manager: RequestManager

	const result: NetworkOpResult = {
		msg: null,
		buffer: Buffer.alloc(0),
		offset: 0,
		length: 0,
	}

	const error = new Error('some error')

	const delay = 100

	// Requests are tracked by transaction key: peer identity + invokeId
	const KEY_42 = '192.168.1.50:47808#42'
	const KEY_43 = '192.168.1.50:47808#43'
	const KEY_44 = '192.168.1.60:47808#42'

	afterEach(() => {
		manager.clear(true)
	})

	test('add() should return a promise that resolves if resolve() is called before the timeout with no error', async (t) => {
		t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
		manager = new RequestManager(delay)
		queueMicrotask(() => {
			manager.resolve(KEY_42, undefined, result)
		})
		assert.strictEqual(await manager.add(KEY_42), result)
	})

	test('add() should return a promise that rejects if resolve() is called before the timeout with an error', async (t) => {
		t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
		manager = new RequestManager(delay)
		const promise = manager.add(KEY_42)
		manager.resolve(KEY_42, error)
		await assert.rejects(promise, (err: Error) => {
			assert.strictEqual(err, error)
			return true
		})
	})

	test('add() should return a promise that rejects if resolve() is never called', async (t) => {
		t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
		manager = new RequestManager(delay)
		const promise = manager.add(KEY_42)
		t.mock.timers.tick(delay)
		await assert.rejects(promise, (err: Error) => {
			assert.strictEqual(err.message, 'ERR_TIMEOUT')
			return true
		})
	})

	test('add() should return a promise that rejects if resolve() is called after the timeout without errors', async (t) => {
		t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
		manager = new RequestManager(delay)
		const promise = manager.add(KEY_42)
		t.mock.timers.tick(delay)
		manager.resolve(KEY_42, undefined, result)
		await assert.rejects(promise, (err: Error) => {
			assert.strictEqual(err.message, 'ERR_TIMEOUT')
			return true
		})
	})

	test('add() should return a promise that cannot be resolved twice', async (t) => {
		t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
		manager = new RequestManager(delay)
		manager.add(KEY_42).catch(() => {})
		assert.strictEqual(manager.resolve(KEY_42, undefined, result), true)
		assert.strictEqual(manager.resolve(KEY_42, undefined, result), false)
	})

	test('add() should return a promise that cannot be resolved after the request has timed out', async (t) => {
		t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
		manager = new RequestManager(delay)
		manager.add(KEY_42).catch(() => {})
		t.mock.timers.tick(delay)
		assert.strictEqual(manager.resolve(KEY_42, undefined, result), false)
	})

	test('one invocation of add() should result in one invocation of setTimeout()', async (t) => {
		t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
		const spy = t.mock.fn(setTimeout)
		manager = new RequestManager(delay, spy)
		manager.add(KEY_42).catch(() => {})
		assert.strictEqual(spy.mock.callCount(), 1)
		t.mock.timers.tick(delay)
		assert.strictEqual(spy.mock.callCount(), 1)
	})

	test('multiple invocations of add() within the same tick of the event loop should result in one invocation of setTimeout()', async (t) => {
		t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
		const spy = t.mock.fn(setTimeout)
		manager = new RequestManager(delay, spy)
		manager.add(KEY_42).catch(() => {})
		manager.add(KEY_43).catch(() => {})
		assert.strictEqual(spy.mock.callCount(), 1)
		t.mock.timers.tick(delay)
		assert.strictEqual(spy.mock.callCount(), 1)
	})

	test('multiple invocations of add() within the timeout delay spread across multiple ticks of the event loop should result in only one invocation of setTimeout()', async (t) => {
		t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
		const spy = t.mock.fn(setTimeout)
		manager = new RequestManager(delay, spy)
		manager.add(KEY_42).catch(() => {})
		assert.strictEqual(spy.mock.callCount(), 1)
		t.mock.timers.tick(delay / 4)
		manager.add(KEY_43).catch(() => {})
		assert.strictEqual(spy.mock.callCount(), 1)
	})

	test('multiple invocations of add() separated by more than the timeout delay should result in multiple invocations of setTimeout()', async (t) => {
		t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
		const spy = t.mock.fn(setTimeout)
		manager = new RequestManager(delay, spy)
		manager.add(KEY_42).catch(() => {})
		assert.strictEqual(spy.mock.callCount(), 1)
		t.mock.timers.tick(delay)
		manager.add(KEY_43).catch(() => {})
		assert.strictEqual(spy.mock.callCount(), 2)
		t.mock.timers.tick(delay)
		manager.add(KEY_44).catch(() => {})
		assert.strictEqual(spy.mock.callCount(), 3)
	})
})
