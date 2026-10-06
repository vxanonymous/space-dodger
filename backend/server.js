// Backend server for Space Dodger leaderboard
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
require('dotenv').config();

const { version } = require('./package.json');

const app = express();
const PORT = process.env.PORT || 3000;

// Render terminates TLS at its proxy; trust it so req.ip is the real client IP
app.set('trust proxy', 1);

// Middleware
const ALLOWED_ORIGIN = /^https:\/\/space-dodger\.surge\.sh$|^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app.use(cors({
    origin: (origin, callback) => callback(null, !origin || ALLOWED_ORIGIN.test(origin)),
    credentials: true
}));
app.use(express.json({ limit: '2kb' }));

const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/space-dodger';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => {
        console.error('MongoDB connection error:', err);
        // Exit so the host restarts the service and retries, instead of serving
        // requests that buffer for 10s and then fail
        process.exit(1);
    });

// Score schema
const scoreSchema = new mongoose.Schema({
    playerName: {
        type: String,
        required: true,
        maxlength: 20,
        trim: true
    },
    score: {
        type: Number,
        required: true,
        min: 0
    },
    level: {
        type: Number,
        required: true,
        min: 1
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

// One compound index serves the leaderboard sort and the rank counts
scoreSchema.index({ score: -1, timestamp: 1 });
// Serves the per-player best lookup, which would otherwise scan the collection
scoreSchema.index({ playerName: 1, score: -1, timestamp: 1 });

const Score = mongoose.model('Score', scoreSchema);

const MAX_LEADERBOARD_LIMIT = 100;
const MAX_REASONABLE_SCORE = 10000000;
const MAX_REASONABLE_LEVEL = 10000;
const MAX_NAME_LENGTH = 20;

// Strip characters with HTML meaning; the frontend renders names as text, but
// stored data must not depend on every client doing so. Lookups run the same
// transform, or a name could be stored in a form no query could find again.
const sanitizeName = (raw) =>
    String(raw).replace(/[<>&"'`]/g, '').trim().substring(0, MAX_NAME_LENGTH);

// One more than the number of scores that beat this one, ties broken by the
// earlier timestamp so this matches the leaderboard's own ordering. Both
// endpoints share it, so they can't report different ranks for one score.
async function rankOf(score, timestamp) {
    const better = await Score.countDocuments({
        $or: [
            { score: { $gt: score } },
            { score, timestamp: { $lt: timestamp } }
        ]
    });
    return better + 1;
}

// Proof-of-play: a token issued at game start bounds any later submission by
// real elapsed time. The game scores exactly SCORE_PER_SECOND, so a claimed
// score can't exceed what the session's wall-clock age allows.
//
// The age bound is only half of it: a token is also spendable exactly once
// (see UsedToken below), so the ceiling can't be farmed by replaying one token.
// Max age caps how high that ceiling can climb while an attacker simply waits,
// which is why it is hours rather than a day.
const SCORE_PER_SECOND = 10;
const LEVEL_DURATION_SECONDS = 10;
const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const SCORE_MARGIN = 50;

// Nonces of tokens that have already been submitted. Mongo expires each row
// once the token itself would be too old to accept, so this stays small.
const usedTokenSchema = new mongoose.Schema({
    nonce: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: Date.now, expires: SESSION_MAX_AGE_MS / 1000 }
});

const UsedToken = mongoose.model('UsedToken', usedTokenSchema);

// Derived from the DB URI when no explicit secret is set: stable across
// restarts, never sent to clients
const TOKEN_SECRET = process.env.SCORE_TOKEN_SECRET ||
    crypto.createHash('sha256').update(`space-dodger-session:${MONGODB_URI}`).digest();

const signSession = (payload) =>
    crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');

function verifySession(token) {
    if (typeof token !== 'string') return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    try {
        const given = Buffer.from(sig, 'hex');
        const expected = Buffer.from(signSession(payload), 'hex');
        if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
            return null;
        }
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        const ageMs = Date.now() - data.t;
        if (!Number.isFinite(data.t) || ageMs < 0 || ageMs > SESSION_MAX_AGE_MS) {
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

// Spends a session token, returning false if it was already spent. The unique
// index decides the winner when two requests race on the same token.
async function spendSession(nonce) {
    try {
        await UsedToken.create({ nonce });
        return true;
    } catch (error) {
        if (error && error.code === 11000) return false;
        throw error;
    }
}

// Health check
app.get('/health', (req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({
        status: dbUp ? 'ok' : 'degraded',
        version,
        timestamp: new Date().toISOString()
    });
});

// Issue a proof-of-play session token; the frontend requests one at game start
app.post('/api/session', readLimiter, (req, res) => {
    const payload = Buffer.from(JSON.stringify({
        t: Date.now(),
        n: crypto.randomBytes(8).toString('hex')
    })).toString('base64url');
    res.status(201).json({ success: true, token: `${payload}.${signSession(payload)}` });
});

// Get leaderboard top 100 scores
app.get('/api/leaderboard', readLimiter, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit) || MAX_LEADERBOARD_LIMIT, 1), MAX_LEADERBOARD_LIMIT);
        // Sort by score descending, then by timestamp ascending
        const topScores = await Score.find()
            .sort({ score: -1, timestamp: 1 })
            .limit(limit)
            .select('playerName score level timestamp -_id')
            .lean();

        res.json({
            success: true,
            leaderboard: topScores,
            count: topScores.length
        });
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch leaderboard'
        });
    }
});

