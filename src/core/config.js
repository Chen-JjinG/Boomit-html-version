/**
 * 游戏配置常量
 */
const CONFIG = {
    cols: 19,
    rows: 15,
    tileSize: 50,
    bombTimer: 3000,
    explosionDuration: 500,
    softWallDensity: 0.6,
    powerUpChance: 0.5, // 提高到 50% 几率掉落道具
    initialExplosionRange: 1,
    initialMaxBombs: 1,
    initialLandmines: 0, 
    initialRockets: 0,
    initialMoveCooldown: 200, // 降低初始冷却，让手感更顺滑
    minMoveCooldown: 80, // 最高移速限制更低，加速效果更明显
    colors: ['blue', 'red', 'green', 'yellow']
};

const AI_PERSONALITIES = ['aggressive', 'conservative', 'sneaky', 'balanced'];

// 预定义角色图标
const CHAR_ICONS = ['🤖', '🐱', '🦊', '🐶'];
