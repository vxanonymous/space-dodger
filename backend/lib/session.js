// Proof-of-play session tokens.
//
// A token is issued at game start and bounds any later submission by real
// elapsed time: the game scores exactly SCORE_PER_SECOND, so a claimed score
// cannot exceed what the session's wall-clock age allows. Spending the token
// is handled by the caller, which owns the database; everything here is pure
// crypto and arithmetic, and takes `now` so expiry can be tested without
// waiting for the clock.

const crypto = require('crypto');

const SCORE_PER_SECOND = 10;
const LEVEL_DURATION_SECONDS = 10;
const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const SCORE_MARGIN = 50;
const LEVEL_MARGIN = 2;

// Derive a stable secret from the DB URI when no explicit one is set: survives
// restarts and is never sent to clients.
function deriveSecret(explicitSecret, mongoUri) {
    return explicitSecret ||
        crypto.createHash('sha256').update(`space-dodger-session:${mongoUri}`).digest();
}

function sign(payload, secret) {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function createToken(secret, now = Date.now(), nonce = crypto.randomBytes(8).toString('hex')) {
    const payload = Buffer.from(JSON.stringify({ t: now, n: nonce })).toString('base64url');
    return `${payload}.${sign(payload, secret)}`;
}

// Returns { elapsedSeconds, nonce } for a token this server issued and that is
// still within its lifetime, otherwise null. Never throws on malformed input.
function verifyToken(token, secret, now = Date.now(), maxAgeMs = SESSION_MAX_AGE_MS) {
    if (typeof token !== 'string') return null;

    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;

    try {
        const given = Buffer.from(sig, 'hex');
        const expected = Buffer.from(sign(payload, secret), 'hex');
        // Length check first: timingSafeEqual throws on a mismatch
        if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
            return null;
        }

        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        const ageMs = now - data.t;
        // Finiteness is checked before the comparisons, which a NaN would pass
        if (!Number.isFinite(data.t) || ageMs < 0 || ageMs > maxAgeMs) {
            return null;
        }
        if (typeof data.n !== 'string' || data.n.length === 0) {
            return null;
        }

        return { elapsedSeconds: ageMs / 1000, nonce: data.n };
    } catch (e) {
        return null;
    }
}

// The score ceiling a session of this age can justify, plus a small margin for
// rounding at the moment of death.
function isScorePlausible(score, elapsedSeconds) {
    return score <= elapsedSeconds * SCORE_PER_SECOND + SCORE_MARGIN;
}

function isLevelPlausible(level, elapsedSeconds) {
    return level <= elapsedSeconds / LEVEL_DURATION_SECONDS + LEVEL_MARGIN;
}

module.exports = {
    SCORE_PER_SECOND,
    LEVEL_DURATION_SECONDS,
    SESSION_MAX_AGE_MS,
    SCORE_MARGIN,
    LEVEL_MARGIN,
    deriveSecret,
    createToken,
    verifyToken,
    isScorePlausible,
    isLevelPlausible
};
