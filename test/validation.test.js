import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    MAX_NAME_LENGTH,
    MAX_REASONABLE_SCORE,
    MAX_REASONABLE_LEVEL,
    MAX_LEADERBOARD_LIMIT,
    sanitizeName,
    validateSubmission,
    clampLimit,
    isValidPlayerId
} = require('../backend/lib/validation.js');

describe('isValidPlayerId', () => {
    test('accepts a generated UUID', () => {
        assert.equal(isValidPlayerId('3f2504e0-4f89-41d3-9a0c-0305e82c3301'), true);
    });

    test('accepts the hex fallback the client uses without randomUUID', () => {
        assert.equal(isValidPlayerId('a'.repeat(32)), true);
    });

    for (const bad of [null, undefined, 42, {}, '', 'short', 'x'.repeat(65), 'has space', 'has/slash', '<script>']) {
        test(`rejects ${JSON.stringify(bad)}`, () => {
            assert.equal(isValidPlayerId(bad), false);
        });
    }
});

describe('sanitizeName', () => {
    test('strips characters with HTML meaning', () => {
        assert.equal(sanitizeName('<script>Bad'), 'scriptBad');
        assert.equal(sanitizeName(`a<b>c&d"e'f\`g`), 'abcdefg');
    });

    test('trims surrounding whitespace', () => {
        assert.equal(sanitizeName('   Vinh   '), 'Vinh');
    });

    test('truncates to the stored column width', () => {
        const long = 'X'.repeat(100);
        assert.equal(sanitizeName(long).length, MAX_NAME_LENGTH);
    });

    test('is idempotent, so a lookup finds what a write stored', () => {
        // This is the property that broke the player lookup: the write path
        // sanitized and the read path did not, so a stored name was unfindable.
        const raw = '  <script>Bad  ';
        assert.equal(sanitizeName(sanitizeName(raw)), sanitizeName(raw));
    });

    test('a name made only of stripped characters reduces to empty', () => {
        assert.equal(sanitizeName('<>&"'), '');
    });

    test('keeps spaces and unicode inside the name', () => {
        assert.equal(sanitizeName('Vinh The Pilot'), 'Vinh The Pilot');
        assert.equal(sanitizeName('🚀 Pilot'), '🚀 Pilot');
    });

    test('coerces non-strings instead of throwing', () => {
        assert.doesNotThrow(() => sanitizeName(42));
        assert.doesNotThrow(() => sanitizeName(null));
        assert.equal(sanitizeName(42), '42');
    });
});

describe('validateSubmission', () => {
    const good = { playerName: 'Vinh', score: 100, level: 3 };

    test('accepts a well formed submission', () => {
        assert.equal(validateSubmission(good), null);
    });

    test('requires a non-empty name', () => {
        assert.match(validateSubmission({ ...good, playerName: '' }), /name is required/);
        assert.match(validateSubmission({ ...good, playerName: '   ' }), /name is required/);
        assert.match(validateSubmission({ ...good, playerName: 42 }), /name is required/);
    });

    test('requires a finite non-negative score', () => {
        assert.match(validateSubmission({ ...good, score: -1 }), /Valid score/);
        assert.match(validateSubmission({ ...good, score: NaN }), /Valid score/);
        assert.match(validateSubmission({ ...good, score: Infinity }), /Valid score/);
        assert.match(validateSubmission({ ...good, score: '100' }), /Valid score/);
    });

    test('accepts a score of exactly zero', () => {
        assert.equal(validateSubmission({ ...good, score: 0 }), null);
    });

    test('requires a level of at least 1', () => {
        assert.match(validateSubmission({ ...good, level: 0 }), /Valid level/);
        assert.match(validateSubmission({ ...good, level: NaN }), /Valid level/);
    });

    test('caps absurd scores and levels', () => {
        assert.equal(validateSubmission({ ...good, score: MAX_REASONABLE_SCORE }), null);
        assert.match(validateSubmission({ ...good, score: MAX_REASONABLE_SCORE + 1 }), /Score exceeds/);
        assert.equal(validateSubmission({ ...good, level: MAX_REASONABLE_LEVEL }), null);
        assert.match(validateSubmission({ ...good, level: MAX_REASONABLE_LEVEL + 1 }), /Level exceeds/);
    });
});

describe('clampLimit', () => {
    test('defaults to the maximum', () => {
        assert.equal(clampLimit(undefined), MAX_LEADERBOARD_LIMIT);
        assert.equal(clampLimit('garbage'), MAX_LEADERBOARD_LIMIT);
    });

    test('passes a sensible value through', () => {
        assert.equal(clampLimit('10'), 10);
    });

    test('clamps to at least 1 and at most the maximum', () => {
        assert.equal(clampLimit('0'), MAX_LEADERBOARD_LIMIT, 'parseInt 0 is falsy, so the default applies');
        assert.equal(clampLimit('-5'), 1);
        assert.equal(clampLimit('99999'), MAX_LEADERBOARD_LIMIT);
    });
});
