/**
 * 困难难度策略 (v2.0)
 * 特点：
 * 1. 猎杀模式：主动寻找并逼近敌人
 * 2. 必杀判定：识别死角并执行补刀
 * 3. 强压制：评分系统大幅向进攻倾斜
 * 4. 连环计：利用多炸弹封锁路径
 */
class HardStrategy extends BaseAIStrategy {
    think() {
        const me = this.entity;
        const riskMap = AIUtils.getRiskMap(gameState, CONFIG, me);

        // 1. 绝对安全优先
        if (riskMap[me.y][me.x] > 0) {
            me.escape(riskMap);
            return;
        }

        // 2. 必杀逻辑 (最高优先级)
        // 检查是否有处于死角的敌人，直接去杀
        const trappedTarget = this.findTrappedTarget();
        if (trappedTarget) {
            // 计算最佳击杀位
            const killPos = this.findKillPosition(trappedTarget);
            if (killPos) {
                // 如果已经到位，直接开火
                if (me.x === killPos.x && me.y === killPos.y) {
                    if (this.canPlaceBombSafely()) {
                        me.performAction();
                        return;
                    }
                } else if (me.canMove()) {
                    // 全速前往击杀位
                    if (this.moveTo(killPos)) return;
                }
            }
        }

        // 3. 常规攻击与压制
        const target = this.findHighValueTarget();
        if (target) {
            const predicted = me.predictTargetPosition(target);
            
            // 尝试直接攻击
            if (this.tryOptimalAttack(predicted, target)) return;

            // 埋雷封路
            if (me.activeWeapon === 'landmine' && me.landmines > 0) {
                if (this.shouldPlaceMine(target)) {
                    me.performAction();
                    return;
                }
            }
        }

        // 4. 移动决策 (Utility Scoring - 进攻版)
        if (me.canMove()) {
            const bestMove = this.evaluateBestMove(target);
            if (bestMove) {
                if (bestMove.x === me.x && bestMove.y === me.y) {
                    // 到位了，如果没事做，就在这放个炸弹封路 (只要安全)
                    // 困难 AI 哪怕没炸到人，也要限制敌人走位
                    if (me.activeBombs < me.maxBombs && this.canPlaceBombSafely()) {
                        // 检查是否为了封路放弹（周围是空地）
                        if (Math.random() < 0.3) {
                             me.performAction();
                             return;
                        }
                    }
                    
                    // 还是没事做？炸墙
                    if (me.isBombUseful('wall') && this.canPlaceBombSafely()) {
                        me.performAction();
                        return;
                    }
                    return;
                }
                
                if (!this.moveTo(bestMove)) {
                    if (me.isBombUseful('wall') && this.canPlaceBombSafely()) {
                        me.performAction();
                        return;
                    }
                    this.wander(riskMap, true); // 移动失败，强制游走调整
                }
                return;
            }
        }
        
        // 5. 炸墙发育
        if (me.isBombUseful('wall') && this.canPlaceBombSafely()) {
            me.performAction();
            return;
        }

        // 6. 兜底
        if (me.canMove()) this.wander(riskMap);
    }

    findTrappedTarget() {
        const targets = [...gameState.players, ...gameState.enemies].filter(e => e !== this.entity && e.alive);
        return targets.find(t => this.entity.isTargetTrapped(t));
    }

    findHighValueTarget() {
        const targets = [...gameState.players, ...gameState.enemies].filter(e => e !== this.entity && e.alive);
        let closest = null;
        let minDist = Infinity;
        for (const t of targets) {
            const d = AIUtils.getDistance(this.entity, t);
            if (d < minDist) {
                minDist = d;
                closest = t;
            }
        }
        return closest;
    }

