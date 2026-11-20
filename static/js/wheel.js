const canvas = document.getElementById('wheelCanvas');
const ctx = canvas.getContext('2d');
const centerX = canvas.width / 2, centerY = canvas.height / 2, radius = 140;

function drawWheel() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const items = appState.wheelItems;
    if(items.length === 0) return;
    const anglePerItem = (Math.PI * 2) / items.length;
    for (let i = 0; i < items.length; i++) {
        const startAngle = i * anglePerItem;
        ctx.beginPath(); ctx.fillStyle = items[i].color;
        ctx.moveTo(centerX, centerY); ctx.arc(centerX, centerY, radius, startAngle, startAngle + anglePerItem);
        ctx.fill(); ctx.strokeStyle = '#1c1c1e'; ctx.lineWidth = 2; ctx.stroke();
        ctx.save(); ctx.translate(centerX, centerY); ctx.rotate(startAngle + anglePerItem / 2);
        ctx.textAlign = 'right'; ctx.fillStyle = 'white'; ctx.font = 'bold 12px sans-serif';
        ctx.fillText(items[i].label, radius - 10, 5); ctx.restore();
    }
    ctx.beginPath(); ctx.fillStyle = '#1c1c1e'; ctx.arc(centerX, centerY, 30, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'var(--accent)'; ctx.lineWidth = 4; ctx.stroke();
}

function updateCooldownUI() {
    const wrapper = document.getElementById('wheel-wrapper');
    let existingOverlay = document.getElementById('cooldown-overlay');
    const now = Date.now();
    const timeLeft = (7 * 24 * 60 * 60 * 1000) - (now - appState.user.lastSpin);

    if (!appState.wheelEnabled) return;

    if (appState.user.lastSpin > 0 && timeLeft > 0) {
        if (!existingOverlay) {
            const overlay = document.createElement('div');
            overlay.id = 'cooldown-overlay';
            overlay.className = 'cooldown-overlay';
            overlay.innerHTML = '<div style="font-size:14px; color:var(--text-muted); margin-bottom:5px;">Кулдаун:</div><div id="cooldown-time" style="font-size:22px; font-weight:bold; color:var(--promo); font-family:monospace;">00:00:00</div>';
            wrapper.appendChild(overlay);
        }
        const h = Math.floor(timeLeft / (1000 * 60 * 60));
        const m = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((timeLeft % (1000 * 60)) / 1000);
        const timeEl = document.getElementById('cooldown-time');
        if(timeEl) timeEl.textContent = `${h}ч.${m.toString().padStart(2, '0')}м.${s.toString().padStart(2, '0')}с`;
        document.getElementById('spin-btn').disabled = true;
        document.getElementById('spin-btn').textContent = 'Кулдаун';
    } else {
        if (existingOverlay) existingOverlay.remove();
        document.getElementById('spin-btn').disabled = false;
        document.getElementById('spin-btn').textContent = 'Крутить';
    }
}
setInterval(updateCooldownUI, 1000);

let currentRotation = 0;
async function spinWheel() {
    if (!appState.wheelEnabled || appState.wheelItems.length === 0) return;
    const btn = document.getElementById('spin-btn');
    btn.disabled = true; btn.textContent = 'Крутится...';
    
    const winIndex = Math.floor(Math.random() * appState.wheelItems.length);
    const prize = appState.wheelItems[winIndex];

    const anglePerItem = 360 / appState.wheelItems.length;
    const sliceCenter = (winIndex * anglePerItem) + (anglePerItem / 2);
    let targetAngle = 270 - sliceCenter;
    const currentMod = currentRotation % 360;
    let degreesToAdd = targetAngle - currentMod;
    if (degreesToAdd < 0) degreesToAdd += 360;

    currentRotation += (5 * 360) + degreesToAdd;
    canvas.style.transform = `rotate(${currentRotation}deg)`;

    setTimeout(async () => {
        appState.user.lastSpin = Date.now();
        localStorage.setItem('nc_vpn_lastSpin', appState.user.lastSpin);
        updateCooldownUI();

        if (prize.value > 0) {
            appState.currentPendingWin = prize.value;
            appState.upgradeLevel = 0; 
            document.getElementById('win-amount').textContent = prize.value + ' ₽';
            document.getElementById('gamble-modal').classList.add('open');
        } else {
            tg.showAlert('Lose! В следующий раз повезет.');
            recordWheelToHistory('Lose');
            btn.textContent = 'Крутить';
        }
    }, 7000);
}

