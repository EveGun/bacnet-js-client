"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestManager = void 0;
const debug_1 = __importDefault(require("debug"));
const debug = (0, debug_1.default)('bacnet:client:requestmanager:debug');
const trace = (0, debug_1.default)('bacnet:client:requestmanager:trace');
class Deferred {
    resolve;
    reject;
    promise;
    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}
class RequestManager {
    #requestsByKey;
    #requestsByTime;
    #delay;
    #activeTimeout;
    #setTimeout;
    constructor(delay, _setTimeout = setTimeout) {
        this.#requestsByKey = new Map();
        this.#requestsByTime = [];
        this.#delay = delay;
        this.#activeTimeout = null;
        this.#setTimeout = _setTimeout;
    }
    add(key) {
        const deferred = new Deferred();
        const request = {
            key,
            deferred,
            expiresAt: Date.now() + this.#delay,
        };
        this.#requestsByKey.set(key, request);
        this.#requestsByTime.push(request);
        this.#scheduleClear();
        trace(`Transaction ${key} callback added -> timeout set to ${this.#delay}.`);
        return deferred.promise;
    }
    resolve(key, err, result) {
        const request = this.#requestsByKey.get(key);
        if (request) {
            trace(`Transaction ${key} found -> call callback`);
            this.#requestsByKey.delete(key);
            if (err) {
                request.deferred.reject(err);
            }
            else {
                request.deferred.resolve(result);
            }
            return true;
        }
        debug('Transaction', key, 'not found -> drop package');
        trace(`Stored transactions: ${Array.from(this.#requestsByKey.keys())}`);
        return false;
    }
    clear = (force) => {
        if (this.#activeTimeout !== null) {
            clearTimeout(this.#activeTimeout);
            this.#activeTimeout = null;
        }
        const now = Date.now();
        const qty = this.#requestsByTime.length;
        this.#requestsByTime = this.#requestsByTime.filter((request) => {
            if (!this.#requestsByKey.has(request.key)) {
                return false;
            }
            if (force || request.expiresAt <= now) {
                request.deferred.reject(new Error('ERR_TIMEOUT'));
                this.#requestsByKey.delete(request.key);
                return false;
            }
            return true;
        });
        debug(`Cleared ${qty - this.#requestsByTime.length} entries.`);
        debug(`There are ${this.#requestsByTime.length} entries pending.`);
        if (!force) {
            this.#scheduleClear();
        }
    };
    #scheduleClear() {
        if (this.#activeTimeout === null && this.#requestsByTime.length > 0) {
            const delay = Math.max(this.#requestsByTime[0].expiresAt - Date.now(), 100);
            trace(`Scheduling timeout for clearing pending request in ${delay}ms`);
            this.#activeTimeout = this.#setTimeout(this.clear, delay);
        }
    }
}
exports.RequestManager = RequestManager;
//# sourceMappingURL=request-manager.js.map