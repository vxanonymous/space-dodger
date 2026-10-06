// Every DOM write that is not the leaderboard.
//
// Elements are looked up once and guarded, so a renamed id degrades to a no-op
// instead of throwing out of the game loop. The game calls these with plain
// values and never touches document itself.

import { summarize } from './metrics.js';

const byId = (id) => document.getElementById(id);

export class HUD {
    constructor() {
        this.score = byId('score');
        this.lives = byId('lives');
        this.level = byId('level');
        this.powerUpStatus = byId('powerUpStatus');
        this.pauseOverlay = byId('pauseOverlay');
        this.pauseBtn = byId('pauseBtn');
        this.mainMenu = byId('mainMenu');
        this.gameOver = byId('gameOver');
        this.finalScore = byId('finalScore');
        this.finalLevel = byId('finalLevel');
        this.newHighScore = byId('newHighScore');

        this.highScoreTargets = ['highScore', 'gameOverHighScore', 'prominentHighScore']
            .map(byId)
            .filter(Boolean);

        // The power-up row is rebuilt only when its contents actually change,
        // not on every one of the ~10 HUD refreshes per second
        this.lastPowerUpKey = '';
    }

    renderStats({ score, lives, level, bossActive }) {
        if (this.score) this.score.textContent = score;
        if (this.lives) this.lives.textContent = lives;
        if (this.level) this.level.textContent = bossActive ? `${level} - BOSS!` : level;
    }

    renderPowerUps({ hasShield, shieldTimer, slowDownActive, slowDownTimer }) {
        if (!this.powerUpStatus) return;

        const parts = [];
        if (hasShield) parts.push(['pu-shield', `🛡️ Shield (${Math.ceil(shieldTimer)}s)`]);
        if (slowDownActive) parts.push(['pu-slow', `⏱️ Slow Down (${Math.ceil(slowDownTimer)}s)`]);

        const key = parts.map(([, label]) => label).join(' | ');
        if (key === this.lastPowerUpKey) return;
        this.lastPowerUpKey = key;

        this.powerUpStatus.replaceChildren();
        parts.forEach(([className, label], i) => {
            if (i > 0) this.powerUpStatus.append(' | ');
            const span = document.createElement('span');
            span.className = className;
            span.textContent = label;
            this.powerUpStatus.appendChild(span);
        });
    }

    setHighScore(highScore) {
        const text = highScore.toLocaleString();
        this.highScoreTargets.forEach(el => { el.textContent = text; });
    }

    setPaused(paused) {
        this.pauseOverlay?.classList.toggle('hidden', !paused);
    }

    setPauseUsed(used) {
        this.pauseBtn?.classList.toggle('used', used);
    }

    showMenu(visible) {
        this.mainMenu?.classList.toggle('hidden', !visible);
    }

    showGameOver({ score, level, isNewHighScore }) {
        if (this.finalScore) this.finalScore.textContent = score.toLocaleString();
        if (this.finalLevel) this.finalLevel.textContent = level;
        this.newHighScore?.classList.toggle('hidden', !isNewHighScore);
        this.gameOver?.classList.remove('hidden');
    }

    hideGameOver() {
        this.gameOver?.classList.add('hidden');
    }

    renderMenuStats(metrics) {
        const values = summarize(metrics);
        Object.keys(values).forEach(id => {
            const el = byId(id);
            if (el) el.textContent = values[id];
        });
    }

    // Transient corner notice, used for pause-already-spent and cache-cleared
    toast(message) {
        const notice = document.createElement('div');
        notice.className = 'toast';
        notice.textContent = message;
        document.body.appendChild(notice);
        setTimeout(() => {
            notice.classList.add('toast-out');
            setTimeout(() => notice.remove(), 300);
        }, 2000);
    }
}
