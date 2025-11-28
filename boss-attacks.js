// Boss attack system
import { CONFIG } from './config.js';

export class BossAttackManager {
    constructor(game) {
        this.game = game;
        this.attacks = [];
        this.warnings = [];
        this.gravityScheduled = false;
        this.attackTypesUsed = new Set();
    }

    reset() {
        this.attacks = [];
        this.warnings = [];
        this.gravityScheduled = false;
        this.attackTypesUsed = new Set();
    }

    update(deltaTime) {
        this.updateWarnings(deltaTime);
        this.updateAttacks(deltaTime);
    }

    bossAttack() {
        const patterns = ['spikes', 'double_spikes', 'wall', 'moving_safe', 'giant_obstacle', 'double_obstacles', 'gravity'];
        const pattern = patterns[Math.floor(Math.random() * patterns.length)];

        this.attackTypesUsed.add(pattern);
        switch (pattern) {
            case 'spikes':
                this.createSpikes();
                break;
            case 'double_spikes':
                this.createDoubleSpikes();
                break;
            case 'wall':
                this.createWallRestriction();
                break;
            case 'moving_safe':
                this.createMovingSafe();
                break;
            case 'giant_obstacle':
                this.createGiantObstacle();
                break;
            case 'double_obstacles':
                this.createDoubleObstacles();
                break;
            case 'gravity':
                this.scheduleGravity();
                break;
        }
    }
    
    getAttackTypesUsed() {
        return Array.from(this.attackTypesUsed);
    }

    // Attack creation methods
    createSpikes() {
        const { SPIKE_COUNT, SPIKE_WIDTH, SPIKE_HEIGHT, SPIKE_WARNING_DURATION } = CONFIG.BOSS_ATTACKS;
        const { CANVAS_WIDTH, CANVAS_HEIGHT } = CONFIG;
        
        // Create 3 spikes equally distributed
        const gap = CANVAS_WIDTH / (SPIKE_COUNT + 1);
        for (let i = 0; i < SPIKE_COUNT; i++) {
            this.warnings.push({
                x: gap * (i + 1) - SPIKE_WIDTH / 2,
                y: 0,
                width: SPIKE_WIDTH,
                height: CANVAS_HEIGHT,
                timer: 0,
                duration: SPIKE_WARNING_DURATION,
                color: CONFIG.COLORS.WARNING,
                type: 'spike'
            });
        }
    }

    createDoubleSpikes() {
        const { DOUBLE_SPIKE_COUNT, SPIKE_WIDTH, SPIKE_HEIGHT, SPIKE_WARNING_DURATION } = CONFIG.BOSS_ATTACKS;
        const { CANVAS_WIDTH, CANVAS_HEIGHT } = CONFIG;
        
        // Create 5 random vertical spikes
        for (let i = 0; i < DOUBLE_SPIKE_COUNT; i++) {
            this.warnings.push({
                x: Math.random() * (CANVAS_WIDTH - 100) + 50,
                y: 0,
                width: SPIKE_WIDTH,
                height: CANVAS_HEIGHT,
                timer: 0,
                duration: SPIKE_WARNING_DURATION,
                color: CONFIG.COLORS.WARNING,
                type: 'spike'
            });
        }
    }

    createWallRestriction() {
        const { CANVAS_WIDTH, CANVAS_HEIGHT } = CONFIG;
        const { SPIKE_WARNING_DURATION } = CONFIG.BOSS_ATTACKS;
        
        this.warnings.push({
            x: 0,
            y: 0,
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            timer: 0,
            duration: SPIKE_WARNING_DURATION,
            color: CONFIG.COLORS.WARNING,
            type: 'wall_restriction'
        });
    }

    createMovingSafe() {
        const { CANVAS_WIDTH, CANVAS_HEIGHT } = CONFIG;
        const { MOVING_SAFE_WIDTH, MOVING_SAFE_SPEED, SPIKE_WARNING_DURATION } = CONFIG.BOSS_ATTACKS;
        
        this.warnings.push({
            x: 0,
            y: 0,
            width: MOVING_SAFE_WIDTH,
            height: CANVAS_HEIGHT,
            timer: 0,
            duration: SPIKE_WARNING_DURATION,
            color: CONFIG.COLORS.SAFE_ZONE,
            type: 'moving_safe',
            speed: MOVING_SAFE_SPEED
        });
    }

