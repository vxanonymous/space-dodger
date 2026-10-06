// Game loop and simulation.
//
// This file owns entity state and the rules that move it. Input wiring lives
// in input.js, DOM writes in hud.js and leaderboard-ui.js, collision maths in
// collision.js and lifetime stats in metrics.js, so what is left here is the
// simulation itself.

import { CONFIG } from './config.js';
import { BossAttackManager } from './boss-attacks.js';
import { leaderboardAPI } from './api.js';
import { StorageManager } from './storage.js';
import { AchievementManager } from './achievements.js';
import { Renderer } from './rendering.js';
import { InputManager } from './input.js';
import { HUD } from './hud.js';
import { LeaderboardUI } from './leaderboard-ui.js';
import { MetricsTracker } from './metrics.js';
import { intersects, sweptBounds, centerOf } from './collision.js';

class SpaceDodger {
    constructor() {
        const { CANVAS_HEIGHT } = CONFIG;
        const { START_X, WIDTH, HEIGHT, COLOR } = CONFIG.PLAYER;
        const { INITIAL_LIVES } = CONFIG.GAME;

        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.state = 'menu';
        this.gameLoopRunning = false;
        this.lastFrameTime = 0;
        this.rafScheduled = false;
        this.boundGameLoop = this.gameLoop.bind(this);

        this.paused = false;
        this.pauseUsedThisGame = false;
        this.pauseStartMs = 0;
        this.pausedElapsedMs = 0;

        this.player = {
            x: START_X,
            y: CANVAS_HEIGHT - HEIGHT,
            width: WIDTH,
            height: HEIGHT,
            color: COLOR,
            invincible: false,
            invincibilityTimer: 0,
            hasShield: false
        };

        const { SPAWN_RATE, BASE_SPEED } = CONFIG.OBSTACLE;
        this.obstacleSpawnRate = SPAWN_RATE;
        this.obstacleSpeed = BASE_SPEED;
        this.slowDownActive = false;
        this.slowDownTimer = 0;
        this.shieldTimer = 0;

        this.obstacles = [];
        this.explosions = [];
        this.stars = [];
        this.powerUps = [];
        this.boss = null;
        this.bossAttackManager = new BossAttackManager(this);
        this.lastBossLevel = 0;

        this.hud = new HUD();
        this.leaderboardUI = new LeaderboardUI({
            onSubmitName: (name) => this.saveNameAndSubmit(name)
        });
        this.input = new InputManager(this.canvas, {
            onPauseToggle: () => this.togglePause(),
            initialX: START_X
        });
        this.metricsTracker = new MetricsTracker();
        this.achievementManager = new AchievementManager(this);
        this.renderer = new Renderer(this);

        this.screenShake = { intensity: 0, duration: 0, offsetX: 0, offsetY: 0 };
        this.levelFlashTimer = 0;

        this.submissionSeq = 0;
        this.scoreSubmitted = false;

        this.score = 0;
        this.lastDisplayedScore = -1;
        this.lives = INITIAL_LIVES;
        this.level = 1;
        this.gameTime = 0;
        this.highScore = StorageManager.loadHighScore();
        this.gameOverCalled = false;

        this.achievements = StorageManager.loadAchievements();
        // Stable across renames and distinct from anyone else who picks the
        // same display name. Null when storage is unavailable, in which case
        // the game plays normally and lookups fall back to the name.
        this.playerId = StorageManager.ensurePlayerId();

        // Per-run tracking the achievement rules read
        this.powerUpsCollectedThisGame = 0;
        this.bossAttackTypesDefeated = new Set();
        this.shieldSavedLife = false;
        this.lifeLostDuringBossLevel = false;
        this.livesLostInFirstLevel = 0;

        this.createStars();
        this.hud.setHighScore(this.highScore);
        // Begin the API's restart before anything needs it, so the wait
        // overlaps with the player reading the menu
        leaderboardAPI.warmUp();
        this.updateMenuMetrics();
    }

