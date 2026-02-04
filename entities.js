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
                this.landmines = (this.landmines || 0) + 1;
                this.rockets = 0; // 切换武器
                this.activeWeapon = 'landmine';
                break;
            case 'rocket':
                this.rockets = (this.rockets || 0) + 2;
                this.landmines = 0; // 切换武器
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

/**
 * 炸弹类：处理炸弹的放置、倒计时和爆炸逻辑
 */
class Bomb {
    constructor(x, y, owner) {
        this.x = x;
        this.y = y;
        this.owner = owner;
        this.range = owner.explosionRange;
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
        if (this.element && this.element.parentNode) this.element.parentNode.removeChild(this.element);
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

/**
 * 智能敌人 AI 类：包含不同难度的决策逻辑
 */
class SmartEnemy extends Entity {
    constructor(x, y, id, colorIndex = 1, difficulty = 'normal', personality = 'balanced') {
        super(x, y, 'enemy', colorIndex);
        this.id = id;
        this.charIndex = colorIndex;
        this.difficulty = difficulty;     // 难度：easy, normal, hard
        this.personality = personality;   // 性格：aggressive, conservative, sneaky, balanced
        
        this.explosionRange = CONFIG.initialExplosionRange;
        this.maxBombs = CONFIG.initialMaxBombs;
        this.activeBombs = 0;
        
        this.moveCooldown = CONFIG.initialMoveCooldown || 200;
        this.element.textContent = CHAR_ICONS[colorIndex % CHAR_ICONS.length];
        
        this.lastActionTime = 0;
        // 根据难度设置思考频率
        this.thinkInterval = this.difficulty === 'hard' ? 150 : (this.difficulty === 'easy' ? 600 : 300);
        this.aiInterval = setInterval(() => this.think(), this.thinkInterval);
    }

    /**
     * 销毁 AI 实体
     */
    destroy() {
        if (this.aiInterval) {
            clearInterval(this.aiInterval);
            this.aiInterval = null;
        }
        super.destroy();
    }

    /**
     * 判断放置炸弹是否有意义（能否炸到墙或目标）
     */
    isBombUseful(type = 'any') {
        const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
        for (const d of dirs) {
            for (let r = 1; r <= this.explosionRange; r++) {
                const nx = this.x + d.dx * r;
                const ny = this.y + d.dy * r;
                if (nx < 0 || nx >= CONFIG.cols || ny < 0 || ny >= CONFIG.rows) break;
                const cell = gameState.grid[ny][nx];
                if (cell === 'wall-hard') break;
                
                // 检查是否能炸到软墙
                if ((type === 'any' || type === 'wall') && cell === 'wall-soft') return true;
                
                // 检查是否能炸到其他实体
                if (type === 'any' || type === 'target') {
                    const target = [...gameState.players, ...gameState.enemies].find(e => 
                        e !== this && e.alive && e.x === nx && e.y === ny
                    );
                    if (target) return true;
                }
                if (cell === 'wall-soft') break;
            }
        }
        return false;
    }

    /**
     * 针对困难难度 AI 的目标位置预测
     */
    predictTargetPosition(target) {
        if (this.difficulty !== 'hard' || !target.moveHistory || target.moveHistory.length === 0) return target;
        
        // 基于移动历史计算趋势
        let trendX = 0, trendY = 0;
        target.moveHistory.forEach(move => { trendX += move.dx; trendY += move.dy; });
        
        // 预测下一格
        const px = target.x + Math.sign(trendX);
        const py = target.y + Math.sign(trendY);
        
        if (this.canMoveTo(px, py)) {
            // 进一步检查：如果目标正在逃离炸弹，预测其逃生终点
            const dangerMap = AIUtils.getDangerMap(gameState, CONFIG);
            if (dangerMap[target.y][target.x] > 0) {
                const safePath = AIUtils.findPath(target, (x, y) => dangerMap[y][x] === 0, gameState, false, false);
                if (safePath && safePath.length > 0) {
                    // 预测目标会向安全点移动
                    return { x: safePath[0].x, y: safePath[0].y };
                }
            }
            return { x: px, y: py };
        }
        return target;
    }

    /**
     * 检查是否有清晰的射击路径（针对火箭筒）
     */
    hasClearShot(tx, ty) {
        const dx = Math.sign(tx - this.x);
        const dy = Math.sign(ty - this.y);
        if (dx !== 0 && dy !== 0) return false; // 不在同一直线上

        let currX = this.x + dx;
        let currY = this.y + dy;
        while (currX !== tx || currY !== ty) {
            if (gameState.grid[currY][currX] !== 'floor') return false;
            if (gameState.bombs.some(b => b.x === currX && b.y === currY)) return false;
            currX += dx;
            currY += dy;
        }
        return true;
    }

    /**
     * 寻找最佳射击/放置位置
     */
    findFiringPosition(target) {
        const candidates = [];
        const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
        
        for (const d of dirs) {
            // 在射程范围内寻找可以炸到目标的位置
            for (let r = 1; r <= this.explosionRange; r++) {
                const nx = target.x + d.dx * r;
                const ny = target.y + d.dy * r;
                
                if (nx >= 0 && nx < CONFIG.cols && ny >= 0 && ny < CONFIG.rows) {
                    if (gameState.grid[ny][nx] === 'floor' && this.canMoveTo(nx, ny)) {
                        // 检查视线是否被硬墙阻挡
                        let blocked = false;
                        for (let i = 1; i < r; i++) {
                            if (gameState.grid[target.y + d.dy * i][target.x + d.dx * i] === 'wall-hard') {
                                blocked = true;
                                break;
                            }
                        }
                        if (!blocked) candidates.push({x: nx, y: ny, dist: r});
                    }
                }
            }
        }
        
        if (candidates.length === 0) return null;
        
        // 选择离当前位置最近的有效射击位
        let bestPos = null;
        let minPathLength = Infinity;
        for (const cand of candidates) {
            const path = AIUtils.findPath(this, cand, gameState, true, false, this);
            if (path && path.length < minPathLength) {
                minPathLength = path.length;
                bestPos = cand;
            }
        }
        return bestPos;
    }

    /**
     * AI 决策入口：根据难度调用不同的思考逻辑
     */
    think() {
        if (!this.alive || gameState.isTestMode) return;
        const now = Date.now();
        if (now - this.lastMoveTime < this.moveCooldown) return;

        switch (this.difficulty) {
            case 'easy':
                this.thinkEasy();
                break;
            case 'hard':
                this.thinkHard();
                break;
            case 'normal':
            default:
                this.thinkNormal();
                break;
        }
    }

    /**
     * 简单难度 AI：主要随机移动，偶尔拆墙，基本不主动攻击
     */
    thinkEasy() {
        const dangerMap = AIUtils.getDangerMap(gameState, CONFIG, this);
        if (dangerMap[this.y][this.x] > 0) {
            this.escape(dangerMap);
            return;
        }

        // 较低概率尝试拆墙
        if (Math.random() < 0.2 && this.isBombUseful('wall') && this.canPlaceBombSafely()) {
            this.performAction();
            return;
        }

        // 主要是随机移动
        this.randomMove(dangerMap);
    }

    /**
     * 普通难度 AI：原有的平衡逻辑
     */
    thinkNormal() {
        const dangerMap = AIUtils.getDangerMap(gameState, CONFIG, this);
        if (dangerMap[this.y][this.x] > 0) {
            this.escape(dangerMap);
            return;
        }

        const targets = [...gameState.players, ...gameState.enemies].filter(e => e !== this && e.alive);
        let closestTarget = null;
        let minTargetDist = Infinity;
        
        targets.forEach(t => {
            const dist = AIUtils.getDistance(this, t);
            if (dist < minTargetDist) {
                minTargetDist = dist;
                closestTarget = t;
            }
        });

        if (closestTarget) {
            const predictedTarget = this.predictTargetPosition(closestTarget);
            
            // 普通攻击尝试
            if (Math.random() < 0.6) {
                if (this.activeWeapon === 'bomb' && this.isBombUseful('target') && this.canPlaceBombSafely()) {
                    this.performAction();
                    return;
                }
            }

            // 移动向目标
            const path = AIUtils.findPath(this, predictedTarget, gameState, true, false, this);
            if (path && path.length > 0) {
                this.executeMove(path[0].dx, path[0].dy);
                return;
            }
        }

        // 拆墙
        if (this.isBombUseful('wall') && this.canPlaceBombSafely()) {
            this.performAction();
            return;
        }

        this.randomMove(dangerMap);
    }

    /**
     * 困难难度 AI：包含预测、围堵、高级武器使用的复杂逻辑
     */
    thinkHard() {
        const dangerMap = AIUtils.getDangerMap(gameState, CONFIG, this);
        if (dangerMap[this.y][this.x] > 0) {
            this.escape(dangerMap);
            return;
        }

        // 2. 寻找最近的目标
        const targets = [...gameState.players, ...gameState.enemies].filter(e => e !== this && e.alive);
        let closestTarget = null;
        let minTargetDist = Infinity;
        
        targets.forEach(t => {
            const dist = AIUtils.getDistance(this, t);
            if (dist < minTargetDist) {
                minTargetDist = dist;
                closestTarget = t;
            }
        });

        // 3. 进攻策略
        if (closestTarget) {
            const predictedTarget = this.predictTargetPosition(closestTarget);
            let attackChance = 0.85;
            if (this.personality === 'aggressive') attackChance = 0.95;
            
            // 尝试“围堵”和“连招”
            if (this.isTargetTrapped(predictedTarget)) {
                if (this.canPlaceBombSafely()) {
                    this.performAction();
                    // 连招：放完炸弹如果还有火箭筒，往逃生方向射一发
                    if (this.activeWeapon === 'rocket' && this.rockets > 0) {
                        setTimeout(() => {
                            if (this.alive) this.performAction();
                        }, 100);
                    }
                    return;
                }
            }

            if (Math.random() < attackChance) {
                // 火箭筒攻击
                if (this.activeWeapon === 'rocket' && this.rockets > 0) {
                    if ((this.x === predictedTarget.x || this.y === predictedTarget.y) && 
                        this.hasClearShot(predictedTarget.x, predictedTarget.y)) {
                        this.performAction();
                        return;
                    }
                } 
                // 地雷伏击
                else if (this.activeWeapon === 'landmine' && this.landmines > 0) {
                    if (AIUtils.getDistance(this, predictedTarget) <= 2) {
                        this.performAction();
                        this.escape(AIUtils.getDangerMap(gameState, CONFIG, this));
                        return;
                    }
                } 
                // 普通炸弹攻击
                else if (this.activeWeapon === 'bomb') {
                    const inRange = (this.x === predictedTarget.x && Math.abs(this.y - predictedTarget.y) <= this.explosionRange) ||
                                  (this.y === predictedTarget.y && Math.abs(this.x - predictedTarget.x) <= this.explosionRange);
                    
                    if (inRange && this.isBombUseful('target') && this.canPlaceBombSafely()) {
                        this.performAction();
                        return;
                    }
                }
            }

            // 优先移动到射击位
            const firingPos = this.findFiringPosition(predictedTarget);
            if (firingPos) {
                const path = AIUtils.findPath(this, firingPos, gameState, true, false, this);
                if (path && path.length > 0) {
                    this.executeMove(path[0].dx, path[0].dy);
                    return;
                }
            }
            
            const path = AIUtils.findPath(this, predictedTarget, gameState, true, false, this);
            if (path && path.length > 0) {
                this.executeMove(path[0].dx, path[0].dy);
                return;
            }
        }

        // 4. 搜寻道具 (困难 AI 更积极搜寻道具)
        const visiblePowerUps = gameState.powerUps.filter(p => AIUtils.getDistance(this, p) < 12);
        if (visiblePowerUps.length > 0) {
            let bestPath = null;
            let minDist = Infinity;
            for (const pu of visiblePowerUps) {
                const path = AIUtils.findPath(this, pu, gameState, true, false, this);
                if (path && path.length < minDist) {
                    minDist = path.length;
                    bestPath = path;
                }
            }
            if (bestPath) {
                this.executeMove(bestPath[0].dx, bestPath[0].dy);
                return;
            }
        }

        // 5. 拆墙开路
        if (this.isBombUseful('wall') && this.canPlaceBombSafely()) {
            this.performAction();
            return;
        }

        const wallPath = AIUtils.findPath(this, (x, y) => gameState.grid[y][x] === 'wall-soft', gameState, true, true, this);
        if (wallPath && wallPath.length > 0) {
            const next = wallPath[0];
            if (next.type === 'wall-soft') {
                if (this.canPlaceBombSafely()) this.performAction();
            } else {
                this.executeMove(next.dx, next.dy);
            }
            return;
        }

        this.randomMove(dangerMap);
    }

    /**
     * 检查目标是否处于易受攻击的状态（走廊或死角）
     */
    isTargetTrapped(target) {
        const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
        let walkableNeighbors = 0;
        dirs.forEach(d => {
            if (this.canMoveTo(target.x + d.dx, target.y + d.dy)) walkableNeighbors++;
        });
        return walkableNeighbors <= 2; // 只有两条或更少的路，容易被堵死
    }

    /**
     * 逃生逻辑：寻找安全路径
     */
    escape(dangerMap) {
        // 尝试寻找安全路径
        const safePath = AIUtils.findPath(this, (x, y) => dangerMap[y][x] === 0, gameState, false, false, this);
        if (safePath && safePath.length > 0) {
            this.executeMove(safePath[0].dx, safePath[0].dy);
        } else {
            // 如果无处可躲，尝试炸开一条生路（仅限困难难度）
            if (this.difficulty === 'hard' && this.canPlaceBombSafely()) {
                const softWallNear = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}].find(d => 
                    gameState.grid[this.y + d.dy][this.x + d.dx] === 'wall-soft'
                );
                if (softWallNear) {
                    this.performAction();
                    return;
                }
            }
            this.randomMove(dangerMap);
        }
    }

