/**
 * 玩家类
 */
class Player extends Entity {
    constructor(x, y, id, charIndex) {
        super(x, y, `player`, charIndex);
        this.id = id;
        this.charIndex = charIndex;
        this.explosionRange = CONFIG.initialExplosionRange;
        this.maxBombs = CONFIG.initialMaxBombs;
        this.activeBombs = 0;
        this.moveCooldown = CONFIG.initialMoveCooldown;
        this.lastMoveTime = 0;
        this.element.textContent = CHAR_ICONS[charIndex];
        
        // 玩家控制键位配置
        this.controls = id === 1 ? {
            up: ['w', 'W'],
            down: ['s', 'S'],
            left: ['a', 'A'],
            right: ['d', 'D'],
            bomb: [' ']
        } : {
            up: ['ArrowUp'],
            down: ['ArrowDown'],
            left: ['ArrowLeft'],
            right: ['ArrowRight'],
            bomb: ['0', 'Insert']
        };
    }
}
