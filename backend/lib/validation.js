// Request validation and name normalization.
//
// Pure functions with no database and no Express, so the rules that decide
// what reaches the leaderboard can be tested directly.

const MAX_LEADERBOARD_LIMIT = 100;
const MAX_REASONABLE_SCORE = 10000000;
const MAX_REASONABLE_LEVEL = 10000;
const MAX_NAME_LENGTH = 20;

// Strip characters with HTML meaning. The frontend renders names as text, but
// stored data must not depend on every client doing so. Lookups run the same
// transform, or a name could be stored in a form no query could find again.
function sanitizeName(raw) {
    return String(raw).replace(/[<>&"'`]/g, '').trim().substring(0, MAX_NAME_LENGTH);
}

// Returns null when the submission is acceptable, or the error string to send.
// Order matters only in which message a caller sees first.
function validateSubmission({ playerName, score, level }) {
    if (!playerName || typeof playerName !== 'string' || playerName.trim().length === 0) {
        return 'Player name is required';
    }
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
        return 'Valid score is required';
    }
    if (typeof level !== 'number' || !Number.isFinite(level) || level < 1) {
        return 'Valid level is required';
    }
    if (score > MAX_REASONABLE_SCORE) {
        return 'Score exceeds maximum allowed value';
    }
    if (level > MAX_REASONABLE_LEVEL) {
        return 'Level exceeds maximum allowed value';
    }
    return null;
}

// Clamp a requested page size into something the database is happy to serve
function clampLimit(raw) {
    return Math.min(Math.max(parseInt(raw) || MAX_LEADERBOARD_LIMIT, 1), MAX_LEADERBOARD_LIMIT);
}

module.exports = {
    MAX_LEADERBOARD_LIMIT,
    MAX_REASONABLE_SCORE,
    MAX_REASONABLE_LEVEL,
    MAX_NAME_LENGTH,
    sanitizeName,
    validateSubmission,
    clampLimit
};
