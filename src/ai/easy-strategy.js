/**
 * 简单难度策略
 * 特点：
 * 1. 主要是随机移动
 * 2. 只有非常安全时才放炸弹
 * 3. 对道具和进攻不敏感
 */
class EasyStrategy extends BaseAIStrategy {
    think() {
        const me = this.entity;
        const riskMap = AIUtils.getRiskMap(gameState, CONFIG, me);

        // 1. 紧急避险 (最高优先级)
        if (riskMap[me.y][me.x] > 0) {
            me.escape(riskMap);
            return;
        }

        // 2. 偶尔发呆 (模拟菜鸟)
        // 但不能太呆，20% 概率不动
        if (Math.random() < 0.2) return;

        // 3. 简单的道具拾取 (视野范围内)
        if (me.canMove()) {
            const powerup = me.findNearestPowerUp();
            // 只有很近的道具才去捡 (距离 <= 5)
            if (powerup && powerup.path.length <= 5) {
                if (this.moveTo(powerup.target)) return;
            }
        }

        // 4. 极低概率放炸弹 (仅为了拆墙)
        // 只有当面前是软墙时才考虑
        if (me.isBombUseful('wall') && this.canPlaceBombSafely()) {
            // 10% 概率放置，很低
            if (Math.random() < 0.1) {
                me.performAction();
                return;
            }
        }

        // 5. 随机游走
        if (me.canMove()) {
            this.wander(riskMap);
        }
    }
}
