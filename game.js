// Main game logic
import { CONFIG } from './config.js';
import { BossAttackManager } from './boss-attacks.js';
import { leaderboardAPI } from './api.js';
import { StorageManager } from './storage.js';
import { AchievementManager } from './achievements.js';
import { Renderer } from './rendering.js';

class SpaceDodger {
    constructor() {
        const { CANVAS_WIDTH, CANVAS_HEIGHT } = CONFIG;
        const { START_X, WIDTH, HEIGHT, COLOR } = CONFIG.PLAYER;
        const { INITIAL_LIVES } = CONFIG.GAME;

        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.state = 'menu';
        this.gameLoopRunning = false;
        this.lastFrameTime = 0;
        this.rafScheduled = false;
        this.boundGameLoop = this.gameLoop.bind(this);

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

        // Initialize managers
        this.achievementManager = new AchievementManager(this);
        this.renderer = new Renderer(this);

        // Visual effects
        this.screenShake = {
            intensity: 0,
            duration: 0,
            offsetX: 0,
            offsetY: 0
        };
        this.levelFlashTimer = 0;

        this.mouseX = START_X;

        this.score = 0;
        this.lastDisplayedScore = -1;
        this.lastPowerUpStatusHTML = '';
        this.lives = INITIAL_LIVES;
        this.level = 1;
        this.gameTime = 0;
        this.highScore = StorageManager.loadHighScore();
        this.gameOverCalled = false;

        this.metrics = StorageManager.loadMetrics();
        this.achievements = StorageManager.loadAchievements();

        // Game state tracking for achievements
        this.powerUpsCollectedThisGame = 0;
        this.bossAttackTypesDefeated = new Set(); // Track boss attack types defeated
        this.shieldSavedLife = false;
        this.totalScoreEarned = this.metrics.totalScoreEarned || 0;
        this.lifeLostDuringBossLevel = false; // Track if life was lost during current boss level

        this.setupEventListeners();
        this.createStars();
        this.updateAllHighScoreDisplays();
        this.updateMenuMetrics();
    }

