/**
 * UI 处理模块：管理游戏界面、状态显示和用户交互
 */
const UI = {
    board: document.getElementById('game-board'),
    startScreen: document.getElementById('start-screen'),
    overlay: document.getElementById('overlay'),
    resultMsg: document.getElementById('result-message'),
    enemyCountEl: document.getElementById('enemy-count'),
    p1Card: document.getElementById('status-p1'),
    p2Card: document.getElementById('status-p2'),
    enemyContainer: document.getElementById('enemy-status-container'),
    timerEl: document.getElementById('game-timer'),

    /**
     * 更新顶部栏敌人剩余数量显示
     */
    updateEnemyCount() {
        if (this.enemyCountEl) this.enemyCountEl.textContent = gameState.enemies.length;
    },

    /**
     * 更新所有实体（玩家和 AI）的状态卡片显示
     */
    updateStatusDisplay() {
        [...gameState.players, ...gameState.enemies].forEach(entity => {
            const isPlayer = entity.type.startsWith('player');
            const isHuman = isPlayer && (gameState.mode !== 'ai-vs-ai');
            
            // 生成唯一 ID 用于定位 DOM 元素
            const id = isPlayer ? (entity.id === 1 ? 'p1' : 'p2') : `enemy-${entity.id || entity.x + '-' + entity.y}`;
            
            let card = document.getElementById(`status-${id}`);
            
            // 如果卡片不存在，则创建
            if (!card) {
                card = document.createElement('div');
                card.id = `status-${id}`;
                card.className = 'status-card';
            }

            // 动态划分位置：人类玩家在左边，AI 玩家在右边
            const targetParent = isHuman ? document.getElementById('left-panel') : this.enemyContainer;
            if (card.parentNode !== targetParent && targetParent) {
                targetParent.appendChild(card);
            }

            if (card) {
                // 更新阵亡样式
                if (!entity.alive) card.classList.add('dead');
                else card.classList.remove('dead');
                
                const charIcon = entity.element.textContent;
                let displayName = isPlayer ? id.toUpperCase() : '敌人 ' + (entity.id || '');
                
                // AI 对战模式下显示更详细的信息（颜色和性格）
                if (gameState.mode === 'ai-vs-ai' && !isPlayer) {
                    const colorNames = {blue: '蓝', red: '红', green: '绿', yellow: '黄'};
                    const personalityNames = {aggressive: '激进', conservative: '保守', sneaky: '偷袭', balanced: '平衡'};
                    const colorName = colorNames[CONFIG.colors[entity.colorIndex]];
                    const personalityName = personalityNames[entity.personality] || '';
                    displayName = `AI ${entity.id} (${colorName}-${personalityName})`;
                }

                // 阵亡原因
                const deathInfo = !entity.alive && entity.deathCause ? 
                    `<div class="death-cause">${entity.deathCause}</div>` : '';

                // 更新卡片内部 HTML
                card.innerHTML = `
                    <h4 style="color: ${isPlayer ? '' : this.getHexColor(entity.colorIndex)}">
                        <span class="icon">${charIcon}</span> ${displayName}
                    </h4>
                    ${deathInfo}
                    <div class="status-items">
                        <div class="item-row ${entity.activeWeapon === 'bomb' ? 'active-weapon' : ''}">🔥 <span>${entity.explosionRange}</span></div>
                        <div class="item-row">👟 <span>${Math.round((200 - entity.moveCooldown) / 20 + 1)}</span></div>
                        <div class="item-row ${entity.activeWeapon === 'bomb' ? 'active-weapon' : ''}">💣 <span>${entity.maxBombs}</span></div>
                        <div class="item-row ${entity.activeWeapon === 'landmine' ? 'active-weapon' : ''}">🚩 <span>${entity.landmines || 0}</span></div>
                        <div class="item-row ${entity.activeWeapon === 'rocket' ? 'active-weapon' : ''}">🚀 <span>${entity.rockets || 0}</span></div>
                    </div>
                `;
            }
        });
    },

    /**
     * 获取指定颜色索引的十六进制代码
     */
    getHexColor(index) {
        const hexColors = ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f'];
        return hexColors[index % hexColors.length];
    },

    /**
     * 显示游戏结束结算界面
     * @param {boolean} win 是否获胜
     * @param {string} customMsg 自定义结束消息
     */
    showEndGame(win, customMsg) {
        this.overlay.classList.remove('hidden');
        const msg = customMsg || (win ? '你赢了！' : '游戏结束');
        this.resultMsg.textContent = msg;
        this.resultMsg.style.color = win ? '#2ecc71' : '#e74c3c';

        // AI 对战模式下支持自动重启
        if (gameState.mode === 'ai-vs-ai') {
            let countdown = 5;
            const updateCountdown = () => {
                if (!gameState.isGameOver || gameState.mode !== 'ai-vs-ai') return;
                this.resultMsg.textContent = `${msg} (${countdown}秒后自动重启)`;
                if (countdown <= 0) {
                    start(); // 调用 game-logic.js 中的 start 函数
                } else {
                    countdown--;
                    gameState.restartTimer = setTimeout(updateCountdown, 1000);
                }
            };
            updateCountdown();
        }
    },

    /**
     * 隐藏所有遮罩层
     */
    hideScreens() {
        this.overlay.classList.add('hidden');
        this.startScreen.classList.add('hidden');
    }
};

