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

const board = document.getElementById('game-board');
const startScreen = document.getElementById('start-screen');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-button');
const resultMsg = document.getElementById('result-message');
const enemyCountEl = document.getElementById('enemy-count');

let gameState = {
    grid: [],
    players: [], // 支持多个玩家
    enemies: [],
    bombs: [],
    landmines: [],
    rockets: [],
    powerUps: [],
    isGameOver: false,
    isStarted: false,
    isTestMode: false,
    keys: {},
    mode: 'single', // 'single', 'multi', 'test'
    selectedChars: [0, 1], // P1 和 P2 选择的角色索引
    difficulty: 'normal' // AI 难度：'easy', 'normal', 'hard'
};

const AI_PERSONALITIES = ['aggressive', 'conservative', 'sneaky', 'balanced'];

// 预定义角色图标
const CHAR_ICONS = ['🤖', '🐱', '🦊', '🐶'];

class PowerUp {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.element = document.createElement('div');
        this.element.className = `powerup ${type}`;
        this.element.style.left = `${x * CONFIG.tileSize}px`;
        this.element.style.top = `${y * CONFIG.tileSize}px`;
        board.appendChild(this.element);
    }

    destroy() {
        if (this.element && this.element.parentNode) {
            board.removeChild(this.element);
        }
    }
}

class Entity {
    constructor(x, y, type, colorIndex = 0) {
        this.x = x; // grid x
        this.y = y; // grid y
        this.type = type;
        this.colorIndex = colorIndex;
        this.activeWeapon = 'bomb'; // 当前激活的武器：'bomb', 'landmine', 'rocket'
        this.landmines = 0;
        this.rockets = 0;
        this.facing = 'down'; // 默认面向下
        this.element = document.createElement('div');
        this.element.className = `entity ${type} color-${CONFIG.colors[colorIndex]}`;
        this.element.dataset.facing = this.facing;
        this.updatePosition();
        this.moveHistory = []; // 记录最近的移动历史
        board.appendChild(this.element);
    }

    updatePosition() {
        this.element.style.left = `${this.x * CONFIG.tileSize}px`;
        this.element.style.top = `${this.y * CONFIG.tileSize}px`;
    }

    canMoveTo(nx, ny) {
        if (nx < 0 || nx >= CONFIG.cols || ny < 0 || ny >= CONFIG.rows) return false;
        const cell = gameState.grid[ny][nx];
        if (cell === 'wall-hard' || cell === 'wall-soft') return false;
        
        // 检查是否有炸弹
        const hasBomb = gameState.bombs.some(b => b.x === nx && b.y === ny);
        if (hasBomb) return false;

        return true;
    }

    move(dx, dy) {
        const nx = this.x + dx;
        const ny = this.y + dy;
        this.lastDir = {dx, dy}; // 记录最后一次移动的方向
        
        // 更新面向
        if (dx > 0) this.facing = 'right';
        else if (dx < 0) this.facing = 'left';
        else if (dy > 0) this.facing = 'down';
        else if (dy < 0) this.facing = 'up';
        this.element.dataset.facing = this.facing;

        if (this.canMoveTo(nx, ny)) {
            const oldX = this.x;
            const oldY = this.y;
            this.x = nx;
            this.y = ny;
            this.updatePosition();
            
            // 更新移动历史，保留最近 3 次
            this.moveHistory.push({dx, dy});
            if (this.moveHistory.length > 3) this.moveHistory.shift();
            
            // 检查地雷激活状态：如果所有者离开了地雷格子，则激活地雷
            gameState.landmines.forEach(m => {
                if (m.owner === this && !m.isArmed) {
                    if (this.x !== m.x || this.y !== m.y) {
                        m.isArmed = true;
                    }
                }
            });

            // 检查道具拾取
            if (this.type.startsWith('player') || this.type === 'enemy') {
                this.checkPowerUpPickup(nx, ny);
                
                // 检查地雷触发
                const mine = gameState.landmines.find(m => m.x === nx && m.y === ny);
                if (mine) {
                    mine.checkTrigger(this);
                }

                // 检查火箭碰撞
                const rocket = gameState.rockets.find(r => r.x === nx && r.y === ny);
                if (rocket) {
                    rocket.explode(nx, ny);
                }
            }
            return true;
        }
        return false;
    }

    checkPowerUpPickup(x, y) {
        const index = gameState.powerUps.findIndex(p => p.x === x && p.y === y);
        if (index !== -1) {
            const pu = gameState.powerUps[index];
            const type = pu.type;
            this.applyPowerUp(type);
            pu.destroy();
            gameState.powerUps.splice(index, 1);

            // 测试模式：拾取后立即在原位刷新一个同类型道具
            if (gameState.isTestMode) {
                this.pickupTimer = setTimeout(() => {
                    if (gameState.isStarted && !gameState.isGameOver) {
                        gameState.powerUps.push(new PowerUp(x, y, type));
                    }
                }, 1000);
            }
        }
    }

