/**
 * 优先队列实现，用于 A* 寻路优化
 */
class PriorityQueue {
    constructor(comparator = (a, b) => a.priority < b.priority) {
        this._heap = [];
        this._comparator = comparator;
    }
    size() { return this._heap.length; }
    isEmpty() { return this.size() === 0; }
    peek() { return this._heap[0]; }
    push(...values) {
        values.forEach(value => {
            this._heap.push(value);
            this._siftUp();
        });
        return this.size();
    }
    pop() {
        const poppedValue = this.peek();
        const bottom = this.size() - 1;
        if (bottom > 0) {
            this._swap(0, bottom);
        }
        this._heap.pop();
        this._siftDown();
        return poppedValue;
    }
    _greater(i, j) { return this._comparator(this._heap[i], this._heap[j]); }
    _swap(i, j) { [this._heap[i], this._heap[j]] = [this._heap[j], this._heap[i]]; }
    _siftUp() {
        let node = this.size() - 1;
        while (node > 0 && this._greater(node, (node - 1) >> 1)) {
            this._swap(node, (node - 1) >> 1);
            node = (node - 1) >> 1;
        }
    }
    _siftDown() {
        let node = 0;
        while (
            (node << 1) + 1 < this.size() && this._greater((node << 1) + 1, node) ||
            (node << 1) + 2 < this.size() && this._greater((node << 1) + 2, node)
        ) {
            let maxChild = (node << 1) + 2 < this.size() && this._greater((node << 1) + 2, (node << 1) + 1)
                ? (node << 1) + 2
                : (node << 1) + 1;
            this._swap(node, maxChild);
            node = maxChild;
        }
    }
}

/**
 * 高级 AI 逻辑类
 */
class AIUtils {
    // 路径缓存：key 为 start-target-avoidDanger-includeSoftWalls, value 为 { path, time }
    static pathCache = new Map();
    static CACHE_TTL = 500; // 缓存有效时间 500ms
    static CACHE_MAX_DIST = 5; // 仅对短距离路径进行缓存

    /**
     * 获取两个实体或点之间的曼哈顿距离
     */
    static getDistance(a, b) {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }

    static clearCache() {
        this.pathCache.clear();
    }

