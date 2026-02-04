/**
 * 优先队列实现，用于 A* 寻路优化
 * 保持路径搜索的高效性
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
 * AI 工具类，包含寻路、危险检测和缓存管理
 */
class AIUtils {
    // 路径缓存：key 为 start-target-avoidDanger-includeSoftWalls, value 为 { path, time }
    // 避免同一帧内重复计算相同路径
    static pathCache = new Map();
    static CACHE_TTL = 500; // 缓存有效时间 500ms
    static CACHE_MAX_DIST = 5; // 仅对短距离路径进行缓存

    /**
     * 获取两个点之间的曼哈顿距离
     */
    static getDistance(a, b) {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }

    /**
     * 清理路径缓存
     */
    static clearCache() {
        this.pathCache.clear();
    }

    /**
     * 获取时间维度的危险图
     * 返回一个 2D 数组，每个格子包含该位置所有炸弹的爆炸时间窗口 [{start, end, ownerId}]
     */
    static getTimeDangerMap(gameState, config) {
        const timeMap = Array.from({ length: config.rows }, () => 
            Array.from({ length: config.cols }, () => [])
        );
        const now = Date.now();

        // 记录所有即将发生的爆炸
        gameState.bombs.forEach(bomb => {
            const explodeTime = (bomb.placedTime || now) + config.bombTimer;
            const explodeEndTime = explodeTime + (config.explosionDuration || 1000);
            const ownerId = bomb.owner ? bomb.owner.id : null;
            
            const mark = (x, y) => {
                if (x >= 0 && x < config.cols && y >= 0 && y < config.rows) {
                    timeMap[y][x].push({ start: explodeTime, end: explodeEndTime, ownerId });
                    return true;
                }
                return false;
            };

            mark(bomb.x, bomb.y);
            const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
            dirs.forEach(d => {
                for (let r = 1; r <= bomb.range; r++) {
                    const nx = bomb.x + d.dx * r;
                    const ny = bomb.y + d.dy * r;
                    if (nx < 0 || nx >= config.cols || ny < 0 || ny >= config.rows) break;
                    const cell = gameState.grid[ny][nx];
                    if (cell === 'wall-hard') break;
                    mark(nx, ny);
                    if (cell === 'wall-soft') break;
                }
            });
        });

        // 新增：考虑火箭弹的动态路径危险（火箭弹飞行路径上的格子在短时间内也是危险的）
        if (gameState.rockets) {
            gameState.rockets.forEach(rocket => {
                const speed = rocket.speed || 5; // 假设速度
                const travelTimePerCell = 1000 / speed;
                const startTime = now;
                
                // 简化预测：预测未来 5 格的路径
                for (let i = 1; i <= 5; i++) {
                    const nx = rocket.x + rocket.dx * i;
                    const ny = rocket.y + rocket.dy * i;
                    if (nx < 0 || nx >= config.cols || ny < 0 || ny >= config.rows) break;
                    if (gameState.grid[ny][nx] === 'wall-hard') break;
                    
                    const arrivalTime = startTime + i * travelTimePerCell;
                    timeMap[ny][nx].push({ 
                        start: arrivalTime - 100, 
                        end: arrivalTime + 500,
                        ownerId: rocket.owner ? rocket.owner.id : null,
                        isProjectile: true
                    });
                    
                    if (gameState.grid[ny][nx] === 'wall-soft') break;
                }
            });
        }

        return timeMap;
    }

