/**
 * 普通难度策略
 * 特点：
 * 1. 继承自原本的困难难度策略（但移除了过于复杂的僵局判定）
 * 2. 具有一定的进攻性和发育能力
 * 3. 适合普通玩家挑战
 */
class NormalStrategy extends BaseAIStrategy {
    think() {
        const me = this.entity;
        const riskMap = AIUtils.getRiskMap(gameState, CONFIG, me);

        // 1. 绝对安全优先
        if (riskMap[me.y][me.x] > 0) {
            me.escape(riskMap);
            return;
        }

        // 2. 攻击逻辑
        const target = this.findTarget();
        if (target) {
            // 普通模式只做简单预测
            const predicted = me.predictTargetPosition(target);
            if (this.tryAttack(predicted, target)) return;
        }

        // 3. 移动决策 (Utility Scoring)
        if (me.canMove()) {
            const bestMove = this.evaluateBestMove(target);
            if (bestMove) {
                if (bestMove.x === me.x && bestMove.y === me.y) {
                    // 原地不动，尝试炸墙
                    if (me.isBombUseful('wall') && this.canPlaceBombSafely()) {
                        // 降低炸墙频率
                        if (Math.random() < 0.5) me.performAction();
                        return;
                    }
                    // 偶尔随机动一下
                    if (Math.random() < 0.2) this.wander(riskMap, true);
                    return;
                }
                
                if (!this.moveTo(bestMove)) {
                    if (me.isBombUseful('wall') && this.canPlaceBombSafely()) {
                        me.performAction();
                        return;
                    }
                    this.wander(riskMap);
                }
                return;
            }
        }
        
        if (me.isBombUseful('wall') && this.canPlaceBombSafely()) {
            me.performAction();
            return;
        }

        if (me.canMove()) this.wander(riskMap);
    }

    findTarget() {
        // 找最近的敌人
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

    tryAttack(predictedPos, realTarget) {
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
            // 普通难度攻击欲望稍低
            if (inRange && me.isBombUseful('target') && Math.random() < 0.8) {
                me.performAction();
                return true;
            }
        }
        return false;
    }

    evaluateBestMove(target) {
        // 复用 Hard 策略的评分逻辑，但可以调整参数
        const me = this.entity;
        const candidates = [];
        const riskMap = AIUtils.getRiskMap(gameState, CONFIG, me);
        const range = 5;

        for (let y = Math.max(0, me.y - range); y <= Math.min(CONFIG.rows - 1, me.y + range); y++) {
            for (let x = Math.max(0, me.x - range); x <= Math.min(CONFIG.cols - 1, me.x + range); x++) {
                if (gameState.grid[y][x] !== 'floor') continue;
                if (riskMap[y][x] > 0) continue;

                let score = 0;
                if (target) {
                    const distToTarget = Math.abs(x - target.x) + Math.abs(y - target.y);
                    if (distToTarget >= 2 && distToTarget <= 4) score += 8; // 稍微降低权重
                    else score -= Math.abs(distToTarget - 3); 
                    if (x === target.x || y === target.y) score += 3;
                }

                const powerup = gameState.powerUps.find(p => p.x === x && p.y === y);
                if (powerup) score += 15;

                const dirs = [{dx:0, dy:1}, {dx:0, dy:-1}, {dx:1, dy:0}, {dx:-1, dy:0}];
                let softWallCount = 0;
                for(const d of dirs) {
                    const nx = x + d.dx, ny = y + d.dy;
                    if (gameState.grid[ny]?.[nx] === 'wall-soft') softWallCount++;
                }
                if (softWallCount > 0) score += 3 * softWallCount;

                const distFromMe = Math.abs(x - me.x) + Math.abs(y - me.y);
                score -= distFromMe * 0.5;
                score += Math.random() * 0.5;

                candidates.push({ x, y, score });
            }
        }

        if (candidates.length === 0) return null;
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0];
    }
}
