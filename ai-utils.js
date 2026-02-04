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
     * 获取危险区域地图
     * 0: 安全, 1: 危险 (在炸弹或地雷的爆炸范围内)
     */
    static getDangerMap(gameState, config, aiEntity = null) {
        const dangerMap = Array.from({ length: config.rows }, () => Array(config.cols).fill(0));
        
        // 1. 标记炸弹爆炸范围
        gameState.bombs.forEach(bomb => {
            dangerMap[bomb.y][bomb.x] = 1;
            const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
            
            dirs.forEach(d => {
                for (let r = 1; r <= bomb.range; r++) {
                    const nx = bomb.x + d.dx * r;
                    const ny = bomb.y + d.dy * r;
                    
                    if (nx < 0 || nx >= config.cols || ny < 0 || ny >= config.rows) break;
                    const cell = gameState.grid[ny][nx];
                    if (cell === 'wall-hard') break;
                    
                    dangerMap[ny][nx] = 1;
                    if (cell === 'wall-soft') break;
                }
            });
        });

        // 2. 标记地雷位置
        gameState.landmines.forEach(mine => {
            let isVisible = false;
            if (aiEntity) {
                const isOwner = mine.owner === aiEntity;
                const isFlashing = mine.element && !mine.element.classList.contains('hidden-mine');
                // 困难 AI 具有“第六感”，能感知附近的地雷
                const isHardAndNearby = aiEntity.difficulty === 'hard' && this.getDistance(aiEntity, mine) <= 2;
                
                if (isOwner || isFlashing || isHardAndNearby) {
                    isVisible = true;
                }
            } else {
                isVisible = mine.element && !mine.element.classList.contains('hidden-mine');
            }

            if (isVisible) {
                dangerMap[mine.y][mine.x] = 1;
            }
        });
        
        return dangerMap;
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

        // 尝试从缓存获取
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
        
        const pq = new PriorityQueue((a, b) => (a.g + a.h) < (b.g + b.h));
        pq.push({ x: startX, y: startY, g: 0, h: 0, parent: null });
        
        const closedList = new Set();
        const openMap = new Map();
        openMap.set(`${startX},${startY}`, 0);
        
        while (!pq.isEmpty()) {
            const current = pq.pop();
            const currentKey = `${current.x},${current.y}`;
            
            if (isTarget(current.x, current.y)) {
                // 找到路径，回溯生成结果
                const path = [];
                let temp = current;
                while (temp.parent) {
                    path.push({ x: temp.x, y: temp.y, dx: temp.x - temp.parent.x, dy: temp.y - temp.parent.y, type: temp.type });
                    temp = temp.parent;
                }
                const result = path.reverse();
                
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
                    moveCost = 10; // 软墙通行代价极高，迫使 AI 优先走空地
                    cellType = 'wall-soft';
                }

                // 避开炸弹本身
                if (gameState.bombs.some(b => b.x === nx && b.y === ny)) continue;
                // 避开危险区域
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
