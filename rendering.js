// Rendering system
import { CONFIG } from './config.js';

export class Renderer {
    constructor(game) {
        this.game = game;
    }
    
    render() {
        if (!this.game.gameLoopRunning) return;
        
        const { CANVAS_WIDTH, CANVAS_HEIGHT } = CONFIG;
        const { BACKGROUND, STAR } = CONFIG.COLORS;
        
        // Apply screen shake offset
        this.game.ctx.save();
        this.game.ctx.translate(this.game.screenShake.offsetX, this.game.screenShake.offsetY);
        
        this.game.ctx.fillStyle = BACKGROUND;
        this.game.ctx.fillRect(-this.game.screenShake.offsetX, -this.game.screenShake.offsetY, CANVAS_WIDTH, CANVAS_HEIGHT);
        
        this.game.ctx.fillStyle = STAR;
        for (const star of this.game.stars) {
            this.game.ctx.fillRect(star.x, star.y, 1, 1);
        }
        
        this.drawPowerUps();
        this.drawPlayer();
        this.drawObstacles();
        this.drawBoss();
        
        this.game.bossAttackManager.drawAttacks();
        this.game.bossAttackManager.drawWarnings();
        
        this.drawExplosions();

        this.game.ctx.restore();
        
        // Draw level flash overlay
        this.drawLevelFlash();
    }
    
    drawPlayer() {
        const { INVINCIBILITY_DURATION } = CONFIG.PLAYER;
        
        // Flash effect when invincible
        if (this.game.player.invincible) {
            const flashRate = 10;
            const shouldShow = Math.floor(this.game.player.invincibilityTimer * flashRate) % 2 === 0;
            if (!shouldShow) return;
        }
        
        this.game.ctx.fillStyle = this.game.player.color;
        this.game.ctx.beginPath();
        this.game.ctx.moveTo(this.game.player.x + this.game.player.width / 2, this.game.player.y);
        this.game.ctx.lineTo(this.game.player.x, this.game.player.y + this.game.player.height);
        this.game.ctx.lineTo(this.game.player.x + this.game.player.width, this.game.player.y + this.game.player.height);
        this.game.ctx.closePath();
        this.game.ctx.fill();
        
        // Draw shield if active
        if (this.game.player.hasShield) {
            const { COLOR } = CONFIG.POWER_UPS.SHIELD;
            this.game.ctx.strokeStyle = COLOR;
            this.game.ctx.lineWidth = 3;
            this.game.ctx.beginPath();
            this.game.ctx.arc(
                this.game.player.x + this.game.player.width / 2,
                this.game.player.y + this.game.player.height / 2,
                this.game.player.width + 5,
                0,
                Math.PI * 2
            );
            this.game.ctx.stroke();
        }
    }
    
    drawPowerUps() {
        const { SHIELD, SLOW_DOWN } = CONFIG.POWER_UPS;
        
        for (const powerUp of this.game.powerUps) {
            this.game.ctx.save();
            
            // Translate to power-up center for rotation
            const centerX = powerUp.x + powerUp.width / 2;
            const centerY = powerUp.y + powerUp.height / 2;
            this.game.ctx.translate(centerX, centerY);
            this.game.ctx.rotate(powerUp.rotation);
            
            const color = powerUp.type === 'shield' ? SHIELD.COLOR : SLOW_DOWN.COLOR;
            
            // Draw diamond shape
            this.game.ctx.fillStyle = color;
            this.game.ctx.beginPath();
            this.game.ctx.moveTo(0, -powerUp.height / 2);
            this.game.ctx.lineTo(powerUp.width / 2, 0);
            this.game.ctx.lineTo(0, powerUp.height / 2);
            this.game.ctx.lineTo(-powerUp.width / 2, 0);
            this.game.ctx.closePath();
            this.game.ctx.fill();
            
            // Draw outline
            this.game.ctx.strokeStyle = '#ffffff';
            this.game.ctx.lineWidth = 2;
            this.game.ctx.stroke();
            
            this.game.ctx.restore();
        }
    }
    
    drawLevelFlash() {
        if (this.game.levelFlashTimer > 0) {
            const { CANVAS_WIDTH, CANVAS_HEIGHT } = CONFIG;
            const { LEVEL_FLASH_COLOR } = CONFIG.VISUAL;
            const alpha = this.game.levelFlashTimer / CONFIG.VISUAL.LEVEL_FLASH_DURATION;
            
            this.game.ctx.fillStyle = LEVEL_FLASH_COLOR;
            this.game.ctx.globalAlpha = alpha * 0.5;
            this.game.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            this.game.ctx.globalAlpha = 1.0;
        }
    }
    
    drawObstacles() {
        for (const obstacle of this.game.obstacles) {
            this.game.ctx.fillStyle = obstacle.color;
            if (obstacle.type === 'asteroid') {
                this.game.ctx.beginPath();
                this.game.ctx.arc(obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height / 2, obstacle.width / 2, 0, Math.PI * 2);
                this.game.ctx.fill();
            } else if (obstacle.type === 'giant_obstacle') {
                this.game.ctx.beginPath();
                this.game.ctx.arc(obstacle.centerX, obstacle.centerY, obstacle.radius, 0, Math.PI * 2);
                this.game.ctx.fill();
            } else {
                this.game.ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
            }
        }
    }
    
    drawBoss() {
        if (!this.game.boss) return;
        
        this.game.ctx.fillStyle = this.game.boss.color;
        this.game.ctx.beginPath();
        this.game.ctx.arc(this.game.boss.x, this.game.boss.y, this.game.boss.radius, 0, Math.PI);
        this.game.ctx.fill();
    }
    
    drawExplosions() {
        const { EXPLOSION_LIFE } = CONFIG.VISUAL;
        
        for (const explosion of this.game.explosions) {
            this.game.ctx.fillStyle = explosion.color;
            this.game.ctx.globalAlpha = explosion.life / EXPLOSION_LIFE;
            this.game.ctx.beginPath();
            this.game.ctx.arc(explosion.x, explosion.y, explosion.size, 0, Math.PI * 2);
            this.game.ctx.fill();
            this.game.ctx.globalAlpha = 1;
        }
    }
}

