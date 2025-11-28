// LocalStorage management utilities
import { CONFIG } from './config.js';

export class StorageManager {
    static loadHighScore() {
        const { HIGH_SCORE } = CONFIG.STORAGE;
        
        try {
            const saved = localStorage.getItem(HIGH_SCORE);
            return saved ? parseInt(saved, 10) : 0;
        } catch (e) {
            return 0;
        }
    }
    
    static saveHighScore(score) {
        const { HIGH_SCORE } = CONFIG.STORAGE;
        
        try {
            localStorage.setItem(HIGH_SCORE, score.toString());
        } catch (e) {}
    }
    
    static loadMetrics() {
        const { METRICS } = CONFIG.STORAGE;
        
        try {
            const saved = localStorage.getItem(METRICS);
            const metrics = saved ? JSON.parse(saved) : {
                totalGamesPlayed: 0,
                totalPlayTime: 0,
                averageScore: 0,
                averageLevel: 0,
                currentGameStartTime: 0,
                totalScoreEarned: 0
            };
            if (!metrics.totalScoreEarned) {
                metrics.totalScoreEarned = 0;
            }
            return metrics;
        } catch (e) {
            return {
                totalGamesPlayed: 0,
                totalPlayTime: 0,
                averageScore: 0,
                averageLevel: 0,
                currentGameStartTime: 0,
                totalScoreEarned: 0
            };
        }
    }
    
    static saveMetrics(metrics) {
        const { METRICS } = CONFIG.STORAGE;
        
        try {
            localStorage.setItem(METRICS, JSON.stringify(metrics));
            } catch (e) {}
    }
    
    static loadAchievements() {
        const { ACHIEVEMENTS } = CONFIG.STORAGE;
        
        try {
            const saved = localStorage.getItem(ACHIEVEMENTS);
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            return {};
        }
    }
    
    static saveAchievements(achievements) {
        const { ACHIEVEMENTS } = CONFIG.STORAGE;
        
        try {
            localStorage.setItem(ACHIEVEMENTS, JSON.stringify(achievements));
        } catch (e) {}
    }
    
    static resetCache() {
        const { HIGH_SCORE, METRICS, PLAYER_NAME, ACHIEVEMENTS } = CONFIG.STORAGE;
        
        localStorage.removeItem(HIGH_SCORE);
        localStorage.removeItem(METRICS);
        localStorage.removeItem(PLAYER_NAME);
        localStorage.removeItem(ACHIEVEMENTS);
    }
}