    /**
     * 随机移动（避开危险）
     */
    randomMove(dangerMap) {
        const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}]
            .sort(() => Math.random() - 0.5);
        
        for (const d of dirs) {
            const nx = this.x + d.dx;
            const ny = this.y + d.dy;
            if (this.canMoveTo(nx, ny) && dangerMap[ny][nx] === 0) {
                this.executeMove(d.dx, d.dy);
                return;
            }
        }
    }

    /**
     * 执行移动并更新冷却计时
     */
    executeMove(dx, dy) {
        if (this.move(dx, dy)) {
            this.lastMoveTime = Date.now();
        }
    }

    /**
     * 核心安全检查：模拟放置炸弹后是否仍有逃生路径
     */
    canPlaceBombSafely() {
        if (this.activeBombs >= this.maxBombs) return false;
        
        // 模拟放置炸弹后的危险地图
        const tempBombs = [...gameState.bombs, {x: this.x, y: this.y, range: this.explosionRange}];
        const tempGameState = { ...gameState, bombs: tempBombs };
        const futureDangerMap = AIUtils.getDangerMap(tempGameState, CONFIG, this);
        
        // 检查是否存在逃向安全区域的路径
        const safePath = AIUtils.findPath(this, (x, y) => futureDangerMap[y][x] === 0, tempGameState, false, false, this);
        return safePath !== null;
    }
}