// 全局函数，为了兼容性
function updateStatusDisplay() { UI.updateStatusDisplay(); }
function updateEnemyCount() { UI.updateEnemyCount(); }

// UI 交互
const singleBtn = document.getElementById('single-player-btn');
const multiBtn = document.getElementById('multi-player-btn');
const aiVsAiBtn = document.getElementById('ai-vs-ai-btn');
const testBtn = document.getElementById('test-mode-btn');

const clearSelection = () => {
    [singleBtn, multiBtn, aiVsAiBtn, testBtn].forEach(btn => {
        if (btn) btn.classList.remove('selected');
    });
};

if (singleBtn) {
    singleBtn.onclick = () => {
        gameState.mode = 'single';
        gameState.isTestMode = false;
        clearSelection();
        singleBtn.classList.add('selected');
        document.getElementById('p2-selection').classList.add('hidden');
        document.getElementById('p2-controls').classList.add('hidden');
    };
}

if (multiBtn) {
    multiBtn.onclick = () => {
        gameState.mode = 'multi';
        gameState.isTestMode = false;
        clearSelection();
        multiBtn.classList.add('selected');
        document.getElementById('p2-selection').classList.remove('hidden');
        document.getElementById('p2-controls').classList.remove('hidden');
    };
}

if (aiVsAiBtn) {
    aiVsAiBtn.onclick = () => {
        gameState.mode = 'ai-vs-ai';
        gameState.isTestMode = false;
        clearSelection();
        aiVsAiBtn.classList.add('selected');
        document.getElementById('p2-selection').classList.add('hidden');
        document.getElementById('p2-controls').classList.add('hidden');
    };
}

if (testBtn) {
    testBtn.onclick = () => {
        gameState.mode = 'test';
        gameState.isTestMode = true;
        clearSelection();
        testBtn.classList.add('selected');
        document.getElementById('p2-selection').classList.add('hidden');
        document.getElementById('p2-controls').classList.add('hidden');
    };
}

// 角色选择
document.querySelectorAll('.p-selection').forEach(pSel => {
    const pId = pSel.id.includes('p1') ? 0 : 1;
    pSel.querySelectorAll('.char-option').forEach(opt => {
        opt.onclick = () => {
            pSel.querySelectorAll('.char-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            gameState.selectedChars[pId] = parseInt(opt.dataset.char);
        };
    });
});

// 难度选择
document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        gameState.difficulty = btn.dataset.diff;
    };
});