// --- Гэмбл (Апгрейд) ---
function claimWin() {
    document.getElementById('gamble-modal').classList.remove('open');
    document.getElementById('gamble-game-modal').classList.remove('open');
    
    fetch('/api/wheel/spin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_id: appState.user.tg_id, prize_value: appState.currentPendingWin, prize_label: `+${appState.currentPendingWin}₽` })
    });
    appState.user.balance += appState.currentPendingWin;
    recordWheelToHistory(`+${appState.currentPendingWin}₽ (Забрал)`);
    
    appState.currentPendingWin = 0;
    appState.upgradeLevel = 0;
    appState.isGambling = false;
    document.getElementById('spin-btn').textContent = 'Крутить';
    updateUI();
}

function startGamble() {
    if (appState.upgradeLevel >= 10) {
        return tg.showAlert("Вы достигли максимального уровня апгрейда (x1024)! Забирайте приз.");
    }
    appState.isGambling = true;
    document.getElementById('gamble-modal').classList.remove('open');
    document.getElementById('gamble-game-modal').classList.add('open');
    
    const nextMultiplier = Math.pow(2, appState.upgradeLevel + 1);
    document.getElementById('upgrade-title').textContent = `Апгрейд x${nextMultiplier}`;
    
    const needle = document.getElementById('gamble-needle');
    needle.style.transition = 'none';
    needle.style.transform = `translateX(-50%) rotate(0deg)`;
    
    document.getElementById('gamble-spin-btn').disabled = false;
    document.getElementById('gamble-spin-btn').textContent = 'Крутить';
}

function runGamble() {
    if (!appState.isGambling) return;
    const btn = document.getElementById('gamble-spin-btn');
    btn.disabled = true; btn.textContent = 'Крутим...';

    const win = Math.random() > 0.5;
    let targetAngle = 0;
    if (win) { targetAngle = Math.floor(Math.random() * 170) + 5; } 
    else { targetAngle = Math.floor(Math.random() * 170) + 185; }
    targetAngle += 360 * 5;

    const needle = document.getElementById('gamble-needle');
    needle.style.transition = 'transform 4s cubic-bezier(0.1, 0.8, 0.2, 1)';
    needle.style.transform = `translateX(-50%) rotate(${targetAngle}deg)`;

    setTimeout(() => {
        if (win) {
            appState.currentPendingWin *= 2;
            appState.upgradeLevel++;
            document.getElementById('win-amount').textContent = appState.currentPendingWin + ' ₽';
            
            tg.showAlert(`🎉 ПОБЕДА! Ваш приз увеличен до ${appState.currentPendingWin} ₽!`);
            document.getElementById('gamble-game-modal').classList.remove('open');
            
            if (appState.upgradeLevel >= 10) {
                tg.showAlert(`🏆 Невероятно! Вы достигли максимального апгрейда (x1024)! Забирайте ${appState.currentPendingWin} ₽!`);
                claimWin();
            } else {
                document.getElementById('gamble-modal').classList.add('open');
            }
        } else {
            tg.showAlert('💀 К сожалению, фортуна отвернулась от вас. Вы потеряли этот выигрыш. В следующий раз обязательно повезёт!');
            document.getElementById('gamble-game-modal').classList.remove('open');
            
            appState.currentPendingWin = 0;
            appState.upgradeLevel = 0;
            appState.isGambling = false;
            document.getElementById('spin-btn').textContent = 'Крутить';
            recordWheelToHistory('Lose (Гэмбл)');
            updateUI();
        }
        btn.disabled = false; btn.textContent = 'Крутить';
    }, 4000);
}

function recordWheelToHistory(text) {
    const dateStr = new Date().toLocaleDateString();
    appState.user.wheelHistory.unshift({ date: dateStr, prize: text });
    localStorage.setItem('nc_vpn_wheel_history', JSON.stringify(appState.user.wheelHistory));
    updateUI();
}

function updateWheelState() {
    const wrapper = document.getElementById('wheel-wrapper');
    let disabledOverlay = document.getElementById('wheel-disabled-overlay');
    if (!appState.wheelEnabled) {
        if(!disabledOverlay) {
            const overlay = document.createElement('div');
            overlay.id = 'wheel-disabled-overlay';
            overlay.className = 'cooldown-overlay';
            overlay.innerHTML = '<div style="text-align:center; padding:20px; font-weight:bold; color:var(--danger);">Колесо временно недоступно</div>';
            wrapper.appendChild(overlay);
        }
    } else {
        if(disabledOverlay) disabledOverlay.remove();
    }
}
