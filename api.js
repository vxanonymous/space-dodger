// API service for leaderboard
import { CONFIG } from './config.js';

class LeaderboardAPI {
    constructor() {
        this.baseURL = CONFIG.API.BASE_URL;
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
            const response = await fetch(`${this.baseURL}/api/leaderboard?limit=${limit}`);
            
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
    
    async getPlayerBestScore(playerName) {
        try {
            const encodedName = encodeURIComponent(playerName.trim());
            const response = await fetch(`${this.baseURL}/api/player/${encodedName}`);
            
            if (!response.ok) {
                throw new Error('Failed to fetch player score');
            }
            
            const data = await response.json();
            return data;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    async checkHealth() {
        try {
            const response = await fetch(`${this.baseURL}/health`);
            return response.ok;
        } catch (error) {
            return false;
        }
    }
}

export const leaderboardAPI = new LeaderboardAPI();