    /**
     * 获取动态风险地图 (Risk Map)
     * 0: 安全, 0.1-0.9: 潜在危险 (根据时间权重), 1.0+: 致命区域
     */
    static getRiskMap(gameState, config, aiEntity = null) {
        const riskMap = Array.from({ length: config.rows }, () => Array(config.cols).fill(0));
        const now = Date.now();
        
        // 1. 标记炸弹风险
        gameState.bombs.forEach(bomb => {
            // 健壮性改进：如果缺失 placedTime（如模拟炸弹），默认为刚刚放置
            const placedTime = bomb.placedTime || now;
            const timeLeft = Math.max(0, (placedTime + config.bombTimer) - now);
            
            // 时间越近，风险权值越高 (从 0.6 到 1.0)
            // 确保即使 timeLeft 为 0 或无效，风险值也至少为 1.0
            let riskWeight = 1.0 - (timeLeft / config.bombTimer) * 0.4;
            if (isNaN(riskWeight)) riskWeight = 1.0;
            
            this._markArea(riskMap, bomb.x, bomb.y, bomb.range, riskWeight, gameState, config);
        });

        // 2. 标记地雷风险
        gameState.landmines.forEach(mine => {
            let isVisible = false;
            if (aiEntity) {
                const isOwner = mine.owner === aiEntity;
                const isFlashing = mine.element && !mine.element.classList.contains('hidden-mine');
                const isHardAndNearby = aiEntity.difficulty === 'hard' && this.getDistance(aiEntity, mine) <= 3;
                if (isOwner || isFlashing || isHardAndNearby) isVisible = true;
            } else {
                isVisible = mine.element && !mine.element.classList.contains('hidden-mine');
            }

            if (isVisible) {
                riskMap[mine.y][mine.x] = 1.0;
            }
        });
        
        return riskMap;
    }

    /**
     * 获取影响图 (Influence Map)
     * 正值代表吸引力（道具、被困敌人），负值代表排斥力（敌人威胁区）
     */
    static getInfluenceMap(gameState, config, aiEntity) {
        const influenceMap = Array.from({ length: config.rows }, () => Array(config.cols).fill(0));
        const players = gameState.players.filter(p => p.alive);
        
        // 1. 道具吸引力与资源压制 (Resource Denial)
        gameState.powerUps.forEach(pu => {
            let baseStrength = 2.0;
            
            // 如果玩家离这个道具更近，增加吸引力（去抢夺）
            players.forEach(p => {
                const distToPlayer = this.getDistance(p, pu);
                const distToAI = this.getDistance(aiEntity, pu);
                if (distToPlayer < distToAI && distToPlayer <= 4) {
                    baseStrength += 1.5; // 提高抢夺优先级
                }
            });
            
            this._applyRadialInfluence(influenceMap, pu.x, pu.y, 6, baseStrength, config);
        });

        // 2. 敌人位置及威胁
        const enemies = [...gameState.players, ...gameState.enemies].filter(e => e !== aiEntity && e.alive);
        enemies.forEach(e => {
            // 靠近敌人有进攻价值（吸引）
            let offensiveStrength = 1.5;
            
            // 如果敌人被困（死角），大幅增加吸引力，前去“补刀”
            if (aiEntity.isTargetTrapped && aiEntity.isTargetTrapped(e)) {
                offensiveStrength += 3.0;
            }
            
            this._applyRadialInfluence(influenceMap, e.x, e.y, 4, offensiveStrength, config);
            
            // 敌人面对的直线区域有威胁（排斥，特别是敌人有火箭筒时）
            if (e.activeWeapon === 'rocket') {
                this._applyLinearInfluence(influenceMap, e.x, e.y, e.facing, 8, -4.0, config);
            }
            
            // 避开玩家放置的炸弹范围（除了风险地图，影响图也提供排斥，让 AI 倾向于站在更开阔的地方）
            gameState.bombs.forEach(b => {
                if (b.owner !== aiEntity) {
                    this._applyRadialInfluence(influenceMap, b.x, b.y, b.range + 1, -0.5, config);
                }
            });
        });

        // 3. 战略点：狭窄通道/路口 (Chokepoints)
        // 倾向于在玩家必经之路附近埋伏
        if (aiEntity.activeWeapon === 'landmine') {
            players.forEach(p => {
                this._findChokepoints(gameState, config).forEach(cp => {
                    const distToPlayer = this.getDistance(p, cp);
                    if (distToPlayer <= 3) {
                        this._applyRadialInfluence(influenceMap, cp.x, cp.y, 2, 2.0, config);
                    }
                });
            });
        }

        return influenceMap;
    }