    applyPowerUp(type) {
        switch(type) {
            case 'range':
                this.explosionRange++;
                break;
            case 'speed':
                // 每次增加 40ms 的冷却缩减，体感更明显
                this.moveCooldown = Math.max(CONFIG.minMoveCooldown, this.moveCooldown - 40);
                break;
            case 'bombCount':
                this.maxBombs++;
                break;
            case 'landmine':
                this.landmines = (this.landmines || 0) + 1;
                this.rockets = 0; // 替换当前道具
                this.activeWeapon = 'landmine';
                break;
            case 'rocket':
                this.rockets = (this.rockets || 0) + 2;
                this.landmines = 0; // 替换当前道具
                this.activeWeapon = 'rocket';
                break;
        }
        updateStatusDisplay();
    }

    performAction() {
        // 根据当前激活的武器进行投放
        if (this.activeWeapon === 'rocket' && this.rockets > 0) {
            this.placeRocket();
        } else if (this.activeWeapon === 'landmine' && this.landmines > 0) {
            this.placeLandmine();
        } else {
            this.placeBomb();
        }
    }

    placeBomb() {
        if (this.activeBombs >= this.maxBombs) return;
        // 不允许在已经有炸弹或地雷的地方放炸弹
        if (gameState.bombs.some(b => b.x === this.x && b.y === this.y)) return;
        if (gameState.landmines.some(m => m.x === this.x && m.y === this.y)) return;

        this.activeBombs++;
        const bomb = new Bomb(this.x, this.y, this);
        gameState.bombs.push(bomb);
        updateStatusDisplay();
    }

    placeLandmine() {
        if (!this.landmines || this.landmines <= 0) {
            this.activeWeapon = 'bomb';
            return;
        }
        // 不允许在已经有炸弹或地雷的地方放地雷
        if (gameState.landmines.some(m => m.x === this.x && m.y === this.y)) return;
        if (gameState.bombs.some(b => b.x === this.x && b.y === this.y)) return;

        this.landmines--;
        if (this.landmines <= 0) {
            this.landmines = 0;
            this.activeWeapon = 'bomb';
        }
        const mine = new Landmine(this.x, this.y, this);
        gameState.landmines.push(mine);
        updateStatusDisplay();
    }

    placeRocket() {
        if (!this.rockets || this.rockets <= 0) {
            this.activeWeapon = 'bomb';
            return;
        }
        
        // 获取当前移动方向，如果没有移动过默认向上
        const dir = this.lastDir || {dx: 0, dy: -1};
        const nx = this.x + dir.dx;
        const ny = this.y + dir.dy;

        // 边界检查
        if (nx < 0 || nx >= CONFIG.cols || ny < 0 || ny >= CONFIG.rows) {
            return;
        }

        this.rockets--;
        if (this.rockets <= 0) {
            this.rockets = 0;
            this.activeWeapon = 'bomb';
        }
        const rocket = new Rocket(nx, ny, dir.dx, dir.dy, this);
        gameState.rockets.push(rocket);
        updateStatusDisplay();
    }

    die() {
        if (gameState.isTestMode) {
            // 测试模式：角色/敌人不消失，闪烁并重置状态
            this.element.classList.add('hit-flash');
            
            this.respawnTimer = setTimeout(() => {
                this.element.classList.remove('hit-flash');
                this.alive = true; // 1秒后复活
                
                if (this.type.startsWith('player')) {
                    // 移除重置到中心点的逻辑，原地复活
                    updateStatusDisplay();
                }
            }, 1000);
            return;
        }

        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.alive = false;
    }

    destroy() {
        this.alive = false;
        if (this.respawnTimer) clearTimeout(this.respawnTimer);
        if (this.pickupTimer) clearTimeout(this.pickupTimer);
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }
}

class Player extends Entity {
    constructor(x, y, id, charIndex) {
        super(x, y, `player`, charIndex);
        this.id = id; // 1 或 2
        this.charIndex = charIndex;
        this.explosionRange = CONFIG.initialExplosionRange;
        this.maxBombs = CONFIG.initialMaxBombs;
        this.activeBombs = 0;
        this.moveCooldown = CONFIG.initialMoveCooldown;
        this.lastMoveTime = 0;
        this.element.textContent = CHAR_ICONS[charIndex];
        
        // 设置按键配置
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
        board.appendChild(this.element);

        this.explodeTimer = setTimeout(() => this.explode(), CONFIG.bombTimer);
    }

    destroy() {
        if (this.explodeTimer) clearTimeout(this.explodeTimer);
        if (this.element && this.element.parentNode) board.removeChild(this.element);
    }

