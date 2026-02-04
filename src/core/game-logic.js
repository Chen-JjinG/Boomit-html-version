/**
 * 游戏核心逻辑模块
 * 负责游戏状态管理、地图生成、胜负判定及核心游戏循环
 */
let gameState = {
    grid: [],           // 地图网格 (floor, wall-hard, wall-soft)
    players: [],        // 玩家实体列表
    enemies: [],        // AI 敌人列表
    bombs: [],          // 当前地图上的炸弹
    landmines: [],      // 当前地图上的地雷
    rockets: [],        // 飞行中的火箭弹
    powerUps: [],       // 地面上的道具
    isGameOver: false,  // 游戏结束标志
    isStarted: false,   // 游戏开始标志
    isTestMode: false,  // 测试模式标志
    keys: {},           // 按键状态记录
    mode: 'single',     // 游戏模式 (single, multi, ai-vs-ai, test)
    selectedChars: [0, 1], // 玩家选择的角色索引
    difficulty: 'normal'   // 游戏难度 (easy, normal, hard)
};

let playerMoveInterval = null; // 玩家移动处理定时器

/**
 * 初始化地图：生成围墙、硬墙、软墙和空地
 */
function initMap() {
    const board = UI.board;
    board.innerHTML = '';
    gameState.grid = [];
    
    // 1. 填充基础地板
    for (let y = 0; y < CONFIG.rows; y++) {
        const row = [];
        for (let x = 0; x < CONFIG.cols; x++) {
            row.push('floor');
        }
        gameState.grid.push(row);
    }

    // 2. 生成外围边界墙
    for (let y = 0; y < CONFIG.rows; y++) {
        for (let x = 0; x < CONFIG.cols; x++) {
            if (x === 0 || x === CONFIG.cols - 1 || y === 0 || y === CONFIG.rows - 1) {
                gameState.grid[y][x] = 'wall-hard';
            }
        }
    }

    // 3. 随机生成内部硬墙 (不可破坏)
    for (let y = 2; y < CONFIG.rows - 2; y++) {
        for (let x = 2; x < CONFIG.cols - 2; x++) {
            if (x % 2 === 0 && y % 2 === 0) {
                if (Math.random() < 0.6) gameState.grid[y][x] = 'wall-hard';
            } else if (Math.random() < 0.1) {
                gameState.grid[y][x] = 'wall-hard';
            }
        }
    }

    // 4. 随机生成软墙 (可破坏，可能掉落道具)
    for (let y = 0; y < CONFIG.rows; y++) {
        for (let x = 0; x < CONFIG.cols; x++) {
            if (gameState.grid[y][x] === 'floor') {
                // 避开出生点区域，确保玩家/AI 有移动空间
                const isSpawnArea = (x <= 2 && y <= 2) || 
                                   (x >= CONFIG.cols - 3 && y <= 2) || 
                                   (x <= 2 && y >= CONFIG.rows - 3) || 
                                   (x >= CONFIG.cols - 3 && y >= CONFIG.rows - 3);
                
                if (!isSpawnArea && Math.random() < CONFIG.softWallDensity) {
                    gameState.grid[y][x] = 'wall-soft';
                }
            }
        }
    }

    // 5. 渲染地图到 DOM
    for (let y = 0; y < CONFIG.rows; y++) {
        for (let x = 0; x < CONFIG.cols; x++) {
            const type = gameState.grid[y][x];
            const cell = document.createElement('div');
            cell.className = `cell ${type}`;
            cell.dataset.x = x;
            cell.dataset.y = y;
            cell.style.left = `${x * CONFIG.tileSize}px`;
            cell.style.top = `${y * CONFIG.tileSize}px`;
            board.appendChild(cell);
        }
    }
}

/**
 * 生成测试关卡
 */
