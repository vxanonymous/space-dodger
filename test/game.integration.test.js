// Boots the real game against the real index.html in a DOM and plays it.
//
// The unit tests cover the rules; this covers the wiring between the modules
// the game was split into, which is the part that fails silently in a browser
// rather than loudly in a function.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// jsdom has no canvas backend, so record the calls instead of drawing
function stubContext() {
    const calls = [];
    const noop = (name) => (...args) => { calls.push({ name, args }); };
    return {
        calls,
        save: noop('save'), restore: noop('restore'), translate: noop('translate'),
        rotate: noop('rotate'), fillRect: noop('fillRect'), beginPath: noop('beginPath'),
        moveTo: noop('moveTo'), lineTo: noop('lineTo'), closePath: noop('closePath'),
        fill: noop('fill'), arc: noop('arc'), stroke: noop('stroke'),
        fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1
    };
}

let dom, ctx, gameModule, frames;

before(async () => {
    dom = new JSDOM(readFileSync(join(ROOT, 'index.html'), 'utf8'), { url: 'http://localhost/' });
    ctx = stubContext();
    dom.window.HTMLCanvasElement.prototype.getContext = () => ctx;

    // Drive frames by hand so the loop is deterministic
    frames = [];
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.localStorage = dom.window.localStorage;
    globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
    globalThis.performance = dom.window.performance;
    // Every API call fails, which is the offline path the game must survive
    globalThis.fetch = () => Promise.reject(new Error('offline in tests'));

    gameModule = await import('../game.js');
});

let game;
let clock;

beforeEach(() => {
    localStorage.clear();
    frames.length = 0;
    clock = 0;
    game = gameModule.createGame();
});

// Advance the loop. The first call only seeds lastFrameTime.
function step(ms = 16, times = 1) {
    for (let i = 0; i < times; i++) {
        clock += ms;
        game.gameLoop(clock);
    }
}

// Runs fn with Math.random pinned high enough that nothing spawns. Any test
// covering more than a couple of seconds needs this: left to chance, roughly
// three obstacles a second reach a stationary ship and the run ends early.
function withoutSpawns(fn) {
    const real = Math.random;
    Math.random = () => 0.99;
    try {
        return fn();
    } finally {
        Math.random = real;
    }
}

function overlapObstacle() {
    return {
        x: game.player.x,
        y: game.player.y,
        prevY: game.player.y,
        width: 30,
        height: 30,
        speed: 0,
        color: '#ff0000',
        type: 'obstacle'
    };
}

describe('construction', () => {
    test('builds against the real markup without throwing', () => {
        assert.ok(game);
        assert.equal(game.state, 'menu');
        assert.equal(game.lives, 3);
    });

    test('creates the starfield', () => {
        assert.equal(game.stars.length, 100);
    });

    test('exposes the fields the achievement rules read', () => {
        // achievements.js reads these off the game object; the metrics move
        // into their own module behind getters, so this is the contract
        assert.equal(typeof game.metrics.totalGamesPlayed, 'number');
        assert.equal(typeof game.totalScoreEarned, 'number');
        assert.ok(game.bossAttackTypesDefeated instanceof Set);
    });
});

describe('playing', () => {
    test('scoring advances and reaches the HUD', () => {
        game.startGame();
        assert.equal(game.state, 'playing');

        step(16, 64); // ~1.008s of game time

        assert.equal(game.score, 10, 'ten points per second');
        assert.equal(document.getElementById('score').textContent, '10');
        assert.equal(document.getElementById('lives').textContent, '3');
    });

    test('the menu is hidden and the canvas is drawn', () => {
        game.startGame();
        step(16, 5);
        assert.ok(document.getElementById('mainMenu').classList.contains('hidden'));
        assert.ok(ctx.calls.length > 0, 'renderer never drew anything');
    });

    test('the ship tracks the pointer', () => {
        game.startGame();
        const startX = game.player.x;
        game.input.pointerX = 700;
        step(16, 30);
        assert.ok(game.player.x > startX, 'ship did not move toward the pointer');
        assert.ok(game.player.x <= 780, 'ship left the canvas');
    });

    test('the level ramps with elapsed time', () => {
        withoutSpawns(() => {
            game.startGame();
            step(33, 340); // past the 10s level boundary
        });
        assert.equal(game.state, 'playing', 'the run should still be alive');
        assert.ok(game.level >= 2, `expected level 2 or more, got ${game.level}`);
        assert.ok(game.obstacleSpeed > 5, 'speed did not ramp');
    });
});

