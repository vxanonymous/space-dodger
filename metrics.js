// Lifetime play statistics.
//
// The arithmetic is split out as a pure function because running averages are
// easy to get subtly wrong and impossible to notice once they drift: they are
// written back to localStorage every game, so a bad value is permanent.

import { StorageManager } from './storage.js';

// Fold one finished run into the stored totals and return the new totals.
// Takes and returns plain data so the averages can be checked directly.
export function accumulateRun(metrics, { score, level, durationMs }) {
    const totalGamesPlayed = metrics.totalGamesPlayed + 1;

    // A clock change or a corrupt start time could otherwise bank a negative
    // or NaN duration into a total that is never recomputed from scratch
    const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;

    return {
        ...metrics,
        totalGamesPlayed,
        totalPlayTime: metrics.totalPlayTime + safeDuration,
        averageScore: (metrics.averageScore * (totalGamesPlayed - 1) + score) / totalGamesPlayed,
        averageLevel: (metrics.averageLevel * (totalGamesPlayed - 1) + level) / totalGamesPlayed,
        totalScoreEarned: metrics.totalScoreEarned + score
    };
}

// What the menu's Statistics block displays, derived rather than stored.
export function summarize(metrics) {
    return {
        gamesPlayed: metrics.totalGamesPlayed,
        avgScore: Math.round(metrics.averageScore),
        avgLevel: Math.round(metrics.averageLevel),
        totalTime: Math.round(metrics.totalPlayTime / 60000)
    };
}

export class MetricsTracker {
    constructor() {
        this.data = StorageManager.loadMetrics();
    }

    startRun(now = Date.now()) {
        this.data.currentGameStartTime = now;
    }

    // Paused time is not play time, so it is subtracted from the wall clock
    completeRun({ score, level, pausedMs = 0, now = Date.now() }) {
        const durationMs = now - this.data.currentGameStartTime - pausedMs;
        this.data = accumulateRun(this.data, { score, level, durationMs });
        StorageManager.saveMetrics(this.data);
        return this.data;
    }

    // After a cache wipe, re-read whatever the defaults are now
    reset() {
        this.data = StorageManager.loadMetrics();
    }
}