function generateTestLevel() {
    const board = UI.board;
    gameState.grid = [];
    board.innerHTML = '';
    for (let y = 0; y < CONFIG.rows; y++) {
        const row = [];
        for (let x = 0; x < CONFIG.cols; x++) {
            let type = (x === 0 || x === CONFIG.cols - 1 || y === 0 || y === CONFIG.rows - 1) ? 'wall-hard' : 'floor';
            row.push(type);
            const cell = document.createElement('div');
            cell.className = `cell ${type}`;
            cell.style.left = `${x * CONFIG.tileSize}px`;
            cell.style.top = `${y * CONFIG.tileSize}px`;
            cell.dataset.x = x;
            cell.dataset.y = y;
            board.appendChild(cell);
        }
        gameState.grid.push(row);
    }

    const midX = Math.floor(CONFIG.cols / 2);
    const midY = Math.floor(CONFIG.rows / 2);

    const powerUpTypes = ['range', 'speed', 'bombCount', 'landmine', 'rocket'];
    powerUpTypes.forEach((type, index) => {
        const x = midX - 2 + index;
        const y = 2;
        gameState.powerUps.push(new PowerUp(x, y, type));
    });

    for (let x = midX - 2; x <= midX + 2; x++) {
        for (let y = midY + 2; y <= midY + 3; y++) {
            gameState.grid[y][x] = 'wall-soft';
            const cell = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
            if (cell) cell.className = 'cell wall-soft';
        }
        const hy = midY + 4;
        gameState.grid[hy][x] = 'wall-hard';
        const hCell = board.querySelector(`.cell[data-x="${x}"][data-y="${hy}"]`);
        if (hCell) hCell.className = 'cell wall-hard';
    }
}

/**
 * 玩家死亡处理
 * @param {Player} player 阵亡玩家
 * @param {Entity} killer 击杀者
 * @param {string} reason 击杀原因
 */
function handlePlayerDeath(player, killer, reason) {
    if (gameState.isGameOver || !player.alive) return;
    player.die(killer, reason);
    UI.updateStatusDisplay();
    if (gameState.isTestMode) return;
    setTimeout(() => {
        const index = gameState.players.indexOf(player);
        if (index !== -1) gameState.players.splice(index, 1);
        checkGameEnd();
    }, 1500);
}

/**
 * 检查游戏是否结束
 */
function checkGameEnd() {
    if (gameState.isGameOver) return;

    if (gameState.mode === 'ai-vs-ai') {
        if (gameState.enemies.length === 1 && gameState.players.length === 0) {
            endGame(true, `AI ${gameState.enemies[0].id} 获得了最终胜利！`);
        } else if (gameState.enemies.length === 0 && gameState.players.length === 0) {
            endGame(false, '同归于尽！没有人获胜。');
        }
    } else {
        if (gameState.players.length === 0) {
            endGame(false);
        } else if (gameState.enemies.length === 0) {
            if (gameState.mode === 'single') endGame(true, '恭喜！你消灭了所有敌人！');
            else if (gameState.mode === 'multi' && gameState.players.length === 1) endGame(true, `P${gameState.players[0].id} 最终获胜！`);
            else endGame(true, '合作愉快！所有敌人已被消灭！');
        }
    }
}

/**
 * 结束游戏
 */
function endGame(win, msg) {
    gameState.isGameOver = true;
    UI.showEndGame(win, msg);
}

/**
 * 玩家移动逻辑
 */
function handlePlayerMovement() {
    if (!gameState.isStarted || gameState.isGameOver) return;
    const now = Date.now();
    gameState.players.forEach(player => {
        if (!player.alive || now - player.lastMoveTime < player.moveCooldown) return;
        let dx = 0, dy = 0;
        if (player.controls.up.some(k => gameState.keys[k])) dy = -1;
        else if (player.controls.down.some(k => gameState.keys[k])) dy = 1;
        else if (player.controls.left.some(k => gameState.keys[k])) dx = -1;
        else if (player.controls.right.some(k => gameState.keys[k])) dx = 1;

        if ((dx !== 0 || dy !== 0) && player.move(dx, dy)) {
            player.lastMoveTime = now;
        }
    });
}

/**
 * 开始/重启游戏
 */