    explode() {
        if (this.exploded) return;
        this.exploded = true;

        // 更新所有者的活跃炸弹数
        if (this.owner) this.owner.activeBombs--;

        // 从列表中移除
        gameState.bombs = gameState.bombs.filter(b => b !== this);
        if (this.element.parentNode) board.removeChild(this.element);

        const directions = [
            {dx: 0, dy: -1}, {dx: 0, dy: 1}, 
            {dx: -1, dy: 0}, {dx: 1, dy: 0}
        ];

        // 中心爆炸
        this.createExplosionAt(this.x, this.y);

        directions.forEach(d => {
            for (let r = 1; r <= this.range; r++) {
                const ex = this.x + d.dx * r;
                const ey = this.y + d.dy * r;

                if (ex < 0 || ex >= CONFIG.cols || ey < 0 || ey >= CONFIG.rows) break;
                
                const cellType = gameState.grid[ey][ex];
                if (cellType === 'wall-hard') break; // 被钢墙阻挡

                this.createExplosionAt(ex, ey);

                if (cellType === 'wall-soft') {
                    // 摧毁软墙并可能掉落道具
                    this.destroySoftWall(ex, ey);
                    break; // 被软墙阻挡（但墙会坏）
                }
            }
        });
    }

    createExplosionAt(ex, ey, isBright = false) {
        const expEl = document.createElement('div');
        expEl.className = `explosion ${isBright ? 'explosion-bright' : ''}`;
        expEl.style.left = `${ex * CONFIG.tileSize}px`;
        expEl.style.top = `${ey * CONFIG.tileSize}px`;
        board.appendChild(expEl);
        setTimeout(() => {
            if (expEl.parentNode) board.removeChild(expEl);
        }, CONFIG.explosionDuration);

        // 检查击中实体 (玩家)
        for (let i = gameState.players.length - 1; i >= 0; i--) {
            const player = gameState.players[i];
            if (player.x === ex && player.y === ey) {
                handlePlayerDeath(player);
            }
        }

        // 检查击中敌人
        for (let i = gameState.enemies.length - 1; i >= 0; i--) {
            const enemy = gameState.enemies[i];
            if (enemy.x === ex && enemy.y === ey) {
                enemy.die();
                
                if (!gameState.isTestMode) {
                    gameState.enemies.splice(i, 1);
                    updateEnemyCount();
                    
                    // 检查胜利条件
                    if (gameState.mode === 'ai-vs-ai') {
                        if (gameState.enemies.length === 1 && gameState.players.length === 0) {
                            endGame(true, `AI ${gameState.enemies[0].id} 获得了最终胜利！`);
                        } else if (gameState.enemies.length === 0 && gameState.players.length === 0) {
                            endGame(false, '同归于尽！没有人获胜。');
                        }
                    } else if (gameState.enemies.length === 0) {
                        if (gameState.mode === 'single') {
                            endGame(true, '恭喜！你消灭了所有敌人！');
                        } else if (gameState.players.length > 0) {
                            endGame(true, '合作愉快！所有敌人已被消灭！');
                        }
                    }
                }
            }
        }
        
        // 1. 连锁爆炸：炸弹
        const otherBomb = gameState.bombs.find(b => b.x === ex && b.y === ey && b !== this);
        if (otherBomb) {
            otherBomb.explode();
        }

        // 2. 摧毁地雷：如果爆炸范围内有地雷，地雷也会爆炸
        const mine = gameState.landmines.find(m => m.x === ex && m.y === ey);
        if (mine) {
            mine.explode(true); // 传入 true，表示由连锁反应引爆，产生更亮的火焰
        }
    }

