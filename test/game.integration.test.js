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

// Runs fn with Math.random returning a fixed value
function withRandom(value, fn) {
    const real = Math.random;
    Math.random = () => value;
    try {
        return fn();
    } finally {
        Math.random = real;
    }
}

function drifter(overrides = {}) {
    return {
        x: 400, prevX: 400, y: 100, prevY: 100,
        width: 30, height: 30, speed: 5, color: '#ff0000',
        type: 'drifter', vx: 3,
        ...overrides
    };
}

describe('drifters', () => {
    test('never spawn before the third boss is behind the player', () => {
        game.startGame();
        game.level = 12;
        withRandom(0.1, () => {
            for (let i = 0; i < 20; i++) game.spawnObstacle();
        });
        assert.ok(game.obstacles.every(o => o.type !== 'drifter'));
    });

    test('join the mix from level 13', () => {
        game.startGame();
        game.level = 13;
        withRandom(0.1, () => game.spawnObstacle());

        const [spawned] = game.obstacles;
        assert.equal(spawned.type, 'drifter');
        assert.ok(Math.abs(spawned.vx) >= 1.5 && Math.abs(spawned.vx) <= 4, `drift ${spawned.vx}`);
    });

    test('only take a share of spawns, not all of them', () => {
        game.startGame();
        game.level = 13;
        withRandom(0.5, () => game.spawnObstacle());
        assert.notEqual(game.obstacles[0].type, 'drifter');
    });

    test('spawn falling 20% slower than a straight obstacle', () => {
        game.startGame();
        game.level = 13;
        // Same draws for both, so only the type decides the speed
        withRandom(0.1, () => game.spawnObstacle());
        withRandom(0.5, () => game.spawnObstacle());
        const [drifting, straight] = game.obstacles;
        assert.equal(drifting.type, 'drifter');
        assert.notEqual(straight.type, 'drifter');
        const straightAtSameDraw = game.obstacleSpeed + 0.1 * 2;
        assert.ok(Math.abs(drifting.speed - straightAtSameDraw * 0.8) < 1e-9,
            `expected ${straightAtSameDraw * 0.8}, got ${drifting.speed}`);
    });

    test('move sideways while falling at their own speed', () => {
        withoutSpawns(() => {
            game.startGame();
            step(16, 2);
            const straight = { ...drifter(), type: 'obstacle', vx: undefined };
            const drifting = drifter();
            game.obstacles = [straight, drifting];
            game.update(1 / 60);
        });
        const [straight, drifting] = game.obstacles;
        assert.equal(drifting.y, straight.y, 'equal speeds should fall equally');
        assert.equal(straight.x, 400, 'a straight obstacle should not drift');
        assert.ok(Math.abs(drifting.x - 403) < 1e-9, `expected x 403, got ${drifting.x}`);
    });

    test('bounce off the right edge', () => {
        game.startGame();
        const d = drifter({ x: 768, vx: 4 }); // max x is 770
        game.driftObstacle(d, 4);
        assert.equal(d.x, 768, 'reflects the 2px overshoot back inside');
        assert.ok(d.vx < 0, 'should now head left');
    });

    test('bounce off the left edge', () => {
        game.startGame();
        const d = drifter({ x: 1, vx: -3 });
        game.driftObstacle(d, -3);
        assert.equal(d.x, 2);
        assert.ok(d.vx > 0, 'should now head right');
    });

    test('stay on the canvas over a long flight', () => {
        game.startGame();
        const d = drifter({ x: 10, vx: -4 });
        for (let i = 0; i < 1000; i++) {
            game.driftObstacle(d, d.vx);
            assert.ok(d.x >= 0 && d.x <= 770, `left the canvas at ${d.x}`);
        }
    });

    test('slow-down eases the sideways drift too', () => {
        withoutSpawns(() => {
            game.startGame();
            step(16, 2);
            game.slowDownActive = true;
            game.slowDownTimer = 5;
            game.obstacles = [drifter({ vx: 5 })];
            game.update(1 / 60);
        });
        assert.ok(Math.abs(game.obstacles[0].x - 404) < 1e-9, `got ${game.obstacles[0].x}`);
    });

    test('a drifter sliding into the ship costs a life', () => {
        game.startGame();
        step(16, 3);
        const { x, y } = game.player;
        // Passes from left of the ship to right of it in one frame
        game.obstacles = [drifter({ prevX: x - 40, x: x + 30, prevY: y - 5, y: y - 5 })];
        game.checkCollisions();
        assert.equal(game.lives, 2);
    });

    test('are drawn as hexagons', () => {
        game.startGame();
        game.obstacles = [drifter()];
        ctx.calls.length = 0;
        game.renderer.drawObstacles();
        const lines = ctx.calls.filter(c => c.name === 'lineTo').length;
        assert.equal(lines, 5, 'a hexagon is one moveTo and five lineTo');
    });
});

