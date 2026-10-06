import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { accumulateRun, summarize } from '../metrics.js';

const empty = {
    totalGamesPlayed: 0,
    totalPlayTime: 0,
    averageScore: 0,
    averageLevel: 0,
    currentGameStartTime: 0,
    totalScoreEarned: 0
};

describe('accumulateRun', () => {
    test('a first run becomes its own average', () => {
        const next = accumulateRun(empty, { score: 500, level: 5, durationMs: 50000 });
        assert.equal(next.totalGamesPlayed, 1);
        assert.equal(next.averageScore, 500);
        assert.equal(next.averageLevel, 5);
        assert.equal(next.totalPlayTime, 50000);
        assert.equal(next.totalScoreEarned, 500);
    });

    test('running averages match a plain mean over several runs', () => {
        const runs = [
            { score: 100, level: 2, durationMs: 10000 },
            { score: 200, level: 4, durationMs: 20000 },
            { score: 600, level: 6, durationMs: 30000 }
        ];
        const result = runs.reduce(accumulateRun, empty);

        assert.equal(result.totalGamesPlayed, 3);
        assert.equal(result.averageScore, (100 + 200 + 600) / 3);
        assert.equal(result.averageLevel, (2 + 4 + 6) / 3);
        assert.equal(result.totalPlayTime, 60000);
        assert.equal(result.totalScoreEarned, 900);
    });

    test('a negative duration is ignored rather than banked', () => {
        // A clock change could otherwise permanently corrupt totalPlayTime,
        // which is never recomputed from scratch.
        const next = accumulateRun(empty, { score: 10, level: 1, durationMs: -5000 });
        assert.equal(next.totalPlayTime, 0);
        assert.equal(next.totalGamesPlayed, 1, 'the run itself still counts');
    });

    test('a non-finite duration is ignored', () => {
        assert.equal(accumulateRun(empty, { score: 10, level: 1, durationMs: NaN }).totalPlayTime, 0);
        assert.equal(accumulateRun(empty, { score: 10, level: 1, durationMs: Infinity }).totalPlayTime, 0);
    });

    test('does not mutate the input', () => {
        const before = { ...empty };
        accumulateRun(before, { score: 42, level: 3, durationMs: 1000 });
        assert.deepEqual(before, empty);
    });

    test('preserves unrelated fields', () => {
        const withStart = { ...empty, currentGameStartTime: 12345 };
        const next = accumulateRun(withStart, { score: 1, level: 1, durationMs: 1 });
        assert.equal(next.currentGameStartTime, 12345);
    });

    test('a zero score still counts as a game played', () => {
        const next = accumulateRun(empty, { score: 0, level: 1, durationMs: 500 });
        assert.equal(next.totalGamesPlayed, 1);
        assert.equal(next.averageScore, 0);
    });
});

describe('summarize', () => {
    test('rounds for display and converts play time to minutes', () => {
        const view = summarize({
            totalGamesPlayed: 7,
            totalPlayTime: 185000, // 3.08 minutes
            averageScore: 123.4,
            averageLevel: 4.6,
            totalScoreEarned: 0
        });
        assert.deepEqual(view, { gamesPlayed: 7, avgScore: 123, avgLevel: 5, totalTime: 3 });
    });
});