    // achievements.js reads these off the game object; keeping them as getters
    // means the metrics move into their own module without changing that contract
    get metrics() {
        return this.metricsTracker.data;
    }

    get totalScoreEarned() {
        return this.metricsTracker.data.totalScoreEarned || 0;
    }

    get mouseX() {
        return this.input.pointerX;
    }

    togglePause() {
        if (this.state !== 'playing') return;

        if (this.paused) {
            this.paused = false;
            this.pausedElapsedMs += Date.now() - this.pauseStartMs;
            this.hud.setPaused(false);
            return;
        }

        if (this.pauseUsedThisGame) {
            this.hud.toast('⏸️ Pause already used this game');
            return;
        }

        this.paused = true;
        this.pauseUsedThisGame = true;
        this.pauseStartMs = Date.now();
        this.hud.setPaused(true);
        this.hud.setPauseUsed(true);
    }

    showToast(message) {
        this.hud.toast(message);
    }

    createStars() {
        const { CANVAS_WIDTH, CANVAS_HEIGHT } = CONFIG;
        const { STAR_COUNT, STAR_MIN_SPEED, STAR_MAX_SPEED } = CONFIG.VISUAL;

        this.stars = [];
        for (let i = 0; i < STAR_COUNT; i++) {
            this.stars.push({
                x: Math.random() * CANVAS_WIDTH,
                y: Math.random() * CANVAS_HEIGHT,
                speed: Math.random() * (STAR_MAX_SPEED - STAR_MIN_SPEED) + STAR_MIN_SPEED
            });
        }
    }

    startGame() {
        this.state = 'playing';
        this.resetGame();
        // Fresh proof-of-play session per game; resolves long before game over
        this.sessionTokenPromise = leaderboardAPI.startSession();
        this.hud.showMenu(false);
        this.hud.hideGameOver();

        if (!this.gameLoopRunning) {
            this.gameLoopRunning = true;
            this.lastFrameTime = 0;
            this.scheduleFrame();
        }
    }

    resetGame() {
        const { CANVAS_HEIGHT } = CONFIG;
        const { START_X, HEIGHT } = CONFIG.PLAYER;
        const { INITIAL_LIVES } = CONFIG.GAME;
        const { SPAWN_RATE, BASE_SPEED } = CONFIG.OBSTACLE;

        // One canonical entity/effect reset; only run-start fields are set here
        this.cleanup();

        this.score = 0;
        this.lastDisplayedScore = -1;
        this.lives = INITIAL_LIVES;
        this.level = 1;
        this.gameTime = 0;
        this.player.x = START_X;
        this.player.y = CANVAS_HEIGHT - HEIGHT;
        this.obstacleSpawnRate = SPAWN_RATE;
        this.obstacleSpeed = BASE_SPEED;
        this.gameOverCalled = false;
        this.scoreSubmitted = false;

        this.paused = false;
        this.pauseUsedThisGame = false;
        this.pausedElapsedMs = 0;
        this.hud.setPaused(false);
        this.hud.setPauseUsed(false);

        this.powerUpsCollectedThisGame = 0;
        this.bossAttackTypesDefeated = new Set();
        this.shieldSavedLife = false;
        this.lifeLostDuringBossLevel = false;
        this.livesLostInFirstLevel = 0;

        this.refreshHUD();
        this.hud.setHighScore(this.highScore);
        this.metricsTracker.startRun();
    }

    refreshHUD() {
        this.hud.renderStats({
            score: this.score,
            lives: this.lives,
            level: this.level,
            bossActive: Boolean(this.boss)
        });
        this.hud.renderPowerUps({
            hasShield: this.player.hasShield,
            shieldTimer: this.shieldTimer,
            slowDownActive: this.slowDownActive,
            slowDownTimer: this.slowDownTimer
        });
    }