describe('collisions', () => {
    test('an overlapping obstacle costs a life', () => {
        game.startGame();
        step(16, 3);
        game.obstacles = [overlapObstacle()];
        game.checkCollisions();

        assert.equal(game.lives, 2);
        assert.equal(game.player.invincible, true, 'no i-frames granted');
        assert.equal(game.explosions.length, 1);
    });

    test('invincibility absorbs further hits in the same frame', () => {
        game.startGame();
        step(16, 3);
        game.obstacles = [overlapObstacle(), overlapObstacle(), overlapObstacle()];
        game.checkCollisions();

        assert.equal(game.lives, 2, 'one impact must never drain more than one life');
    });

    test('a shield absorbs the hit instead of a life', () => {
        game.startGame();
        step(16, 3);
        game.player.hasShield = true;
        game.obstacles = [overlapObstacle()];
        game.checkCollisions();

        assert.equal(game.lives, 3, 'shield should have taken it');
        assert.equal(game.player.hasShield, false, 'shield should be consumed');
        assert.equal(game.player.invincible, true);
    });

    test('losing the last life ends the run', () => {
        game.startGame();
        step(16, 3);
        game.lives = 1;
        game.obstacles = [overlapObstacle()];
        game.checkCollisions();

        assert.equal(game.state, 'gameOver');
        assert.equal(document.getElementById('gameOver').classList.contains('hidden'), false);
    });
});

describe('pause', () => {
    test('pausing freezes game time and shows the overlay', () => {
        game.startGame();
        step(16, 64);
        const scoreBefore = game.score;

        game.togglePause();
        assert.equal(game.paused, true);
        assert.equal(document.getElementById('pauseOverlay').classList.contains('hidden'), false);

        step(16, 60);
        assert.equal(game.score, scoreBefore, 'score advanced while paused');
    });

    test('resuming hides the overlay and time runs again', () => {
        game.startGame();
        step(16, 20);
        game.togglePause();
        game.togglePause();

        assert.equal(game.paused, false);
        assert.ok(document.getElementById('pauseOverlay').classList.contains('hidden'));

        const before = game.gameTime;
        step(16, 20);
        assert.ok(game.gameTime > before);
    });

    test('a second pause in one run is refused', () => {
        game.startGame();
        game.togglePause();
        game.togglePause();
        game.togglePause(); // the one that should be rejected

        assert.equal(game.paused, false, 'pause should have been spent');
        assert.ok(document.querySelector('.toast'), 'no toast explaining the refusal');
    });

    test('a new run restores the pause', () => {
        game.startGame();
        game.togglePause();
        game.togglePause();
        game.startGame();

        assert.equal(game.pauseUsedThisGame, false);
        game.togglePause();
        assert.equal(game.paused, true);
    });
});

describe('the HUD', () => {
    test('shows active power-ups with their own classes', () => {
        game.startGame();
        game.player.hasShield = true;
        game.shieldTimer = 7;
        game.slowDownActive = true;
        game.slowDownTimer = 4;
        game.refreshHUD();

        const status = document.getElementById('powerUpStatus');
        assert.match(status.textContent, /Shield \(7s\)/);
        assert.match(status.textContent, /Slow Down \(4s\)/);
        assert.ok(status.querySelector('.pu-shield'));
        assert.ok(status.querySelector('.pu-slow'));
    });

    test('clears the power-up row once effects lapse', () => {
        game.startGame();
        game.player.hasShield = true;
        game.shieldTimer = 3;
        game.refreshHUD();
        assert.notEqual(document.getElementById('powerUpStatus').textContent, '');

        game.player.hasShield = false;
        game.refreshHUD();
        assert.equal(document.getElementById('powerUpStatus').textContent, '');
    });

    test('marks a boss level', () => {
        game.startGame();
        game.level = 4;
        game.boss = { x: 0, y: 0, radius: 60 };
        game.refreshHUD();
        assert.equal(document.getElementById('level').textContent, '4 - BOSS!');
    });

    test('writes the high score to every place it appears', () => {
        game.highScore = 4321;
        game.hud.setHighScore(game.highScore);
        for (const id of ['highScore', 'gameOverHighScore', 'prominentHighScore']) {
            assert.equal(document.getElementById(id).textContent, '4,321');
        }
    });
});

