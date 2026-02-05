/**
 * AI 策略基类
 * 定义所有难度 AI 的通用接口和基础行为
 */
class BaseAIStrategy {
    constructor(entity) {
        this.entity = entity; // 绑定的 AI 实体
    }

    /**
     * 执行思考逻辑
     * @returns {void}
     */
    think() {
        // 子类必须实现
    }

    /**
     * 通用：尝试移动到目标位置
     * @param {Object} target 目标位置 {x, y}
     * @returns {boolean} 是否成功执行移动
     */
    moveTo(target) {
        if (!target) return false;
        
        // 1. 获取寻路路径
        // 注意：这里强制开启 avoidDanger，所有移动必须基于安全前提
        const path = AIUtils.findPath(this.entity, target, gameState, true, false, this.entity);
        
        if (path && path.length > 0) {
            const step = path[0];
            // 2. 双重检查：下一步是否真的安全
            // AIUtils.findPath 已经考虑了静态风险，这里再确认一下动态风险（如果有必要）
            // 目前 findPath 内部已经集成了时间轴检查，所以直接执行即可
            return this.entity.executeMove(step.dx, step.dy);
        }
        return false;
    }

    /**
     * 通用：安全检查 - 是否可以安全放置炸弹
     * @returns {boolean}
     */
    canPlaceBombSafely() {
        if (this.entity.activeBombs >= this.entity.maxBombs) return false;

        const now = Date.now();
        const me = this.entity;
        
        // 模拟放置炸弹
        const simulatedBomb = {
            x: me.x,
            y: me.y,
            range: me.explosionRange,
            placedTime: now,
            owner: me
        };

        // 创建临时游戏状态用于评估
        const tempGameState = {
            ...gameState,
            bombs: [...gameState.bombs, simulatedBomb]
        };

        // 1. 获取未来的危险地图（包含新炸弹的爆炸区域）
        const futureDangerMap = AIUtils.getDangerMap(tempGameState, CONFIG, me);
        
        // 2. 寻找逃生路径
        // 目标：找到任何一个绝对安全（Danger == 0）且在爆炸前可达的格子
        // 关键：这里不需要完整的 A* 到某个特定点，而是 Dijkstra 搜索最近的安全点
        const safePath = AIUtils.findPath(me, (x, y) => futureDangerMap[y][x] === 0, tempGameState, false, false, me);

        if (!safePath || safePath.length === 0) {
            // console.log(`[AI-${me.id}] 放弃放弹：无路可逃`);
            return false;
        }

        // 3. 验证逃生时间是否充足
        // 计算到达安全点所需时间
        // 考虑移动冷却 + 反应延迟
        const reactionTime = 150; 
        const timePerStep = me.moveCooldown; 
        const escapeTimeNeeded = (safePath.length * timePerStep) + reactionTime;
        
        // 炸弹倒计时
        const bombTimer = CONFIG.bombTimer;
        
        // 安全冗余：必须在爆炸前至少 500ms 到达
        // 困难模式可以稍微极限一点，简单模式需要更多缓冲
        // 如果有多枚炸弹，安全缓冲需要更大，防止连环爆炸
        const multiBombBuffer = me.activeBombs > 0 ? 300 : 0;
        const safetyBuffer = (this.entity.difficulty === 'hard' ? 400 : 800) + multiBombBuffer;

        if (escapeTimeNeeded + safetyBuffer >= bombTimer) {
            // console.log(`[AI-${me.id}] 放弃放弹：逃生时间不足`);
            return false;
        }

        // 4. (可选) 检查是否会困住队友 - 仅困难模式
        if (this.entity.difficulty === 'hard') {
            if (this.wouldTrapTeammate(tempGameState, simulatedBomb)) {
                return false;
            }
        }

        return true;
    }

    /**
     * 检查是否困住队友
     */
    wouldTrapTeammate(tempGameState, bomb) {
        const teammates = [...gameState.players, ...gameState.enemies].filter(e => e !== this.entity && e.alive);
        // 获取加入新炸弹后的危险图
        const futureDangerMap = AIUtils.getDangerMap(tempGameState, CONFIG, this.entity);

        for (const tm of teammates) {
            // 简单判定：如果队友在炸弹范围内
            const inRange = (tm.x === bomb.x && Math.abs(tm.y - bomb.y) <= bomb.range) ||
                            (tm.y === bomb.y && Math.abs(tm.x - bomb.x) <= bomb.range);
            
            if (inRange) {
                // 检查队友是否还有路可逃
                const escapePath = AIUtils.findPath(tm, (x, y) => futureDangerMap[y][x] === 0, tempGameState, false, false, tm);
                if (!escapePath || escapePath.length === 0) {
                    return true; // 队友死定了
                }
            }
        }
        return false;
    }

    /**
     * 随机移动兜底逻辑
     * @param {Array} riskMap 风险地图
     * @param {boolean} forceMove 是否强制移动（哪怕周围没有更好位置）
     */
    wander(riskMap, forceMove = false) {
        const me = this.entity;
        // 简单的随机游走，但避开危险
        // 降低原地不动的概率
        if (!forceMove && riskMap[me.y][me.x] === 0 && Math.random() < 0.1) {
            return; // 偶尔停顿
        }
        me.randomMove(riskMap);
    }
}