    update(deltaTime) {
        if (this.state === 'gameOver') {
            // Let the death explosion and starfield play out behind the overlay
            this.updateExplosions(deltaTime);
            this.updateStars(deltaTime);
            return;
        }

        if (this.state !== 'playing') return;

        this.gameTime += deltaTime;
        this.updateScore();

        this.updatePlayer(deltaTime);
        this.updateInvincibility(deltaTime);
        this.updateScreenShake(deltaTime);
        this.updateLevelFlash(deltaTime);
        this.updateSlowDown(deltaTime);
        this.updateShield(deltaTime);
        this.updateObstacles(deltaTime);
        this.updateExplosions(deltaTime);
        this.updateStars(deltaTime);
        this.updatePowerUps(deltaTime);

        this.checkBossLevel();
        this.updateBoss(deltaTime);

        this.bossAttackManager.update(deltaTime);
        this.spawnObstacles(deltaTime);
        this.spawnPowerUps(deltaTime);
        this.checkCollisions();
        this.checkPowerUpCollisions();
        this.updateLevel();
    }

    updateScore() {
        const { SCORE_PER_SECOND } = CONFIG.GAME;

        this.score = Math.floor(this.gameTime * SCORE_PER_SECOND);
        // The displayed score only changes ~10x/sec; skip DOM writes and
        // achievement scans on the frames in between
        if (this.score !== this.lastDisplayedScore) {
            this.lastDisplayedScore = this.score;
            this.refreshHUD();
            this.achievementManager.checkAchievements();
        }
    }

    updatePlayer(deltaTime) {
        const { CANVAS_WIDTH } = CONFIG;
        const { MOUSE_FOLLOW_SPEED, WIDTH } = CONFIG.PLAYER;

        // Frame-rate-independent lerp: same convergence per second at any refresh rate
        const followFactor = 1 - Math.pow(1 - MOUSE_FOLLOW_SPEED, deltaTime * 60);
        this.player.x += (this.input.pointerX - this.player.x) * followFactor;
        this.player.x = Math.max(0, Math.min(CANVAS_WIDTH - WIDTH, this.player.x));
    }

    updateInvincibility(deltaTime) {
        if (this.player.invincible) {
            this.player.invincibilityTimer -= deltaTime;
            if (this.player.invincibilityTimer <= 0) {
                this.player.invincible = false;
                this.player.invincibilityTimer = 0;
            }
        }
    }

    updateScreenShake(deltaTime) {
        if (this.screenShake.duration > 0) {
            this.screenShake.duration -= deltaTime;

            if (this.screenShake.duration > 0) {
                this.screenShake.offsetX = (Math.random() - 0.5) * 2 * this.screenShake.intensity;
                this.screenShake.offsetY = (Math.random() - 0.5) * 2 * this.screenShake.intensity;
            } else {
                this.resetScreenShake();
            }
        }
    }

    resetScreenShake() {
        this.screenShake.intensity = 0;
        this.screenShake.duration = 0;
        this.screenShake.offsetX = 0;
        this.screenShake.offsetY = 0;
    }

    updateLevelFlash(deltaTime) {
        if (this.levelFlashTimer > 0) {
            this.levelFlashTimer -= deltaTime;
        }
    }

    updateSlowDown(deltaTime) {
        if (this.slowDownActive) {
            this.slowDownTimer -= deltaTime;
            if (this.slowDownTimer <= 0) {
                this.slowDownActive = false;
                this.slowDownTimer = 0;
            }
        }
    }

    updateShield(deltaTime) {
        if (this.player.hasShield) {
            this.shieldTimer -= deltaTime;
            if (this.shieldTimer <= 0) {
                this.player.hasShield = false;
                this.shieldTimer = 0;
            }
        }
    }

    triggerScreenShake() {
        const { SCREEN_SHAKE_INTENSITY, SCREEN_SHAKE_DURATION } = CONFIG.VISUAL;
        this.screenShake.intensity = SCREEN_SHAKE_INTENSITY;
        this.screenShake.duration = SCREEN_SHAKE_DURATION;
    }

    triggerLevelFlash() {
        const { LEVEL_FLASH_DURATION } = CONFIG.VISUAL;
        this.levelFlashTimer = LEVEL_FLASH_DURATION;
    }

