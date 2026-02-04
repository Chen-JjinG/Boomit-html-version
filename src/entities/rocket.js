/**
 * 火箭类：处理火箭弹的飞行、碰撞和爆炸逻辑
 */
class Rocket {
    constructor(x, y, dx, dy, owner) {
        this.x = x;
        this.y = y;
        this.dx = dx;
        this.dy = dy;
        this.owner = owner;
        this.exploded = false;
        this.element = document.createElement('div');
        this.element.className = 'rocket-projectile';
        this.element.textContent = '🚀';
        this.element.style.left = `${x * CONFIG.tileSize}px`;
        this.element.style.top = `${y * CONFIG.tileSize}px`;
        
        // 根据飞行方向旋转图标
        const angle = dx === 1 ? 90 : dx === -1 ? -90 : dy === 1 ? 180 : 0;
        this.element.style.transform = `translate(10%, 10%) rotate(${angle}deg)`;
        const board = document.getElementById('game-board');
        if (board) board.appendChild(this.element);

        // 初始位置碰撞检查
        if (this.checkCollision(this.x, this.y)) return;

        // 设置飞行计时器
        this.moveInterval = setInterval(() => this.move(), 100);
    }

    /**
     * 销毁火箭弹
     */
    destroy() {
        if (this.moveInterval) clearInterval(this.moveInterval);
        if (this.element && this.element.parentNode) this.element.parentNode.removeChild(this.element);
    }

    /**
     * 碰撞检测：检查指定位置是否有障碍物或实体
     */
    checkCollision(nx, ny) {
        if (this.exploded) return true;

        // 墙壁和越界检查
        if (nx < 0 || nx >= CONFIG.cols || ny < 0 || ny >= CONFIG.rows || gameState.grid[ny][nx] !== 'floor') {
            this.explode(nx, ny);
            return true;
        }

        // 炸弹和地雷检查
        const hasObstacle = gameState.bombs.some(b => b.x === nx && b.y === ny) || 
                           gameState.landmines.some(m => m.x === nx && m.y === ny);
        if (hasObstacle) {
            this.explode(nx, ny);
            return true;
        }

        // 实体碰撞检查
        const target = [...gameState.players, ...gameState.enemies].find(e => 
            e.alive && e.x === nx && e.y === ny && e !== this.owner
        );
        
        if (target) {
            this.explode(nx, ny);
            return true;
        }
        return false;
    }

    /**
     * 执行移动一步
     */
    move() {
        if (this.exploded) return;

        // 移动前先检查当前格（防止瞬移穿墙）
        if (this.checkCollision(this.x, this.y)) return;

        this.createTrail(); // 创建尾迹

        const nx = this.x + this.dx;
        const ny = this.y + this.dy;

        // 检查下一格
        if (this.checkCollision(nx, ny)) return;

        this.x = nx;
        this.y = ny;
        this.element.style.left = `${nx * CONFIG.tileSize}px`;
        this.element.style.top = `${ny * CONFIG.tileSize}px`;
    }

    /**
     * 创建飞行尾迹效果
     */
    createTrail() {
        const board = document.getElementById('game-board');
        const trail = document.createElement('div');
        trail.className = 'rocket-trail';
        trail.style.left = `${this.x * CONFIG.tileSize}px`;
        trail.style.top = `${this.y * CONFIG.tileSize}px`;
        if (board) board.appendChild(trail);
        
        setTimeout(() => {
            if (trail.parentNode) trail.parentNode.removeChild(trail);
        }, 500);
    }

    /**
     * 执行火箭弹爆炸逻辑
     */
    explode(ex, ey) {
        if (this.exploded) return;
        this.exploded = true;

        clearInterval(this.moveInterval);
        if (this.element && this.element.parentNode) this.element.parentNode.removeChild(this.element);
        gameState.rockets = gameState.rockets.filter(r => r !== this);

        // 创建一个临时炸弹对象来调用其爆炸方法
        const tempBomb = Object.create(Bomb.prototype);
        tempBomb.owner = this.owner;
        
        // 如果炸到自己附近，只在原地爆炸，否则产生十字形爆炸
        const isNearOwner = Math.abs(ex - this.owner.x) <= 1 && Math.abs(ey - this.owner.y) <= 1;
        const directions = isNearOwner ? [{dx: 0, dy: 0}] : [
            {dx: 0, dy: 0}, {dx: 0, dy: -1}, {dx: 0, dy: 1}, 
            {dx: -1, dy: 0}, {dx: 1, dy: 0}
        ];

        directions.forEach(d => {
            const tx = ex + d.dx;
            const ty = ey + d.dy;
            if (tx >= 0 && tx < CONFIG.cols && ty >= 0 && ty < CONFIG.rows) {
                const cellType = gameState.grid[ty][tx];
                if (cellType !== 'wall-hard') {
                    // 保护发射者不被自己的近距离火箭弹炸伤
                    if (isNearOwner && tx === this.owner.x && ty === this.owner.y) return;
                    tempBomb.createExplosionAt(tx, ty, false, 'rocket');
                    if (cellType === 'wall-soft') tempBomb.destroySoftWall(tx, ty);
                }
            }
        });
    }
}
