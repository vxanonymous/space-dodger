// Achievement system
import { StorageManager } from './storage.js';
import { BOSS_ATTACK_PATTERNS } from './boss-attacks.js';

// Single source of truth for achievement ids, display names, icons, and
// descriptions (shown in the details popup)
export const ACHIEVEMENTS = [
    { id: 'score_500', name: 'Warming Up', icon: '⭐', description: 'Reach 500 points in a single game.', progress: (g) => ({ current: g.highScore, target: 500 }) },
    { id: 'score_1000', name: 'Cruising Altitude', icon: '⭐', description: 'Reach 1,000 points in a single game.', progress: (g) => ({ current: g.highScore, target: 1000 }) },
    { id: 'score_1500', name: 'Asteroid Veteran', icon: '⭐', description: 'Reach 1,500 points in a single game.', progress: (g) => ({ current: g.highScore, target: 1500 }) },
    { id: 'score_2000', name: 'Deep Space', icon: '⭐', description: 'Reach 2,000 points in a single game.', progress: (g) => ({ current: g.highScore, target: 2000 }) },
    { id: 'score_5000', name: 'Legend of the Void', icon: '⭐', description: 'Reach 5,000 points in a single game.', progress: (g) => ({ current: g.highScore, target: 5000 }) },
    { id: 'beat_high_score', name: 'Personal Best', icon: '📈', description: 'Beat your own previous high score. Your record must be above 0, so your first game doesn\'t count.' },
    { id: 'comeback_1000', name: 'Phoenix', icon: '🔥', description: 'Lose two lives during level 1, then rise from the ashes and still reach 1,000 points.' },
    { id: 'perfect_run', name: 'Round Number', icon: '✨', description: 'Finish a game with a score that is exactly divisible by 100.' },
    { id: 'boss_spikes', name: 'Spike Dancer', icon: '👾', description: 'Survive a boss fight featuring the Spikes attack without losing a life.' },
    { id: 'boss_double_spikes', name: 'Needle Threader', icon: '👾', description: 'Survive a boss fight featuring the Double Spikes attack without losing a life.' },
    { id: 'boss_wall', name: 'Wall Runner', icon: '👾', description: 'Survive a boss fight featuring the collapsing Walls attack without losing a life.' },
    { id: 'boss_moving_safe', name: 'Safe Passage', icon: '👾', description: 'Survive a boss fight featuring the Moving Safe Zone attack without losing a life.' },
    { id: 'boss_giant_obstacle', name: 'Giant Slayer', icon: '👾', description: 'Survive a boss fight featuring the Giant Obstacle attack without losing a life.' },
    { id: 'boss_double_obstacles', name: 'Storm Chaser', icon: '👾', description: 'Survive a boss fight featuring the Double Obstacles attack without losing a life.' },
    { id: 'boss_gravity', name: 'Gravity Defier', icon: '👾', description: 'Survive a boss fight featuring the 500%-speed Gravity attack without losing a life.' },
    { id: 'all_bosses', name: 'Full House', icon: '👑', description: 'Survive all seven boss attack types across your games.', progress: (g) => ({ current: BOSS_ATTACK_PATTERNS.filter(t => g.achievements[`boss_${t}`]).length, target: BOSS_ATTACK_PATTERNS.length }) },
    { id: 'shield_saved', name: 'Clutch Save', icon: '🛡️', description: 'On your last life, have a shield absorb a hit that would have ended the game.' },
    { id: 'powerups_3', name: 'Collector', icon: '💎', description: 'Grab three power-ups in a single game.' },
    { id: 'games_100', name: 'Frequent Flyer', icon: '🎮', description: 'Play 100 games in total.', progress: (g) => ({ current: g.metrics.totalGamesPlayed, target: 100 }) },
    { id: 'total_score_50000', name: 'Marathon Runner', icon: '🏅', description: 'Earn 50,000 points in total across all your games.', progress: (g) => ({ current: g.totalScoreEarned, target: 50000 }) },
    { id: 'leaderboard_ranked', name: 'On the Board', icon: '🌐', description: 'Place a score in the global top 100 leaderboard.' },
    { id: 'leaderboard_top1', name: 'World Champion', icon: '👑', description: 'Hold the #1 spot on the global leaderboard.' }
];

const ACHIEVEMENT_NAMES = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a.name]));

const SCORE_MILESTONES = [500, 1000, 1500, 2000, 5000];

export class AchievementManager {
    constructor(game) {
        this.game = game;
        this.setupDetailsModal();
    }

    setupDetailsModal() {
        // One delegated listener on the grid container survives every rebuild
        const list = document.getElementById('achievementsList');
        if (list) {
            list.addEventListener('click', (e) => {
                const card = e.target.closest('[data-ach-id]');
                if (card) this.showAchievementDetails(card.dataset.achId);
            });
        }

        const modal = document.getElementById('achievementModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.add('hidden');
            });
            document.getElementById('achModalCloseBtn').addEventListener('click', () => {
                modal.classList.add('hidden');
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') modal.classList.add('hidden');
            });
        }
    }

    showAchievementDetails(id) {
        const ach = ACHIEVEMENTS.find(a => a.id === id);
        if (!ach) return;

        document.getElementById('achModalIcon').textContent = ach.icon;
        document.getElementById('achModalName').textContent = ach.name;
        document.getElementById('achModalDesc').textContent = ach.description;

        const status = document.getElementById('achModalStatus');
        const unlocked = this.game.achievements[id];

        // Progress toward the goal, for locked achievements with a counter
        const progressRow = document.getElementById('achModalProgress');
        if (!unlocked && ach.progress) {
            const { current, target } = ach.progress(this.game);
            const capped = Math.max(0, Math.min(current, target));
            document.getElementById('achModalProgressBar').style.width = `${(capped / target) * 100}%`;
            document.getElementById('achModalProgressText').textContent =
                `${capped.toLocaleString()} / ${target.toLocaleString()}`;
            progressRow.classList.remove('hidden');
        } else {
            progressRow.classList.add('hidden');
        }
        if (unlocked) {
            const when = unlocked.unlockedAt ? ` on ${new Date(unlocked.unlockedAt).toLocaleDateString()}` : '';
            status.textContent = `✓ Unlocked${when}`;
            status.style.color = '#00ff00';
        } else {
            status.textContent = '🔒 Locked';
            status.style.color = '#888';
        }

        document.getElementById('achievementModal').classList.remove('hidden');
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

        // Beat a previous, non-zero high score (checked live, so it pops the
        // moment the record falls; game.highScore updates only at game over)
        if (this.game.highScore > 0 && this.game.score > this.game.highScore) {
            this.unlockAchievement('beat_high_score');
        }

        // Comeback: lost 2 lives during level 1, still reached 1000 points
        if (this.game.livesLostInFirstLevel >= 2 && this.game.score >= 1000) {
            this.unlockAchievement('comeback_1000');
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
                <div data-ach-id="${ach.id}" title="Click for details" style="
                    padding: 15px;
                    background: ${unlocked ? '#222' : '#111'};
                    border: 2px solid ${unlocked ? '#00ff00' : '#333'};
                    border-radius: 5px;
                    opacity: ${unlocked ? '1' : '0.6'};
                    cursor: pointer;
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