    /**
     * 获取所有炸弹产生的危险区域地图
     * @param {Object} gameState
     * @param {Object} config
     * @param {Object} aiEntity 调用此方法的 AI 实体，用于判断地雷可见性
     * @returns {Array<Array<number>>} 危险等级地图，0为安全，1为即将爆炸
     */
    static getDangerMap(gameState, config, aiEntity = null) {
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
            // 合理的地雷避让逻辑：
            // 1. 如果是 AI 自己放的地雷，永远记得位置，必须避开
            // 2. 如果是别人放的地雷，且当前是“闪烁”可见状态（未隐藏），则避开
            // 3. 困难难度的 AI 有概率能“预判”到附近可能存在的隐藏地雷（这里简化为：困难 AI 能感应到距离 2 以内的所有地雷）
            let isVisible = false;
            if (aiEntity) {
                const isOwner = mine.owner === aiEntity;
                const isFlashing = mine.element && !mine.element.classList.contains('hidden-mine');
                const isHardAndNearby = aiEntity.difficulty === 'hard' && this.getDistance(aiEntity, mine) <= 2;
                
                if (isOwner || isFlashing || isHardAndNearby) {
                    isVisible = true;
                }
            } else {
                // 如果没有传入 aiEntity（如通用路径计算），默认标记所有闪烁地雷
                isVisible = mine.element && !mine.element.classList.contains('hidden-mine');
            }

            if (isVisible) {
                // 标记地雷中心为危险区（地雷现在只有 1x1 爆炸范围）
                dangerMap[mine.y][mine.x] = 1;
            }
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
     * @param {Object} aiEntity 调用此寻路的 AI 实体
     */
    static findPath(start, target, gameState, avoidDanger = true, includeSoftWalls = false, aiEntity = null) {
        const startX = start.x;
        const startY = start.y;
        
        const isTargetFunc = typeof target === 'function';
        const isTarget = isTargetFunc 
            ? (x, y) => target(x, y)
            : (x, y) => x === target.x && y === target.y;

        if (!isTargetFunc && startX === target.x && startY === target.y) return [];

        // 尝试从缓存中获取（仅针对坐标目标且距离较短的情况）
        let cacheKey = null;
        if (!isTargetFunc) {
            const dist = this.getDistance(start, target);
            if (dist <= this.CACHE_MAX_DIST) {
                cacheKey = `${startX},${startY}-${target.x},${target.y}-${avoidDanger}-${includeSoftWalls}-${aiEntity ? aiEntity.id : 'none'}`;
                const cached = this.pathCache.get(cacheKey);
                if (cached && Date.now() - cached.time < this.CACHE_TTL) {
                    return cached.path;
                }
            }
        }

        const config = CONFIG;
        const dangerMap = avoidDanger ? this.getDangerMap(gameState, config, aiEntity) : null;
        
        // 使用优先队列优化 A*
        const pq = new PriorityQueue((a, b) => (a.g + a.h) < (b.g + b.h));
        pq.push({ x: startX, y: startY, g: 0, h: 0, parent: null });
        
        const closedList = new Set();
        const openMap = new Map(); // 用于快速检查节点是否在 openList 中
        openMap.set(`${startX},${startY}`, 0);
        
        while (!pq.isEmpty()) {
            const current = pq.pop();
            const currentKey = `${current.x},${current.y}`;
            
            if (isTarget(current.x, current.y)) {
                const path = [];
                let temp = current;
                while (temp.parent) {
                    path.push({ x: temp.x, y: temp.y, dx: temp.x - temp.parent.x, dy: temp.y - temp.parent.y, type: temp.type });
                    temp = temp.parent;
                }
                const result = path.reverse();
                
                // 存入缓存
                if (cacheKey) {
                    this.pathCache.set(cacheKey, { path: result, time: Date.now() });
                }
                return result;
            }
            
            closedList.add(currentKey);
            
            const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
            for (const d of dirs) {
                const nx = current.x + d.dx;
                const ny = current.y + d.dy;
                const nextKey = `${nx},${ny}`;
                
                if (nx < 0 || nx >= config.cols || ny < 0 || ny >= config.rows) continue;
                if (closedList.has(nextKey)) continue;
                
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
                const h = isTargetFunc ? 0 : Math.abs(nx - target.x) + Math.abs(ny - target.y);
                
                const existingG = openMap.get(nextKey);
                if (existingG === undefined || g < existingG) {
                    pq.push({ x: nx, y: ny, g, h, parent: current, type: cellType });
                    openMap.set(nextKey, g);
                }
            }
        }
        return null;
    }
}

class SmartEnemy extends Entity {
    constructor(x, y, id, colorIndex = 1, difficulty = 'normal', personality = 'balanced') {
        super(x, y, 'enemy', colorIndex);
        this.id = id;
        this.charIndex = colorIndex; // 记录图标索引
        this.difficulty = difficulty;
        this.personality = personality;
        
        this.explosionRange = CONFIG.initialExplosionRange;
        this.maxBombs = CONFIG.initialMaxBombs;
        this.activeBombs = 0;
        
        // 根据难度调整初始参数
        this.adjustStatsByDifficulty();
        
        this.element.textContent = CHAR_ICONS[colorIndex % CHAR_ICONS.length];
        
        // 记录一些行为状态
        this.lastActionTime = 0;
        this.thinkInterval = this.difficulty === 'hard' ? 150 : (this.difficulty === 'easy' ? 600 : 300);
        this.aiInterval = setInterval(() => this.think(), this.thinkInterval);
    }

    adjustStatsByDifficulty() {
        // 移除基于难度的属性加成，所有 AI 初始冷却与配置一致
        this.moveCooldown = CONFIG.initialMoveCooldown || 200;
    }

