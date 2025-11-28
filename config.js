// Game configuration constants
export const CONFIG = {
    // Canvas dimensions
    CANVAS_WIDTH: 800,
    CANVAS_HEIGHT: 700,
    
    // Player settings
    PLAYER: {
        START_X: 400,
        START_Y: 650,
        WIDTH: 20,
        HEIGHT: 20,
        SPEED: 5,
        COLOR: '#00ff00',
        MOUSE_FOLLOW_SPEED: 0.3,
        INVINCIBILITY_DURATION: 1.0 // seconds
    },
    
    // Obstacle settings
    OBSTACLE: {
        SPAWN_RATE: 0.05,
        BASE_SPEED: 5,
        WIDTH: 30,
        HEIGHT: 30,
        COLOR: '#ff0000',
        ASTEROID_CHANCE: 0.7,
        SPEED_VARIANCE: 2
    },
    
    // Game settings
    GAME: {
        INITIAL_LIVES: 3,
        SCORE_PER_SECOND: 10,
        LEVEL_DURATION: 10,
        SPAWN_RATE_INCREASE: 0.01,
        SPEED_INCREASE: 1,
        BOSS_LEVEL_INTERVAL: 4,
        MAX_SPAWN_RATE: 2,
        MAX_SPEED: 200
    },
    
    // Boss settings
    BOSS: {
        X: 400,
        Y: 100,
        RADIUS: 60,
        COLOR: '#ff6600',
        ATTACK_COOLDOWN: 4,
        LEVEL_DURATION: 10,
        ATTACK_WINDOW_END: 8
    },
    
    // Boss attack settings
    BOSS_ATTACKS: {
        SPIKE_COUNT: 3,
        SPIKE_WIDTH: 20,
        SPIKE_HEIGHT: 700,
        SPIKE_WARNING_DURATION: 1,
        SPIKE_ATTACK_DURATION: 5,
        DOUBLE_SPIKE_COUNT: 5,
        WALL_TARGET_GAP: 200,
        WALL_COLLAPSE_SPEED: 1,
        MOVING_SAFE_WIDTH: 400,
        MOVING_SAFE_SPEED: 2,
        GIANT_OBSTACLE_RADIUS: 200,
        GIANT_OBSTACLE_START_Y: -200,
        GIANT_OBSTACLE_FALL_SPEED: 3,
        DOUBLE_OBSTACLES_DURATION: 5,
        GRAVITY_TRIGGER_DELAY: 5,
        GRAVITY_DURATION: 3,
        GRAVITY_SPEED_MULTIPLIER: 5
    },
    
    // Visual settings
    VISUAL: {
        STAR_COUNT: 100,
        STAR_MIN_SPEED: 0.5,
        STAR_MAX_SPEED: 2.5,
        EXPLOSION_INITIAL_SIZE: 20,
        EXPLOSION_LIFE: 15,
        EXPLOSION_GROWTH_RATE: 0.5,
        EXPLOSION_COLOR: '#ff0000',
        WARNING_ALPHA: 0.5,
        SAFE_ZONE_ALPHA: 0.2,
        DANGER_ZONE_ALPHA: 0.3,
        SCREEN_SHAKE_INTENSITY: 10,
        SCREEN_SHAKE_DURATION: 0.3,
        LEVEL_FLASH_DURATION: 0.1,
        LEVEL_FLASH_COLOR: '#ffffff'
    },
    
    // Colors
    COLORS: {
        BACKGROUND: '#000',
        STAR: '#ffffff',
        WARNING: '#ffff00',
        SAFE_ZONE: '#00ff00',
        DANGER_ZONE: 'rgba(255, 0, 0, 0.3)',
        BOSS_HEALTH_BG: '#333',
        BOSS_HEALTH_BAR: '#ff0000'
    },
    
    // LocalStorage keys
    STORAGE: {
        HIGH_SCORE: 'spaceDodgerHighScore',
        METRICS: 'spaceDodgerMetrics',
        PLAYER_NAME: 'spaceDodgerPlayerName',
        ACHIEVEMENTS: 'spaceDodgerAchievements'
    },
    
    // API settings
    API: {
        BASE_URL: 'http://localhost:3000',
        LEADERBOARD_LIMIT: 100
    },
    
    // Power-up settings
    POWER_UPS: {
        SPAWN_RATE: 0.0005, // Chance per frame, approximately every 30-40 seconds
        WIDTH: 25,
        HEIGHT: 25,
        FALL_SPEED: 1.5,
        ROTATION_SPEED: 2, // rad/s
        SHIELD: {
            COLOR: '#00ffff',
            DURATION: 10,
            NAME: 'Shield'
        },
        SLOW_DOWN: {
            COLOR: '#ffff00',
            DURATION: 10,
            SPEED_REDUCTION: 0.20, // 20% reduction
            NAME: 'Slow Down'
        }
    }
};

