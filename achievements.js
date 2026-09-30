// Achievement system
import { StorageManager } from './storage.js';
import { BOSS_ATTACK_PATTERNS } from './boss-attacks.js';

// Single source of truth for achievement ids, display names, and icons
export const ACHIEVEMENTS = [
    { id: 'score_500', name: 'Reach 500 points', icon: '⭐' },
    { id: 'score_1000', name: 'Reach 1000 points', icon: '⭐' },
    { id: 'score_1500', name: 'Reach 1500 points', icon: '⭐' },
    { id: 'score_2000', name: 'Reach 2000 points', icon: '⭐' },
    { id: 'score_5000', name: 'Reach 5000 points', icon: '⭐' },
    { id: 'perfect_run', name: 'Perfect Run (Score divisible by 100)', icon: '✨' },
    { id: 'boss_spikes', name: 'Defeat Spikes Boss', icon: '👾' },
    { id: 'boss_double_spikes', name: 'Defeat Double Spikes Boss', icon: '👾' },
    { id: 'boss_wall', name: 'Defeat Wall Restriction Boss', icon: '👾' },
    { id: 'boss_moving_safe', name: 'Defeat Moving Safe Zone Boss', icon: '👾' },
    { id: 'boss_giant_obstacle', name: 'Defeat Giant Obstacle Boss', icon: '👾' },
    { id: 'boss_double_obstacles', name: 'Defeat Double Obstacles Boss', icon: '👾' },
    { id: 'boss_gravity', name: 'Defeat Gravity Attack Boss', icon: '👾' },
    { id: 'all_bosses', name: 'Complete All Boss Types', icon: '👑' },
    { id: 'shield_saved', name: 'Survived by Shield at 1 Life', icon: '🛡️' },
    { id: 'powerups_3', name: 'Get 3 Power-ups in One Game', icon: '💎' },
    { id: 'games_100', name: 'Play 100 Games', icon: '🎮' },
    { id: 'total_score_50000', name: 'Total 50,000 Points Earned', icon: '🏅' },
    { id: 'leaderboard_ranked', name: 'Get a Result on Global Leaderboard', icon: '🌐' },
    { id: 'leaderboard_top1', name: 'Get Top 1 on Global Leaderboard', icon: '👑' }
];

const ACHIEVEMENT_NAMES = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a.name]));

const SCORE_MILESTONES = [500, 1000, 1500, 2000, 5000];

export class AchievementManager {
    constructor(game) {
        this.game = game;
    }

    unlockAchievement(id) {
        if (this.game.achievements[id]) {
            return false;
        }

        const name = ACHIEVEMENT_NAMES[id] || id;
        this.game.achievements[id] = {
            unlocked: true,
            unlockedAt: Date.now(),
            name: name
        };
        StorageManager.saveAchievements(this.game.achievements);
        this.updateAchievementsDisplay();

        this.showAchievementNotification(name);
        return true;
    }

    showAchievementNotification(name) {
        // Create notification element
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #00ff00;
            color: #000;
            padding: 15px 25px;
            border-radius: 5px;
            font-weight: bold;
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        `;
        notification.innerHTML = `🏆 Achievement Unlocked!<br>${name}`;
        document.body.appendChild(notification);

        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    checkAchievements() {
        // Score milestones
        for (const milestone of SCORE_MILESTONES) {
            if (this.game.score >= milestone) {
                this.unlockAchievement(`score_${milestone}`);
            }
        }

        // Boss type achievements (one for each attack type)
        this.game.bossAttackTypesDefeated.forEach(attackType => {
            this.unlockAchievement(`boss_${attackType}`);
        });

        // All boss types completed
        const allBossesDefeated = BOSS_ATTACK_PATTERNS.every(type =>
            this.game.achievements[`boss_${type}`]
        );
        if (allBossesDefeated) {
            this.unlockAchievement('all_bosses');
        }

        // Shield saved life
        if (this.game.shieldSavedLife) {
            this.unlockAchievement('shield_saved');
        }

        // 3 power-ups in one game
        if (this.game.powerUpsCollectedThisGame >= 3) {
            this.unlockAchievement('powerups_3');
        }

        // 100 games played
        if (this.game.metrics.totalGamesPlayed >= 100) {
            this.unlockAchievement('games_100');
        }

        // Total 50000 points earned
        if (this.game.totalScoreEarned >= 50000) {
            this.unlockAchievement('total_score_50000');
        }
    }

    updateAchievementsDisplay() {
        const achievementsList = document.getElementById('achievementsList');
        if (!achievementsList) return;

        achievementsList.innerHTML = ACHIEVEMENTS.map(ach => {
            const unlocked = this.game.achievements[ach.id];
            return `
                <div style="
                    padding: 15px;
                    background: ${unlocked ? '#222' : '#111'};
                    border: 2px solid ${unlocked ? '#00ff00' : '#333'};
                    border-radius: 5px;
                    opacity: ${unlocked ? '1' : '0.6'};
                ">
                    <div style="font-size: 2em; margin-bottom: 5px;">${ach.icon}</div>
                    <div style="color: ${unlocked ? '#00ff00' : '#888'}; font-weight: ${unlocked ? 'bold' : 'normal'};">
                        ${ach.name}
                    </div>
                    ${unlocked ? '<div style="color: #00ff00; font-size: 0.8em; margin-top: 5px;">✓ Unlocked</div>' : '<div style="color: #666; font-size: 0.8em; margin-top: 5px;">Locked</div>'}
                </div>
            `;
        }).join('');
    }
}