    /**
     * 辅助方法：寻找地图上的关键路口/窄道
     */
    static _findChokepoints(gameState, config) {
        const chokepoints = [];
        for (let y = 1; y < config.rows - 1; y++) {
            for (let x = 1; x < config.cols - 1; x++) {
                if (gameState.grid[y][x] === 'floor') {
                    const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
                    let walls = 0;
                    dirs.forEach(d => {
                        if (gameState.grid[y + d.dy][x + d.dx] !== 'floor') walls++;
                    });
                    if (walls >= 2) chokepoints.push({x, y});
                }
            }
        }
        return chokepoints;
    }

    /**
     * 辅助方法：在地图上标记范围风险
     */
    static _markArea(map, x, y, range, weight, gameState, config) {
        map[y][x] = Math.max(map[y][x], weight);
        const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
        dirs.forEach(d => {
            for (let r = 1; r <= range; r++) {
                const nx = x + d.dx * r;
                const ny = y + d.dy * r;
                if (nx < 0 || nx >= config.cols || ny < 0 || ny >= config.rows) break;
                const cell = gameState.grid[ny][nx];
                if (cell === 'wall-hard') break;
                map[ny][nx] = Math.max(map[ny][nx], weight);
                if (cell === 'wall-soft') break;
            }
        });
    }

    /**
     * 辅助方法：施加径向影响（衰减）
     */
    static _applyRadialInfluence(map, cx, cy, radius, strength, config) {
        for (let y = Math.max(0, cy - radius); y <= Math.min(config.rows - 1, cy + radius); y++) {
            for (let x = Math.max(0, cx - radius); x <= Math.min(config.cols - 1, cx + radius); x++) {
                const dist = Math.abs(x - cx) + Math.abs(y - cy);
                if (dist <= radius) {
                    map[y][x] += strength * (1 - dist / radius);
                }
            }
        }
    }

    /**
     * 辅助方法：施加直线影响
     */
    static _applyLinearInfluence(map, x, y, facing, length, strength, config) {
        const dirMap = { 'up': {dx:0, dy:-1}, 'down': {dx:0, dy:1}, 'left': {dx:-1, dy:0}, 'right': {dx:1, dy:0} };
        const d = dirMap[facing];
        if (!d) return;
        for (let i = 1; i <= length; i++) {
            const nx = x + d.dx * i;
            const ny = y + d.dy * i;
            if (nx < 0 || nx >= config.cols || ny < 0 || ny >= config.rows) break;
            map[ny][nx] += strength * (1 - i / length);
        }
    }

    /**
     * 获取危险区域地图 (保留原接口兼容性，但内部升级)
     */
    static getDangerMap(gameState, config, aiEntity = null) {
        const riskMap = this.getRiskMap(gameState, config, aiEntity);
        // 将风险地图简化为 0/1 以兼容旧逻辑
        // 降低阈值到 0.5，确保只要有炸弹覆盖，即使刚放下也被视为危险区域
        return riskMap.map(row => row.map(v => v >= 0.5 ? 1 : 0));
    }

    /**
     * A* 寻路算法
     * @param {Object} start 起点 {x, y}
     * @param {Object|Function} target 终点 {x, y} 或判断函数 (x, y) => boolean
     * @param {Object} gameState 游戏状态
     * @param {boolean} avoidDanger 是否避开危险区域
     * @param {boolean} includeSoftWalls 是否将软墙视为可通行(代价较高)，用于寻找拆墙路径
     * @param {Object} aiEntity 调用此方法的 AI 实体
     */
    static findPath(start, target, gameState, avoidDanger = true, includeSoftWalls = false, aiEntity = null) {
        const startX = start.x;
        const startY = start.y;
        
        const isTargetFunc = typeof target === 'function';
        const isTarget = isTargetFunc 
            ? (x, y) => target(x, y)
            : (x, y) => x === target.x && y === target.y;

        if (!isTargetFunc && startX === target.x && startY === target.y) return [];

        const config = CONFIG;
        // 升级：获取风险地图和时间危险地图
        const riskMap = avoidDanger ? this.getRiskMap(gameState, config, aiEntity) : null;
        const timeDangerMap = avoidDanger ? this.getTimeDangerMap(gameState, config) : null;
        const now = Date.now();
        const moveCooldown = aiEntity ? aiEntity.moveCooldown : 200;
        const timeSinceLastMove = aiEntity ? (now - aiEntity.lastMoveTime) : 0;
        
        // 增加 150ms 的决策响应补偿，模拟 AI 从思考到发出指令的延迟
        const reactionCompensation = 150;
        const initialWait = Math.max(0, moveCooldown - timeSinceLastMove) + reactionCompensation;
        
        const pq = new PriorityQueue((a, b) => (a.g + a.h) < (b.g + b.h));
        pq.push({ x: startX, y: startY, g: 0, h: 0, parent: null, steps: 0 });
        
        const closedList = new Set();
        const openMap = new Map();
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
                return path.reverse();
            }
            