describe('game over', () => {
    test('records the run and offers the name form to a new player', () => {
        game.startGame();
        step(16, 64);
        game.lives = 1;
        game.obstacles = [overlapObstacle()];
        game.checkCollisions();

        assert.equal(game.metrics.totalGamesPlayed, 1);
        assert.equal(document.getElementById('finalScore').textContent, '10');
        assert.equal(document.getElementById('nameForm').classList.contains('hidden'), false,
            'a player with no saved name should be asked for one');
    });

    test('a returning player submits without being asked again', () => {
        localStorage.setItem('spaceDodgerPlayerName', 'Vinh');
        game = gameModule.createGame();
        game.startGame();
        step(16, 20);
        game.lives = 1;
        game.obstacles = [overlapObstacle()];
        game.checkCollisions();

        assert.ok(document.getElementById('nameForm').classList.contains('hidden'));
        assert.match(document.getElementById('finalRank').textContent, /Playing as Vinh/);
    });

    test('a new high score is banked and announced', () => {
        game.startGame();
        step(16, 64);
        game.lives = 1;
        game.obstacles = [overlapObstacle()];
        game.checkCollisions();

        assert.equal(game.highScore, 10);
        assert.equal(localStorage.getItem('spaceDodgerHighScore'), '10');
        assert.equal(document.getElementById('newHighScore').classList.contains('hidden'), false);
    });

    test('the loop stops once the explosion has faded', () => {
        game.startGame();
        step(16, 10);
        game.lives = 1;
        game.obstacles = [overlapObstacle()];
        game.checkCollisions();

        // Explosions live 15 units decremented by deltaTime*60, so ~0.25s
        step(33, 40);
        assert.equal(game.explosions.length, 0);
        assert.equal(game.gameLoopRunning, false, 'loop should stop with nothing left to animate');
    });

    test('restarting after the loop stopped starts it again', () => {
        game.startGame();
        step(16, 10);
        game.lives = 1;
        game.obstacles = [overlapObstacle()];
        game.checkCollisions();
        step(33, 40);
        assert.equal(game.gameLoopRunning, false);

        game.startGame();
        assert.equal(game.gameLoopRunning, true);
        assert.equal(game.state, 'playing');
        assert.equal(game.lives, 3);
        assert.equal(game.score, 0);
    });
});

describe('offline behaviour', () => {
    test('the board reports unavailable rather than breaking the menu', async () => {
        await game.loadLeaderboard();
        assert.match(document.getElementById('leaderboard').textContent, /unavailable/i);
    });

    test('the personal best block stays hidden when the lookup fails', async () => {
        await game.refreshLeaderboardViews();
        assert.ok(document.getElementById('personalBest').classList.contains('hidden'));
    });

    test('a failed submission still leaves a readable rank line', async () => {
        await game.submitScoreToLeaderboard('Vinh');
        assert.match(document.getElementById('finalRank').textContent, /leaderboard unavailable/);
    });

    test('a score is only submitted once per run', async () => {
        await game.submitScoreToLeaderboard('Vinh');
        game.leaderboardUI.setRankLine('untouched');
        await game.submitScoreToLeaderboard('Vinh');
        assert.equal(document.getElementById('finalRank').textContent, 'untouched',
            'the second submission should have been refused');
    });
});

