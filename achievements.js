// Achievement system
import { CONFIG } from './config.js';
import { StorageManager } from './storage.js';

export class AchievementManager {
    constructor(game) {
        this.game = game;
    }
    
    unlockAchievement(id, name) {
        if (this.game.achievements[id]) {
            return false;
        }
        
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
        if (this.game.score >= 500 && !this.game.achievements.score_500) {
            this.unlockAchievement('score_500', 'Reach 500 points');
        }
        if (this.game.score >= 1000 && !this.game.achievements.score_1000) {
            this.unlockAchievement('score_1000', 'Reach 1000 points');
        }
        if (this.game.score >= 1500 && !this.game.achievements.score_1500) {
            this.unlockAchievement('score_1500', 'Reach 1500 points');
        }
        if (this.game.score >= 2000 && !this.game.achievements.score_2000) {
            this.unlockAchievement('score_2000', 'Reach 2000 points');
        }
        if (this.game.score >= 5000 && !this.game.achievements.score_5000) {
            this.unlockAchievement('score_5000', 'Reach 5000 points');
        }
        
        // Boss type achievements (one for each attack type)
        const bossTypeNames = {
            'spikes': 'Defeat Spikes Boss',
            'double_spikes': 'Defeat Double Spikes Boss',
            'wall': 'Defeat Wall Restriction Boss',
            'moving_safe': 'Defeat Moving Safe Zone Boss',
            'giant_obstacle': 'Defeat Giant Obstacle Boss',
            'double_obstacles': 'Defeat Double Obstacles Boss',
            'gravity': 'Defeat Gravity Attack Boss'
        };
        
        this.game.bossAttackTypesDefeated.forEach(attackType => {
            const achievementId = `boss_${attackType}`;
            if (!this.game.achievements[achievementId]) {
                this.unlockAchievement(achievementId, bossTypeNames[attackType] || `Defeat ${attackType} Boss`);
            }
        });
        
        // All boss types completed
        const allBossTypes = ['spikes', 'double_spikes', 'wall', 'moving_safe', 'giant_obstacle', 'double_obstacles', 'gravity'];
        const allBossesDefeated = allBossTypes.every(type => 
            this.game.achievements[`boss_${type}`]
        );
        if (allBossesDefeated && !this.game.achievements.all_bosses) {
            this.unlockAchievement('all_bosses', 'Complete All Boss Types');
        }
        
        // Shield saved life
        if (this.game.shieldSavedLife && !this.game.achievements.shield_saved) {
            this.unlockAchievement('shield_saved', 'Survived by Shield at 1 Life');
        }
        
        // 3 power-ups in one game
        if (this.game.powerUpsCollectedThisGame >= 3 && !this.game.achievements.powerups_3) {
            this.unlockAchievement('powerups_3', 'Get 3 Power-ups in One Game');
        }
        
        // 100 games played
        if (this.game.metrics.totalGamesPlayed >= 100 && !this.game.achievements.games_100) {
            this.unlockAchievement('games_100', 'Play 100 Games');
        }
        
        // Total 50000 points earned
        if (this.game.totalScoreEarned >= 50000 && !this.game.achievements.total_score_50000) {
            this.unlockAchievement('total_score_50000', 'Total 50,000 Points Earned');
        }
    }
    
    updateAchievementsDisplay() {
        const achievementsList = document.getElementById('achievementsList');
        if (!achievementsList) return;
        
        const allAchievements = [
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
        
        achievementsList.innerHTML = allAchievements.map(ach => {
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

