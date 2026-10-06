// API service for leaderboard
import { CONFIG } from './config.js';

class LeaderboardAPI {
    constructor() {
        this.baseURL = CONFIG.API.BASE_URL;
        // Until something answers, assume the service may be asleep
        this.warmed = false;
    }

    // Never let a hung request block a caller forever. The budget is generous
    // only until the first reply: a sleeping host takes tens of seconds to
    // restart, but once awake it answers in milliseconds, and a long timeout
    // from then on would just mean a long wait before reporting a real outage.
    requestTimeout() {
        if (typeof AbortSignal === 'undefined' || !AbortSignal.timeout) return undefined;
        return AbortSignal.timeout(this.warmed ? CONFIG.API.TIMEOUT_MS : CONFIG.API.COLD_TIMEOUT_MS);
    }

    // Start the restart clock as early as possible, so the wait overlaps with
    // the player reading the menu instead of landing on their first request.
    // Fire and forget: nothing depends on the result.
    warmUp() {
        if (this.warmed) return;
        fetch(`${this.baseURL}/health`, { signal: this.requestTimeout() })
            .then(() => { this.warmed = true; })
            .catch(() => {});
    }

    // Single place that applies the timeout and notices the host is awake.
    // Any reply counts, including an error status: the point is that
    // something answered, so later requests need not budget for a restart.
    async request(path, options = {}) {
        const response = await fetch(`${this.baseURL}${path}`, {
            ...options,
            signal: this.requestTimeout()
        });
        this.warmed = true;
        return response;
    }

    // Proof-of-play: fetched at game start so the server can bound the final
    // score by the session's real age
    async startSession() {
        try {
            const response = await this.request('/api/session', { method: 'POST' });
            if (!response.ok) {
                throw new Error('Failed to start session');
            }
            const data = await response.json();
            return data.token || null;
        } catch (error) {
            return null;
        }
    }

    async submitScore(playerName, score, level, sessionToken, playerId) {
        try {
            const response = await this.request('/api/scores', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    playerName: playerName.trim(),
                    score: Math.floor(score),
                    level: Math.floor(level),
                    sessionToken: sessionToken || undefined,
                    playerId: playerId || undefined
                })
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
            const response = await this.request(`/api/leaderboard?limit=${limit}`);

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

    // A player's own best run and where it sits globally, including ranks past
    // the visible top 100.
    //
    // Resolved by player id rather than display name, so two players who chose
    // the same name do not share a record. POST keeps the id out of URLs and
    // access logs; the name is sent only as a fallback for runs recorded
    // before ids existed.
    async getPlayerBest(playerId, playerName) {
        try {
            const response = await this.request('/api/player/best', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playerId: playerId || undefined,
                    playerName: playerName || undefined
                })
            });

            if (!response.ok) {
                throw new Error('Failed to fetch player best');
            }

            return await response.json();
        } catch (error) {
            return { success: false, score: null, error: error.message };
        }
    }
}

export const leaderboardAPI = new LeaderboardAPI();