    /**
     * 销毁 AI，清除定时器
     */
    destroy() {
        if (this.aiInterval) {
            clearInterval(this.aiInterval);
            this.aiInterval = null;
        }
        super.destroy();
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

    // 困难难度下的预判逻辑：根据移动历史预测目标下一步可能的位置
    predictTargetPosition(target) {
        if (this.difficulty !== 'hard' || !target.moveHistory || target.moveHistory.length === 0) return target;
        
        // 分析移动历史，看是否有持续的方向
        const lastMove = target.moveHistory[target.moveHistory.length - 1];
        
        // 简单的趋势分析：如果最近几次移动方向一致，则预判会继续在该方向移动
        let trendX = 0, trendY = 0;
        target.moveHistory.forEach(move => {
            trendX += move.dx;
            trendY += move.dy;
        });

        // 归一化趋势
        const dx = Math.sign(trendX);
        const dy = Math.sign(trendY);

        const px = target.x + dx;
        const py = target.y + dy;

        // 如果预判位置可达，则返回预判位置
        if (this.canMoveTo(px, py)) {
            return { x: px, y: py };
        }
        
        return target;
    }

    // 寻路到可以炸到目标的位置，而不是直接寻路到目标
    findFiringPosition(target) {
        const range = this.explosionRange;
        const candidates = [];
        
        // 查找与目标在同一行或同一列，且距离在爆炸范围内的格子
        const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
        
        for (const d of dirs) {
            for (let r = 1; r <= range; r++) {
                const nx = target.x + d.dx * r;
                const ny = target.y + d.dy * r;
                
                // 必须在地图范围内且是地板
                if (nx >= 0 && nx < CONFIG.cols && ny >= 0 && ny < CONFIG.rows) {
                    if (gameState.grid[ny][nx] === 'floor' && this.canMoveTo(nx, ny)) {
                        // 检查是否有硬墙阻挡
                        let blocked = false;
                        for (let i = 1; i < r; i++) {
                            const cx = target.x + d.dx * i;
                            const cy = target.y + d.dy * i;
                            if (gameState.grid[cy][cx] === 'wall-hard') {
                                blocked = true;
                                break;
                            }
                        }
                        if (!blocked) {
                            candidates.push({x: nx, y: ny, dist: r});
                        }
                    }
                }
            }
        }
        
        if (candidates.length === 0) return null;
        
        // 寻找离 AI 最近的一个候选点
        let bestPos = null;
        let minPathLength = Infinity;
        
        for (const cand of candidates) {
            const path = AIUtils.findPath({x: this.x, y: this.y}, {x: cand.x, y: cand.y}, gameState, true, false, this);
            if (path && path.length < minPathLength) {
                minPathLength = path.length;
                bestPos = cand;
            }
        }
        
        return bestPos;
    }

    think() {
        if (!this.alive || gameState.isTestMode) return;

        const now = Date.now();
        if (now - this.lastMoveTime < this.moveCooldown) return;

        const dangerMap = AIUtils.getDangerMap(gameState, CONFIG, this);

        // 1. 危险检测与逃跑（最高优先级）
        if (dangerMap[this.y][this.x] > 0) {
            this.escape(dangerMap);
            return;
        }

        // 获取所有潜在目标
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

        // 2. 攻击逻辑
        if (closestTarget) {
            const predictedTarget = this.predictTargetPosition(closestTarget);
            const distToPredicted = AIUtils.getDistance(this, predictedTarget);

            // 性格影响武器选择和使用频率
            let attackChance = 0.7; // 默认攻击欲望
            if (this.personality === 'aggressive') attackChance = 0.9;
            if (this.personality === 'conservative') attackChance = 0.4;

            if (Math.random() < attackChance) {
                // 尝试攻击逻辑
                if (this.activeWeapon === 'rocket' && this.rockets > 0) {
                    if ((this.x === predictedTarget.x || this.y === predictedTarget.y) && this.hasClearShot(predictedTarget.x, predictedTarget.y)) {
                        this.performAction();
                        return;
                    }
                } else if (this.activeWeapon === 'landmine' && this.landmines > 0) {
                    // 激进型喜欢在路口放雷，保守型喜欢在自己脚下放雷封路
                    const shouldPlaceMine = this.personality === 'aggressive' ? distToPredicted <= 2 : distToPredicted <= 3;
                    if (shouldPlaceMine && Math.random() < 0.5) {
                        this.performAction();
                        // 放雷后立即重新计算危险图并逃跑，避免误伤
                        const newDangerMap = AIUtils.getDangerMap(gameState, CONFIG, this);
                        this.escape(newDangerMap);
                        return;
                    }
                } else if (this.activeWeapon === 'bomb') {
                    const inRange = (this.x === predictedTarget.x && Math.abs(this.y - predictedTarget.y) <= this.explosionRange) ||
                                  (this.y === predictedTarget.y && Math.abs(this.x - predictedTarget.x) <= this.explosionRange);
                    
                    if (inRange && this.isBombUseful('target') && this.canPlaceBombSafely()) {
                        this.performAction();
                        return;
                    }
                }
            }

            // 困难 AI 可能会尝试包抄或布雷封锁路线
            if (this.difficulty === 'hard' && this.activeWeapon === 'landmine' && this.landmines > 0) {
                // 如果目标在移动，尝试在它的前方或者交叉口布雷
                if (distToPredicted <= 4 && Math.random() < 0.3) {
                    this.performAction();
                    const newDangerMap = AIUtils.getDangerMap(gameState, CONFIG, this);
                    this.escape(newDangerMap);
                    return;
                }
            }

            // 移动逻辑：简单难度 AI 偶尔会乱走
            if (this.difficulty === 'easy' && Math.random() < 0.3) {
                this.randomMove(dangerMap);
                return;
            }

            // 寻路向攻击位（或预测位置）
            const firingPos = this.findFiringPosition(predictedTarget);
            if (firingPos) {
                const path = AIUtils.findPath({x: this.x, y: this.y}, {x: firingPos.x, y: firingPos.y}, gameState, true, false, this);
                if (path && path.length > 0) {
                    this.executeMove(path[0].dx, path[0].dy);
                    return;
                }
            }
            
            // 如果找不到理想攻击位，尝试靠近目标
            const path = AIUtils.findPath({x: this.x, y: this.y}, {x: predictedTarget.x, y: predictedTarget.y}, gameState, true, false, this);
            if (path && path.length > 0) {
                // 如果是保守型，且离目标太近，可能会选择后退
                if (this.personality === 'conservative' && path.length < 3) {
                    this.escape(dangerMap); // 实际上是寻找更安全/远的地方
                } else {
                    this.executeMove(path[0].dx, path[0].dy);
                }
                return;
            }
        }

        // 3. 拾取道具
        // 偷袭型/保守型更喜欢捡道具增强自己
        const pickupRange = this.personality === 'aggressive' ? 5 : 10;
        const visiblePowerUps = gameState.powerUps.filter(p => AIUtils.getDistance(this, p) < pickupRange);
        
        if (visiblePowerUps.length > 0) {
            let bestPath = null;
            let minDist = Infinity;
            for (const pu of visiblePowerUps) {
                const path = AIUtils.findPath({x: this.x, y: this.y}, {x: pu.x, y: pu.y}, gameState, true, false, this);
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

        // 4. 炸墙逻辑
        if (this.difficulty !== 'easy' || Math.random() < 0.5) {
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
                gameState,
                true,
                true,
                this
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
        }
        
        // 5. 随机移动
        this.randomMove(dangerMap);
    }

    randomMove(dangerMap) {
        // 尝试向“未探索”或“有价值”的区域移动
        // 寻找最近的软墙（潜在道具）或距离所有角色最远的地方
        const targetPos = this.findExplorationTarget();
        
        if (targetPos) {
            const path = AIUtils.findPath({x: this.x, y: this.y}, targetPos, gameState, true, false, this);
            if (path && path.length > 0) {
                this.executeMove(path[0].dx, path[0].dy);
                return;
            }
        }

        // 保底：随机安全移动
        const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
        const safeMoves = dirs.filter(d => {
            const nx = this.x + d.dx;
            const ny = this.y + d.dy;
            return this.canMoveTo(nx, ny) && dangerMap[ny][nx] === 0;
        });

        if (safeMoves.length > 0) {
            const move = safeMoves[Math.floor(Math.random() * safeMoves.length)];
            this.executeMove(move.dx, move.dy);
        }
    }

    // 寻找探索目标：最近的软墙或视野外的区域
    findExplorationTarget() {
        // 寻找最近的软墙
        let closestWall = null;
        let minDist = Infinity;
        
        for (let y = 0; y < CONFIG.rows; y++) {
            for (let x = 0; x < CONFIG.cols; x++) {
                if (gameState.grid[y][x] === 'wall-soft') {
                    const dist = AIUtils.getDistance(this, {x, y});
                    if (dist < minDist) {
                        minDist = dist;
                        closestWall = {x, y};
                    }
                }
            }
        }
        
        if (closestWall) {
            // 返回软墙邻近的可通行位置
            const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
            for (const d of dirs) {
                const nx = closestWall.x + d.dx;
                const ny = closestWall.y + d.dy;
                if (nx >= 0 && nx < CONFIG.cols && ny >= 0 && ny < CONFIG.rows && gameState.grid[ny][nx] === 'floor') {
                    return {x: nx, y: ny};
                }
            }
        }
        
        return null;
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
        
        // 1. 寻找周围危险等级最低且可达的方向
        const moves = dirs.filter(d => this.canMoveTo(this.x + d.dx, this.y + d.dy))
                         .map(d => ({
                             dx: d.dx, 
                             dy: d.dy, 
                             danger: dangerMap[this.y + d.dy][this.x + d.dx]
                         }))
                         .sort((a, b) => a.danger - b.danger);

        if (moves.length > 0 && moves[0].danger < dangerMap[this.y][this.x]) {
            // 如果周围有更安全的地方，直接走过去
            this.executeMove(moves[0].dx, moves[0].dy);
        } else {
            // 2. 寻找最近的安全点，使用 A* 寻找路径
            const path = AIUtils.findPath(
                {x: this.x, y: this.y},
                (x, y) => dangerMap[y][x] === 0 && gameState.grid[y][x] === 'floor',
                gameState,
                false, // 逃跑时允许穿过低危险区
                false,
                this
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
        const dangerMap = AIUtils.getDangerMap(tempGameState, CONFIG, this);
        
        // 寻找一个安全点
        const path = AIUtils.findPath(
            {x: this.x, y: this.y},
            (x, y) => dangerMap[y][x] === 0 && gameState.grid[y][x] === 'floor',
            tempGameState,
            false, // 允许穿过即将爆炸的区域到达更远的终点（因为我们要跑路）
            false,
            this
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
