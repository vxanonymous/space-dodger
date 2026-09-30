// Game configuration constants

// The deployed frontend talks to the hosted API; local dev (any localhost port)
// talks to a local backend so playtest scores never reach the production leaderboard.
const IS_LOCALHOST = typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname);

export const CONFIG = {
    // Canvas dimensions
    CANVAS_WIDTH: 800,
    CANVAS_HEIGHT: 700,

    // Player settings
    PLAYER: {
        START_X: 400,
        WIDTH: 20,
        HEIGHT: 20,
        COLOR: '#00ff00',
        MOUSE_FOLLOW_SPEED: 0.3, // convergence per 1/60s frame; frame-rate normalized in updatePlayer
        INVINCIBILITY_DURATION: 1.0 // seconds
    },

    // Obstacle settings
    // SPAWN_RATE is the expected obstacles per 1/60s frame; speeds are px per 1/60s frame
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
        // A spawn rate of 1 already means one obstacle every frame, so this cap
        // must stay well below 1 to actually prevent the kill screen
        MAX_SPAWN_RATE: 0.3,
        // Px per 1/60s frame. Matches the original ramp (effectively uncapped in
        // realistic runs); swept collision keeps hits registering at any speed
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
        DANGER_ZONE: 'rgba(255, 0, 0, 0.3)'
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
        BASE_URL: IS_LOCALHOST ? 'http://localhost:3000' : 'https://space-dodger-api.onrender.com',
        LEADERBOARD_LIMIT: 100,
        TIMEOUT_MS: 8000
    },

    // Power-up settings
    POWER_UPS: {
        SPAWN_RATE: 0.0005, // Expected spawns per 1/60s frame, approximately every 30-40 seconds
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
