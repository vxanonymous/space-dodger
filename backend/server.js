// Backend server for Space Dodger leaderboard
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: [
        'https://space-dodger.surge.sh',
        'http://localhost:8000',
        'http://127.0.0.1:8000',
        'http://localhost:3000'
    ],
    credentials: true
}));
app.use(express.json());

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/space-dodger';

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

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
}, {
    timestamps: true
});

// Index for leaderboard queries
scoreSchema.index({ score: -1 });
scoreSchema.index({ timestamp: -1 });

const Score = mongoose.model('Score', scoreSchema);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get leaderboard top 100 scores
app.get('/api/leaderboard', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
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
app.post('/api/scores', async (req, res) => {
    try {
        const { playerName, score, level } = req.body;
        
        // Validation
        if (!playerName || typeof playerName !== 'string' || playerName.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Player name is required'
            });
        }
        
        if (typeof score !== 'number' || score < 0) {
            return res.status(400).json({
                success: false,
                error: 'Valid score is required'
            });
        }
        
        if (typeof level !== 'number' || level < 1) {
            return res.status(400).json({
                success: false,
                error: 'Valid level is required'
            });
        }
        
        const MAX_REASONABLE_SCORE = 10000000;
        const MAX_REASONABLE_LEVEL = 10000;
        
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
        
        // Create and save score
        const newScore = new Score({
            playerName: playerName.trim().substring(0, 20),
            score: Math.floor(score),
            level: Math.floor(level),
            timestamp: new Date()
        });
        
        await newScore.save();
        
        // Get player's rank. Count scores that are either:
        // 1. Higher score
        // 2. Same score but with earlier timestamp
        const betterScores = await Score.countDocuments({
            $or: [
                { score: { $gt: score } },
                { score: score, timestamp: { $lt: newScore.timestamp } }
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
app.get('/api/player/:playerName', async (req, res) => {
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