    destroySoftWall(ex, ey) {
        gameState.grid[ey][ex] = 'floor';
        const cellEl = board.querySelector(`.cell[data-x="${ex}"][data-y="${ey}"]`);
        cellEl.className = 'cell floor';

        // 掉落道具
        if (Math.random() < CONFIG.powerUpChance) {
            let types = ['range', 'speed', 'bombCount', 'landmine', 'rocket'];
            
            // 优化：在开局区域（靠近出生点）不刷新地雷道具，防止误触或在狭窄区域造成困扰
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
        // 根据方向旋转火箭
        const angle = dx === 1 ? 90 : dx === -1 ? -90 : dy === 1 ? 180 : 0;
        this.element.style.transform = `translate(10%, 10%) rotate(${angle}deg)`;
        board.appendChild(this.element);

        // 立即检测发射点（玩家面向的第一格）是否有碰撞
        if (this.checkCollision(this.x, this.y)) {
            return;
        }

        this.moveInterval = setInterval(() => this.move(), 100);
    }

    destroy() {
        if (this.moveInterval) clearInterval(this.moveInterval);
        if (this.element && this.element.parentNode) board.removeChild(this.element);
    }

    checkCollision(nx, ny) {
        if (this.exploded) return true;

        // 1. 碰撞检测：墙壁
        if (nx < 0 || nx >= CONFIG.cols || ny < 0 || ny >= CONFIG.rows || gameState.grid[ny][nx] !== 'floor') {
            this.explode(nx, ny);
            return true;
        }

        // 1.5 碰撞检测：炸弹或地雷
        const hasObstacle = gameState.bombs.some(b => b.x === nx && b.y === ny) || 
                           gameState.landmines.some(m => m.x === nx && m.y === ny);
        if (hasObstacle) {
            this.explode(nx, ny);
            return true;
        }

        // 2. 碰撞检测：角色（排除发射者，防止贴脸发射自爆）
        const target = [...gameState.players, ...gameState.enemies].find(e => 
            e.alive && e.x === nx && e.y === ny && e !== this.owner
        );
        
        if (target) {
            this.explode(nx, ny);
            return true;
        }
        return false;
    }

    move() {
        if (this.exploded) return;

        // 在移动前，先检测当前格是否有人（处理敌人主动撞上火箭的情况）
        if (this.checkCollision(this.x, this.y)) {
            return;
        }

        // 在移动前，在当前位置留下轨迹
        this.createTrail();

        const nx = this.x + this.dx;
        const ny = this.y + this.dy;

        if (this.checkCollision(nx, ny)) {
            return;
        }

        this.x = nx;
        this.y = ny;
        this.element.style.left = `${nx * CONFIG.tileSize}px`;
        this.element.style.top = `${ny * CONFIG.tileSize}px`;
    }

    createTrail() {
        const trail = document.createElement('div');
        trail.className = 'rocket-trail';
        trail.style.left = `${this.x * CONFIG.tileSize}px`;
        trail.style.top = `${this.y * CONFIG.tileSize}px`;
        board.appendChild(trail);
        
        // 轨迹在一段时间后自动移除
        setTimeout(() => {
            if (trail.parentNode) board.removeChild(trail);
        }, 500);
    }

    explode(ex, ey) {
        if (this.exploded) return;
        this.exploded = true;

        clearInterval(this.moveInterval);
        if (this.element && this.element.parentNode) board.removeChild(this.element);
        gameState.rockets = gameState.rockets.filter(r => r !== this);

        // 创建爆炸
        const tempBomb = Object.create(Bomb.prototype);
        tempBomb.owner = this.owner;
        
        // 火箭筒击中点的爆炸
        // 如果是在玩家面前贴脸爆炸，为了安全，爆炸范围缩小到仅击中格
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
                    // 再次检查爆炸是否会伤到发射者（如果是贴脸爆炸）
                    if (isNearOwner && tx === this.owner.x && ty === this.owner.y) {
                        return;
                    }
                    tempBomb.createExplosionAt(tx, ty);
                    if (cellType === 'wall-soft') {
                        tempBomb.destroySoftWall(tx, ty);
                    }
                }
            }
        });
    }
}

class Landmine {
    constructor(x, y, owner) {
        this.x = x;
        this.y = y;
        this.owner = owner;
        this.isArmed = false; // 初始未激活
        this.element = document.createElement('div');
        this.element.className = 'landmine-placed'; // 使用正确的 CSS 类名
        this.element.style.left = `${x * CONFIG.tileSize}px`;
        this.element.style.top = `${y * CONFIG.tileSize}px`;
        board.appendChild(this.element);

        // 放置 2 秒内闪烁，之后进入隐形状态
        this.armTimer = setTimeout(() => {
            if (this.element) {
                this.element.classList.add('hidden-mine');
            }
        }, 2000); // 增加到 2 秒
    }

    destroy() {
        if (this.armTimer) clearTimeout(this.armTimer);
        if (this.element && this.element.parentNode) board.removeChild(this.element);
    }

    checkTrigger(entity) {
        // 如果是所有者且地雷还没激活（还没离开过），不触发
        if (entity === this.owner && !this.isArmed) {
            return;
        }
        
        // 触发爆炸：正常踩到地雷是 3x3 范围
        this.explode(false);
    }

    explode(isChainReaction = false) {
        if (this.exploded) return;
        this.exploded = true;

        // 从列表中移除
        gameState.landmines = gameState.landmines.filter(m => m !== this);
        if (this.element && this.element.parentNode) board.removeChild(this.element);

        // 确定爆炸范围
        // 地雷爆炸范围始终为仅自身所在格 (1x1)
        const directions = [{dx: 0, dy: 0}];

        // 创建一个临时 Bomb 实例用于复用爆炸逻辑
        const tempBomb = Object.create(Bomb.prototype);
        tempBomb.owner = this.owner;

        directions.forEach(d => {
            const ex = this.x + d.dx;
            const ey = this.y + d.dy;

            if (ex >= 0 && ex < CONFIG.cols && ey >= 0 && ey < CONFIG.rows) {
                const cellType = gameState.grid[ey][ex];
                if (cellType !== 'wall-hard') {
                     // 连锁引爆或中心点使用高亮样式
                     const isCenter = d.dx === 0 && d.dy === 0;
                     tempBomb.createExplosionAt(ex, ey, isChainReaction || isCenter);
                     if (cellType === 'wall-soft') {
                         tempBomb.destroySoftWall(ex, ey);
                     }
                }
            }
        });
    }
}