    spawnObstacles(deltaTime) {
        // Spawn rate is expected obstacles per 1/60s frame; scale by the actual frame
        // time so difficulty is identical at 30, 60, or 144 Hz
        const modifier = this.bossAttackManager.getSpawnRateModifier();
        let expected = this.obstacleSpawnRate * modifier * deltaTime * 60;

        while (expected >= 1) {
            this.spawnObstacle();
            expected -= 1;
        }
        if (Math.random() < expected) {
            this.spawnObstacle();
        }
    }

    spawnObstacle() {
        const { CANVAS_WIDTH } = CONFIG;
        const { WIDTH, HEIGHT, COLOR, ASTEROID_CHANCE, SPEED_VARIANCE } = CONFIG.OBSTACLE;

        this.obstacles.push({
            x: Math.random() * (CANVAS_WIDTH - WIDTH),
            y: -HEIGHT,
            prevY: -HEIGHT,
            width: WIDTH,
            height: HEIGHT,
            speed: this.obstacleSpeed + Math.random() * SPEED_VARIANCE,
            color: COLOR,
            type: Math.random() < ASTEROID_CHANCE ? 'asteroid' : 'obstacle'
        });
    }

    updateObstacles(deltaTime) {
        const { CANVAS_HEIGHT } = CONFIG;
        const { GRAVITY_SPEED_MULTIPLIER } = CONFIG.BOSS_ATTACKS;
        const { SPEED_REDUCTION } = CONFIG.POWER_UPS.SLOW_DOWN;

        const speedMultiplier = this.slowDownActive ? 1.0 - SPEED_REDUCTION : 1.0;

        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const obstacle = this.obstacles[i];
            obstacle.prevY = obstacle.y;

            if (obstacle.gravityAffected) {
                obstacle.y += obstacle.speed * GRAVITY_SPEED_MULTIPLIER * speedMultiplier * deltaTime * 60;

                if (obstacle.gravityTimer !== undefined) {
                    obstacle.gravityTimer -= deltaTime;
                    if (obstacle.gravityTimer <= 0) {
                        obstacle.gravityAffected = false;
                        obstacle.gravityTimer = undefined;
                    }
                }
            } else {
                obstacle.y += obstacle.speed * speedMultiplier * deltaTime * 60;
            }

            // Keep an obstacle one frame past the bottom edge so the swept collision
            // test still sees the path it travelled through the player's row
            if (obstacle.y > CANVAS_HEIGHT && obstacle.prevY > CANVAS_HEIGHT) {
                this.obstacles.splice(i, 1);
            }
        }
    }

    spawnPowerUps(deltaTime) {
        const { CANVAS_WIDTH } = CONFIG;
        const { SPAWN_RATE, WIDTH, HEIGHT, FALL_SPEED } = CONFIG.POWER_UPS;

        // Not during boss fights, and only one on screen at a time
        if (this.boss) return;
        if (this.powerUps.length > 0) return;

        if (Math.random() < SPAWN_RATE * deltaTime * 60) {
            const types = ['shield', 'slowDown'];
            const type = types[Math.floor(Math.random() * types.length)];

            this.powerUps.push({
                x: Math.random() * (CANVAS_WIDTH - WIDTH),
                y: -HEIGHT,
                width: WIDTH,
                height: HEIGHT,
                type: type,
                rotation: 0,
                speed: FALL_SPEED
            });
        }
    }

    updatePowerUps(deltaTime) {
        const { CANVAS_HEIGHT } = CONFIG;
        const { ROTATION_SPEED } = CONFIG.POWER_UPS;

        for (let i = this.powerUps.length - 1; i >= 0; i--) {
            const powerUp = this.powerUps[i];
            powerUp.y += powerUp.speed * deltaTime * 60;
            powerUp.rotation += ROTATION_SPEED * deltaTime;

            if (powerUp.y > CANVAS_HEIGHT) {
                this.powerUps.splice(i, 1);
            }
        }
    }

    checkPowerUpCollisions() {
        for (let i = this.powerUps.length - 1; i >= 0; i--) {
            const powerUp = this.powerUps[i];

            if (intersects(this.player, powerUp)) {
                this.collectPowerUp(powerUp.type);
                this.powerUps.splice(i, 1);
            }
        }
    }

    collectPowerUp(type) {
        const { DURATION: SLOW_DOWN_DURATION } = CONFIG.POWER_UPS.SLOW_DOWN;
        const { DURATION: SHIELD_DURATION } = CONFIG.POWER_UPS.SHIELD;

        this.powerUpsCollectedThisGame++;

        if (type === 'shield') {
            this.player.hasShield = true;
            this.shieldTimer = SHIELD_DURATION;
        } else if (type === 'slowDown') {
            this.slowDownActive = true;
            this.slowDownTimer = SLOW_DOWN_DURATION;
        }

        this.achievementManager.checkAchievements();
    }

    updateExplosions(deltaTime) {
        const { EXPLOSION_GROWTH_RATE } = CONFIG.VISUAL;

        for (let i = this.explosions.length - 1; i >= 0; i--) {
            const explosion = this.explosions[i];
            explosion.life -= deltaTime * 60;
            explosion.size += EXPLOSION_GROWTH_RATE * deltaTime * 60;

            if (explosion.life <= 0) {
                this.explosions.splice(i, 1);
            }
        }
    }

    updateStars(deltaTime) {
        const { CANVAS_WIDTH, CANVAS_HEIGHT } = CONFIG;

        for (const star of this.stars) {
            star.y += star.speed * deltaTime * 60;
            if (star.y > CANVAS_HEIGHT) {
                star.y = 0;
                star.x = Math.random() * CANVAS_WIDTH;
            }
        }
    }

    checkCollisions() {
        if (this.player.invincible) return;

        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const obstacle = this.obstacles[i];

            if (intersects(this.player, sweptBounds(obstacle))) {
                const impact = centerOf(this.player);
                this.createExplosion(impact.x, impact.y);
                this.obstacles.splice(i, 1);
                this.triggerScreenShake();
                this.handleHit();
                // The i-frames from this hit absorb any other overlap this frame;
                // one visual impact must never drain more than one hit
                if (this.player.invincible || this.gameOverCalled) {
                    return;
                }
            }
        }

        if (this.bossAttackManager.checkPlayerCollision(this.player)) {
            const impact = centerOf(this.player);
            this.createExplosion(impact.x, impact.y);
            this.triggerScreenShake();
            this.handleHit();
        }
    }

    handleHit() {
        const { INVINCIBILITY_DURATION } = CONFIG.PLAYER;

        // Shield absorbs the hit and grants the same i-frames, so a persistent boss
        // zone can't consume the shield and a life on consecutive frames
        if (this.player.hasShield) {
            this.player.hasShield = false;
            this.shieldTimer = 0;
            this.player.invincible = true;
            this.player.invincibilityTimer = INVINCIBILITY_DURATION;
            if (this.lives === 1) {
                this.shieldSavedLife = true;
                this.achievementManager.checkAchievements();
            }
            return;
        }

        this.loseLife();
    }

    createExplosion(x, y) {
        const { EXPLOSION_INITIAL_SIZE, EXPLOSION_LIFE, EXPLOSION_COLOR } = CONFIG.VISUAL;

        this.explosions.push({
            x,
            y,
            size: EXPLOSION_INITIAL_SIZE,
            life: EXPLOSION_LIFE,
            color: EXPLOSION_COLOR
        });
    }

    loseLife() {
        const { INVINCIBILITY_DURATION } = CONFIG.PLAYER;

        if (this.boss) {
            this.lifeLostDuringBossLevel = true;
        }
        if (this.level === 1) {
            this.livesLostInFirstLevel++;
        }

        this.lives--;
        if (this.lives <= 0) {
            this.gameOver();
        } else {
            this.player.invincible = true;
            this.player.invincibilityTimer = INVINCIBILITY_DURATION;
        }
    }

    checkBossLevel() {
        const { BOSS_LEVEL_INTERVAL } = CONFIG.GAME;

        if (this.level % BOSS_LEVEL_INTERVAL === 0 && !this.boss && this.lastBossLevel !== this.level) {
            this.createBoss();
            this.lastBossLevel = this.level;
        }
    }

    createBoss() {
        const { X, Y, RADIUS, COLOR, ATTACK_COOLDOWN } = CONFIG.BOSS;

        this.lifeLostDuringBossLevel = false;

        this.boss = {
            x: X,
            y: Y,
            radius: RADIUS,
            color: COLOR,
            attackTimer: 0,
            attackCooldown: ATTACK_COOLDOWN,
            levelStartTime: this.gameTime
        };
    }

    updateBoss(deltaTime) {
        if (!this.boss) return;

        const { LEVEL_DURATION, ATTACK_WINDOW_END } = CONFIG.BOSS;

        if (this.gameTime - this.boss.levelStartTime >= LEVEL_DURATION) {
            // Boss survived; only credit the attack types if no life was lost
            if (!this.lifeLostDuringBossLevel) {
                this.bossAttackManager.getAttackTypesUsed().forEach(type => {
                    this.bossAttackTypesDefeated.add(type);
                });
            }
            this.achievementManager.checkAchievements();

            this.boss = null;
            this.bossAttackManager.reset();
            this.clearGravityEffects();
            return;
        }

        this.bossAttackManager.handleGravityAttack(this.boss.levelStartTime, this.gameTime);

        if (this.gameTime - this.boss.levelStartTime >= ATTACK_WINDOW_END) {
            return;
        }

        this.boss.attackTimer += deltaTime;

        if (this.boss.attackTimer >= this.boss.attackCooldown && this.bossAttackManager.isIdle()) {
            this.bossAttackManager.bossAttack();
            this.boss.attackTimer = 0;
        }
    }

    clearGravityEffects() {
        for (const obstacle of this.obstacles) {
            obstacle.gravityAffected = false;
        }
    }

    updateLevel() {
        const { LEVEL_DURATION, SPAWN_RATE_INCREASE, SPEED_INCREASE, MAX_SPAWN_RATE, MAX_SPEED } = CONFIG.GAME;

        const newLevel = Math.floor(this.gameTime / LEVEL_DURATION) + 1;
        if (newLevel > this.level) {
            this.level = newLevel;
            // Cap spawn rate and speed to prevent kill screen
            this.obstacleSpawnRate = Math.min(this.obstacleSpawnRate + SPAWN_RATE_INCREASE, MAX_SPAWN_RATE);
            this.obstacleSpeed = Math.min(this.obstacleSpeed + SPEED_INCREASE, MAX_SPEED);
            this.triggerLevelFlash();
        }
    }

    gameOver() {
        if (this.gameOverCalled) {
            return;
        }
        this.gameOverCalled = true;

        // Keep the loop alive: update() now only animates the death explosion and
        // starfield in this state, and entities stay frozen where they were
        this.state = 'gameOver';

        const { SCORE_PER_SECOND } = CONFIG.GAME;
        this.score = Math.floor(this.gameTime * SCORE_PER_SECOND);
        this.updateGameMetrics();

        if (this.score > 0 && this.score % 100 === 0) {
            this.achievementManager.unlockAchievement('perfect_run');
        }

        const isNewHighScore = this.score > this.highScore;
        if (isNewHighScore) {
            this.highScore = this.score;
            StorageManager.saveHighScore(this.highScore);
        }

        this.hud.setHighScore(this.highScore);

        // Show the death screen immediately; the leaderboard submit runs in the
        // background and must never gate the UI on a network round-trip
        this.hud.showGameOver({ score: this.score, level: this.level, isNewHighScore });
        this.prepareLeaderboardSubmission();
    }

    prepareLeaderboardSubmission() {
        const playerName = StorageManager.loadPlayerName();

        if (playerName) {
            this.leaderboardUI.showNameForm(false);
            this.leaderboardUI.setRankLine(`Playing as ${playerName} — submitting score…`);
            this.submitScoreToLeaderboard(playerName);
        } else {
            // First submission: ask for a name inline instead of a blocking prompt.
            // Skipping (restarting without submitting) just skips this game's entry.
            this.leaderboardUI.setRankLine('');
            this.leaderboardUI.showNameForm(true);
        }
    }

    saveNameAndSubmit(name) {
        StorageManager.savePlayerName(name);
        this.leaderboardUI.showNameForm(false);
        this.leaderboardUI.setRankLine(`Playing as ${name} — submitting score…`);
        this.submitScoreToLeaderboard(name);
    }

    cleanup() {
        this.obstacles = [];
        this.explosions = [];
        this.powerUps = [];
        this.boss = null;
        this.bossAttackManager.reset();
        this.lastBossLevel = 0;
        this.player.invincible = false;
        this.player.invincibilityTimer = 0;
        this.player.hasShield = false;
        this.shieldTimer = 0;
        this.slowDownActive = false;
        this.slowDownTimer = 0;
        this.resetScreenShake();
        this.levelFlashTimer = 0;
    }

    updateGameMetrics() {
        this.metricsTracker.completeRun({
            score: this.score,
            level: this.level,
            pausedMs: this.pausedElapsedMs
        });
        this.achievementManager.checkAchievements();
    }

    updateAllHighScoreDisplays() {
        this.hud.setHighScore(this.highScore);
    }

    resetCache() {
        if (this.state === 'playing') {
            this.gameLoopRunning = false;
            this.state = 'menu';
        }

        this.cleanup();

        StorageManager.resetCache();

        this.highScore = 0;
        this.metricsTracker.reset();
        this.achievements = StorageManager.loadAchievements();
        // The old identity was just cleared; mint a fresh one so this browser
        // still has one rather than silently falling back to name matching
        this.playerId = StorageManager.ensurePlayerId();

        // Clear per-game trackers too, or the checkAchievements() call below would
        // instantly re-unlock achievements from the last game's state
        this.score = 0;
        this.lastDisplayedScore = -1;
        this.gameTime = 0;
        this.level = 1;
        this.lives = CONFIG.GAME.INITIAL_LIVES;
        this.powerUpsCollectedThisGame = 0;
        this.bossAttackTypesDefeated = new Set();
        this.shieldSavedLife = false;
        this.lifeLostDuringBossLevel = false;
        this.livesLostInFirstLevel = 0;

        this.hud.setHighScore(this.highScore);
        this.updateMenuMetrics();

        return true;
    }

    async updateMenuMetrics() {
        this.hud.renderMenuStats(this.metricsTracker.data);

        this.achievementManager.checkAchievements();
        this.achievementManager.updateAchievementsDisplay();
        await this.refreshLeaderboardViews();
    }

    // Both requests go out together, but the board is rendered after the
    // personal best resolves: knowing which run is yours is what lets the row
    // be highlighted by identity instead of by a display name anyone can take.
    async refreshLeaderboardViews() {
        const playerName = StorageManager.loadPlayerName();

        // The host sleeps when idle and takes tens of seconds to come back, so
        // say so rather than leaving the panel blank for the whole restart
        if (!leaderboardAPI.warmed) {
            this.leaderboardUI.showBoardMessage(
                'Global Leaderboard',
                'Waking the server up, this can take up to a minute…'
            );
        }

        const [board, best] = await Promise.all([
            leaderboardAPI.getLeaderboard().catch(() => ({ success: false })),
            this.fetchPersonalBest(playerName)
        ]);

        if (best) {
            this.leaderboardUI.renderPersonalBest({
                playerName: best.score.playerName || playerName,
                score: best.score.score,
                level: best.score.level,
                timestamp: best.score.timestamp,
                rank: best.rank
            });
        } else {
            this.leaderboardUI.hidePersonalBest();
        }

        if (board.success) {
            this.leaderboardUI.renderBoard(board.leaderboard, best ? best.score : null);
        } else {
            this.leaderboardUI.showBoardMessage('Global Leaderboard', 'Leaderboard unavailable');
        }
    }

    // The visible board stops at the top 100, so this is the only place a
    // player outside it can see where they actually stand
    async fetchPersonalBest(playerName) {
        if (!this.playerId && !playerName) return null;

        const result = await leaderboardAPI.getPlayerBest(this.playerId, playerName);
        return result.success && result.score ? result : null;
    }

    async submitScoreToLeaderboard(playerName) {
        // The session token is spent by the first accepted submission, so a
        // second attempt for the same game would come back 409 and replace a
        // good rank with an error
        if (this.scoreSubmitted) return;
        this.scoreSubmitted = true;

        // A quick restart can start a newer submission; only the latest may
        // write to the rank line
        const seq = ++this.submissionSeq;
        try {
            const sessionToken = this.sessionTokenPromise ? await this.sessionTokenPromise : null;
            const result = await leaderboardAPI.submitScore(
                playerName, this.score, this.level, sessionToken, this.playerId
            );

            if (result.success) {
                if (result.rank && result.rank <= CONFIG.API.LEADERBOARD_LIMIT) {
                    this.achievementManager.unlockAchievement('leaderboard_ranked');
                }
                if (result.rank === 1) {
                    this.achievementManager.unlockAchievement('leaderboard_top1');
                }
            }

            if (seq === this.submissionSeq) {
                this.leaderboardUI.setRankLine(
                    result.success && result.rank
                        ? `Playing as ${playerName} — Global Rank: #${result.rank}`
                        : `Playing as ${playerName} — leaderboard unavailable`
                );
            }
        } catch (error) {}
    }

    // Kept as a thin alias: refreshLeaderboardViews needs the personal best to
    // know which row is yours, so the two are fetched together
    async loadLeaderboard() {
        await this.refreshLeaderboardViews();
    }

    scheduleFrame() {
        // At most one pending animation frame, so restarts can never stack loops
        if (this.rafScheduled) return;
        this.rafScheduled = true;
        requestAnimationFrame(this.boundGameLoop);
    }

    gameLoop(currentTime) {
        this.rafScheduled = false;
        if (!this.gameLoopRunning) return;

        const now = currentTime ?? performance.now();

        if (this.lastFrameTime === 0) {
            this.lastFrameTime = now;
            this.scheduleFrame();
            return;
        }

        const deltaTime = (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;

        // While paused the world is frozen: gameTime stops, so score, boss timers,
        // and power-up countdowns all resume exactly where they left off
        if (this.paused) {
            this.scheduleFrame();
            return;
        }

        // Cap deltaTime to prevent large jumps; skip bogus frames
        const clampedDeltaTime = Math.min(Math.max(deltaTime, 0), 1 / 30);
        if (!(clampedDeltaTime > 0)) {
            this.scheduleFrame();
            return;
        }

        this.update(clampedDeltaTime);
        this.renderer.render();

        // Once the death explosion has faded there is nothing left to animate
        // behind the game-over overlay, so stop burning frames. startGame()
        // sees gameLoopRunning is false and restarts the loop.
        if (this.state === 'gameOver' && this.explosions.length === 0) {
            this.gameLoopRunning = false;
            return;
        }

        this.scheduleFrame();
    }
}

export { SpaceDodger };

// Exported for menu.js
export let game;

export function startGame() {
    if (!game) return;
    game.startGame();
}

export function restartGame() {
    if (!game) return;
    game.startGame();
}

export function returnToMenu() {
    if (!game) return;
    game.hud.hideGameOver();
    game.hud.showMenu(true);
    game.state = 'menu';
    game.gameLoopRunning = false;
    game.cleanup();
    game.hud.setHighScore(game.highScore);
    game.updateMenuMetrics();
}

export function resetCache() {
    if (!game) return;
    game.resetCache();
    game.hud.toast('🧹 Local data cleared');
}

export function createGame() {
    game = new SpaceDodger();
    return game;
}

// Initialize as soon as the DOM is ready. menu.js binds its click handlers at
// the same event, and this module's listener registers first.
document.addEventListener('DOMContentLoaded', () => {
    createGame();
});
