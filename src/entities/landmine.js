/**
 * 地雷类：处理地雷的布设、隐藏和触发逻辑
 */
class Landmine {
    constructor(x, y, owner) {
        this.x = x;
        this.y = y;
        this.owner = owner;
        this.isArmed = false; // 是否已激活（离开布设点后激活）
        this.element = document.createElement('div');
        this.element.className = 'landmine-placed';
        this.element.style.left = `${x * CONFIG.tileSize}px`;
        this.element.style.top = `${y * CONFIG.tileSize}px`;
        const board = document.getElementById('game-board');
        if (board) board.appendChild(this.element);

        // 2秒后进入隐藏状态
        this.armTimer = setTimeout(() => {
            if (this.element) this.element.classList.add('hidden-mine');
        }, 2000);
    }

    /**
     * 销毁地雷
     */
    destroy() {
        if (this.armTimer) clearTimeout(this.armTimer);
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }

    /**
     * 检查是否触发地雷
     */
    checkTrigger(entity) {
        // 发射者在未激活前不会触发
        if (entity === this.owner && !this.isArmed) return;
        this.explode(false);
    }

    /**
     * 执行地雷爆炸
     */
    explode(isChainReaction = false) {
        if (this.exploded) return;
        this.exploded = true;

        gameState.landmines = gameState.landmines.filter(m => m !== this);
        if (this.element && this.element.parentNode) this.element.parentNode.removeChild(this.element);

        // 地雷只在中心一格产生强力爆炸
        const directions = [{dx: 0, dy: 0}];
        const tempBomb = Object.create(Bomb.prototype);
        tempBomb.owner = this.owner;

        directions.forEach(d => {
            const ex = this.x + d.dx;
            const ey = this.y + d.dy;

            if (ex >= 0 && ex < CONFIG.cols && ey >= 0 && ey < CONFIG.rows) {
                const cellType = gameState.grid[ey][ex];
                if (cellType !== 'wall-hard') {
                     const isCenter = d.dx === 0 && d.dy === 0;
                     tempBomb.createExplosionAt(ex, ey, isChainReaction || isCenter, 'landmine');
                     if (cellType === 'wall-soft') tempBomb.destroySoftWall(ex, ey);
                }
            }
        });
    }
}