// Submit a new score
app.post('/api/scores', writeLimiter, async (req, res) => {
    try {
        const { playerName, score, level } = req.body;

        // Validation
        if (!playerName || typeof playerName !== 'string' || playerName.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Player name is required'
            });
        }

        if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
            return res.status(400).json({
                success: false,
                error: 'Valid score is required'
            });
        }

        if (typeof level !== 'number' || !Number.isFinite(level) || level < 1) {
            return res.status(400).json({
                success: false,
                error: 'Valid level is required'
            });
        }

        if (score > MAX_REASONABLE_SCORE) {
            return res.status(400).json({
                success: false,
                error: 'Score exceeds maximum allowed value'
            });
        }

        if (level > MAX_REASONABLE_LEVEL) {
            return res.status(400).json({
                success: false,
                error: 'Level exceeds maximum allowed value'
            });
        }

        // The session token bounds the claim by real elapsed time
        const session = verifySession(req.body.sessionToken);
        if (!session) {
            return res.status(400).json({
                success: false,
                error: 'Valid session token is required'
            });
        }
        if (score > session.elapsedSeconds * SCORE_PER_SECOND + SCORE_MARGIN) {
            return res.status(400).json({
                success: false,
                error: 'Score is not plausible for this session'
            });
        }
        if (level > session.elapsedSeconds / LEVEL_DURATION_SECONDS + 2) {
            return res.status(400).json({
                success: false,
                error: 'Level is not plausible for this session'
            });
        }

        const safeName = sanitizeName(playerName);
        if (safeName.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Player name contains no usable characters'
            });
        }

        // Spend the token only once the submission is known to be acceptable, so
        // a rejected attempt doesn't strand a legitimate player's session
        if (!await spendSession(session.nonce)) {
            return res.status(409).json({
                success: false,
                error: 'This session has already submitted a score'
            });
        }

        // Create and save score
        const newScore = new Score({
            playerName: safeName,
            score: Math.floor(score),
            level: Math.floor(level),
            timestamp: new Date()
        });

        await newScore.save();

        // Rank comes from the stored (floored) value, not the submitted one
        const rank = await rankOf(newScore.score, newScore.timestamp);

        // Echo back only the public fields; the raw document would also carry
        // the internal _id and __v
        res.status(201).json({
            success: true,
            score: {
                playerName: newScore.playerName,
                score: newScore.score,
                level: newScore.level,
                timestamp: newScore.timestamp
            },
            rank: rank
        });
    } catch (error) {
        console.error('Error submitting score:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to submit score'
        });
    }
});

// Get player's best score
app.get('/api/player/:playerName', readLimiter, async (req, res) => {
    try {
        // Match how the name was normalized on the way in
        const playerName = sanitizeName(req.params.playerName);
        if (playerName.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Player name contains no usable characters'
            });
        }

        // Same tiebreak as the leaderboard, so a player with two identical best
        // scores always resolves to the earlier one rather than an arbitrary row
        const bestScore = await Score.findOne({ playerName })
            .sort({ score: -1, timestamp: 1 })
            .select('playerName score level timestamp -_id')
            .lean();

        if (!bestScore) {
            return res.json({
                success: true,
                score: null,
                message: 'No scores found for this player'
            });
        }

        const rank = await rankOf(bestScore.score, bestScore.timestamp);

        res.json({
            success: true,
            score: bestScore,
            rank: rank
        });
    } catch (error) {
        console.error('Error fetching player score:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch player score'
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Space Dodger API server running on port ${PORT}`);
});
