/**
 * 高级 AI 逻辑类
 */
class AIUtils {
    /**
     * 获取两个实体或点之间的曼哈顿距离
     */
    static getDistance(a, b) {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }

    /**
     * 获取所有炸弹产生的危险区域地图
     * @returns {Array<Array<number>>} 危险等级地图，0为安全，1为即将爆炸
     */
    static getDangerMap(gameState, config) {
        const dangerMap = Array.from({ length: config.rows || CONFIG.rows }, () => Array(config.cols || CONFIG.cols).fill(0));
        
        // 1. 标记炸弹爆炸范围
        gameState.bombs.forEach(bomb => {
            dangerMap[bomb.y][bomb.x] = 1;
            const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
            
            dirs.forEach(d => {
                for (let r = 1; r <= bomb.range; r++) {
                    const nx = bomb.x + d.dx * r;
                    const ny = bomb.y + d.dy * r;
                    
                    if (nx < 0 || nx >= (config.cols || CONFIG.cols) || ny < 0 || ny >= (config.rows || CONFIG.rows)) break;
                    const cell = gameState.grid[ny][nx];
                    if (cell === 'wall-hard') break;
                    
                    dangerMap[ny][nx] = 1;
                    if (cell === 'wall-soft') break;
                }
            });
        });

        // 2. 标记地雷位置
        gameState.landmines.forEach(mine => {
            dangerMap[mine.y][mine.x] = 1;
        });
        
        return dangerMap;
    }

    /**
     * A* 寻路算法
     * @param {Object} start {x, y}
     * @param {Object|Function} target {x, y} 或 (x, y) => boolean
     * @param {Object} gameState
     * @param {boolean} avoidDanger 
     * @param {boolean} includeSoftWalls 
     */
    static findPath(start, target, gameState, avoidDanger = true, includeSoftWalls = false) {
        const startX = start.x;
        const startY = start.y;
        
        const isTarget = typeof target === 'function' 
            ? (x, y) => target(x, y)
            : (x, y) => x === target.x && y === target.y;

        if (typeof target !== 'function' && startX === target.x && startY === target.y) return [];

        const config = CONFIG;
        const dangerMap = avoidDanger ? this.getDangerMap(gameState, config) : null;
        const openList = [{ x: startX, y: startY, g: 0, h: 0, parent: null }];
        const closedList = new Set();
        
        while (openList.length > 0) {
            openList.sort((a, b) => (a.g + a.h) - (b.g + b.h));
            const current = openList.shift();
            
            if (isTarget(current.x, current.y)) {
                const path = [];
                let temp = current;
                while (temp.parent) {
                    path.push({ x: temp.x, y: temp.y, dx: temp.x - temp.parent.x, dy: temp.y - temp.parent.y, type: temp.type });
                    temp = temp.parent;
                }
                return path.reverse();
            }
            
            closedList.add(`${current.x},${current.y}`);
            
            const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
            for (const d of dirs) {
                const nx = current.x + d.dx;
                const ny = current.y + d.dy;
                
                if (nx < 0 || nx >= config.cols || ny < 0 || ny >= config.rows) continue;
                if (closedList.has(`${nx},${ny}`)) continue;
                
                const cell = gameState.grid[ny][nx];
                if (cell === 'wall-hard') continue;
                
                let moveCost = 1;
                let cellType = 'floor';

                if (cell === 'wall-soft') {
                    if (!includeSoftWalls) continue;
                    moveCost = 10;
                    cellType = 'wall-soft';
                }

                if (gameState.bombs.some(b => b.x === nx && b.y === ny)) continue;
                if (avoidDanger && dangerMap[ny][nx] > 0) continue;
                
                const g = current.g + moveCost;
                // 如果 target 是坐标，计算 H；如果是函数，H 设为 0
                const h = typeof target === 'function' ? 0 : Math.abs(nx - target.x) + Math.abs(ny - target.y);
                
                const existing = openList.find(o => o.x === nx && o.y === ny);
                if (existing) {
                    if (g < existing.g) {
                        existing.g = g;
                        existing.parent = current;
                        existing.type = cellType;
                    }
                } else {
                    openList.push({ x: nx, y: ny, g, h, parent: current, type: cellType });
                }
            }
        }
        return null;
    }
}

