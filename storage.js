// LocalStorage management utilities
import { CONFIG } from './config.js';

const DEFAULT_METRICS = {
    totalGamesPlayed: 0,
    totalPlayTime: 0,
    averageScore: 0,
    averageLevel: 0,
    currentGameStartTime: 0,
    totalScoreEarned: 0
};

export class StorageManager {
    static loadHighScore() {
        try {
            const saved = parseInt(localStorage.getItem(CONFIG.STORAGE.HIGH_SCORE), 10);
            return Number.isFinite(saved) && saved >= 0 ? saved : 0;
        } catch (e) {
            return 0;
        }
    }

    static saveHighScore(score) {
        try {
            localStorage.setItem(CONFIG.STORAGE.HIGH_SCORE, score.toString());
        } catch (e) {}
    }

    static loadMetrics() {
        try {
            const saved = JSON.parse(localStorage.getItem(CONFIG.STORAGE.METRICS));
            const metrics = { ...DEFAULT_METRICS, ...saved };
            // Corrupt or legacy values must never poison the running averages
            for (const key of Object.keys(DEFAULT_METRICS)) {
                if (!Number.isFinite(metrics[key])) {
                    metrics[key] = DEFAULT_METRICS[key];
                }
            }
            return metrics;
        } catch (e) {
            return { ...DEFAULT_METRICS };
        }
    }

    static saveMetrics(metrics) {
        try {
            localStorage.setItem(CONFIG.STORAGE.METRICS, JSON.stringify(metrics));
        } catch (e) {}
    }

    static loadAchievements() {
        try {
            const saved = localStorage.getItem(CONFIG.STORAGE.ACHIEVEMENTS);
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            return {};
        }
    }

    static saveAchievements(achievements) {
        try {
            localStorage.setItem(CONFIG.STORAGE.ACHIEVEMENTS, JSON.stringify(achievements));
        } catch (e) {}
    }

    static loadPlayerName() {
        try {
            return localStorage.getItem(CONFIG.STORAGE.PLAYER_NAME);
        } catch (e) {
            return null;
        }
    }

    static savePlayerName(name) {
        try {
            localStorage.setItem(CONFIG.STORAGE.PLAYER_NAME, name);
        } catch (e) {}
    }

    static resetCache() {
        const { HIGH_SCORE, METRICS, PLAYER_NAME, ACHIEVEMENTS } = CONFIG.STORAGE;

        try {
            localStorage.removeItem(HIGH_SCORE);
            localStorage.removeItem(METRICS);
            localStorage.removeItem(PLAYER_NAME);
            localStorage.removeItem(ACHIEVEMENTS);
        } catch (e) {}
    }
}
