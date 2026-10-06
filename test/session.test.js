import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    SESSION_MAX_AGE_MS,
    SCORE_PER_SECOND,
    SCORE_MARGIN,
    deriveSecret,
    createToken,
    verifyToken,
    isScorePlausible,
    isLevelPlausible
} = require('../backend/lib/session.js');

const SECRET = Buffer.from('a'.repeat(64), 'hex');
const T0 = 1_700_000_000_000; // fixed clock so expiry is testable without waiting

describe('deriveSecret', () => {
    test('an explicit secret wins', () => {
        assert.equal(deriveSecret('explicit', 'mongodb://x'), 'explicit');
    });

    test('the derived secret is stable for the same URI', () => {
        const a = deriveSecret(undefined, 'mongodb://localhost:27017/sd');
        const b = deriveSecret(undefined, 'mongodb://localhost:27017/sd');
        assert.deepEqual(a, b);
    });

    test('a different URI derives a different secret', () => {
        const a = deriveSecret(undefined, 'mongodb://localhost:27017/one');
        const b = deriveSecret(undefined, 'mongodb://localhost:27017/two');
        assert.notDeepEqual(a, b);
    });

    test('the derived secret does not contain the URI', () => {
        const uri = 'mongodb://user:hunter2@host/db';
        assert.equal(deriveSecret(undefined, uri).toString('hex').includes('hunter2'), false);
    });
});

describe('verifyToken', () => {
    test('accepts a token it just issued', () => {
        const token = createToken(SECRET, T0, 'abc123');
        const result = verifyToken(token, SECRET, T0);
        assert.notEqual(result, null);
        assert.equal(result.nonce, 'abc123');
        assert.equal(result.elapsedSeconds, 0);
    });

    test('reports elapsed time in seconds', () => {
        const token = createToken(SECRET, T0);
        assert.equal(verifyToken(token, SECRET, T0 + 90_000).elapsedSeconds, 90);
    });

    test('rejects a token signed with another secret', () => {
        const token = createToken(Buffer.from('b'.repeat(64), 'hex'), T0);
        assert.equal(verifyToken(token, SECRET, T0), null);
    });

    test('rejects a tampered payload', () => {
        const token = createToken(SECRET, T0);
        const [, sig] = token.split('.');
        // Back-date the claim by an hour to inflate the allowed score
        const forged = Buffer.from(JSON.stringify({ t: T0 - 3_600_000, n: 'x' })).toString('base64url');
        assert.equal(verifyToken(`${forged}.${sig}`, SECRET, T0), null);
    });

    test('rejects a tampered signature', () => {
        const [payload, sig] = createToken(SECRET, T0).split('.');
        const flipped = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
        assert.equal(verifyToken(`${payload}.${flipped}`, SECRET, T0), null);
    });

    test('rejects a signature of the wrong length', () => {
        const [payload] = createToken(SECRET, T0).split('.');
        assert.equal(verifyToken(`${payload}.ff`, SECRET, T0), null);
    });

    test('accepts a token right up to the age limit', () => {
        const token = createToken(SECRET, T0);
        assert.notEqual(verifyToken(token, SECRET, T0 + SESSION_MAX_AGE_MS), null);
    });

    test('rejects a token one millisecond past the age limit', () => {
        const token = createToken(SECRET, T0);
        assert.equal(verifyToken(token, SECRET, T0 + SESSION_MAX_AGE_MS + 1), null);
    });

    test('rejects a token dated in the future', () => {
        const token = createToken(SECRET, T0 + 60_000);
        assert.equal(verifyToken(token, SECRET, T0), null);
    });

    test('rejects a non-finite timestamp', () => {
        // JSON has no NaN, so a crafted payload uses null, which arithmetic
        // would otherwise coerce to 0 and read as a very old token
        const payload = Buffer.from(JSON.stringify({ t: null, n: 'x' })).toString('base64url');
        const crypto = require('node:crypto');
        const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
        assert.equal(verifyToken(`${payload}.${sig}`, SECRET, T0), null);
    });

    test('rejects a token with no nonce, which could never be spent', () => {
        const payload = Buffer.from(JSON.stringify({ t: T0 })).toString('base64url');
        const crypto = require('node:crypto');
        const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
        assert.equal(verifyToken(`${payload}.${sig}`, SECRET, T0), null);
    });

    for (const bad of [null, undefined, 42, {}, '', '.', 'nodot', 'a.b', 'a.b.c']) {
        test(`rejects malformed input ${JSON.stringify(bad)}`, () => {
            assert.equal(verifyToken(bad, SECRET, T0), null);
        });
    }

    test('every issued token carries a distinct nonce', () => {
        const nonces = new Set(
            Array.from({ length: 200 }, () => verifyToken(createToken(SECRET, T0), SECRET, T0).nonce)
        );
        assert.equal(nonces.size, 200);
    });
});

describe('plausibility bounds', () => {
    test('a score within the elapsed-time ceiling is allowed', () => {
        assert.equal(isScorePlausible(100, 30), true); // 30s allows 350
    });

    test('a score exactly at the ceiling is allowed', () => {
        assert.equal(isScorePlausible(30 * SCORE_PER_SECOND + SCORE_MARGIN, 30), true);
    });

    test('a score one point past the ceiling is rejected', () => {
        assert.equal(isScorePlausible(30 * SCORE_PER_SECOND + SCORE_MARGIN + 1, 30), false);
    });

    test('a fresh token cannot justify a large score', () => {
        assert.equal(isScorePlausible(800000, 0), false);
    });

    test('the two-hour ceiling is what a patient attacker is limited to', () => {
        const maxAgeSeconds = SESSION_MAX_AGE_MS / 1000;
        const ceiling = maxAgeSeconds * SCORE_PER_SECOND + SCORE_MARGIN;
        assert.equal(ceiling, 72050);
        assert.equal(isScorePlausible(ceiling, maxAgeSeconds), true);
        assert.equal(isScorePlausible(ceiling + 1, maxAgeSeconds), false);
        // The 24-hour ceiling this replaced
        assert.equal(isScorePlausible(864050, maxAgeSeconds), false);
    });

    test('levels are bounded by elapsed time too', () => {
        assert.equal(isLevelPlausible(3, 30), true);
        assert.equal(isLevelPlausible(8000, 30), false);
    });
});
