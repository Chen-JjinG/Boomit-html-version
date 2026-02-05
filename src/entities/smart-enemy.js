/**
 * 智能敌人 AI 类
 * 充当 AI 实体的 Shell，将思考逻辑委托给具体的 Strategy 实现
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
        
        // 统一所有难度的基础移动冷却，确保公平性
        // 不再给困难 AI 加速，完全靠算法取胜
        this.moveCooldown = CONFIG.initialMoveCooldown || 200;
        
        this.element.textContent = CHAR_ICONS[colorIndex % CHAR_ICONS.length];
        
        this.lastActionTime = 0;
        this.currentTargetPath = null; 

        // 初始化策略
        this.strategy = this._createStrategy(difficulty);
        
        this.updateThinkInterval();
    }

    /**
     * 工厂方法：创建对应难度的策略
     */
    _createStrategy(difficulty) {
        switch (difficulty) {
            case 'easy':
                return new EasyStrategy(this);
            case 'hard':
                return new HardStrategy(this);
            case 'normal':
            default:
                return new NormalStrategy(this);
        }
    }

    /**
     * 更新思考频率
     */
    updateThinkInterval() {
        // 思考频率不影响移动速度，只影响反应快慢
        // 困难 AI 反应更快 (50ms)，简单 AI 较慢 (200ms)
        const newInterval = this.difficulty === 'hard' ? 50 : (this.difficulty === 'normal' ? 100 : 200);
        
        if (this.thinkInterval !== newInterval) {
            this.thinkInterval = newInterval;
            if (this.aiInterval) clearInterval(this.aiInterval);
            this.aiInterval = setInterval(() => this.think(), this.thinkInterval);
        }
    }

    applyPowerUp(type) {
        super.applyPowerUp(type);
        // 如果吃了加速道具，思考频率也相应提升
        if (type === 'speed') {
            this.updateThinkInterval();
        }
    }

    destroy() {
        if (this.aiInterval) {
            clearInterval(this.aiInterval);
            this.aiInterval = null;
        }
        super.destroy();
    }

    /**
     * 核心思考循环：委托给策略执行
     */
    think() {
        if (!this.alive || gameState.isTestMode) return;
        
        // 确保策略存在
        if (this.strategy) {
            this.strategy.think();
        }
    }

    // --- 辅助方法提供给策略使用 ---

    /**
     * 判断放置炸弹是否有意义
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
                
                if ((type === 'any' || type === 'wall') && cell === 'wall-soft') return true;
                
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
     * 预测目标位置
     */
    predictTargetPosition(target) {
        // 简单模式不预测
        if (this.difficulty === 'easy') return target;

        if (!target.moveHistory || target.moveHistory.length === 0) return target;
        
        let trendX = 0, trendY = 0;
        target.moveHistory.forEach(move => { trendX += move.dx; trendY += move.dy; });
        
        // 预测 1-2 格
        const predictionSteps = this.difficulty === 'hard' ? 2 : 1;
        
        let px = target.x;
        let py = target.y;
        
        // 简单的线性预测
        if (Math.abs(trendX) > Math.abs(trendY)) {
            px += Math.sign(trendX) * predictionSteps;
        } else {
            py += Math.sign(trendY) * predictionSteps;
        }
        
        // 边界检查
        if (px >= 0 && px < CONFIG.cols && py >= 0 && py < CONFIG.rows && gameState.grid[py][px] === 'floor') {
            return { x: px, y: py };
        }
        return target;
    }

    /**
     * 寻找最近的道具
     */
    findNearestPowerUp() {
        if (!gameState.powerUps || gameState.powerUps.length === 0) return null;
        let best = null;
        let bestLen = Infinity;
        // 限制搜索范围，避免全图寻路太耗时
        const searchLimit = this.difficulty === 'hard' ? 20 : 10;
        
        for (const pu of gameState.powerUps) {
            const dist = Math.abs(this.x - pu.x) + Math.abs(this.y - pu.y);
            if (dist > searchLimit) continue;

            const path = AIUtils.findPath(this, pu, gameState, true, false, this);
            if (path && path.length > 0 && path.length < bestLen) {
                bestLen = path.length;
                best = { target: pu, path };
            }
        }
        return best;
    }

    /**
     * 寻找最近的软墙破坏点
     */
    findWallBreachPosition() {
        // 简化版搜索：只找附近的
        const range = 6;
        let best = null;
        let minPath = Infinity;

        for (let dy = -range; dy <= range; dy++) {
            for (let dx = -range; dx <= range; dx++) {
                const nx = this.x + dx;
                const ny = this.y + dy;
                if (nx < 0 || nx >= CONFIG.cols || ny < 0 || ny >= CONFIG.rows) continue;
                if (gameState.grid[ny][nx] !== 'floor') continue;

                // 检查这个点旁边有没有软墙
                const dirs = [{dx:0, dy:1}, {dx:0, dy:-1}, {dx:1, dy:0}, {dx:-1, dy:0}];
                const hasSoftWall = dirs.some(d => gameState.grid[ny+d.dy]?.[nx+d.dx] === 'wall-soft');
                
                if (hasSoftWall) {
                    const path = AIUtils.findPath(this, {x:nx, y:ny}, gameState, true, false, this);
                    if (path && path.length > 0 && path.length < minPath) {
                        minPath = path.length;
                        best = { target: {x:nx, y:ny}, path };
                    }
                }
            }
        }
        return best;
    }
    
    /**
     * 检查是否有清晰射击线 (复用旧逻辑)
     */
    hasClearShot(tx, ty) {
        const dx = Math.sign(tx - this.x);
        const dy = Math.sign(ty - this.y);
        if (dx !== 0 && dy !== 0) return false;

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
     * 检查目标是否被困
     */
    isTargetTrapped(target) {
        // 简单判定：目标周围的可移动格子数
        const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
        let exits = 0;
        for (const d of dirs) {
            const nx = target.x + d.dx;
            const ny = target.y + d.dy;
            // 简单检查地形
            if (nx >= 0 && nx < CONFIG.cols && ny >= 0 && ny < CONFIG.rows) {
                 const cell = gameState.grid[ny][nx];
                 if (cell === 'floor' && !gameState.bombs.some(b => b.x === nx && b.y === ny)) {
                     exits++;
                 }
            }
        }
        return exits <= 1;
    }

    /**
     * 逃生 (委托给 AIUtils，但也保留作为 fallback)
     */
    escape(map) {
        const safePath = AIUtils.findPath(this, (x, y) => map[y][x] === 0, gameState, true, false, this);
        if (safePath && safePath.length > 0) {
            this.executeMove(safePath[0].dx, safePath[0].dy);
        } else {
            // 实在跑不掉，随机动一下
            this.randomMove(map);
        }
    }
    
    /**
     * 随机移动
     */
    randomMove(map) {
        const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}]
            .sort(() => Math.random() - 0.5);
            
        for (const d of dirs) {
            const nx = this.x + d.dx;
            const ny = this.y + d.dy;
            // 必须是合法的移动且目标位置相对安全（风险不增加）
            if (this.canMoveTo(nx, ny) && map[ny][nx] <= map[this.y][this.x]) {
                if (this.executeMove(d.dx, d.dy)) return;
            }
        }
    }

    // 复用 executeMove, canMoveTo, performAction 等 Entity 基类方法
    // 这些方法在 Entity 类中定义，SmartEnemy 继承使用
    
    /**
     * 执行移动 (包装一层以更新状态)
     */
    executeMove(dx, dy) {
        const now = Date.now();
        if (now - this.lastMoveTime < this.moveCooldown) return false;
        
        if (this.move(dx, dy)) {
            this.lastMoveTime = now;
            return true;
        }
        return false;
    }
    
    canMove() {
        return Date.now() - this.lastActionTime >= this.moveCooldown;
    }
}
