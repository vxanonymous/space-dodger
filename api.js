// API service for leaderboard
import { CONFIG } from './config.js';

class LeaderboardAPI {
    constructor() {
        this.baseURL = CONFIG.API.BASE_URL;
    }

    // Never let a hung request (e.g. a cold-starting server) block a caller forever
    requestTimeout() {
        return typeof AbortSignal !== 'undefined' && AbortSignal.timeout
            ? AbortSignal.timeout(CONFIG.API.TIMEOUT_MS)
            : undefined;
    }

    async submitScore(playerName, score, level) {
        try {
            const response = await fetch(`${this.baseURL}/api/scores`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    playerName: playerName.trim(),
                    score: Math.floor(score),
                    level: Math.floor(level)
                }),
                signal: this.requestTimeout()
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to submit score');
            }

            return data;
        } catch (error) {
            // Fail silently - don't break the game if API is down
            return { success: false, error: error.message };
        }
    }

    async getLeaderboard(limit = CONFIG.API.LEADERBOARD_LIMIT) {
        try {
            const response = await fetch(`${this.baseURL}/api/leaderboard?limit=${limit}`, {
                signal: this.requestTimeout()
            });

            if (!response.ok) {
                throw new Error('Failed to fetch leaderboard');
            }

            const data = await response.json();
            return data;
        } catch (error) {
            // Return empty leaderboard if API is down
            return { success: false, leaderboard: [], error: error.message };
        }
    }
}

export const leaderboardAPI = new LeaderboardAPI();