    createGiantObstacle() {
        const { CANVAS_WIDTH } = CONFIG;
        const { GIANT_OBSTACLE_RADIUS, GIANT_OBSTACLE_START_Y, SPIKE_WARNING_DURATION } = CONFIG.BOSS_ATTACKS;
        
        const minX = GIANT_OBSTACLE_RADIUS;
        const maxX = CANVAS_WIDTH - GIANT_OBSTACLE_RADIUS;
        const randomX = Math.random() * (maxX - minX) + minX;
        
        this.warnings.push({
            x: randomX - GIANT_OBSTACLE_RADIUS,
            y: GIANT_OBSTACLE_START_Y,
            width: GIANT_OBSTACLE_RADIUS * 2,
            height: GIANT_OBSTACLE_RADIUS * 2,
            timer: 0,
            duration: SPIKE_WARNING_DURATION,
            color: CONFIG.BOSS.COLOR,
            type: 'giant_obstacle',
            radius: GIANT_OBSTACLE_RADIUS
        });
    }

    createDoubleObstacles() {
        this.attacks.push({
            type: 'double_obstacles',
            timer: 0
        });
    }

    scheduleGravity() {
        this.gravityScheduled = true;
    }

    // Update methods
    updateWarnings(deltaTime) {
        for (let i = this.warnings.length - 1; i >= 0; i--) {
            const warning = this.warnings[i];
            warning.timer += deltaTime;
            
            if (warning.timer >= warning.duration) {
                this.convertWarningToAttack(warning);
                this.warnings.splice(i, 1);
            }
        }
    }

    convertWarningToAttack(warning) {
        const { WALL_TARGET_GAP, WALL_COLLAPSE_SPEED, GIANT_OBSTACLE_FALL_SPEED } = CONFIG.BOSS_ATTACKS;
        const { CANVAS_WIDTH } = CONFIG;
        
        const attack = {
            x: warning.x,
            y: warning.y,
            width: warning.width,
            height: warning.height,
            color: warning.color,
            timer: 0,
            type: warning.type
        };

        // Set specific properties based on attack type
        if (warning.type === 'moving_safe') {
            attack.speed = warning.speed;
        } else if (warning.type === 'wall_restriction') {
            attack.leftWall = 0;
            attack.rightWall = CANVAS_WIDTH;
            attack.targetGap = WALL_TARGET_GAP;
            attack.collapseSpeed = WALL_COLLAPSE_SPEED;
        } else if (warning.type === 'giant_obstacle') {
            attack.radius = warning.radius;
            attack.centerX = warning.x + warning.radius;
            attack.centerY = warning.y + warning.radius;
        }

        this.attacks.push(attack);
    }

    updateAttacks(deltaTime) {
        const { CANVAS_WIDTH, CANVAS_HEIGHT } = CONFIG;
        const { SPIKE_ATTACK_DURATION, DOUBLE_OBSTACLES_DURATION, GIANT_OBSTACLE_FALL_SPEED, GIANT_OBSTACLE_RADIUS } = CONFIG.BOSS_ATTACKS;
        
        for (let i = this.attacks.length - 1; i >= 0; i--) {
            const attack = this.attacks[i];
            attack.timer += deltaTime;
            
            if (attack.type === 'moving_safe') {
                attack.x += attack.speed * deltaTime * 60;
                if (attack.x > CANVAS_WIDTH) {
                    this.attacks.splice(i, 1);
                }
            } else if (attack.type === 'wall_restriction') {
                if (attack.leftWall < attack.rightWall - attack.targetGap) {
                    attack.leftWall += attack.collapseSpeed * deltaTime * 60;
                    attack.rightWall -= attack.collapseSpeed * deltaTime * 60;
                }
            } else if (attack.type === 'giant_obstacle') {
                attack.centerY += GIANT_OBSTACLE_FALL_SPEED * deltaTime * 60;
                if (attack.centerY > CANVAS_HEIGHT + GIANT_OBSTACLE_RADIUS + 100) {
                    this.attacks.splice(i, 1);
                }
            } else if (attack.type === 'double_obstacles') {
                if (attack.timer > DOUBLE_OBSTACLES_DURATION) {
                    this.attacks.splice(i, 1);
                }
            } else if (attack.timer > SPIKE_ATTACK_DURATION) {
                this.attacks.splice(i, 1);
            }
        }
    }