function start() {
    if (gameState.restartTimer) clearTimeout(gameState.restartTimer);

    const entitiesToDestroy = [...gameState.powerUps, ...gameState.bombs, ...gameState.landmines, ...gameState.rockets, ...gameState.enemies, ...gameState.players];
    entitiesToDestroy.forEach(e => e && e.destroy && e.destroy());

    const board = UI.board;
    if (board) {
        board.querySelectorAll('.explosion, .explosion-bright, .rocket-trail').forEach(el => el.parentNode && el.parentNode.removeChild(el));
    }

    gameState.powerUps = []; gameState.bombs = []; gameState.landmines = []; gameState.rockets = []; gameState.enemies = []; gameState.players = [];
    gameState.keys = {};
    AIUtils.clearCache();

    if (gameState.isTestMode) generateTestLevel();
    else initMap();
    
    if (UI.enemyContainer) UI.enemyContainer.innerHTML = '';
    
    let p1X = 1, p1Y = 1;
    let p2X = CONFIG.cols - 2, p2Y = CONFIG.rows - 2;

    if (gameState.isTestMode) {
        p1X = Math.floor(CONFIG.cols / 2); p1Y = Math.floor(CONFIG.rows / 2);
    }

    if (gameState.mode !== 'ai-vs-ai') {
        const p1 = new Player(p1X, p1Y, 1, gameState.selectedChars[0]);
        p1.alive = true; gameState.players.push(p1);
        if (UI.p1Card) UI.p1Card.classList.remove('hidden', 'dead');

        if (gameState.mode === 'multi' && !gameState.isTestMode) {
            const p2 = new Player(p2X, p2Y, 2, gameState.selectedChars[1]);
            p2.alive = true; gameState.players.push(p2);
            if (UI.p2Card) UI.p2Card.classList.remove('hidden', 'dead');
        } else if (UI.p2Card) {
            UI.p2Card.classList.add('hidden');
        }
    } else {
        if (UI.p1Card) UI.p1Card.classList.add('hidden');
        if (UI.p2Card) UI.p2Card.classList.add('hidden');
    }

    if (gameState.isTestMode) {
        const playerChar = gameState.selectedChars[0];
        gameState.enemies = [new SmartEnemy(p1X, p1Y + 1, 1, (playerChar + 1) % CHAR_ICONS.length, gameState.difficulty, 'balanced')];
    } else if (gameState.mode === 'ai-vs-ai') {
        gameState.enemies = [
            new SmartEnemy(1, 1, 1, 0, gameState.difficulty, 'aggressive'),
            new SmartEnemy(CONFIG.cols - 2, 1, 2, 1, gameState.difficulty, 'conservative'),
            new SmartEnemy(1, CONFIG.rows - 2, 3, 2, gameState.difficulty, 'sneaky'),
            new SmartEnemy(CONFIG.cols - 2, CONFIG.rows - 2, 4, 3, gameState.difficulty, 'balanced')
        ];
    } else {
        const corners = [{x: CONFIG.cols - 2, y: 1}, {x: 1, y: CONFIG.rows - 2}, {x: CONFIG.cols - 2, y: CONFIG.rows - 2}];
        const occupiedChars = gameState.mode === 'multi' ? [gameState.selectedChars[0], gameState.selectedChars[1]] : [gameState.selectedChars[0]];
        const availableChars = CHAR_ICONS.map((_, i) => i).filter(i => !occupiedChars.includes(i));
        
        const enemyCorners = corners.filter(c => gameState.mode !== 'multi' || (c.x !== p2X || c.y !== p2Y));
        enemyCorners.forEach((pos, i) => {
            const personality = AI_PERSONALITIES[Math.floor(Math.random() * AI_PERSONALITIES.length)];
            const charIndex = availableChars.length > 0 ? availableChars.splice(Math.floor(Math.random() * availableChars.length), 1)[0] : Math.floor(Math.random() * CHAR_ICONS.length);
            gameState.enemies.push(new SmartEnemy(pos.x, pos.y, i + 1, charIndex, gameState.difficulty, personality));
        });
    }
    
    gameState.enemies.forEach(e => e.alive = true);
    gameState.isStarted = true;
    gameState.isGameOver = false;
    gameState.startTime = Date.now(); // 记录游戏开始时间
    UI.hideScreens();
    UI.updateEnemyCount();
    UI.updateStatusDisplay();

    if (playerMoveInterval) clearInterval(playerMoveInterval);
    playerMoveInterval = setInterval(handlePlayerMovement, 30);
}

// 全局开始按钮绑定
const startBtn = document.getElementById('start-button');
if (startBtn) startBtn.onclick = start;

// 按键监听
window.addEventListener('keydown', e => {
    gameState.keys[e.key] = true;
    if (gameState.isStarted && !gameState.isGameOver) {
        gameState.players.forEach(p => {
            if (p.alive && p.controls.bomb.includes(e.key)) p.performAction();
        });
    }
});
window.addEventListener('keyup', e => {
    gameState.keys[e.key] = false;
});

// 初始化显示
UI.updateStatusDisplay();
