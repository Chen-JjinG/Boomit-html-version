/**
 * 道具类：处理游戏地图上掉落的各种增强道具
 */
class PowerUp {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type; // 道具类型：range, speed, bombCount, landmine, rocket
        this.element = document.createElement('div');
        this.element.className = `powerup ${type}`;
        this.element.style.left = `${x * CONFIG.tileSize}px`;
        this.element.style.top = `${y * CONFIG.tileSize}px`;
        const board = document.getElementById('game-board');
        if (board) board.appendChild(this.element);
    }

    /**
     * 移除道具 DOM 元素
     */
    destroy() {
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }
}