function key(type, k, target = document) {
    const e = new dom.window.KeyboardEvent(type, { key: k, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
}

describe('keyboard steering', () => {
    for (const [k, sign] of [['d', 1], ['D', 1], ['ArrowRight', 1], ['a', -1], ['A', -1], ['ArrowLeft', -1]]) {
        test(`holding ${k} steers the ship ${sign > 0 ? 'right' : 'left'}`, () => {
            withoutSpawns(() => {
                game.startGame();
                game.input.pointerX = 400;
                step(16, 2);
                const startX = game.player.x;
                key('keydown', k);
                step(16, 30);
                key('keyup', k);
                assert.ok((game.player.x - startX) * sign > 50,
                    `moved ${game.player.x - startX}px`);
            });
        });
    }

    test('moves at the configured speed', () => {
        withoutSpawns(() => {
            game.startGame();
            game.input.pointerX = 400;
            step(16, 2);
            key('keydown', 'd');
            step(16, 50); // 0.8s
            key('keyup', 'd');
        });
        // 600px/s for 0.8s, give or take the frame that seeds the clock
        assert.ok(Math.abs(game.input.pointerX - Math.min(780, 400 + 480)) <= 10,
            `target at ${game.input.pointerX}`);
    });

    test('releasing the key stops the ship', () => {
        withoutSpawns(() => {
            game.startGame();
            game.input.pointerX = 400;
            step(16, 2);
            key('keydown', 'ArrowRight');
            step(16, 10);
            key('keyup', 'ArrowRight');
            step(16, 60); // let the ship catch up to the target
            const settled = game.player.x;
            step(16, 30);
            assert.ok(Math.abs(game.player.x - settled) < 0.01, 'ship kept moving');
        });
    });

    test('holding both directions cancels out', () => {
        withoutSpawns(() => {
            game.startGame();
            game.input.pointerX = 400;
            key('keydown', 'a');
            key('keydown', 'd');
            step(16, 30);
            key('keyup', 'a');
            key('keyup', 'd');
        });
        assert.equal(game.input.pointerX, 400);
    });

    test('cannot steer the ship off either edge', () => {
        withoutSpawns(() => {
            game.startGame();
            key('keydown', 'ArrowLeft');
            step(16, 200);
            key('keyup', 'ArrowLeft');
            assert.ok(game.input.pointerX === 0, `target at ${game.input.pointerX}`);
            assert.ok(game.player.x < 0.01, `ship at ${game.player.x}`);
            key('keydown', 'ArrowRight');
            step(16, 300);
            key('keyup', 'ArrowRight');
        });
        assert.equal(game.input.pointerX, 780);
        assert.ok(Math.abs(game.player.x - 780) < 0.01);
    });

    test('a pointer parked off the canvas does not delay the key', () => {
        withoutSpawns(() => {
            game.startGame();
            game.input.pointerX = 2000; // mouse left the canvas far to the right
            step(16, 60);
            key('keydown', 'a');
            step(16, 5);
            key('keyup', 'a');
        });
        assert.ok(game.input.pointerX < 780, `target still at ${game.input.pointerX}`);
    });

    test('a shrunken ship still reaches the edge by keyboard', () => {
        withoutSpawns(() => {
            game.startGame();
            game.collectPowerUp('shrink');
            key('keydown', 'd');
            step(16, 300);
            key('keyup', 'd');
        });
        assert.ok(Math.abs(game.player.x - 790) < 0.01, `ship at ${game.player.x}`);

        withoutSpawns(() => {
            key('keydown', 'a');
            step(16, 300);
            key('keyup', 'a');
        });
        assert.ok(game.player.x < 0.01, `ship at ${game.player.x}`);
    });

    test('arrow keys do not scroll the page during a run', () => {
        game.startGame();
        assert.equal(key('keydown', 'ArrowLeft').defaultPrevented, true);
        key('keyup', 'ArrowLeft');
    });

    // Every earlier test's game still listens on this shared document, so
    // this checks the current game's own decision rather than the event
    test('arrow keys still scroll the page from the menu', () => {
        assert.equal(game.state, 'menu');
        assert.equal(game.input.isPlaying(), false);
        game.startGame();
        assert.equal(game.input.isPlaying(), true);
    });

    test('typing a name does not steer', () => {
        game.startGame();
        const input = document.createElement('input');
        document.body.appendChild(input);
        key('keydown', 'a', input);
        assert.equal(game.input.keyDirection(), 0);
        input.remove();
    });

    test('losing window focus releases held keys', () => {
        game.startGame();
        key('keydown', 'd');
        assert.equal(game.input.keyDirection(), 1);
        dom.window.dispatchEvent(new dom.window.Event('blur'));
        assert.equal(game.input.keyDirection(), 0);
    });

    test('P still pauses', () => {
        game.startGame();
        step(16, 3);
        key('keydown', 'p');
        assert.equal(game.paused, true);
    });
});

describe('shrink power-up', () => {
    test('halves the ship about its centre and keeps it on the floor', () => {
        game.startGame();
        game.player.x = 400;
        game.collectPowerUp('shrink');

        assert.equal(game.player.width, 10);
        assert.equal(game.player.height, 10);
        assert.equal(game.player.x, 405, 'centre should stay at 410');
        assert.equal(game.player.y, 690, 'bottom should stay on the canvas edge');
        assert.equal(game.shrinkActive, true);
        assert.equal(game.shrinkTimer, 10);
    });

    test('shrinks the hitbox, so a near miss becomes a miss', () => {
        game.startGame();
        step(16, 3);
        game.player.x = 400;
        game.collectPowerUp('shrink');
        // Overlaps the full-size ship's left edge but not the shrunken one
        game.obstacles = [{ ...overlapObstacle(), x: 372, y: 685, prevY: 685 }];
        game.checkCollisions();
        assert.equal(game.lives, 3);
    });

    test('wears off after ten seconds and restores the full ship', () => {
        withoutSpawns(() => {
            game.startGame();
            step(16, 2);
            game.input.pointerX = game.player.x;
            game.collectPowerUp('shrink');
            step(16, 300); // 4.8s
            assert.equal(game.player.width, 10, 'should still be shrunk');
            step(16, 340); // past 10s
        });
        assert.equal(game.shrinkActive, false);
        assert.equal(game.player.width, 20);
        assert.equal(game.player.height, 20);
        assert.equal(game.player.y, 680);
    });

    test('a second pickup restarts the timer instead of shrinking further', () => {
        game.startGame();
        game.collectPowerUp('shrink');
        game.shrinkTimer = 2;
        game.collectPowerUp('shrink');
        assert.equal(game.shrinkTimer, 10);
        assert.equal(game.player.width, 10);
    });

    test('steering aims the shrunken ship at the same centre', () => {
        withoutSpawns(() => {
            game.startGame();
            game.input.pointerX = 300;
            game.collectPowerUp('shrink');
            step(16, 120);
        });
        const centre = game.player.x + game.player.width / 2;
        assert.ok(Math.abs(centre - 310) < 0.01, `centre at ${centre}`);
    });

    test('the shrunken ship can reach the right edge', () => {
        withoutSpawns(() => {
            game.startGame();
            game.collectPowerUp('shrink');
            game.input.pointerX = 2000;
            step(16, 120);
        });
        assert.equal(game.player.x, 790);
    });

    test('a new run starts at full size', () => {
        game.startGame();
        game.collectPowerUp('shrink');
        game.startGame();
        assert.equal(game.shrinkActive, false);
        assert.equal(game.player.width, 20);
        assert.equal(game.player.y, 680);
    });

    test('spawns as one of the falling power-ups', () => {
        game.startGame();
        const types = new Set();
        // The first draw decides whether anything spawns, the next picks the type
        for (const r of [0.1, 0.4, 0.9]) {
            const real = Math.random;
            let call = 0;
            Math.random = () => (call++ === 0 ? 0 : r);
            try {
                game.spawnPowerUps(1 / 60);
            } finally {
                Math.random = real;
            }
            types.add(game.powerUps[0].type);
            game.powerUps = [];
        }
        assert.deepEqual([...types].sort(), ['shield', 'shrink', 'slowDown']);
    });

    test('counts toward the collector achievement', () => {
        game.startGame();
        game.collectPowerUp('shrink');
        assert.equal(game.powerUpsCollectedThisGame, 1);
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

    test('shows an active shrink', () => {
        game.startGame();
        game.shrinkActive = true;
        game.shrinkTimer = 6;
        game.refreshHUD();

        const status = document.getElementById('powerUpStatus');
        assert.match(status.textContent, /Shrink \(6s\)/);
        assert.ok(status.querySelector('.pu-shrink'));
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

describe('cold start', () => {
    // Measured against the real host: 22.6s for the first request after it
    // sleeps, 0.1s once awake. The old flat 8s budget meant the first visitor
    // after any lull always saw "unavailable".
    let api, CONFIG;

    before(async () => {
        ({ leaderboardAPI: api } = await import('../api.js'));
        ({ CONFIG } = await import('../config.js'));
    });

    test('the cold budget comfortably exceeds a real restart', () => {
        assert.ok(CONFIG.API.COLD_TIMEOUT_MS > 22646,
            'the cold timeout must clear the 22.6s restart that was measured');
    });

    test('the warm budget stays short, so a real outage is reported quickly', () => {
        assert.ok(CONFIG.API.TIMEOUT_MS <= 10000);
        assert.ok(CONFIG.API.TIMEOUT_MS < CONFIG.API.COLD_TIMEOUT_MS);
    });

    test('an unwarmed client budgets for the restart', () => {
        api.warmed = false;
        assert.equal(api.requestTimeout().constructor.name, 'AbortSignal');
    });

    test('any reply marks the host awake, including an error status', async () => {
        api.warmed = false;
        const original = globalThis.fetch;
        globalThis.fetch = () => Promise.resolve({
            ok: false, status: 500, json: () => Promise.resolve({})
        });
        try {
            await api.getLeaderboard();
            assert.equal(api.warmed, true, 'a 500 still proves the host answered');
        } finally {
            globalThis.fetch = original;
        }
    });

    test('a failed request leaves the client cold, so the next one still waits', async () => {
        api.warmed = false;
        await api.getLeaderboard(); // the suite's fetch rejects
        assert.equal(api.warmed, false);
    });

    test('warmUp does not reject when the host is unreachable', async () => {
        api.warmed = false;
        assert.doesNotThrow(() => api.warmUp());
        await new Promise(r => setTimeout(r, 10));
    });

    test('the menu says the server is waking rather than sitting blank', async () => {
        api.warmed = false;
        // Checked before awaiting: the notice has to be on screen for the
        // whole restart, not swapped in after it finishes.
        const inFlight = game.refreshLeaderboardViews();
        assert.match(game.leaderboardUI.board.textContent, /Waking the server up/);
        await inFlight;
    });

    test('a warm client skips the waking notice', async () => {
        api.warmed = true;
        const inFlight = game.refreshLeaderboardViews();
        assert.doesNotMatch(game.leaderboardUI.board.textContent, /Waking the server up/);
        await inFlight;
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