    setupEventListeners() {
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            // The canvas can be CSS-scaled down on small screens; map back to canvas coordinates
            this.mouseX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
        });
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
        document.getElementById('mainMenu').classList.add('hidden');
        document.getElementById('gameOver').classList.add('hidden');

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

        // Reset achievement tracking for this game
        this.powerUpsCollectedThisGame = 0;
        this.bossAttackTypesDefeated = new Set();
        this.shieldSavedLife = false;
        this.lifeLostDuringBossLevel = false;

        this.updateHUD();
        this.metrics.currentGameStartTime = Date.now();
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
            this.updateHUD();
            this.achievementManager.checkAchievements();
        }
    }

    updatePlayer(deltaTime) {
        const { CANVAS_WIDTH } = CONFIG;
        const { MOUSE_FOLLOW_SPEED, WIDTH } = CONFIG.PLAYER;

        // Frame-rate-independent lerp: same convergence per second at any refresh rate
        const followFactor = 1 - Math.pow(1 - MOUSE_FOLLOW_SPEED, deltaTime * 60);
        this.player.x += (this.mouseX - this.player.x) * followFactor;
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
                // Random shake offset
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

        // Calculate speed multiplier for slow-down effect
        let speedMultiplier = 1.0;
        if (this.slowDownActive) {
            speedMultiplier = 1.0 - SPEED_REDUCTION;
        }

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

        // Don't spawn power-ups during boss fights
        if (this.boss) return;

        // Only spawn if no power-up is currently on screen
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

            if (this.checkCollision(this.player, powerUp)) {
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

            // Swept test: cover the whole path travelled this frame so fast
            // obstacles (especially under the gravity attack) can't tunnel through
            const sweptTop = Math.min(obstacle.prevY, obstacle.y);
            const swept = {
                x: obstacle.x,
                y: sweptTop,
                width: obstacle.width,
                height: obstacle.y + obstacle.height - sweptTop
            };

            if (this.checkCollision(this.player, swept)) {
                this.createExplosion(this.player.x + this.player.width / 2, this.player.y + this.player.height / 2);
                this.obstacles.splice(i, 1);
                this.triggerScreenShake();
                this.handleHit();
                // The i-frames from this hit absorb any other overlap this frame —
                // one visual impact must never drain more than one hit
                if (this.player.invincible || this.gameOverCalled) {
                    return;
                }
            }
        }

        if (this.bossAttackManager.checkPlayerCollision(this.player)) {
            this.createExplosion(this.player.x + this.player.width / 2, this.player.y + this.player.height / 2);
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
            // Track if shield saved life at 1 life for achievement
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

        this.lives--;
        if (this.lives <= 0) {
            this.gameOver();
        } else {
            this.player.invincible = true;
            this.player.invincibilityTimer = INVINCIBILITY_DURATION;
        }
    }

    checkCollision(obj1, obj2) {
        return obj1.x < obj2.x + obj2.width &&
               obj1.x + obj1.width > obj2.x &&
               obj1.y < obj2.y + obj2.height &&
               obj1.y + obj1.height > obj2.y;
    }

    checkBossLevel() {
        const { BOSS_LEVEL_INTERVAL } = CONFIG.GAME;

        // Only create boss if:
        // 1. It's a boss level (level % 4 === 0)
        // 2. No boss currently exists
        // 3. A boss haven't been spawned for this level
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
            // Boss defeated, only track attack types if no life was lost
            if (!this.lifeLostDuringBossLevel) {
                const attackTypes = this.bossAttackManager.getAttackTypesUsed();
                attackTypes.forEach(type => {
                    this.bossAttackTypesDefeated.add(type);
                });
            }
            // Check achievements
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

    updateHUD() {
        document.getElementById('score').textContent = this.score;
        document.getElementById('lives').textContent = this.lives;

        if (this.boss) {
            document.getElementById('level').textContent = `${this.level} - BOSS!`;
        } else {
            document.getElementById('level').textContent = this.level;
        }

        const highScoreElement = document.getElementById('highScore');
        if (highScoreElement) {
            highScoreElement.textContent = this.highScore.toLocaleString();
        }

        // Update power-up status
        const powerUpStatus = document.getElementById('powerUpStatus');
        if (powerUpStatus) {
            const statuses = [];

            if (this.player.hasShield) {
                const timeLeft = Math.ceil(this.shieldTimer);
                statuses.push(`<span style="color: #00ffff;">🛡️ Shield (${timeLeft}s)</span>`);
            }

            if (this.slowDownActive) {
                const timeLeft = Math.ceil(this.slowDownTimer);
                statuses.push(`<span style="color: #ffff00;">⏱️ Slow Down (${timeLeft}s)</span>`);
            }

            const html = statuses.join(' | ');
            if (html !== this.lastPowerUpStatusHTML) {
                this.lastPowerUpStatusHTML = html;
                powerUpStatus.innerHTML = html;
            }
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

        // Check Perfect Run achievement
        if (this.score > 0 && this.score % 100 === 0) {
            this.achievementManager.unlockAchievement('perfect_run');
        }

        const isNewHighScore = this.score > this.highScore;
        if (isNewHighScore) {
            this.highScore = this.score;
            StorageManager.saveHighScore(this.highScore);
        }

        document.getElementById('finalScore').textContent = this.score.toLocaleString();
        document.getElementById('finalLevel').textContent = this.level;

        const newHighScoreBanner = document.getElementById('newHighScore');
        if (newHighScoreBanner) {
            newHighScoreBanner.classList.toggle('hidden', !isNewHighScore);
        }

        this.updateAllHighScoreDisplays();

        // Show the death screen immediately; the leaderboard submit runs in the
        // background and must never gate the UI on a network round-trip
        document.getElementById('gameOver').classList.remove('hidden');
        this.submitScoreToLeaderboard();
    }

    cleanup() {
        // Clear all game objects
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
        const gameDuration = Date.now() - this.metrics.currentGameStartTime;
        this.metrics.totalGamesPlayed++;
        this.metrics.totalPlayTime += gameDuration;
        this.metrics.averageScore = (this.metrics.averageScore * (this.metrics.totalGamesPlayed - 1) + this.score) / this.metrics.totalGamesPlayed;
        this.metrics.averageLevel = (this.metrics.averageLevel * (this.metrics.totalGamesPlayed - 1) + this.level) / this.metrics.totalGamesPlayed;

        // Update total score earned
        this.totalScoreEarned += this.score;
        this.metrics.totalScoreEarned = this.totalScoreEarned;

        this.achievementManager.checkAchievements();

        StorageManager.saveMetrics(this.metrics);
    }

    updateAllHighScoreDisplays() {
        const elements = ['menuHighScore', 'highScore', 'gameOverHighScore', 'prominentHighScore'];
        elements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = this.highScore.toLocaleString();
            }
        });
    }

    resetCache() {
        if (this.state === 'playing') {
            this.gameLoopRunning = false;
            this.state = 'menu';
        }

        this.cleanup();

        StorageManager.resetCache();

        this.highScore = 0;
        this.metrics = StorageManager.loadMetrics();
        this.achievements = StorageManager.loadAchievements();
        this.totalScoreEarned = 0;

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

        this.updateAllHighScoreDisplays();
        this.updateMenuMetrics();

        return true;
    }

    async updateMenuMetrics() {
        const elements = {
            'gamesPlayed': this.metrics.totalGamesPlayed,
            'avgScore': Math.round(this.metrics.averageScore),
            'avgLevel': Math.round(this.metrics.averageLevel),
            'totalTime': Math.round(this.metrics.totalPlayTime / 60000)
        };

        Object.keys(elements).forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = elements[id];
            }
        });

        this.achievementManager.checkAchievements();
        this.achievementManager.updateAchievementsDisplay();
        await this.loadLeaderboard();
    }

    getPlayerName() {
        let playerName = StorageManager.loadPlayerName();

        if (!playerName) {
            const input = prompt('Enter your name for the leaderboard (max 20 characters):', 'Player');
            playerName = (input || '').trim().substring(0, 20) || 'Anonymous';
            // Persist even the fallback, so a cancelled prompt never re-fires on
            // every subsequent game over
            StorageManager.savePlayerName(playerName);
        }

        return playerName;
    }

    async submitScoreToLeaderboard() {
        try {
            const playerName = this.getPlayerName();
            const result = await leaderboardAPI.submitScore(playerName, this.score, this.level);

            if (result.success) {
                // "Get a Result on Global Leaderboard" means placing on the visible board
                if (result.rank && result.rank <= CONFIG.API.LEADERBOARD_LIMIT) {
                    this.achievementManager.unlockAchievement('leaderboard_ranked');
                }
                if (result.rank === 1) {
                    this.achievementManager.unlockAchievement('leaderboard_top1');
                }
            }
        } catch (error) {}
    }

    async loadLeaderboard() {
        const leaderboardElement = document.getElementById('leaderboard');
        if (!leaderboardElement) return;

        try {
            const result = await leaderboardAPI.getLeaderboard();

            if (result.success) {
                if (result.leaderboard && result.leaderboard.length > 0) {
                    leaderboardElement.innerHTML = '<h3>Global Leaderboard (Top 100)</h3>';
                    const list = document.createElement('div');
                    list.style.cssText = 'text-align: left; max-width: 500px; margin: 10px auto; padding-left: 30px; max-height: 400px; overflow-y: auto;';

                    result.leaderboard.forEach((entry, index) => {
                        const item = document.createElement('div');
                        item.style.marginBottom = '5px';

                        // Server data is rendered as text nodes only — a stored player
                        // name must never reach innerHTML
                        const name = document.createElement('strong');
                        name.textContent = entry.playerName;

                        const date = document.createElement('span');
                        date.style.cssText = 'color: #888; font-size: 0.9em;';
                        date.textContent = new Date(entry.timestamp).toLocaleDateString();

                        item.append(
                            `${index + 1}. `,
                            name,
                            ` - ${Number(entry.score).toLocaleString()} pts (Level ${entry.level}) `,
                            date
                        );
                        list.appendChild(item);
                    });

                    leaderboardElement.appendChild(list);
                } else {
                    leaderboardElement.innerHTML = '<h3>Global Leaderboard</h3><p style="color: #888;">No scores yet. Be the first!</p>';
                }
            } else {
                leaderboardElement.innerHTML = `<h3>Global Leaderboard</h3><p style="color: #888;">Leaderboard unavailable</p>`;
            }
        } catch (error) {
            leaderboardElement.innerHTML = `<h3>Global Leaderboard</h3><p style="color: #888;">Failed to load leaderboard</p>`;
        }
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

        // Handle first frame
        if (this.lastFrameTime === 0) {
            this.lastFrameTime = now;
            this.scheduleFrame();
            return;
        }

        const deltaTime = (now - this.lastFrameTime) / 1000; // Convert to seconds
        this.lastFrameTime = now;

        // Cap deltaTime to prevent large jumps; skip bogus frames
        const clampedDeltaTime = Math.min(Math.max(deltaTime, 0), 1 / 30);
        if (!(clampedDeltaTime > 0)) {
            this.scheduleFrame();
            return;
        }

        this.update(clampedDeltaTime);
        this.renderer.render();

        this.scheduleFrame();
    }
}

// Export functions for menu.js
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
    document.getElementById('gameOver').classList.add('hidden');
    document.getElementById('mainMenu').classList.remove('hidden');
    game.state = 'menu';
    game.gameLoopRunning = false;
    game.cleanup();
    game.updateAllHighScoreDisplays();
    game.updateMenuMetrics();
}

export function resetCache() {
    if (game && game.resetCache) {
        if (confirm('Are you sure you want to reset all local cache? This will clear:\n- High Score\n- Statistics\n- Achievements\n- Player Name\n\nThe leaderboard will remain intact.')) {
            game.resetCache();
            alert('Cache reset successfully!');
        }
    }
}

// Initialize game as soon as the DOM is ready — menu.js binds its click handlers
// at the same event, and this module's listener registers first
document.addEventListener('DOMContentLoaded', () => {
    game = new SpaceDodger();
});
