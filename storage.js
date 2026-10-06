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
            const saved = JSON.parse(localStorage.getItem(CONFIG.STORAGE.ACHIEVEMENTS));
            // Achievements are looked up and assigned by id, which throws in strict
            // mode on anything but a plain object. Corrupt storage must not brick
            // the game before it starts.
            const usable = saved && typeof saved === 'object' && !Array.isArray(saved);
            return usable ? saved : {};
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

    // A stable id for this browser, minted once and never shown to anyone.
    // Display names collide; this is what actually says "these runs are mine".
    static ensurePlayerId() {
        try {
            const existing = localStorage.getItem(CONFIG.STORAGE.PLAYER_ID);
            if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) {
                return existing;
            }
            const id = StorageManager.newPlayerId();
            localStorage.setItem(CONFIG.STORAGE.PLAYER_ID, id);
            return id;
        } catch (e) {
            // Storage unavailable: play on without an identity rather than fail
            return null;
        }
    }

    static newPlayerId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        // Older browsers, and any non-secure context where randomUUID is absent
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            const bytes = crypto.getRandomValues(new Uint8Array(16));
            return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        }
        return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    }

    static resetCache() {
        const { HIGH_SCORE, METRICS, PLAYER_NAME, PLAYER_ID, ACHIEVEMENTS } = CONFIG.STORAGE;

        try {
            localStorage.removeItem(HIGH_SCORE);
            localStorage.removeItem(METRICS);
            // The name already goes, so the identity goes with it. Submitted
            // scores stay on the board, they just stop being claimable here.
            localStorage.removeItem(PLAYER_NAME);
            localStorage.removeItem(PLAYER_ID);
            localStorage.removeItem(ACHIEVEMENTS);
        } catch (e) {}
    }
}