            if (closedList.has(currentKey)) continue;
            closedList.add(currentKey);
            
            const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
            for (const d of dirs) {
                const nx = current.x + d.dx;
                const ny = current.y + d.dy;
                const nextKey = `${nx},${ny}`;
                
                if (nx < 0 || nx >= config.cols || ny < 0 || ny >= config.rows) continue;
                if (closedList.has(nextKey)) continue;
                
                const cellType = gameState.grid[ny][nx];
                if (cellType === 'wall-hard') continue;
                if (cellType === 'wall-soft' && !includeSoftWalls) continue;
                
                // 检查实体阻挡
                const otherEntities = [...gameState.players, ...gameState.enemies].filter(e => 
                    e.alive && e !== aiEntity && e.x === nx && e.y === ny
                );
                const hasEntity = otherEntities.length > 0;
                
                let moveCost = 1;
                if (cellType === 'wall-soft') moveCost = 10;
                
                // 改进：AI vs AI 模式下，实体阻塞是自杀的主因之一
                // 我们不再将实体视为简单的高代价路径，而是根据实体的状态动态计算代价
                if (hasEntity) {
                    // 如果对方也是 AI，且正在移动，代价略高但可接受
                    // 如果对方站着不动，可能是在“尬站”或者等待，代价极高以避免互相卡死
                    moveCost += 15; 
                }
                
                // --- 核心改进：时间轴安全性检查（增加安全冗余） ---
                if (avoidDanger && timeDangerMap) {
                    const arrivalTime = now + initialWait + (current.steps + 1) * moveCooldown;
                    const dangerWindows = timeDangerMap[ny][nx];
                    let isFatal = false;
                    
                    for (const window of dangerWindows) {
                        // 增加安全冗余缓冲
                        // 在多 AI 模式下，由于互相卡位的风险，我们需要更大的缓冲
                        const isMultiAI = [...gameState.players, ...gameState.enemies].filter(e => e.alive).length > 2;
                        const safetyBuffer = isMultiAI ? 500 : 350; 
                        
                        if (arrivalTime + safetyBuffer >= window.start && arrivalTime <= window.end + safetyBuffer) {
                            // 特殊处理：如果是自己放的炸弹，且当前没有其他逃生选择，权重稍微降低（但不代表安全）
                            // 但如果是别人放的炸弹，必须绝对避开
                            isFatal = true;
                            break;
                        }
                    }
                    if (isFatal) continue;
                }
                
                // 避开静态致命风险 (risk >= 0.8)
                if (avoidDanger && riskMap && riskMap[ny][nx] >= 0.8) continue;
                
                // 动态代价：经过有风险的区域会增加路径代价
                if (avoidDanger && riskMap && riskMap[ny][nx] > 0) {
                    moveCost += riskMap[ny][nx] * 10;
                }
                
                const g = current.g + moveCost;
                const h = isTargetFunc ? 0 : Math.abs(nx - target.x) + Math.abs(ny - target.y);
                
                const existingG = openMap.get(nextKey);
                if (existingG === undefined || g < existingG) {
                    pq.push({ x: nx, y: ny, g, h, parent: current, type: cellType, steps: current.steps + 1 });
                    openMap.set(nextKey, g);
                }
            }
        }
        return null;
    }
}