    /**
     * 寻找能炸死被困敌人的位置
     */
    findKillPosition(target) {
        const me = this.entity;
        const candidates = [];
        const riskMap = AIUtils.getRiskMap(gameState, CONFIG, me);
        
        // 搜索射程内的所有点
        const range = me.explosionRange;
        const dirs = [{dx:0, dy:-1}, {dx:0, dy:1}, {dx:-1, dy:0}, {dx:1, dy:0}];
        
        for (const d of dirs) {
            for (let r = 1; r <= range; r++) {
                const tx = target.x + d.dx * r;
                const ty = target.y + d.dy * r;
                
                if (tx >= 0 && tx < CONFIG.cols && ty >= 0 && ty < CONFIG.rows) {
                    if (gameState.grid[ty][tx] === 'floor' && riskMap[ty][tx] === 0) {
                        // 检查视线
                        if (me.hasClearShot({x:tx, y:ty}, target)) { // 复用 hasClearShot 检查两点间无阻挡
                             candidates.push({x: tx, y: ty});
                        }
                    }
                }
            }
        }
        
        // 找最近的一个
        let best = null;
        let minPath = Infinity;
        for (const cand of candidates) {
            const path = AIUtils.findPath(me, cand, gameState, true, false, me);
            if (path && path.length < minPath) {
                minPath = path.length;
                best = cand;
            }
        }
        return best;
    }

    tryOptimalAttack(predictedPos, realTarget) {
        const me = this.entity;
        if (me.activeWeapon === 'rocket' && me.rockets > 0) {
            if (me.hasClearShot(predictedPos.x, predictedPos.y)) {
                me.performAction();
                return true;
            }
        }

        if (me.activeWeapon === 'bomb' && this.canPlaceBombSafely()) {
            const inRange = (me.x === predictedPos.x && Math.abs(me.y - predictedPos.y) <= me.explosionRange) ||
                            (me.y === predictedPos.y && Math.abs(me.x - predictedPos.x) <= me.explosionRange);
            
            // 只要能炸到，毫不犹豫
            if (inRange && me.isBombUseful('target')) {
                me.performAction();
                return true;
            }
        }
        return false;
    }

    shouldPlaceMine(target) {
        const isChokepoint = AIUtils._findChokepoints(gameState, CONFIG).some(cp => cp.x === this.entity.x && cp.y === this.entity.y);
        const dist = AIUtils.getDistance(this.entity, target);
        return isChokepoint && dist < 5;
    }

    evaluateBestMove(target) {
        const me = this.entity;
        const candidates = [];
        const riskMap = AIUtils.getRiskMap(gameState, CONFIG, me);
        const range = 7; // 扩大搜索视野

        for (let y = Math.max(0, me.y - range); y <= Math.min(CONFIG.rows - 1, me.y + range); y++) {
            for (let x = Math.max(0, me.x - range); x <= Math.min(CONFIG.cols - 1, me.x + range); x++) {
                if (gameState.grid[y][x] !== 'floor') continue;
                if (riskMap[y][x] > 0) continue;

                let score = 0;
                if (target) {
                    const distToTarget = Math.abs(x - target.x) + Math.abs(y - target.y);
                    
                    // 激进评分：越近分越高，没有所谓“安全距离”
                    // 只要能放炸弹且自己能跑掉，贴脸也是好的
                    score += (20 - distToTarget) * 2; 

                    // 处于同一直线（攻击位）大幅加分
                    if (x === target.x || y === target.y) score += 15;
                }

                const powerup = gameState.powerUps.find(p => p.x === x && p.y === y);
                if (powerup) score += 25; // 抢资源

                const dirs = [{dx:0, dy:1}, {dx:0, dy:-1}, {dx:1, dy:0}, {dx:-1, dy:0}];
                let softWallCount = 0;
                for(const d of dirs) {
                    const nx = x + d.dx, ny = y + d.dy;
                    if (gameState.grid[ny]?.[nx] === 'wall-soft') softWallCount++;
                }
                if (softWallCount > 0) score += 5 * softWallCount;

                const distFromMe = Math.abs(x - me.x) + Math.abs(y - me.y);
                score -= distFromMe * 0.2; // 降低移动代价的扣分，鼓励长途奔袭
                score += Math.random() * 2; // 增加随机性，防止路径死循环

                candidates.push({ x, y, score });
            }
        }

        if (candidates.length === 0) return null;
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0];
    }
}