function generateTestLevel() {
    // 1. 初始化空地图（仅保留边界硬墙）
    gameState.grid = [];
    board.innerHTML = '';
    for (let y = 0; y < CONFIG.rows; y++) {
        const row = [];
        for (let x = 0; x < CONFIG.cols; x++) {
            let type = 'floor';
            // 仅保留最外层边界
            if (x === 0 || x === CONFIG.cols - 1 || y === 0 || y === CONFIG.rows - 1) {
                type = 'wall-hard';
            }
            row.push(type);
            const cell = document.createElement('div');
            cell.className = `cell ${type}`;
            cell.style.left = `${x * CONFIG.tileSize}px`;
            cell.style.top = `${y * CONFIG.tileSize}px`;
            cell.dataset.x = x;
            cell.dataset.y = y;
            board.appendChild(cell);
        }
        gameState.grid.push(row);
    }

    const midX = Math.floor(CONFIG.cols / 2);
    const midY = Math.floor(CONFIG.rows / 2);

    // 2. 放置一排现成的道具 (y=2，离出生点更近一点，更显眼)
    const powerUpTypes = ['range', 'speed', 'bombCount', 'landmine', 'rocket'];
    powerUpTypes.forEach((type, index) => {
        const x = midX - 2 + index;
        const y = 2;
        const pu = new PowerUp(x, y, type);
        gameState.powerUps.push(pu);
    });

    // 3. 放置软箱子 (敌人后方，y=midY + 2 和 midY + 3)
    for (let x = midX - 2; x <= midX + 2; x++) {
        for (let y = midY + 2; y <= midY + 3; y++) {
            gameState.grid[y][x] = 'wall-soft';
            const cell = board.querySelector(`.cell[style*="left: ${x * CONFIG.tileSize}px"][style*="top: ${y * CONFIG.tileSize}px"]`);
            if (cell) cell.className = 'cell wall-soft';
        }
    }

    // 4. 软箱子后面放一排硬墙 (y=midY + 4)
    for (let x = midX - 2; x <= midX + 2; x++) {
        const y = midY + 4;
        gameState.grid[y][x] = 'wall-hard';
        const cell = board.querySelector(`.cell[style*="left: ${x * CONFIG.tileSize}px"][style*="top: ${y * CONFIG.tileSize}px"]`);
        if (cell) cell.className = 'cell wall-hard';
    }
}

function initMap() {
    board.innerHTML = '';
    gameState.grid = [];
    
    // 1. 先生成全地板的基础网格
    for (let y = 0; y < CONFIG.rows; y++) {
        const row = [];
        for (let x = 0; x < CONFIG.cols; x++) {
            row.push('floor');
        }
        gameState.grid.push(row);
    }

    // 2. 放置外墙
    for (let y = 0; y < CONFIG.rows; y++) {
        for (let x = 0; x < CONFIG.cols; x++) {
            if (x === 0 || x === CONFIG.cols - 1 || y === 0 || y === CONFIG.rows - 1) {
                gameState.grid[y][x] = 'wall-hard';
            }
        }
    }

    // 3. 随机放置硬墙（打破公式化）
    // 相比原来的 100% 棋盘格，我们现在降低概率并增加随机分布
    for (let y = 2; y < CONFIG.rows - 2; y++) {
        for (let x = 2; x < CONFIG.cols - 2; x++) {
            // 棋盘格位置有 60% 几率生成硬墙
            if (x % 2 === 0 && y % 2 === 0) {
                if (Math.random() < 0.6) {
                    gameState.grid[y][x] = 'wall-hard';
                }
            } 
            // 非棋盘格位置有 10% 几率生成硬墙
            else if (Math.random() < 0.1) {
                gameState.grid[y][x] = 'wall-hard';
            }
        }
    }

    // 4. 填充软墙
    for (let y = 0; y < CONFIG.rows; y++) {
        for (let x = 0; x < CONFIG.cols; x++) {
            if (gameState.grid[y][x] === 'floor') {
                const isSpawnArea = (x <= 2 && y <= 2) || // P1 area
                                   (x >= CONFIG.cols - 3 && y <= 2) || // Enemy 1 area
                                   (x <= 2 && y >= CONFIG.rows - 3) || // Enemy 2 area
                                   (x >= CONFIG.cols - 3 && y >= CONFIG.rows - 3); // P2 / Enemy 3 area
                
                if (!isSpawnArea && Math.random() < CONFIG.softWallDensity) {
                    gameState.grid[y][x] = 'wall-soft';
                }
            }
        }
    }

    // 5. 渲染地图
    for (let y = 0; y < CONFIG.rows; y++) {
        for (let x = 0; x < CONFIG.cols; x++) {
            const type = gameState.grid[y][x];
            const cell = document.createElement('div');
            cell.className = `cell ${type}`;
            cell.dataset.x = x;
            cell.dataset.y = y;
            board.appendChild(cell);
        }
    }
}

