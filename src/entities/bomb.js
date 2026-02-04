/**
 * 炸弹类：处理炸弹的放置、倒计时和爆炸逻辑
 */
class Bomb {
    constructor(x, y, owner) {
        this.x = x;
        this.y = y;
        this.owner = owner;
        this.range = owner.explosionRange;
        this.placedTime = Date.now(); // 记录放置时间，用于 AI 风险评估
        this.element = document.createElement('div');
        this.element.className = 'bomb';
        this.element.style.left = `${x * CONFIG.tileSize}px`;
        this.element.style.top = `${y * CONFIG.tileSize}px`;
        const board = document.getElementById('game-board');
        if (board) board.appendChild(this.element);

        // 设置爆炸倒计时
        this.explodeTimer = setTimeout(() => this.explode(), CONFIG.bombTimer);
    }

    /**
     * 销毁炸弹（清理倒计时和 DOM）
     */
    destroy() {
        if (this.explodeTimer) clearTimeout(this.explodeTimer);
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }

    /**
     * 执行爆炸逻辑
     */
    explode() {
        if (this.exploded) return;
        this.exploded = true;

        if (this.owner) this.owner.activeBombs--;

        // 从全局列表中移除
        gameState.bombs = gameState.bombs.filter(b => b !== this);
        if (this.element.parentNode) this.element.parentNode.removeChild(this.element);

        const directions = [
            {dx: 0, dy: -1}, {dx: 0, dy: 1}, 
            {dx: -1, dy: 0}, {dx: 1, dy: 0}
        ];

        // 中心爆炸
        this.createExplosionAt(this.x, this.y);

        // 四个方向延伸爆炸
        directions.forEach(d => {
            for (let r = 1; r <= this.range; r++) {
                const ex = this.x + d.dx * r;
                const ey = this.y + d.dy * r;

                if (ex < 0 || ex >= CONFIG.cols || ey < 0 || ey >= CONFIG.rows) break;
                
                const cellType = gameState.grid[ey][ex];
                if (cellType === 'wall-hard') break; // 被硬墙挡住

                this.createExplosionAt(ex, ey);

                if (cellType === 'wall-soft') {
                    this.destroySoftWall(ex, ey); // 炸毁软墙
                    break; // 爆炸不穿透软墙
                }
            }
        });
    }

    /**
     * 在指定位置创建爆炸特效并检测伤害
     * @param {number} ex 爆炸中心X
     * @param {number} ey 爆炸中心Y
     * @param {boolean} isBright 是否为亮色特效
     * @param {string} reason 爆炸原因
     */
    createExplosionAt(ex, ey, isBright = false, reason = 'bomb') {
        const board = document.getElementById('game-board');
        const expEl = document.createElement('div');
        expEl.className = `explosion ${isBright ? 'explosion-bright' : ''}`;
        expEl.style.left = `${ex * CONFIG.tileSize}px`;
        expEl.style.top = `${ey * CONFIG.tileSize}px`;
        if (board) board.appendChild(expEl);
        
        // 特效消失计时
        setTimeout(() => {
            if (expEl.parentNode) expEl.parentNode.removeChild(expEl);
        }, CONFIG.explosionDuration);

        // 检测玩家伤害
        for (let i = gameState.players.length - 1; i >= 0; i--) {
            const player = gameState.players[i];
            if (player.x === ex && player.y === ey) {
                if (typeof handlePlayerDeath === 'function') handlePlayerDeath(player, this.owner, reason);
            }
        }

        // 检测敌人伤害
        for (let i = gameState.enemies.length - 1; i >= 0; i--) {
            const enemy = gameState.enemies[i];
            if (enemy.x === ex && enemy.y === ey) {
                if (!enemy.alive) continue;
                enemy.die(this.owner, reason);
                
                if (!gameState.isTestMode) {
                    // 非测试模式下，延迟移除敌人并检查游戏结束
                    setTimeout(() => {
                        const index = gameState.enemies.indexOf(enemy);
                        if (index !== -1) {
                            gameState.enemies.splice(index, 1);
                            if (typeof updateEnemyCount === 'function') updateEnemyCount();
                        }
                        if (typeof checkGameEnd === 'function') checkGameEnd();
                    }, 1500);
                }
            }
        }
        
        // 连锁反应：引爆其他炸弹
        const otherBomb = gameState.bombs.find(b => b.x === ex && b.y === ey && b !== this);
        if (otherBomb) otherBomb.explode();

        // 引爆地雷
        const mine = gameState.landmines.find(m => m.x === ex && m.y === ey);
        if (mine) mine.explode(true);
    }

    /**
     * 炸毁软墙并可能掉落道具
     */
    destroySoftWall(ex, ey) {
        gameState.grid[ey][ex] = 'floor';
        const board = document.getElementById('game-board');
        const cellEl = board.querySelector(`.cell[data-x="${ex}"][data-y="${ey}"]`);
        if (cellEl) cellEl.className = 'cell floor';

        // 随机掉落道具
        if (Math.random() < CONFIG.powerUpChance) {
            let types = ['range', 'speed', 'bombCount', 'landmine', 'rocket'];
            
            // 初始出生点附近不掉落地雷，防止开局自杀
            const isNearSpawn = (x, y) => {
                const spawns = [
                    {x: 1, y: 1}, 
                    {x: CONFIG.cols - 2, y: 1}, 
                    {x: 1, y: CONFIG.rows - 2}, 
                    {x: CONFIG.cols - 2, y: CONFIG.rows - 2}
                ];
                return spawns.some(s => Math.abs(s.x - x) + Math.abs(s.y - y) <= 4);
            };

            if (isNearSpawn(ex, ey)) {
                types = types.filter(t => t !== 'landmine');
            }

            const type = types[Math.floor(Math.random() * types.length)];
            const pu = new PowerUp(ex, ey, type);
            gameState.powerUps.push(pu);
        }
    }
}