describe('leaderboard rendering', () => {
    test('renders rows and marks the player', () => {
        game.leaderboardUI.renderBoard([
            { playerName: 'Vinh', score: 1769, level: 18, timestamp: '2025-12-07T07:52:17.354Z' },
            { playerName: 'Other', score: 900, level: 9, timestamp: '2026-01-01T00:00:00.000Z' }
        ], { score: 1769, timestamp: '2025-12-07T07:52:17.354Z' });

        const board = document.getElementById('leaderboard');
        assert.equal(board.querySelectorAll('.board-row').length, 2);
        assert.equal(board.querySelectorAll('.board-row-own').length, 1);
        assert.match(board.textContent, /1,769 pts \(Level 18\)/);
        assert.match(board.textContent, /\(you\)/);
    });

    test('a stranger sharing your display name is not marked as you', () => {
        // The whole point of resolving identity server-side: two players can
        // both be called Vinh, and only one of these rows is actually mine.
        game.leaderboardUI.renderBoard([
            { playerName: 'Vinh', score: 5000, level: 50, timestamp: '2026-02-01T00:00:00.000Z' },
            { playerName: 'Vinh', score: 1769, level: 18, timestamp: '2025-12-07T07:52:17.354Z' }
        ], { score: 1769, timestamp: '2025-12-07T07:52:17.354Z' });

        const board = document.getElementById('leaderboard');
        const own = board.querySelectorAll('.board-row-own');
        assert.equal(own.length, 1, 'exactly one row should be mine');
        assert.match(own[0].textContent, /1,769/, 'the marked row should be my run, not the higher one');
        assert.doesNotMatch(own[0].textContent, /5,000/);
    });

    test('no row is marked when the player has no recorded best', () => {
        game.leaderboardUI.renderBoard([
            { playerName: 'Vinh', score: 1769, level: 18, timestamp: '2025-12-07T07:52:17.354Z' }
        ], null);

        assert.equal(document.getElementById('leaderboard').querySelectorAll('.board-row-own').length, 0);
        assert.doesNotMatch(document.getElementById('leaderboard').textContent, /\(you\)/);
    });

    test('a player name is never interpreted as markup', () => {
        game.leaderboardUI.renderBoard([
            { playerName: '<img src=x onerror=alert(1)>', score: 1, level: 1, timestamp: Date.now() }
        ], null);

        const board = document.getElementById('leaderboard');
        assert.equal(board.querySelector('img'), null, 'server data reached the DOM as markup');
        assert.match(board.textContent, /<img src=x onerror=alert\(1\)>/, 'should render as literal text');
    });

    test('an empty board invites the first score', () => {
        game.leaderboardUI.renderBoard([], null);
        assert.match(document.getElementById('leaderboard').textContent, /Be the first/);
    });

    test('the personal best shows the run and its rank', () => {
        game.leaderboardUI.renderPersonalBest({
            playerName: 'Vinh', score: 1769, level: 18,
            timestamp: '2025-12-07T07:52:17.354Z', rank: 1
        });

        const el = document.getElementById('personalBest');
        assert.equal(el.classList.contains('hidden'), false);
        assert.match(el.textContent, /Your Best as Vinh/);
        assert.match(el.textContent, /1,769 pts \(Level 18\)/);
        assert.match(el.textContent, /Global Rank: #1/);
    });
});

describe('achievements', () => {
    // These rules decide what players earn and had no coverage at all. They
    // need a DOM because the manager builds its popup on construction, which
    // is why they live here rather than in a pure unit file.
    let ACHIEVEMENTS, BOSS_ATTACK_PATTERNS;

    before(async () => {
        ({ ACHIEVEMENTS } = await import('../achievements.js'));
        ({ BOSS_ATTACK_PATTERNS } = await import('../boss-attacks.js'));
    });

    test('every score milestone in the catalogue actually unlocks', () => {
        // Guards a real drift hazard: the thresholds the checker loops over
        // are written out separately from the catalogue, so adding an entry
        // to one and not the other yields an achievement nobody can earn.
        const milestones = ACHIEVEMENTS
            .map(a => /^score_(\d+)$/.exec(a.id))
            .filter(Boolean)
            .map(m => Number(m[1]));

        assert.ok(milestones.length >= 5, 'expected several score achievements');

        for (const target of milestones) {
            const fresh = gameModule.createGame();
            fresh.score = target;
            fresh.achievementManager.checkAchievements();
            assert.ok(fresh.achievements[`score_${target}`],
                `score_${target} is in the catalogue but never unlocks at ${target} points`);
        }
    });

    test('a milestone does not unlock one point early', () => {
        game.score = 499;
        game.achievementManager.checkAchievements();
        assert.equal(game.achievements.score_500, undefined);

        game.score = 500;
        game.achievementManager.checkAchievements();
        assert.ok(game.achievements.score_500);
    });

    test('every boss attack pattern has an achievement to earn', () => {
        const ids = new Set(ACHIEVEMENTS.map(a => a.id));
        for (const pattern of BOSS_ATTACK_PATTERNS) {
            assert.ok(ids.has(`boss_${pattern}`),
                `attack pattern ${pattern} can be survived but has no achievement`);
        }
    });

    test('no boss achievement refers to a pattern that no longer exists', () => {
        const patterns = new Set(BOSS_ATTACK_PATTERNS);
        for (const a of ACHIEVEMENTS.filter(x => x.id.startsWith('boss_'))) {
            assert.ok(patterns.has(a.id.slice('boss_'.length)),
                `${a.id} has no matching attack pattern`);
        }
    });

    test('catalogue entries are complete and unique', () => {
        const ids = ACHIEVEMENTS.map(a => a.id);
        assert.equal(new Set(ids).size, ids.length, 'duplicate achievement id');
        for (const a of ACHIEVEMENTS) {
            assert.ok(a.name && a.icon && a.description, `${a.id} is missing display fields`);
        }
    });

    test('beating a previous record unlocks, but a first game does not', () => {
        game.highScore = 0;
        game.score = 5;
        game.achievementManager.checkAchievements();
        assert.equal(game.achievements.beat_high_score, undefined, 'first game should not count');

        game.highScore = 100;
        game.score = 101;
        game.achievementManager.checkAchievements();
        assert.ok(game.achievements.beat_high_score);
    });

    test('the comeback needs both the lost lives and the score', () => {
        game.livesLostInFirstLevel = 2;
        game.score = 999;
        game.achievementManager.checkAchievements();
        assert.equal(game.achievements.comeback_1000, undefined);

        game.score = 1000;
        game.achievementManager.checkAchievements();
        assert.ok(game.achievements.comeback_1000);
    });

    test('collecting three power-ups unlocks the collector', () => {
        game.powerUpsCollectedThisGame = 2;
        game.achievementManager.checkAchievements();
        assert.equal(game.achievements.powerups_3, undefined);

        game.powerUpsCollectedThisGame = 3;
        game.achievementManager.checkAchievements();
        assert.ok(game.achievements.powerups_3);
    });

    test('the full house needs every pattern, not merely several', () => {
        for (const pattern of BOSS_ATTACK_PATTERNS.slice(0, -1)) {
            game.achievements[`boss_${pattern}`] = { unlocked: true };
        }
        game.achievementManager.checkAchievements();
        assert.equal(game.achievements.all_bosses, undefined, 'six of seven should not be enough');

        game.achievements[`boss_${BOSS_ATTACK_PATTERNS.at(-1)}`] = { unlocked: true };
        game.achievementManager.checkAchievements();
        assert.ok(game.achievements.all_bosses);
    });

    test('unlocking is idempotent and persisted', () => {
        assert.equal(game.achievementManager.unlockAchievement('powerups_3'), true);
        assert.equal(game.achievementManager.unlockAchievement('powerups_3'), false,
            'a second unlock should be a no-op');

        const stored = JSON.parse(localStorage.getItem('spaceDodgerAchievements'));
        assert.ok(stored.powerups_3.unlocked);
    });

    test('unlocking announces itself on screen', () => {
        game.achievementManager.unlockAchievement('shield_saved');
        assert.match(document.body.textContent, /Achievement Unlocked/);
    });
});

describe('reset', () => {
    test('clears stored progress and the displays', () => {
        game.startGame();
        step(16, 64);
        game.lives = 1;
        game.obstacles = [overlapObstacle()];
        game.checkCollisions();
        assert.equal(game.highScore, 10);

        game.resetCache();

        assert.equal(game.highScore, 0);
        assert.equal(game.metrics.totalGamesPlayed, 0);
        assert.deepEqual(game.achievements, {});
        assert.equal(document.getElementById('prominentHighScore').textContent, '0');
        assert.equal(localStorage.getItem('spaceDodgerHighScore'), null);
    });
});
