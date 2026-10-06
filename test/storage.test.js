import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { StorageManager } from '../storage.js';

// A localStorage that can be preloaded with corrupt values, or made to throw
// the way a browser does in private mode or at quota.
function fakeStorage(initial = {}, { throwOnGet = false, throwOnSet = false } = {}) {
    const data = { ...initial };
    return {
        getItem(key) {
            if (throwOnGet) throw new Error('SecurityError');
            return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
        },
        setItem(key, value) {
            if (throwOnSet) throw new Error('QuotaExceededError');
            data[key] = String(value);
        },
        removeItem(key) { delete data[key]; },
        raw: data
    };
}

const install = (storage) => { globalThis.localStorage = storage; };

beforeEach(() => { install(fakeStorage()); });

describe('loadHighScore', () => {
    test('reads a stored number', () => {
        install(fakeStorage({ spaceDodgerHighScore: '1500' }));
        assert.equal(StorageManager.loadHighScore(), 1500);
    });

    test('defaults to 0 when unset', () => {
        assert.equal(StorageManager.loadHighScore(), 0);
    });

    test('rejects a negative stored value', () => {
        install(fakeStorage({ spaceDodgerHighScore: '-5' }));
        assert.equal(StorageManager.loadHighScore(), 0);
    });

    test('rejects a non-numeric stored value', () => {
        install(fakeStorage({ spaceDodgerHighScore: 'banana' }));
        assert.equal(StorageManager.loadHighScore(), 0);
    });

    test('survives storage that throws', () => {
        install(fakeStorage({}, { throwOnGet: true }));
        assert.equal(StorageManager.loadHighScore(), 0);
    });
});

describe('loadAchievements', () => {
    // Regression guard: anything but a plain object used to throw a TypeError
    // on the first unlock, and since the manager is built in the game's
    // constructor, the game never started at all.
    const corrupt = ['null', '[]', '5', '"hi"', 'true', 'not json at all', '[1,2,3]'];

    for (const stored of corrupt) {
        test(`falls back to an empty object for ${stored}`, () => {
            install(fakeStorage({ spaceDodgerAchievements: stored }));
            const result = StorageManager.loadAchievements();
            assert.equal(typeof result, 'object');
            assert.notEqual(result, null);
            assert.equal(Array.isArray(result), false);

            // The operation that used to throw
            assert.doesNotThrow(() => { result.score_500 = { unlocked: true }; });
        });
    }

    test('returns a real achievement map unchanged', () => {
        install(fakeStorage({
            spaceDodgerAchievements: '{"score_500":{"unlocked":true,"name":"Warming Up"}}'
        }));
        const result = StorageManager.loadAchievements();
        assert.equal(result.score_500.unlocked, true);
        assert.equal(result.score_500.name, 'Warming Up');
    });

    test('defaults to an empty object when unset', () => {
        assert.deepEqual(StorageManager.loadAchievements(), {});
    });
});

describe('loadMetrics', () => {
    test('fills in defaults for missing keys', () => {
        install(fakeStorage({ spaceDodgerMetrics: '{"totalGamesPlayed":3}' }));
        const m = StorageManager.loadMetrics();
        assert.equal(m.totalGamesPlayed, 3);
        assert.equal(m.averageScore, 0);
        assert.equal(m.totalPlayTime, 0);
    });

    test('replaces non-finite values rather than poisoning the averages', () => {
        install(fakeStorage({
            spaceDodgerMetrics: '{"totalGamesPlayed":"lots","averageScore":null,"totalPlayTime":1000}'
        }));
        const m = StorageManager.loadMetrics();
        assert.equal(m.totalGamesPlayed, 0);
        assert.equal(m.averageScore, 0);
        assert.equal(m.totalPlayTime, 1000, 'valid values are kept');
    });

    test('survives malformed JSON', () => {
        install(fakeStorage({ spaceDodgerMetrics: '{oh no' }));
        const m = StorageManager.loadMetrics();
        assert.equal(m.totalGamesPlayed, 0);
    });
});

describe('writes', () => {
    test('saving never throws when storage is full', () => {
        install(fakeStorage({}, { throwOnSet: true }));
        assert.doesNotThrow(() => StorageManager.saveHighScore(10));
        assert.doesNotThrow(() => StorageManager.saveMetrics({ totalGamesPlayed: 1 }));
        assert.doesNotThrow(() => StorageManager.saveAchievements({}));
        assert.doesNotThrow(() => StorageManager.savePlayerName('Vinh'));
    });

    test('round-trips a player name', () => {
        StorageManager.savePlayerName('Vinh');
        assert.equal(StorageManager.loadPlayerName(), 'Vinh');
    });

    test('resetCache clears every key it owns', () => {
        StorageManager.saveHighScore(100);
        StorageManager.savePlayerName('Vinh');
        StorageManager.saveAchievements({ score_500: { unlocked: true } });
        StorageManager.resetCache();

        assert.equal(StorageManager.loadHighScore(), 0);
        assert.equal(StorageManager.loadPlayerName(), null);
        assert.deepEqual(StorageManager.loadAchievements(), {});
    });
});