class SmartEnemy extends Entity {
    constructor(x, y, id, colorIndex = 1) {
        super(x, y, 'enemy', colorIndex);
        this.id = id;
        this.charIndex = colorIndex; // 记录图标索引
        this.explosionRange = CONFIG.initialExplosionRange;
        this.maxBombs = CONFIG.initialMaxBombs;
        this.activeBombs = 0;
        this.moveCooldown = 400; 
        this.lastMoveTime = 0;
        this.element.textContent = CHAR_ICONS[colorIndex % CHAR_ICONS.length];
        
        this.aiInterval = setInterval(() => this.think(), 300);
    }

    // 检查在当前位置放置炸弹是否能炸到有意义的目标
    // type: 'wall' - 只检查软墙, 'target' - 只检查角色, 'any' - 检查两者
    isBombUseful(type = 'any') {
        const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
        const range = this.explosionRange;
        
        for (const d of dirs) {
            for (let r = 1; r <= range; r++) {
                const nx = this.x + d.dx * r;
                const ny = this.y + d.dy * r;
                
                if (nx < 0 || nx >= CONFIG.cols || ny < 0 || ny >= CONFIG.rows) break;
                
                const cell = gameState.grid[ny][nx];
                if (cell === 'wall-hard') break;
                
                if ((type === 'any' || type === 'wall') && cell === 'wall-soft') return true;
                
                if (type === 'any' || type === 'target') {
                    const target = [...gameState.players, ...gameState.enemies].find(e => e !== this && e.alive && e.x === nx && e.y === ny);
                    if (target) return true;
                }
                
                // 如果是检查目标，炸弹波会被软墙挡住
                if (cell === 'wall-soft') break;
            }
        }
        return false;
    }

    think() {
        if (!this.alive || gameState.isTestMode) return;

        const now = Date.now();
        if (now - this.lastMoveTime < this.moveCooldown) return;

        const dangerMap = AIUtils.getDangerMap(gameState, CONFIG);

        // 1. 危险检测与逃跑（最高优先级）
        if (dangerMap[this.y][this.x] > 0) {
            this.escape(dangerMap);
            return;
        }

        // 2. 攻击逻辑：尝试靠近并炸其他角色
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
            // 尝试攻击逻辑
            if (this.activeWeapon === 'rocket' && this.rockets > 0) {
                if ((this.x === closestTarget.x || this.y === closestTarget.y) && this.hasClearShot(closestTarget.x, closestTarget.y)) {
                    this.performAction();
                    return;
                }
            } else if (this.activeWeapon === 'landmine' && this.landmines > 0) {
                if (minTargetDist <= 2 && Math.random() < 0.3) {
                    this.performAction();
                    return;
                }
            } else if (this.activeWeapon === 'bomb') {
                const inRange = (this.x === closestTarget.x && Math.abs(this.y - closestTarget.y) <= this.explosionRange) ||
                              (this.y === closestTarget.y && Math.abs(this.x - closestTarget.x) <= this.explosionRange);
                
                if (inRange && this.isBombUseful('target') && this.canPlaceBombSafely()) {
                    this.performAction();
                    return;
                }
            }

            // 移动向目标
            const path = AIUtils.findPath({x: this.x, y: this.y}, {x: closestTarget.x, y: closestTarget.y}, gameState);
            if (path && path.length > 0) {
                this.executeMove(path[0].dx, path[0].dy);
                return;
            }
        }

        // 3. 拾取道具（如果没有紧迫的攻击目标或无法到达目标）
        const visiblePowerUps = gameState.powerUps.filter(p => AIUtils.getDistance(this, p) < 8);
        if (visiblePowerUps.length > 0) {
            let bestPath = null;
            let minDist = Infinity;
            for (const pu of visiblePowerUps) {
                const path = AIUtils.findPath({x: this.x, y: this.y}, {x: pu.x, y: pu.y}, gameState);
                if (path && path.length < minDist) {
                    minDist = path.length;
                    bestPath = path;
                }
            }
            if (bestPath && bestPath.length > 0) {
                this.executeMove(bestPath[0].dx, bestPath[0].dy);
                return;
            }
        }

        // 4. 炸墙逻辑：如果无法直接攻击目标，则尝试炸开路径
        const wallPath = AIUtils.findPath(
            {x: this.x, y: this.y},
            (x, y) => {
                const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
                return dirs.some(d => {
                    const nx = x + d.dx;
                    const ny = y + d.dy;
                    return nx >= 0 && nx < CONFIG.cols && ny >= 0 && ny < CONFIG.rows && gameState.grid[ny][nx] === 'wall-soft';
                });
            },
            gameState
        );