function updateStatusDisplay() {
    [...gameState.players, ...gameState.enemies].forEach(entity => {
        const isPlayer = entity.type.startsWith('player');
        const id = isPlayer ? (entity.type.includes('0') || entity.id === 1 ? 'p1' : 'p2') : `enemy-${entity.id || entity.x + '-' + entity.y}`;
        
        let card = document.getElementById(`status-${id}`);
        
        // 如果是敌人且卡片不存在，则创建
        if (!isPlayer && !card) {
            card = document.createElement('div');
            card.id = `status-${id}`;
            card.className = 'status-card';
            const container = document.getElementById('enemy-status-container');
            if (container) container.appendChild(card);
        }

        if (card) {
            if (!entity.alive) {
                card.classList.add('dead');
            } else {
                card.classList.remove('dead');
            }
            
            const charIcon = entity.element.textContent;
            let displayName = isPlayer ? id.toUpperCase() : '敌人 ' + (entity.id || '');
            if (gameState.mode === 'ai-vs-ai' && !isPlayer) {
                const colorNames = {blue: '蓝', red: '红', green: '绿', yellow: '黄'};
                const personalityNames = {aggressive: '激进', conservative: '保守', sneaky: '偷袭', balanced: '平衡'};
                const colorName = colorNames[CONFIG.colors[entity.colorIndex]];
                const personalityName = personalityNames[entity.personality] || '';
                displayName = `AI ${entity.id} (${colorName}-${personalityName})`;
            }

            card.innerHTML = `
                <h4 style="color: ${isPlayer ? '' : getHexColor(entity.colorIndex)}">
                    <span class="icon">${charIcon}</span> ${displayName}
                </h4>
                <div class="status-items">
                    <div class="item-row ${entity.activeWeapon === 'bomb' ? 'active-weapon' : ''}">🔥 <span>${entity.explosionRange}</span></div>
                    <div class="item-row">👟 <span>${Math.round((200 - entity.moveCooldown) / 20 + 1)}</span></div>
                    <div class="item-row ${entity.activeWeapon === 'bomb' ? 'active-weapon' : ''}">💣 <span>${entity.maxBombs}</span></div>
                    <div class="item-row ${entity.activeWeapon === 'landmine' ? 'active-weapon' : ''}">🚩 <span>${entity.landmines || 0}</span></div>
                    <div class="item-row ${entity.activeWeapon === 'rocket' ? 'active-weapon' : ''}">🚀 <span>${entity.rockets || 0}</span></div>
                </div>
            `;
        }
    });
}

function getHexColor(index) {
    const hexColors = ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f'];
    return hexColors[index % hexColors.length];
}

function handlePlayerDeath(player) {
    if (gameState.isGameOver || !player.alive) return;
    
    player.alive = false;
    player.die();
    updateStatusDisplay();

    // 检查胜负
    if (gameState.isTestMode) return; // 测试模式不移除玩家，也不检查胜负
    
    const index = gameState.players.indexOf(player);
    if (index !== -1) {
        gameState.players.splice(index, 1);
    }
    
    if (gameState.players.length === 0) {
        endGame(false); // 玩家全部阵亡
    } else if (gameState.mode === 'multi' && gameState.players.length === 1) {
        if (gameState.enemies.length === 0) {
            endGame(true, `P${gameState.players[0].id} 最终获胜！`);
        }
    }
}

function updateEnemyCount() {
    if (enemyCountEl) enemyCountEl.textContent = gameState.enemies.length;
}

function endGame(win, customMsg) {
    if (gameState.isGameOver) return; // 防止重复触发结算逻辑
    gameState.isGameOver = true;
    overlay.classList.remove('hidden');
    const msg = customMsg || (win ? '你赢了！' : '游戏结束');
    resultMsg.textContent = msg;
    resultMsg.style.color = win ? '#2ecc71' : '#e74c3c';

    // AI 互博模式：5秒后自动重新开始
    if (gameState.mode === 'ai-vs-ai') {
        let countdown = 5;
        const updateCountdown = () => {
            if (!gameState.isGameOver || gameState.mode !== 'ai-vs-ai') return;
            
            resultMsg.textContent = `${msg} (${countdown}秒后自动重启)`;
            if (countdown <= 0) {
                start();
            } else {
                countdown--;
                gameState.restartTimer = setTimeout(updateCountdown, 1000);
            }
        };
        updateCountdown();
    }
}

