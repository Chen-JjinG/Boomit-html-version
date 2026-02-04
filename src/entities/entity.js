/**
 * 实体基类：玩家和 AI 敌人的共同基类，包含移动、碰撞检测和动作执行等通用逻辑
 */
class Entity {
    constructor(x, y, type, colorIndex = 0) {
        this.x = x;
        this.y = y;
        this.type = type; // 'player' 或 'enemy'
        this.colorIndex = colorIndex;
        this.activeWeapon = 'bomb'; // 当前武器：bomb, landmine, rocket
        this.landmines = 0; // 持有地雷数
        this.rockets = 0;   // 持有火箭弹数
        this.facing = 'down'; // 朝向：up, down, left, right
        this.alive = true;
        this.element = document.createElement('div');
        this.element.className = `entity ${type} color-${CONFIG.colors[colorIndex]}`;
        this.element.dataset.facing = this.facing;
        this.updatePosition();
        this.moveHistory = []; // 记录最近 3 次移动，用于 AI 预测
        const board = document.getElementById('game-board');
        if (board) board.appendChild(this.element);
    }

    /**
     * 更新实体在页面上的位置
     */
    updatePosition() {
        this.element.style.left = `${this.x * CONFIG.tileSize}px`;
        this.element.style.top = `${this.y * CONFIG.tileSize}px`;
    }

    /**
     * 检查目标位置是否可通行
     */
    canMoveTo(nx, ny) {
        // 越界检查
        if (nx < 0 || nx >= CONFIG.cols || ny < 0 || ny >= CONFIG.rows) return false;
        
        // 墙壁检查
        const cell = gameState.grid[ny][nx];
        if (cell === 'wall-hard' || cell === 'wall-soft') return false;
        
        // 炸弹阻挡检查
        const hasBomb = gameState.bombs.some(b => b.x === nx && b.y === ny);
        if (hasBomb) return false;

        return true;
    }

    /**
     * 执行移动逻辑
     * @param {number} dx X轴偏移量
     * @param {number} dy Y轴偏移量
     */
    move(dx, dy) {
        const nx = this.x + dx;
        const ny = this.y + dy;
        this.lastDir = {dx, dy};
        
        // 更新朝向
        if (dx > 0) this.facing = 'right';
        else if (dx < 0) this.facing = 'left';
        else if (dy > 0) this.facing = 'down';
        else if (dy < 0) this.facing = 'up';
        this.element.dataset.facing = this.facing;

        if (this.canMoveTo(nx, ny)) {
            this.x = nx;
            this.y = ny;
            this.updatePosition();
            
            // 记录移动历史 (AI 预测用)
            this.moveHistory.push({dx, dy});
            if (this.moveHistory.length > 3) this.moveHistory.shift();
            
            // 玩家走出地雷范围后激活地雷
            gameState.landmines.forEach(m => {
                if (m.owner === this && !m.isArmed) {
                    if (this.x !== m.x || this.y !== m.y) {
                        m.isArmed = true;
                    }
                }
            });

            // 检查碰撞：道具、地雷、火箭弹
            if (this.type.startsWith('player') || this.type === 'enemy') {
                this.checkPowerUpPickup(nx, ny);
                
                const mine = gameState.landmines.find(m => m.x === nx && m.y === ny);
                if (mine) mine.checkTrigger(this);

                const rocket = gameState.rockets.find(r => r.x === nx && r.y === ny);
                if (rocket) rocket.explode(nx, ny);
            }
            return true;
        }
        return false;
    }

    /**
     * 检查并拾取指定坐标的道具
     */
    checkPowerUpPickup(x, y) {
        const index = gameState.powerUps.findIndex(p => p.x === x && p.y === y);
        if (index !== -1) {
            const pu = gameState.powerUps[index];
            const type = pu.type;
            this.applyPowerUp(type);
            pu.destroy();
            gameState.powerUps.splice(index, 1);

            // 测试模式下道具会自动刷新
            if (gameState.isTestMode) {
                this.pickupTimer = setTimeout(() => {
                    if (gameState.isStarted && !gameState.isGameOver) {
                        gameState.powerUps.push(new PowerUp(x, y, type));
                    }
                }, 1000);
            }
        }
    }

