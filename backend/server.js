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

const Score = mongoose.model('Score', scoreSchema);

const MAX_LEADERBOARD_LIMIT = 100;
const MAX_REASONABLE_SCORE = 10000000;
const MAX_REASONABLE_LEVEL = 10000;

// Proof-of-play: a token issued at game start bounds any later submission by
// real elapsed time — the game scores exactly SCORE_PER_SECOND, so a claimed
// score can't exceed what the session's wall-clock age allows.
const SCORE_PER_SECOND = 10;
const LEVEL_DURATION_SECONDS = 10;
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SCORE_MARGIN = 50;
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
        return { elapsedSeconds: ageMs / 1000 };
    } catch (e) {
        return null;
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
            .select('playerName score level timestamp')
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

        // Strip characters with HTML meaning; the frontend renders names as text,
        // but stored data must not depend on every client doing so
        const safeName = playerName.replace(/[<>&"'`]/g, '').trim().substring(0, 20);
        if (safeName.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Player name contains no usable characters'
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

        // Get player's rank from the stored (floored) value. Count scores that are either:
        // 1. Higher score
        // 2. Same score but with earlier timestamp
        const betterScores = await Score.countDocuments({
            $or: [
                { score: { $gt: newScore.score } },
                { score: newScore.score, timestamp: { $lt: newScore.timestamp } }
            ]
        });
        const rank = betterScores + 1;

        res.status(201).json({
            success: true,
            score: newScore,
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
        const playerName = req.params.playerName.trim();
        const bestScore = await Score.findOne({ playerName })
            .sort({ score: -1 })
            .select('playerName score level timestamp')
            .lean();

        if (!bestScore) {
            return res.json({
                success: true,
                score: null,
                message: 'No scores found for this player'
            });
        }

        const rank = await Score.countDocuments({ score: { $gt: bestScore.score } }) + 1;

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
