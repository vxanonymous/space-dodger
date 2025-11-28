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
        const { START_X, START_Y, WIDTH, HEIGHT, SPEED, COLOR } = CONFIG.PLAYER;
        const { INITIAL_LIVES } = CONFIG.GAME;
        
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.state = 'menu';
        this.gameLoopRunning = false;
        this.lastFrameTime = 0;
        
        this.player = {
            x: START_X,
            y: START_Y,
            width: WIDTH,
            height: HEIGHT,
            speed: SPEED,
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
        this.mouseY = CANVAS_HEIGHT / 2;
        
        this.score = 0;
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
        this.updateMenuHighScore();
        this.updateMenuMetrics();
        this.achievementManager.updateAchievementsDisplay();
    }
    
    setupEventListeners() {
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.mouseX = e.clientX - rect.left;
            this.mouseY = e.clientY - rect.top;
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
        this.gameLoopRunning = true;
        this.resetGame();
        this.lastFrameTime = performance.now();
        this.gameLoop();
        document.getElementById('mainMenu').classList.add('hidden');
    }
    
    resetGame() {
        const { START_X, START_Y } = CONFIG.PLAYER;
        const { INITIAL_LIVES } = CONFIG.GAME;
        const { SPAWN_RATE, BASE_SPEED } = CONFIG.OBSTACLE;
        
        this.score = 0;
        this.lives = INITIAL_LIVES;
        this.level = 1;
        this.gameTime = 0;
        this.player.x = START_X;
        this.player.y = START_Y;
        this.player.invincible = false;
        this.player.invincibilityTimer = 0;
        this.player.hasShield = false;
        this.obstacles = [];
        this.explosions = [];
        this.powerUps = [];
        this.boss = null;
        this.bossAttackManager.reset();
        this.lastBossLevel = 0;
        this.obstacleSpawnRate = SPAWN_RATE;
        this.obstacleSpeed = BASE_SPEED;
        this.slowDownActive = false;
        this.slowDownTimer = 0;
        this.gameOverCalled = false;
        this.screenShake.intensity = 0;
        this.screenShake.duration = 0;
        this.levelFlashTimer = 0;
        
        // Reset achievement tracking for this game
        this.powerUpsCollectedThisGame = 0;
        this.bossAttackTypesDefeated = new Set();
        this.shieldSavedLife = false;
        this.lifeLostDuringBossLevel = false;
        
        this.updateHUD();
        this.metrics.currentGameStartTime = Date.now();
    }
    
    update(deltaTime) {
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
        this.spawnObstacles();
        this.spawnPowerUps();
        this.checkCollisions();
        this.checkPowerUpCollisions();
        this.updateLevel();
    }
    
    updateScore() {
        const { SCORE_PER_SECOND } = CONFIG.GAME;
        // Ensure gameTime is a valid number
        if (isNaN(this.gameTime) || !isFinite(this.gameTime)) {
            this.gameTime = 0;
        }
        this.score = Math.floor(this.gameTime * SCORE_PER_SECOND);
        // Ensure score is a valid number
        if (isNaN(this.score) || !isFinite(this.score)) {
            this.score = 0;
        }
        this.updateHUD();
        // Check score-based achievements
        this.achievementManager.checkAchievements();
    }
    
    updatePlayer(deltaTime) {
        const { CANVAS_WIDTH, CANVAS_HEIGHT } = CONFIG;
        const { MOUSE_FOLLOW_SPEED, WIDTH, HEIGHT } = CONFIG.PLAYER;
        
        this.player.x += (this.mouseX - this.player.x) * MOUSE_FOLLOW_SPEED;
        this.player.x = Math.max(0, Math.min(CANVAS_WIDTH - WIDTH, this.player.x));
        this.player.y = CANVAS_HEIGHT - HEIGHT;
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
        const { SCREEN_SHAKE_INTENSITY } = CONFIG.VISUAL;
        
        if (this.screenShake.duration > 0) {
            this.screenShake.duration -= deltaTime;
            
            if (this.screenShake.duration > 0) {
                // Random shake offset
                this.screenShake.offsetX = (Math.random() - 0.5) * 2 * this.screenShake.intensity;
                this.screenShake.offsetY = (Math.random() - 0.5) * 2 * this.screenShake.intensity;
            } else {
                this.screenShake.offsetX = 0;
                this.screenShake.offsetY = 0;
                this.screenShake.intensity = 0;
            }
        }
    }
    
    updateLevelFlash(deltaTime) {
        if (this.levelFlashTimer > 0) {
            this.levelFlashTimer -= deltaTime;
        }
    }
    
    updateSlowDown(deltaTime) {
        const { DURATION } = CONFIG.POWER_UPS.SLOW_DOWN;
        
        if (this.slowDownActive) {
            this.slowDownTimer -= deltaTime;
            if (this.slowDownTimer <= 0) {
                this.slowDownActive = false;
                this.slowDownTimer = 0;
            }
        }
    }
    
    updateShield(deltaTime) {
        const { DURATION } = CONFIG.POWER_UPS.SHIELD;
        
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
    
    spawnObstacles() {
        const { CANVAS_WIDTH } = CONFIG;
        const { WIDTH, HEIGHT, COLOR, ASTEROID_CHANCE, SPEED_VARIANCE } = CONFIG.OBSTACLE;
        
        let spawnRate = this.obstacleSpawnRate;
        spawnRate *= this.bossAttackManager.getSpawnRateModifier();
        
        if (Math.random() < spawnRate) {
            this.obstacles.push({
                x: Math.random() * (CANVAS_WIDTH - WIDTH),
                y: -HEIGHT,
                width: WIDTH,
                height: HEIGHT,
                speed: this.obstacleSpeed + Math.random() * SPEED_VARIANCE,
                color: COLOR,
                type: Math.random() < ASTEROID_CHANCE ? 'asteroid' : 'obstacle'
            });
        }
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
            
            if (obstacle.type === 'giant_obstacle') {
                obstacle.centerY = obstacle.y + obstacle.radius;
            }
            
            if (obstacle.y > CANVAS_HEIGHT) {
                this.obstacles.splice(i, 1);
            }
        }
    }
    
    spawnPowerUps() {
        const { CANVAS_WIDTH } = CONFIG;
        const { SPAWN_RATE, WIDTH, HEIGHT } = CONFIG.POWER_UPS;
        
        // Don't spawn power-ups during boss fights
        if (this.boss) return;
        
        // Only spawn if no power-up is currently on screen
        if (this.powerUps.length > 0) return;
        
        if (Math.random() < SPAWN_RATE) {
            const types = ['shield', 'slowDown'];
            const type = types[Math.floor(Math.random() * types.length)];
            
            this.powerUps.push({
                x: Math.random() * (CANVAS_WIDTH - WIDTH),
                y: -HEIGHT,
                width: WIDTH,
                height: HEIGHT,
                type: type,
                rotation: 0,
                speed: CONFIG.POWER_UPS.FALL_SPEED
            });
        }
    }
    
    updatePowerUps(deltaTime) {
        const { CANVAS_HEIGHT } = CONFIG;
        const { ROTATION_SPEED, FALL_SPEED } = CONFIG.POWER_UPS;
        
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
        const { EXPLOSION_GROWTH_RATE, EXPLOSION_LIFE } = CONFIG.VISUAL;
        
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
            
            if (!obstacle || !obstacle.type) {
                this.obstacles.splice(i, 1);
                continue;
            }
            
            let collision = false;
            
            if (obstacle.type === 'giant_obstacle') {
                const dx = (this.player.x + this.player.width / 2) - obstacle.centerX;
                const dy = (this.player.y + this.player.height / 2) - obstacle.centerY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                collision = distance < obstacle.radius;
            } else {
                collision = this.checkCollision(this.player, obstacle);
            }
            
            if (collision) {
                this.createExplosion(this.player.x + this.player.width / 2, this.player.y + this.player.height / 2);
                this.obstacles.splice(i, 1);
                this.triggerScreenShake();
                this.handleHit();
            }
        }
        
        if (this.bossAttackManager.checkPlayerCollision(this.player)) {
            this.createExplosion(this.player.x + this.player.width / 2, this.player.y + this.player.height / 2);
            this.triggerScreenShake();
            this.handleHit();
        }
    }
    
    handleHit() {
        // Shield absorbs the hit
        if (this.player.hasShield) {
            this.player.hasShield = false;
            this.shieldTimer = 0;
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
            highScoreElement.textContent = this.highScore;
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
            
            powerUpStatus.innerHTML = statuses.length > 0 ? statuses.join(' | ') : '';
        }
    }
    
    async gameOver() {
        if (this.gameOverCalled) {
            return;
        }
        this.gameOverCalled = true;
        
        this.state = 'gameOver';
        this.gameLoopRunning = false;
        
        // Clean up game state
        this.cleanup();
        
        const { SCORE_PER_SECOND } = CONFIG.GAME;
        this.score = Math.floor(this.gameTime * SCORE_PER_SECOND);
        this.updateGameMetrics();
        
        // Check Perfect Run achievement
        if (this.score > 0 && this.score % 100 === 0 && !this.achievements.perfect_run) {
            this.achievementManager.unlockAchievement('perfect_run', 'Perfect Run (Score divisible by 100)');
        }
        
        if (this.score > this.highScore) {
            const oldHighScore = this.highScore;
            this.highScore = this.score;
            StorageManager.saveHighScore(this.highScore);
            alert(`🎉 NEW HIGH SCORE! 🎉\nScore: ${this.score}\nPrevious: ${oldHighScore}`);
        }
        
        // Submit score to leaderboard
        await this.submitScoreToLeaderboard();
        
        document.getElementById('finalScore').textContent = this.score;
        document.getElementById('finalLevel').textContent = this.level;
        
        this.updateAllHighScoreDisplays();
        
        const gameOverHighScore = document.getElementById('gameOverHighScore');
        if (gameOverHighScore) {
            gameOverHighScore.textContent = this.highScore;
        }
        
        document.getElementById('gameOver').classList.remove('hidden');
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
        this.screenShake.intensity = 0;
        this.screenShake.duration = 0;
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
    
    
    updateMenuHighScore() {
        const menuHighScoreElement = document.getElementById('menuHighScore');
        if (menuHighScoreElement) {
            menuHighScoreElement.textContent = this.highScore.toLocaleString();
        }
        const prominentHighScoreElement = document.getElementById('prominentHighScore');
        if (prominentHighScoreElement) {
            prominentHighScoreElement.textContent = this.highScore.toLocaleString();
        }
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
        const { HIGH_SCORE, METRICS, PLAYER_NAME, ACHIEVEMENTS } = CONFIG.STORAGE;
        if (this.state === 'playing') {
            this.gameLoopRunning = false;
            this.state = 'menu';
        }
        
        this.obstacles = [];
        this.powerUps = [];
        this.explosions = [];
        
        StorageManager.resetCache();
        
        this.highScore = 0;
        this.metrics = StorageManager.loadMetrics();
        this.achievements = StorageManager.loadAchievements();
        this.totalScoreEarned = 0;
        
        this.updateAllHighScoreDisplays();
        this.updateMenuMetrics();
        this.achievementManager.updateAchievementsDisplay();
        
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
        const { PLAYER_NAME } = CONFIG.STORAGE;
        let playerName = localStorage.getItem(PLAYER_NAME);
        
        if (!playerName) {
            playerName = prompt('Enter your name for the leaderboard (max 20 characters):', 'Player');
            if (playerName) {
                playerName = playerName.trim().substring(0, 20) || 'Anonymous';
                localStorage.setItem(PLAYER_NAME, playerName);
            } else {
                playerName = 'Anonymous';
            }
        }
        
        return playerName;
    }
    
    async submitScoreToLeaderboard() {
        try {
            const playerName = this.getPlayerName();
            const result = await leaderboardAPI.submitScore(playerName, this.score, this.level);
            
            if (result.success) {
                // Check leaderboard achievements
                if (!this.achievements.leaderboard_ranked) {
                    this.achievementManager.unlockAchievement('leaderboard_ranked', 'Get a Result on Global Leaderboard');
                }
                if (result.rank === 1 && !this.achievements.leaderboard_top1) {
                    this.achievementManager.unlockAchievement('leaderboard_top1', 'Get Top 1 on Global Leaderboard');
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
                        const date = new Date(entry.timestamp).toLocaleDateString();
                        const rank = index + 1;
                        item.innerHTML = `${rank}. <strong>${entry.playerName}</strong> - ${entry.score.toLocaleString()} pts (Level ${entry.level}) <span style="color: #888; font-size: 0.9em;">${date}</span>`;
                        item.style.marginBottom = '5px';
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
            if (leaderboardElement) {
                leaderboardElement.innerHTML = `<h3>Global Leaderboard</h3><p style="color: #888;">Failed to load leaderboard</p>`;
            }
        }
    }
    
    gameLoop(currentTime) {
        // Handle first frame
        if (this.lastFrameTime === 0) {
            this.lastFrameTime = currentTime || performance.now();
            requestAnimationFrame((time) => this.gameLoop(time));
            return;
        }
        
        const deltaTime = ((currentTime || performance.now()) - this.lastFrameTime) / 1000; // Convert to seconds
        this.lastFrameTime = currentTime || performance.now();
        
        // Cap deltaTime to prevent large jumps
        const maxDeltaTime = 1 / 30;
        const clampedDeltaTime = Math.min(Math.max(deltaTime, 0), maxDeltaTime);
        
        if (isNaN(clampedDeltaTime) || clampedDeltaTime <= 0) {
            requestAnimationFrame((time) => this.gameLoop(time));
            return;
        }
        
        this.update(clampedDeltaTime);
        this.renderer.render();
        
        if (this.gameLoopRunning) {
            requestAnimationFrame((time) => this.gameLoop(time));
        }
    }
}

// Export functions for menu.js
export let game;

export function startGame() {
    game.startGame();
}

export function restartGame() {
    document.getElementById('gameOver').classList.add('hidden');
    game.resetGame();
    game.startGame();
}

export function returnToMenu() {
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

// Initialize game
window.addEventListener('load', () => {
    game = new SpaceDodger();
});