let playerMoveInterval = null;

function handlePlayerMovement() {
    if (!gameState.isStarted || gameState.isGameOver) return;
    const now = Date.now();

    gameState.players.forEach(player => {
        if (!player.alive) return;
        if (now - player.lastMoveTime < player.moveCooldown) return;

        let dx = 0, dy = 0;
        let moved = false;

        if (player.controls.up.some(k => gameState.keys[k])) dy = -1;
        else if (player.controls.down.some(k => gameState.keys[k])) dy = 1;
        else if (player.controls.left.some(k => gameState.keys[k])) dx = -1;
        else if (player.controls.right.some(k => gameState.keys[k])) dx = 1;

        if (dx !== 0 || dy !== 0) {
            if (player.move(dx, dy)) {
                player.lastMoveTime = now;
                moved = true;
            }
        }
    });
}

function start() {
    // 清除可能存在的自动重启定时器
    if (gameState.restartTimer) {
        clearTimeout(gameState.restartTimer);
        gameState.restartTimer = null;
    }

    // 彻底销毁旧实体，清理定时器和 DOM
    const entitiesToDestroy = [
        ...(gameState.powerUps || []),
        ...(gameState.bombs || []),
        ...(gameState.landmines || []),
        ...(gameState.rockets || []),
        ...(gameState.enemies || []),
        ...(gameState.players || [])
    ];
    entitiesToDestroy.forEach(entity => {
        if (entity && typeof entity.destroy === 'function') {
            entity.destroy();
        }
    });

    // 清理可能残留的特效 DOM 元素（爆炸、火箭尾迹等）
    if (board) {
        const effects = board.querySelectorAll('.explosion, .explosion-bright, .rocket-trail');
        effects.forEach(el => {
            if (el && el.parentNode) el.parentNode.removeChild(el);
        });
    }

    // 清空数组并确保初始化
    gameState.powerUps = [];
    gameState.bombs = [];
    gameState.landmines = [];
    gameState.rockets = [];
    gameState.enemies = [];
    gameState.players = [];
    gameState.keys = {}; // 清除按键状态，防止重启后自动移动

    // 清理 AI 路径缓存
    if (typeof AIUtils !== 'undefined' && AIUtils.clearCache) {
        AIUtils.clearCache();
    }

    if (gameState.isTestMode) {
        generateTestLevel();
    } else {
        initMap();
    }
    
    // 清空状态栏中的敌人卡片
    const enemyContainer = document.getElementById('enemy-status-container');
    if (enemyContainer) enemyContainer.innerHTML = '';
    
    // 初始化玩家
    gameState.players = [];
    let p1X = 1, p1Y = 1;
    let p2X = CONFIG.cols - 2, p2Y = CONFIG.rows - 2;

    if (gameState.isTestMode) {
        p1X = Math.floor(CONFIG.cols / 2);
        p1Y = Math.floor(CONFIG.rows / 2);
    }

    if (gameState.mode !== 'ai-vs-ai') {
        const p1 = new Player(p1X, p1Y, 1, gameState.selectedChars[0]);
        p1.alive = true;
        gameState.players.push(p1);
        
        const p1Card = document.getElementById('status-p1');
        if (p1Card) p1Card.classList.remove('hidden', 'dead');

        if (gameState.mode === 'multi' && !gameState.isTestMode) {
            const p2 = new Player(p2X, p2Y, 2, gameState.selectedChars[1]);
            p2.alive = true;
            gameState.players.push(p2);
            const p2Card = document.getElementById('status-p2');
            if (p2Card) p2Card.classList.remove('hidden', 'dead');
        } else {
            const p2Card = document.getElementById('status-p2');
            if (p2Card) p2Card.classList.add('hidden');
        }
    } else {
        // AI 互博模式：隐藏所有玩家面板
        document.getElementById('status-p1').classList.add('hidden');
        document.getElementById('status-p2').classList.add('hidden');
    }

    if (gameState.isTestMode) {
        // 测试模式：放置一个靶子 AI 在角色正前方
        gameState.enemies = [
            new SmartEnemy(p1X, p1Y + 1, 1, 1, gameState.difficulty, 'balanced')
        ];
    } else if (gameState.mode === 'ai-vs-ai') {
        // AI 互博模式：四个角落各一个 AI
        gameState.enemies = [
            new SmartEnemy(1, 1, 1, 0, gameState.difficulty, 'aggressive'),
            new SmartEnemy(CONFIG.cols - 2, 1, 2, 1, gameState.difficulty, 'conservative'),
            new SmartEnemy(1, CONFIG.rows - 2, 3, 2, gameState.difficulty, 'sneaky'),
            new SmartEnemy(CONFIG.cols - 2, CONFIG.rows - 2, 4, 3, gameState.difficulty, 'balanced')
        ];
    } else {
        // 单人/双人模式：根据难度随机分配性格
        gameState.enemies = [];
        const corners = [
            {x: CONFIG.cols - 2, y: 1},
            {x: 1, y: CONFIG.rows - 2},
            {x: CONFIG.cols - 2, y: CONFIG.rows - 2}
        ];
        
        // 确保 P2 的位置不被敌人占据（双人模式）
        const enemyCorners = corners.filter(c => 
            gameState.mode !== 'multi' || (c.x !== p2X || c.y !== p2Y)
        );

        enemyCorners.forEach((pos, i) => {
            const personality = AI_PERSONALITIES[Math.floor(Math.random() * AI_PERSONALITIES.length)];
            gameState.enemies.push(new SmartEnemy(pos.x, pos.y, i + 1, i + 1, gameState.difficulty, personality));
        });
    }
    
    gameState.enemies.forEach(e => e.alive = true);
    
    gameState.isStarted = true;
    gameState.isGameOver = false;
    overlay.classList.add('hidden');
    document.getElementById('start-screen').classList.add('hidden');
    updateEnemyCount();
    updateStatusDisplay();

    if (playerMoveInterval) clearInterval(playerMoveInterval);
    playerMoveInterval = setInterval(handlePlayerMovement, 30);
}