    handleGravityAttack(bossLevelStartTime, gameTime) {
        const { GRAVITY_TRIGGER_DELAY, GRAVITY_DURATION } = CONFIG.BOSS_ATTACKS;
        
        if (this.gravityScheduled && gameTime - bossLevelStartTime >= GRAVITY_TRIGGER_DELAY) {
            for (const obstacle of this.game.obstacles) {
                obstacle.gravityAffected = true;
                obstacle.gravityTimer = GRAVITY_DURATION;
            }
            this.gravityScheduled = false;
        }
    }

    // Drawing methods
    drawWarnings() {
        const { WARNING_ALPHA } = CONFIG.VISUAL;
        
        for (const warning of this.warnings) {
            this.game.ctx.fillStyle = warning.color;
            this.game.ctx.globalAlpha = WARNING_ALPHA;
            this.game.ctx.fillRect(warning.x, warning.y, warning.width, warning.height);
            this.game.ctx.globalAlpha = 1.0;
        }
    }

    drawAttacks() {
        const { CANVAS_WIDTH, CANVAS_HEIGHT } = CONFIG;
        const { SAFE_ZONE_ALPHA } = CONFIG.VISUAL;
        const { DANGER_ZONE } = CONFIG.COLORS;
        
        for (const attack of this.attacks) {
            if (attack.type === 'double_obstacles' || attack.type === 'gravity') {
                continue;
            }
            
            this.game.ctx.fillStyle = attack.color;
            
            if (attack.type === 'moving_safe') {
                this.game.ctx.globalAlpha = SAFE_ZONE_ALPHA;
                this.game.ctx.fillRect(attack.x, attack.y, attack.width, attack.height);
                this.game.ctx.globalAlpha = 1.0;
                
                // Draw deadly areas
                this.game.ctx.fillStyle = DANGER_ZONE;
                this.game.ctx.fillRect(0, attack.y, attack.x, attack.height);
                this.game.ctx.fillRect(attack.x + attack.width, attack.y, CANVAS_WIDTH - (attack.x + attack.width), attack.height);
            } else if (attack.type === 'wall_restriction') {
                this.game.ctx.fillRect(0, 0, attack.leftWall, CANVAS_HEIGHT);
                this.game.ctx.fillRect(attack.rightWall, 0, CANVAS_WIDTH - attack.rightWall, CANVAS_HEIGHT);
            } else if (attack.type === 'giant_obstacle') {
                this.game.ctx.beginPath();
                this.game.ctx.arc(attack.centerX, attack.centerY, attack.radius, 0, Math.PI * 2);
                this.game.ctx.fill();
            } else {
                this.game.ctx.fillRect(attack.x, attack.y, attack.width, attack.height);
            }
        }
    }

    checkPlayerCollision(player) {
        for (const attack of this.attacks) {
            if (attack.type === 'double_obstacles' || attack.type === 'gravity') {
                continue;
            }
            
            let collision = false;
            
            if (attack.type === 'moving_safe') {
                // Player is safe if inside the safe zone
                collision = !(player.x >= attack.x && 
                           player.x + player.width <= attack.x + attack.width && 
                           player.y >= attack.y && 
                           player.y + player.height <= attack.y + attack.height);
            } else if (attack.type === 'wall_restriction') {
                collision = player.x < attack.leftWall || player.x + player.width > attack.rightWall;
            } else if (attack.type === 'giant_obstacle') {
                const dx = (player.x + player.width / 2) - attack.centerX;
                const dy = (player.y + player.height / 2) - attack.centerY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                collision = distance < attack.radius;
            } else {
                collision = this.game.checkCollision(player, attack);
            }
            
            if (collision) {
                return true;
            }
        }
        return false;
    }

    getSpawnRateModifier() {
        for (const attack of this.attacks) {
            if (attack.type === 'double_obstacles') {
                return 2;
            }
        }
        return 1;
    }

    isIdle() {
        return this.attacks.length === 0 && this.warnings.length === 0;
    }
}