    /**
     * 应用道具效果
     */
    applyPowerUp(type) {
        switch(type) {
            case 'range':
                this.explosionRange++;
                break;
            case 'speed':
                // 减少移动冷却时间（增加移动速度）
                this.moveCooldown = Math.max(CONFIG.minMoveCooldown, this.moveCooldown - 40);
                break;
            case 'bombCount':
                this.maxBombs++;
                break;
            case 'landmine':
                // 统一道具规则：捡到新攻击道具直接替换，不叠加，用完变回炸弹
                this.landmines = 1; 
                this.rockets = 0; 
                this.activeWeapon = 'landmine';
                break;
            case 'rocket':
                // 统一道具规则：捡到新攻击道具直接替换，不叠加，用完变回炸弹
                this.rockets = 2;
                this.landmines = 0;
                this.activeWeapon = 'rocket';
                break;
        }
        if (typeof updateStatusDisplay === 'function') updateStatusDisplay();
    }

    /**
     * 根据当前选定的武器执行动作
     */
    performAction() {
        if (this.activeWeapon === 'rocket' && this.rockets > 0) {
            this.placeRocket();
        } else if (this.activeWeapon === 'landmine' && this.landmines > 0) {
            this.placeLandmine();
        } else {
            this.placeBomb();
        }
    }

    /**
     * 放置普通炸弹
     */
    placeBomb() {
        if (this.activeBombs >= this.maxBombs) return;
        if (gameState.bombs.some(b => b.x === this.x && b.y === this.y)) return;
        if (gameState.landmines.some(m => m.x === this.x && m.y === this.y)) return;

        this.activeBombs++;
        const bomb = new Bomb(this.x, this.y, this);
        gameState.bombs.push(bomb);
        if (typeof updateStatusDisplay === 'function') updateStatusDisplay();
    }

    /**
     * 放置地雷
     */
    placeLandmine() {
        if (!this.landmines || this.landmines <= 0) {
            this.activeWeapon = 'bomb';
            return;
        }
        if (gameState.landmines.some(m => m.x === this.x && m.y === this.y)) return;
        if (gameState.bombs.some(b => b.x === this.x && b.y === this.y)) return;

        this.landmines--;
        if (this.landmines <= 0) {
            this.landmines = 0;
            this.activeWeapon = 'bomb';
        }
        const mine = new Landmine(this.x, this.y, this);
        gameState.landmines.push(mine);
        if (typeof updateStatusDisplay === 'function') updateStatusDisplay();
    }

    /**
     * 发射火箭弹
     */
    placeRocket() {
        if (!this.rockets || this.rockets <= 0) {
            this.activeWeapon = 'bomb';
            return;
        }
        const dir = this.lastDir || {dx: 0, dy: -1}; // 默认向上发射
        const nx = this.x + dir.dx;
        const ny = this.y + dir.dy;

        // 起点不能越界
        if (nx < 0 || nx >= CONFIG.cols || ny < 0 || ny >= CONFIG.rows) return;

        this.rockets--;
        if (this.rockets <= 0) {
            this.rockets = 0;
            this.activeWeapon = 'bomb';
        }
        const rocket = new Rocket(nx, ny, dir.dx, dir.dy, this);
        gameState.rockets.push(rocket);
        if (typeof updateStatusDisplay === 'function') updateStatusDisplay();
    }

    /**
     * 实体阵亡处理
     * @param {Entity} killer 击杀者
     * @param {string} reason 击杀原因 (bomb, rocket, landmine)
     */
    die(killer = null, reason = 'unknown') {
        if (gameState.isTestMode) {
            // 测试模式下只是闪烁
            this.element.classList.add('hit-flash');
            this.respawnTimer = setTimeout(() => {
                this.element.classList.remove('hit-flash');
                this.alive = true;
                if (typeof updateStatusDisplay === 'function') updateStatusDisplay();
            }, 1000);
            return;
        }

        this.alive = false;
        
        // 记录阵亡原因
        if (killer) {
            const killerName = killer.type.startsWith('player') ? `P${killer.id}` : `敌人 ${killer.id}`;
            const reasonName = {
                'bomb': '炸弹',
                'rocket': '火箭弹',
                'landmine': '地雷',
                'unknown': '未知原因'
            }[reason] || reason;
            this.deathCause = `被 ${killerName} 的 ${reasonName} 击败`;
        } else {
            this.deathCause = '意外阵亡';
        }

        if (this.element) {
            this.element.classList.add('entity-death'); // 播放阵亡动画
            setTimeout(() => {
                if (this.element && this.element.parentNode) {
                    this.element.parentNode.removeChild(this.element);
                }
            }, 1500); // 1.5s 后移除元素，与 CSS 动画时间匹配
        }
        
        if (typeof updateStatusDisplay === 'function') updateStatusDisplay();
    }

    /**
     * 销毁实体（清理计时器和 DOM）
     */
    destroy() {
        this.alive = false;
        if (this.respawnTimer) clearTimeout(this.respawnTimer);
        if (this.pickupTimer) clearTimeout(this.pickupTimer);
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }
}