        if (wallPath) {
            if (wallPath.length === 0 || (wallPath.length === 1 && this.isBombUseful('wall'))) {
                if (this.isBombUseful('wall') && this.canPlaceBombSafely()) {
                    this.performAction();
                    return;
                }
            }
            if (wallPath.length > 0) {
                this.executeMove(wallPath[0].dx, wallPath[0].dy);
                return;
            }
        }
        
        // 5. 随机移动 (仅当完全没事可做时)
        const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
        const safeMoves = dirs.filter(d => {
            const nx = this.x + d.dx;
            const ny = this.y + d.dy;
            return this.canMoveTo(nx, ny) && dangerMap[ny][nx] === 0;
        });

        if (safeMoves.length > 0 && Math.random() < 0.2) {
            const move = safeMoves[Math.floor(Math.random() * safeMoves.length)];
            this.executeMove(move.dx, move.dy);
        }
    }

    // 检查是否有清晰的射击路线（用于火箭筒）
    hasClearShot(tx, ty) {
        if (this.x !== tx && this.y !== ty) return false;
        const dx = Math.sign(tx - this.x);
        const dy = Math.sign(ty - this.y);
        let cx = this.x + dx;
        let cy = this.y + dy;
        
        const maxDist = 10; // 火箭筒最大射程
        let dist = 1;
        
        while ((cx !== tx || cy !== ty) && dist < maxDist) {
            if (cx < 0 || cx >= CONFIG.cols || cy < 0 || cy >= CONFIG.rows) return false;
            const cell = gameState.grid[cy][cx];
            if (cell === 'wall-hard') return false;
            // 火箭可以穿过软墙，但通常我们希望直接击中玩家或至少能穿透
            cx += dx;
            cy += dy;
            dist++;
        }
        return dist < maxDist;
    }

    executeMove(dx, dy) {
        if (this.move(dx, dy)) {
            this.lastMoveTime = Date.now();
        }
    }

    escape(dangerMap) {
        const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
        const safeDirs = dirs.filter(d => {
            const nx = this.x + d.dx;
            const ny = this.y + d.dy;
            return this.canMoveTo(nx, ny) && dangerMap[ny][nx] === 0;
        });

        if (safeDirs.length > 0) {
            const d = safeDirs[Math.floor(Math.random() * safeDirs.length)];
            this.executeMove(d.dx, d.dy);
        } else {
            // 寻找最近的安全点，不考虑软墙
            const path = AIUtils.findPath(
                {x: this.x, y: this.y},
                (x, y) => dangerMap[y][x] === 0 && gameState.grid[y][x] === 'floor',
                gameState,
                false, // 不避开危险，因为我们正在寻找离开危险的路
                false
            );

            if (path && path.length > 0) {
                this.executeMove(path[0].dx, path[0].dy);
            }
        }
    }

    canPlaceBombSafely() {
        if (this.activeBombs >= this.maxBombs) return false;
        
        const virtualBomb = { x: this.x, y: this.y, range: this.explosionRange };
        const tempBombs = [...gameState.bombs, virtualBomb];
        const tempGameState = { ...gameState, bombs: tempBombs };
        const dangerMap = AIUtils.getDangerMap(tempGameState, CONFIG);
        
        // 寻找一个安全点
        const path = AIUtils.findPath(
            {x: this.x, y: this.y},
            (x, y) => dangerMap[y][x] === 0 && gameState.grid[y][x] === 'floor',
            tempGameState,
            false, // 允许穿过即将爆炸的区域到达更远的终点（因为我们要跑路）
            false
        );

        // 炸弹通常 3 秒爆炸，移动间隔通常是 moveCooldown
        // 我们需要确保在炸弹爆炸前能到达安全点
        // 预留一些缓冲时间（比如 500ms）
        const timeToExplode = CONFIG.bombTimer - 500;
        const timeToReach = path ? path.length * this.moveCooldown : Infinity;

        if (path && path.length > 0 && timeToReach < timeToExplode) return true;
        
        return false;
    }

    die() {
        if (gameState.isTestMode) {
            // 测试模式：不清除 AI 思考定时器，只标记死亡状态
            this.alive = false;
            super.die();
            return;
        }
        clearInterval(this.aiInterval);
        super.die();
    }
}
