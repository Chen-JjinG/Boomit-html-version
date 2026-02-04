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
        this.currentTargetPath = null; // 用于路径锁定，减少抖动
        this.updateThinkInterval();
    }

    /**
     * 根据当前移动冷却时间动态更新思考频率
     */
    updateThinkInterval() {
        // 显著提升思考频率，让 AI 反应更敏捷
        // 困难/普通模式下统一为极速思考（50-80ms），简单模式略慢
        const newInterval = this.difficulty === 'hard' ? 50 : (this.difficulty === 'normal' ? 80 : 200);
        
        if (this.thinkInterval !== newInterval) {
            this.thinkInterval = newInterval;
            if (this.aiInterval) clearInterval(this.aiInterval);
            this.aiInterval = setInterval(() => this.think(), this.thinkInterval);
        }
    }

    /**
     * 重写 applyPowerUp 以便在提速后更新思考频率
     */
    applyPowerUp(type) {
        super.applyPowerUp(type);
        if (type === 'speed') {
            this.updateThinkInterval();
        }
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
            // 修正：使用 AI 实体自身的视角获取危险地图
            const dangerMap = AIUtils.getDangerMap(gameState, CONFIG, this);
            if (dangerMap[target.y][target.x] > 0) {
                const safePath = AIUtils.findPath(target, (x, y) => dangerMap[y][x] === 0, gameState, false, false, target);
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
        
        // 只有移动需要检查 moveCooldown，攻击动作可以有更独立的响应节奏
        // 将冷却检查下移到具体的移动逻辑中，让 AI 即使在等待移动时也能实时“思考”逃生路径或攻击机会
        
        // 核心安全验证：即使在思考逻辑之外，也强制检查当前格在时间轴上的绝对安全性
        if (this.difficulty === 'hard') {
            const timeDangerMap = AIUtils.getTimeDangerMap(gameState, CONFIG);
            const dangerWindows = timeDangerMap[this.y][this.x];
            if (dangerWindows.length > 0) {
                const safetyBuffer = 400;
                const isUrgent = dangerWindows.some(w => now + safetyBuffer >= w.start && now <= w.end + safetyBuffer);
                if (isUrgent) {
                    const riskMap = AIUtils.getRiskMap(gameState, CONFIG, this);
                    this.escape(riskMap);
                    return;
                }
            }
        }

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
        const now = Date.now();
        const canMove = now - this.lastMoveTime >= this.moveCooldown;

        if (dangerMap[this.y][this.x] > 0) {
            this.escape(dangerMap);
            return;
        }

        // 非必要不移动
        if (dangerMap[this.y][this.x] === 0) {
            if (Math.random() > 0.1) return;
        }

        // 较低概率尝试拆墙
        if (Math.random() < 0.2 && this.isBombUseful('wall') && this.canPlaceBombSafely()) {
            this.performAction();
            return;
        }

        // 主要是随机移动
        if (canMove) {
            this.randomMove(dangerMap);
        }
    }

    /**
     * 普通难度 AI：升级至较强水平，使用风险图和基础进攻策略
     */
    thinkNormal() {
        const riskMap = AIUtils.getRiskMap(gameState, CONFIG, this);
        const now = Date.now();
        const canMove = now - this.lastMoveTime >= this.moveCooldown;
        
        // 1. 紧急避险 (最高优先级，不受冷却限制思考，但受限制移动)
        if (riskMap[this.y][this.x] > 0.4) {
            this.currentTargetPath = null;
            this.escape(riskMap);
            return;
        }

        // 2. 路径保持逻辑 (防止抽风)
        if (this.currentTargetPath && this.currentTargetPath.length > 0) {
            if (canMove) {
                const nextStep = this.currentTargetPath.shift();
                if (this.canMoveTo(this.x + nextStep.dx, this.y + nextStep.dy) && 
                    riskMap[this.y + nextStep.dy][this.x + nextStep.dx] < 0.3) {
                    this.executeMove(nextStep.dx, nextStep.dy);
                    return;
                }
                this.currentTargetPath = null;
            } else {
                // 等待冷却，不执行后续逻辑，保持路径
                return;
            }
        }

        // 3. 寻找最近目标
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

        const canPlaceBomb = riskMap[this.y][this.x] < 0.2 && this.canPlaceBombSafely();
        const hasRocket = this.activeWeapon === 'rocket' && this.rockets > 0;

        if (closestTarget) {
            const predictedTarget = this.predictTargetPosition(closestTarget);
            
            // 基础进攻决策
            if (hasRocket) {
                if ((this.x === predictedTarget.x || this.y === predictedTarget.y) && 
                    this.hasClearShot(predictedTarget.x, predictedTarget.y)) {
                    this.performAction();
                    return;
                }
            } else if (canPlaceBomb && this.activeWeapon === 'bomb') {
                const inRange = (this.x === predictedTarget.x && Math.abs(this.y - predictedTarget.y) <= this.explosionRange) ||
                              (this.y === predictedTarget.y && Math.abs(this.x - predictedTarget.x) <= this.explosionRange);
                
                // 多炸弹限制
                const multiBombThrottling = this.activeBombs > 0 ? 0.4 : 1.0;
                if (inRange && this.isBombUseful('target') && Math.random() < multiBombThrottling) {
                    this.performAction();
                    return;
                }
            }

            // 移动向目标
            if (canMove) {
                const path = AIUtils.findPath(this, predictedTarget, gameState, true, false, this);
                if (path && path.length > 0) {
                    this.currentTargetPath = path;
                    const step = this.currentTargetPath.shift();
                    this.executeMove(step.dx, step.dy);
                    return;
                }
            } else {
                return; // 等待冷却
            }
        }

        // 4. 拆墙
        if (this.isBombUseful('wall')) {
            if (hasRocket) {
                const dir = this.lastDir || {dx: 0, dy: -1};
                const frontCell = gameState.grid[this.y + dir.dy]?.[this.x + dir.dx];
                if (frontCell === 'wall-soft') {
                    this.performAction();
                    return;
                }
            } else if (canPlaceBomb) {
                // 拆墙时的多炸弹限制
                const wallThrottling = this.activeBombs > 0 ? 0.1 : 1.0;
                if (Math.random() < wallThrottling) {
                    this.performAction();
                    return;
                }
            }
        }

        // 5. 随机安全移动
        if (riskMap[this.y][this.x] === 0) {
            // 在普通模式下，如果当前位置已经安全，且没有紧迫的进攻目标或拆墙需求，则原地待命
            if (Math.random() > 0.2) {
                return;
            }
        }
        
        if (canMove) {
            this.randomMove(riskMap);
        }
    }

    /**
     * 困难难度 AI：包含影响图站位、动态风险规避、资源压制等高级算法
     */
    thinkHard() {
        const riskMap = AIUtils.getRiskMap(gameState, CONFIG, this);
        
        // 1. 紧急避险：只要当前格有任何风险，立即寻找代价最低的安全路径
        // 将阈值从 0.4 降低，只要有风险就进入逃生逻辑
        if (riskMap[this.y][this.x] > 0.05) {
            this.currentTargetPath = null; 
            this.escape(riskMap);
            return;
        }

        // 2. 路径锁定逻辑：如果已经有目标路径且目的地仍然绝对安全，则继续执行
        if (this.currentTargetPath && this.currentTargetPath.length > 0) {
            const now = Date.now();
            if (now - this.lastMoveTime >= this.moveCooldown) {
                const targetPos = this.currentTargetPath[this.currentTargetPath.length - 1].target;
                // 目的地必须绝对安全 (risk === 0)
                if (targetPos && riskMap[targetPos.y][targetPos.x] === 0) {
                    const nextStep = this.currentTargetPath.shift();
                    if (this.canMoveTo(this.x + nextStep.dx, this.y + nextStep.dy)) {
                        // 下一步也必须绝对安全
                        if (riskMap[this.y + nextStep.dy][this.x + nextStep.dx] === 0) {
                            this.executeMove(nextStep.dx, nextStep.dy);
                            return;
                        }
                    }
                }
                this.currentTargetPath = null;
            } else {
                // 虽然在冷却，但我们不返回，继续执行后面的攻击判定
                // 这样 AI 即使在等待移动时也能发射火箭或放置地雷
            }
        }

        // 3. 获取影响图，寻找全局最优战略点
        const influenceMap = AIUtils.getInfluenceMap(gameState, CONFIG, this);
        let bestScore = -Infinity;
        let bestPos = null;

        // 当前位置的基础分（用于后续对比）
        const currentPosScore = influenceMap[this.y][this.x];

        // 在周围 7x7 范围内寻找分数最高且安全的战略位 (扩大搜索范围)
        for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
                const nx = this.x + dx;
                const ny = this.y + dy;
                if (nx >= 0 && nx < CONFIG.cols && ny >= 0 && ny < CONFIG.rows) {
                    // 目的地筛选：必须是空地，且风险必须在极低范围内
                    if (gameState.grid[ny][nx] === 'floor') {
                        let score = influenceMap[ny][nx];
                        
                        // 距离惩罚
                        score -= (Math.abs(dx) + Math.abs(dy)) * 0.15;
                        
                        // 核心改进：风险惩罚
                        // 如果该位置有任何风险（即便只是爆炸边缘），都施加巨大的负分，确保 AI 优先选择绝对安全（risk 为 0）的格子
                        if (riskMap[ny][nx] > 0) {
                            score -= riskMap[ny][nx] * 20; // 极大的风险惩罚
                        }
                        
                        // 只有当得分依然大于一个基础门槛时才考虑（过滤掉高风险区）
                        if (score < -5) continue; 

                        // 原地停留加分（惯性权重），防止在得分相近的格子间来回抽风
                        if (dx === 0 && dy === 0 && riskMap[ny][nx] === 0) {
                            score += 0.25; 
                        }

                        if (score > bestScore) {
                            bestScore = score;
                            bestPos = { x: nx, y: ny };
                        }
                    }
                }
            }
        }

        // 4. 资源压制与进攻决策
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

        // 攻击前置检查：解耦不同武器的安全性与可用性
        const canPlaceBomb = riskMap[this.y][this.x] < 0.2 && this.canPlaceBombSafely();
        const hasRocket = this.activeWeapon === 'rocket' && this.rockets > 0;
        const hasLandmine = this.activeWeapon === 'landmine' && this.landmines > 0;

        if (closestTarget) {
            const predictedTarget = this.predictTargetPosition(closestTarget);
            
            // 如果目标被困，优先执行“围堵” (仅炸弹)
            if (this.isTargetTrapped(predictedTarget) && canPlaceBomb && this.activeWeapon === 'bomb') {
                this.performAction();
                return;
            }

            // 火箭筒攻击逻辑：更远距离的预判
            if (hasRocket) {
                const onLine = this.x === predictedTarget.x || this.y === predictedTarget.y;
                const dist = AIUtils.getDistance(this, predictedTarget);
                // 火箭筒射程远，只要在直线上且有视野就开火
                if (onLine && dist <= 10 && this.hasClearShot(predictedTarget.x, predictedTarget.y)) {
                    this.performAction();
                    return;
                }
            }

            // 地雷战术：在关键点放置
            if (hasLandmine) {
                const isAtChokepoint = AIUtils._findChokepoints(gameState, CONFIG).some(cp => cp.x === this.x && cp.y === this.y);
                if (isAtChokepoint && AIUtils.getDistance(this, predictedTarget) <= 4) {
                    this.performAction();
                    return;
                }
            }

            // 炸弹常规进攻
            if (this.activeWeapon === 'bomb') {
                const attackChance = this.personality === 'aggressive' ? 0.95 : 0.8;
                // 如果已有炸弹，显著降低进攻欲望，优先保证生存
                const multiBombThrottling = this.activeBombs > 0 ? 0.3 : 1.0;
                if (Math.random() < attackChance * multiBombThrottling) {
                    const inRange = (this.x === predictedTarget.x && Math.abs(this.y - predictedTarget.y) <= this.explosionRange) ||
                                  (this.y === predictedTarget.y && Math.abs(this.x - predictedTarget.x) <= this.explosionRange);
                    
                    if (inRange && this.isBombUseful('target') && canPlaceBomb) {
                        this.performAction();
                        return;
                    }
                }
            }
        }

        // 5. 移动向战略点
        if (bestPos && (bestPos.x !== this.x || bestPos.y !== this.y)) {
            const now = Date.now();
            if (now - this.lastMoveTime >= this.moveCooldown) {
                // 降低切换阈值，0.15 既能过滤微小抖动，又不至于让 AI 反应迟钝
                if (bestScore > (currentPosScore + 0.15)) {
                    const path = AIUtils.findPath(this, bestPos, gameState, true, false, this);
                    if (path && path.length > 0) {
                        // 将目的地信息存入路径中以便追踪
                        const pathWithTarget = path.map(step => ({ ...step, target: bestPos }));
                        this.currentTargetPath = pathWithTarget;
                        const nextStep = this.currentTargetPath.shift();
                        this.executeMove(nextStep.dx, nextStep.dy);
                        return;
                    }
                }
            } else {
                // 冷却中，不执行后续逻辑，保持当前移动意图
                return;
            }
        }

        // 6. 拆墙开路
        if (this.isBombUseful('wall')) {
            if (hasRocket) {
                // 如果当前朝向刚好是对着墙，直接开火，否则不浪费火箭
                const dir = this.lastDir || {dx: 0, dy: -1};
                let nx = this.x + dir.dx;
                let ny = this.y + dir.dy;
                if (nx >= 0 && nx < CONFIG.cols && ny >= 0 && ny < CONFIG.rows && gameState.grid[ny][nx] === 'wall-soft') {
                    this.performAction();
                    return;
                }
            } else if (canPlaceBomb) {
                // 已有炸弹时，极低概率为了拆墙放炸弹，防止被自己炸死
                const wallDestructionThrottling = this.activeBombs > 0 ? 0.1 : 1.0;
                if (Math.random() < wallDestructionThrottling) {
                    this.performAction();
                    return;
                }
            }
        }

        // 7. 兜底逻辑：随机安全移动
        // 如果当前位置已经安全，则以较低概率（20%）进行游走，保持一定的活跃度
        if (riskMap[this.y][this.x] === 0 && Math.random() > 0.2) {
            return;
        }
        this.randomMove(riskMap);
    }

    /**
     * 检查目标是否处于易受攻击的状态（不仅是死角，还包括逃生路径受限）
     */
    isTargetTrapped(target) {
        const dangerMap = AIUtils.getDangerMap(gameState, CONFIG, this);
        // 如果目标已经在危险中，检查其是否有逃生路径
        if (dangerMap[target.y][target.x] > 0) {
            const safePath = AIUtils.findPath(target, (x, y) => dangerMap[y][x] === 0, gameState, false, false, target);
            if (!safePath) return true;
        }

        // 基础死角检查
        const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
        let walkableNeighbors = 0;
        dirs.forEach(d => {
            if (this.canMoveTo(target.x + d.dx, target.y + d.dy)) walkableNeighbors++;
        });
        
        // 如果只有 1 个出口，或者当前就在危险区且无路可逃，视为被困
        return walkableNeighbors <= 1;
    }

    /**
     * 逃生逻辑：寻找安全路径
     */
    escape(map) {
        // 尝试寻找风险最低的路径 (findPath 内部会处理风险权值)
        const safePath = AIUtils.findPath(this, (x, y) => map[y][x] === 0, gameState, true, false, this);
        if (safePath && safePath.length > 0) {
            this.executeMove(safePath[0].dx, safePath[0].dy);
        } else {
            // 如果无处可躲，尝试炸开一条生路（仅限困难难度）
            if (this.difficulty === 'hard' && this.canPlaceBombSafely()) {
                const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
                const softWallNear = dirs.find(d => {
                    const nx = this.x + d.dx, ny = this.y + d.dy;
                    return nx >= 0 && nx < CONFIG.cols && ny >= 0 && ny < CONFIG.rows && 
                           gameState.grid[ny][nx] === 'wall-soft';
                });
                if (softWallNear) {
                    this.performAction();
                    return;
                }
            }
            this.randomMove(map);
        }
    }

    /**
     * 随机移动（避开危险）
     */
    randomMove(map) {
        const timeDangerMap = AIUtils.getTimeDangerMap(gameState, CONFIG);
        const now = Date.now();
        const timeSinceLastMove = now - this.lastMoveTime;
        
        // 增加决策补偿和更长的安全缓冲
        const reactionCompensation = 150;
        const safetyBuffer = 400; 
        const remainingCooldown = Math.max(0, this.moveCooldown - timeSinceLastMove);
        const arrivalTime = now + remainingCooldown + reactionCompensation;

        // 如果当前位置已经绝对安全，且 randomMove 被调用（通常是 20% 的游走概率），
        // 我们应该优先考虑原地不动，除非周围有显著更好的位置。
        // 这能有效解决在狭窄空间（1-2格）内的“抽风”抖动。
        if (map[this.y][this.x] === 0 && Math.random() < 0.7) {
            return;
        }

        const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}]
            .sort(() => Math.random() - 0.5);
        
        // 1. 过滤掉在到达时间点会爆炸的格子
        const safeDirs = dirs.filter(d => {
            const nx = this.x + d.dx;
            const ny = this.y + d.dy;
            if (!this.canMoveTo(nx, ny)) return false;
            
            const dangerWindows = timeDangerMap[ny][nx];
            for (const window of dangerWindows) {
                if (arrivalTime + safetyBuffer >= window.start && arrivalTime <= window.end + safetyBuffer) {
                    return false;
                }
            }
            return true;
        });

        // 优先选择风险为 0 的格子
        for (const d of safeDirs) {
            const nx = this.x + d.dx;
            const ny = this.y + d.dy;
            if (map[ny][nx] === 0) {
                this.executeMove(d.dx, d.dy);
                return;
            }
        }
        
        // 如果没有风险为 0 的格子，选择风险最低的格子
        let minRisk = Infinity;
        let bestDir = null;
        for (const d of safeDirs) {
            const nx = this.x + d.dx;
            const ny = this.y + d.dy;
            if (map[ny][nx] < minRisk) {
                minRisk = map[ny][nx];
                bestDir = d;
            }
        }
        // 如果没有绝对安全的格子，从所有可选方向中选择风险最低的
        if (!bestDir) {
            let minRiskFallback = Infinity;
            for (const d of dirs) {
                const nx = this.x + d.dx;
                const ny = this.y + d.dy;
                if (this.canMoveTo(nx, ny)) {
                    if (map[ny][nx] < minRiskFallback) {
                        minRiskFallback = map[ny][nx];
                        bestDir = d;
                    }
                }
            }
        }
        
        if (bestDir) this.executeMove(bestDir.dx, bestDir.dy);
    }

    /**
     * 执行移动并更新冷却计时
     */
    executeMove(dx, dy) {
        const now = Date.now();
        // 强制执行移动冷却检查
        if (now - this.lastMoveTime < this.moveCooldown) return false;
        
        if (this.move(dx, dy)) {
            this.lastMoveTime = now;
            return true;
        }
        return false;
    }

    /**
     * 核心安全检查：模拟放置炸弹后是否仍有逃生路径
     * 升级：引入多步时间轴预测，并严格考虑爆炸持续时间
     */
    canPlaceBombSafely() {
        if (this.activeBombs >= this.maxBombs) return false;
        
        const now = Date.now();
        // 关键点：考虑当前移动冷却的剩余时间
        const timeSinceLastMove = now - this.lastMoveTime;
        const remainingCooldown = Math.max(0, this.moveCooldown - timeSinceLastMove);
        
        // 模拟放置炸弹后的状态
        const simulatedBomb = {
            x: this.x, 
            y: this.y, 
            range: this.explosionRange,
            placedTime: now
        };
        const tempBombs = [...gameState.bombs, simulatedBomb];
        const tempGameState = { ...gameState, bombs: tempBombs };
        
        // 1. 静态风险检查：是否存在逃向安全区域（风险为 0）的路径
        const futureDangerMap = AIUtils.getDangerMap(tempGameState, CONFIG, this);
        // 寻找一个绝对安全的落脚点
        const safePath = AIUtils.findPath(this, (x, y) => futureDangerMap[y][x] === 0, tempGameState, false, false, this);
        
        if (!safePath || safePath.length === 0) return false;

        // 2. 动态时间轴检查：验证逃生路径上的每一步在到达时是否安全
        for (let i = 0; i < safePath.length; i++) {
            const step = safePath[i];
            const arrivalTime = now + remainingCooldown + (i + 1) * this.moveCooldown + 150;
            
            for (const b of tempBombs) {
                const explodeTime = b.placedTime + CONFIG.bombTimer;
                const explodeEndTime = explodeTime + (CONFIG.explosionDuration || 1000);
                
                const safetyBuffer = 450; // 增加安全缓冲
                if (arrivalTime + safetyBuffer >= explodeTime && arrivalTime <= explodeEndTime + safetyBuffer) {
                    if (b.x === step.x && Math.abs(b.y - step.y) <= b.range || 
                        b.y === step.y && Math.abs(b.x - step.x) <= b.range) {
                        if (!this._isExplosionBlocked(b, step.x, step.y)) {
                            return false; 
                        }
                    }
                }
            }
        }

        // 3. 针对多炸弹情况的额外限制
        // 如果已经有炸弹在场，逃生冗余必须更大，防止多个炸弹封死所有出口
        const multiBombPenalty = this.activeBombs > 0 ? 800 : 0;
        const totalEscapeTime = remainingCooldown + safePath.length * this.moveCooldown;
        const gameTime = Date.now() - (gameState.startTime || Date.now());
        const earlyGameBuffer = gameTime < 30000 ? 500 : 0;
        
        const safetyBuffer = (this.difficulty === 'hard' ? 1200 : 800) + earlyGameBuffer + multiBombPenalty; 
        
        if (totalEscapeTime >= (CONFIG.bombTimer - safetyBuffer)) return false;

        // 4. 同伴陷阱检查
        if (this.wouldTrapTeammate(simulatedBomb)) return false;

        return true;
    }

    /**
     * 检查放置炸弹是否会导致同伴被困（同伴陷阱检查）
     */
    wouldTrapTeammate(simulatedBomb) {
        // 仅在困难模式下执行精细的同伴保护
        if (this.difficulty !== 'hard') return false;

        const teammates = [...gameState.players, ...gameState.enemies].filter(e => e !== this && e.alive);
        if (teammates.length === 0) return false;

        const tempBombs = [...gameState.bombs, simulatedBomb];
        const tempGameState = { ...gameState, bombs: tempBombs };
        
        // 获取模拟放置炸弹后的危险地图
        const futureDangerMap = AIUtils.getDangerMap(tempGameState, CONFIG, this);

        for (const tm of teammates) {
            // 检查同伴是否在炸弹范围内
            const inRangeX = simulatedBomb.x === tm.x && Math.abs(simulatedBomb.y - tm.y) <= simulatedBomb.range;
            const inRangeY = simulatedBomb.y === tm.y && Math.abs(simulatedBomb.x - tm.x) <= simulatedBomb.range;
            
            if (inRangeX || inRangeY) {
                // 如果爆炸会被阻挡，则同伴是安全的
                if (this._isExplosionBlocked(simulatedBomb, tm.x, tm.y)) continue;

                // 检查同伴是否有逃生路径
                const escapePath = AIUtils.findPath(tm, (x, y) => futureDangerMap[y][x] === 0, tempGameState, false, false, tm);
                if (!escapePath) {
                    // console.log(`AI ${this.id} 放弃放弹：会困住队友 ${tm.id || 'P'}`);
                    return true; 
                }
            }
        }
        return false;
    }

    /**
     * 辅助方法：检查炸弹爆炸是否被墙阻挡
     */
    _isExplosionBlocked(bomb, tx, ty) {
        if (bomb.x === tx && bomb.y === ty) return false;
        const dx = Math.sign(tx - bomb.x);
        const dy = Math.sign(ty - bomb.y);
        let cx = bomb.x + dx;
        let cy = bomb.y + dy;
        while (cx !== tx || cy !== ty) {
            const cell = gameState.grid[cy][cx];
            if (cell === 'wall-hard' || cell === 'wall-soft') return true;
            cx += dx;
            cy += dy;
        }
        return false;
    }
}