// UI 交互
const singleBtn = document.getElementById('single-player-btn');
const multiBtn = document.getElementById('multi-player-btn');
const aiVsAiBtn = document.getElementById('ai-vs-ai-btn');
const testBtn = document.getElementById('test-mode-btn');

const clearSelection = () => {
    [singleBtn, multiBtn, aiVsAiBtn, testBtn].forEach(btn => {
        if (btn) btn.classList.remove('selected');
    });
};

singleBtn.onclick = () => {
    gameState.mode = 'single';
    gameState.isTestMode = false;
    clearSelection();
    singleBtn.classList.add('selected');
    document.getElementById('p2-selection').classList.add('hidden');
    document.getElementById('p2-controls').classList.add('hidden');
};

multiBtn.onclick = () => {
    gameState.mode = 'multi';
    gameState.isTestMode = false;
    clearSelection();
    multiBtn.classList.add('selected');
    document.getElementById('p2-selection').classList.remove('hidden');
    document.getElementById('p2-controls').classList.remove('hidden');
};

if (aiVsAiBtn) {
    aiVsAiBtn.onclick = () => {
        gameState.mode = 'ai-vs-ai';
        gameState.isTestMode = false;
        clearSelection();
        aiVsAiBtn.classList.add('selected');
        document.getElementById('p2-selection').classList.add('hidden');
        document.getElementById('p2-controls').classList.add('hidden');
    };
}

if (testBtn) {
    testBtn.onclick = () => {
        gameState.mode = 'test';
        gameState.isTestMode = true;
        clearSelection();
        testBtn.classList.add('selected');
        document.getElementById('p2-selection').classList.add('hidden');
        document.getElementById('p2-controls').classList.add('hidden');
    };
}

// 角色选择
document.querySelectorAll('.p-selection').forEach((pSelect, pIdx) => {
    pSelect.querySelectorAll('.char-option').forEach(option => {
        option.onclick = () => {
            pSelect.querySelectorAll('.char-option').forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            gameState.selectedChars[pIdx] = parseInt(option.dataset.char);
        };
    });
});

// AI 难度选择
document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        gameState.difficulty = btn.dataset.diff;
    };
});

startBtn.onclick = start;

window.addEventListener('keydown', (e) => {
    // 阻止默认滚动
    const preventKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '];
    if (preventKeys.includes(e.key)) e.preventDefault();

    // 检查是否已经按下，防止长按连发
    if (gameState.keys[e.key] || gameState.keys[e.code]) return;
    
    gameState.keys[e.key] = true;
    gameState.keys[e.code] = true;

    if (!gameState.isStarted || gameState.isGameOver) return;

    const p1 = gameState.players.find(p => p.id === 1);
    const p2 = gameState.players.find(p => p.id === 2);

    // 动作键直接触发
    if (p1 && p1.alive) {
        if (p1.controls.bomb.includes(e.key)) {
            p1.performAction();
        }
    }
    if (p2 && p2.alive) {
        if (p2.controls.bomb.includes(e.key)) {
            p2.performAction();
        }
    }
});

window.addEventListener('keyup', (e) => {
    gameState.keys[e.key] = false;
    gameState.keys[e.code] = false;
});
