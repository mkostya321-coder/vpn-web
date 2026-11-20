const tg = Telegram.WebApp;
tg.ready();
tg.expand();

const savedNickname = localStorage.getItem('nc_vpn_nickname');
const tgFirstName = tg.initDataUnsafe?.user?.first_name || 'User';

let appState = {
    isAdmin: false,
    user: {
        tg_id: tg.initDataUnsafe?.user?.id || 123456789,
        tg_username: tg.initDataUnsafe?.user?.username ? '@' + tg.initDataUnsafe.user.username : '@no_username',
        nickname: savedNickname || tgFirstName,
        balance: 0, 
        is_blocked: false,
        selectedDevices: 1,
        selectedPriceDay: 6,
        activeFixed: null,
        activeFixedDevices: 1,
        lastSpin: Number(localStorage.getItem('nc_vpn_lastSpin')) || 0,
        topupHistory: JSON.parse(localStorage.getItem('nc_vpn_topup_history')) || [],
        wheelHistory: JSON.parse(localStorage.getItem('nc_vpn_wheel_history')) || []
    },
    allUsers: [],
    tariffs: [],
    dailyPlans: [
        { devices: 1, priceDay: 6, priceMonth: 186 },
        { devices: 2, priceDay: 7, priceMonth: 217 },
        { devices: 3, priceDay: 8, priceMonth: 248 },
        { devices: 4, priceDay: 8, priceMonth: 248, promo: true },
        { devices: 5, priceDay: 9, priceMonth: 279 }
    ],
    wheelEnabled: true,
    wheelItems: [],
    currentPendingWin: 0,
    upgradeLevel: 0,
    isGambling: false
};

document.getElementById('welcome-message').innerHTML = `Привет, <b>${appState.user.nickname}</b>!<br>Рады видеть тебя в NC VPN.`;

async function loadInitialData() {
    try {
        await fetch('/api/user/sync', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tg_id: appState.user.tg_id, username: appState.user.tg_username, nickname: appState.user.nickname })
        });
        const resUser = await fetch(`/api/user/${appState.user.tg_id}`);
        const dataUser = await resUser.json();
        if (dataUser.ok) {
            appState.user.balance = dataUser.user.balance;
            appState.user.is_blocked = dataUser.user.is_blocked;
            appState.user.activeFixed = dataUser.user.active_fixed_expires ? { expires: new Date(dataUser.user.active_fixed_expires).getTime(), desc: dataUser.user.active_fixed_desc } : null;
            appState.user.activeFixedDevices = dataUser.user.active_fixed_devices || 1;
        }

        const resTariffs = await fetch('/api/tariffs');
        const dataTariffs = await resTariffs.json();
        if(dataTariffs.ok) appState.tariffs = dataTariffs.tariffs;

        const resWheel = await fetch('/api/wheel_items');
        const dataWheel = await resWheel.json();
        if(dataWheel.ok) appState.wheelItems = dataWheel.items;

        updateUI();
        drawWheel();
        updateCooldownUI();
    } catch(e) { console.error(e); }
}

function closeWelcome() {
    document.getElementById('welcome-screen').style.opacity = '0';
    setTimeout(() => {
        document.getElementById('welcome-screen').style.display = 'none';
        loadInitialData();
    }, 500);
}

function toggleMenu() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('overlay').classList.toggle('open');
}

function switchTab(tab) {
    const adminTabs = ['admin-users', 'admin-tariffs', 'admin-wheel'];
    if (adminTabs.includes(tab) && !appState.isAdmin) return tg.showAlert('Доступ запрещен.');

    document.querySelectorAll('.main-content > div').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
    
    document.getElementById('view-' + tab).style.display = 'block';
    if(document.getElementById('tab-' + tab)) document.getElementById('tab-' + tab).classList.add('active');
    
    const titles = { home: 'Главная', profile: 'Профиль', wheel: 'Колесо', tariffs: 'Тарифы', support: 'Поддержка', 'admin-login': 'Вход', 'admin-users': 'Пользователи', 'admin-tariffs': 'Тарифы', 'admin-wheel': 'Колесо', connect: 'Подключение' };
    document.getElementById('header-title').textContent = titles[tab];

    if (tab === 'connect' || tab.includes('admin-')) {
        document.getElementById('burger-btn').style.display = 'none';
        document.getElementById('back-btn').style.display = 'block';
    } else {
        document.getElementById('burger-btn').style.display = 'block';
        document.getElementById('back-btn').style.display = 'none';
    }
    if (document.getElementById('sidebar').classList.contains('open')) toggleMenu();
    
    if(tab === 'admin-users') fetchAdminUsers();
    if(tab === 'admin-tariffs') renderAdminTariffs();
    if(tab === 'admin-wheel') renderAdminWheelList();
    if(tab === 'tariffs') renderUserTariffsList();
    if(tab === 'wheel') updateCooldownUI();
    updateUI();
}

function changeNickname() {
    const newNick = window.prompt("Введите новый никнейм:", appState.user.nickname);
    if (newNick && newNick.trim() !== '') {
        appState.user.nickname = newNick.trim();
        localStorage.setItem('nc_vpn_nickname', appState.user.nickname);
        document.getElementById('welcome-message').innerHTML = `Привет, <b>${appState.user.nickname}</b>!<br>Рады видеть тебя в NC VPN.`;
        updateUI();
    }
}

function handleAdminAuthClick() {
    if (appState.isAdmin) {
        appState.isAdmin = false;
        document.getElementById('admin-menu').style.display = 'none';
        document.getElementById('admin-auth-btn').innerHTML = '⚙️ Войти в АдмПрофиль';
        switchTab('home');
    } else {
        switchTab('admin-login');
    }
}

function checkAdminLogin() {
    const login = document.getElementById('admin-login').value;
    const pass = document.getElementById('admin-pass').value;
    if (login === 'admin' && pass === 'admin') {
        appState.isAdmin = true;
        document.getElementById('admin-menu').style.display = 'block';
        document.getElementById('admin-auth-btn').innerHTML = '🚪 Выйти из АдмПрофиль';
        tg.showAlert('Успешный вход!');
        switchTab('home');
    } else {
        tg.showAlert('Неверный логин или пароль!');
    }
}

function updateUI() {
    document.getElementById('home-balance').textContent = appState.user.balance.toFixed(2) + ' ₽';
    document.getElementById('user-nickname').textContent = appState.user.nickname;
    document.getElementById('user-tg-username').textContent = appState.user.tg_username;

    const topupList = document.getElementById('topup-history');
    if (appState.user.topupHistory.length === 0) {
        topupList.innerHTML = '<li style="color: var(--text-muted);">Пока пусто</li>';
    } else {
        topupList.innerHTML = appState.user.topupHistory.map(item => `<li><span>${item.date}</span><b style="color:var(--success);">+${item.amount} ₽</b></li>`).join('');
    }

    const wheelList = document.getElementById('wheel-history');
    if (appState.user.wheelHistory.length === 0) {
        wheelList.innerHTML = '<li style="color: var(--text-muted);">Пока пусто</li>';
    } else {
        wheelList.innerHTML = appState.user.wheelHistory.map(item => `<li><span>${item.date}</span><span style="color:var(--promo);">${item.prize}</span></li>`).join('');
    }

    const now = Date.now();
    if (appState.user.activeFixed && appState.user.activeFixed.expires > now) {
        document.getElementById('active-fixed-card').style.display = 'block';
        document.getElementById('daily-block').style.display = 'none';
        const daysLeft = Math.ceil((appState.user.activeFixed.expires - now) / (1000 * 60 * 60 * 24));
        document.getElementById('fixed-name').textContent = appState.user.activeFixed.desc;
        document.getElementById('fixed-days').textContent = daysLeft;
    } else {
        document.getElementById('active-fixed-card').style.display = 'none';
        document.getElementById('daily-block').style.display = 'block';
        const days = Math.floor(appState.user.balance / appState.user.selectedPriceDay);
        document.getElementById('days-left').textContent = days + ' дней';
        const mainPlans = document.getElementById('user-plans-container');
        mainPlans.innerHTML = appState.dailyPlans.map((t, i) => `
            <div class="plan-btn ${t.devices === appState.user.selectedDevices ? 'active' : ''}" onclick="selectDailyPlan(${t.devices}, ${t.priceDay})">
                <div class="plan-devices">${t.devices} устр.</div>
                <div class="plan-price-day">${t.priceDay} ₽/день</div>
            </div>
        `).join('');
    }
}

function selectDailyPlan(devices, priceDay) {
    appState.user.selectedDevices = devices;
    appState.user.selectedPriceDay = priceDay;
    updateUI();
}

async function topUpBalance() {
    const res = await fetch('/api/user/balance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_id: appState.user.tg_id, amount: 100 })
    });
    const data = await res.json();
    if(data.ok) {
        appState.user.balance = data.balance;
        const dateStr = new Date().toLocaleDateString();
        appState.user.topupHistory.unshift({ date: dateStr, amount: 100 });
        localStorage.setItem('nc_vpn_topup_history', JSON.stringify(appState.user.topupHistory));
        updateUI();
        tg.showAlert('Баланс пополнен на 100₽');
    }
}

async function connectVpn() {
    if (appState.user.is_blocked) return tg.showAlert('Ваш аккаунт заблокирован!');
    
    const devicesToUse = (appState.user.activeFixed && appState.user.activeFixed.expires > Date.now()) 
                         ? appState.user.activeFixedDevices 
                         : appState.user.selectedDevices;

    switchTab('connect');
    document.getElementById('sub-link').textContent = 'Получение...';
    try {
        const res = await fetch('/api/create-vpn', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: appState.user.tg_id, devices: devicesToUse })
        });
        const data = await res.json();
        document.getElementById('sub-link').textContent = data.subscription_url || 'Ошибка';
    } catch(e) { document.getElementById('sub-link').textContent = 'Ошибка сети'; }
}

function copyLink() {
    const link = document.getElementById('sub-link').textContent;
    if (link && !link.includes('Ошибка') && !link.includes('Получение')) {
        navigator.clipboard.writeText(link).then(() => tg.showAlert('Ссылка скопирована!'));
    }
}

async function sendSupport() {
    const subject = document.getElementById('support-subject').value;
    const msg = document.getElementById('support-msg').value;
    if (!subject || !msg) return tg.showAlert('Заполните поля!');
    try {
        const res = await fetch('/api/support', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: appState.user.tg_id, username: appState.user.tg_username, subject, message: msg })
        });
        const data = await res.json();
        if (data.ok) {
            tg.showAlert('Отправлено!');
            document.getElementById('support-subject').value = '';
            document.getElementById('support-msg').value = '';
        } else { tg.showAlert('Ошибка: ' + data.error); }
    } catch(e) { tg.showAlert('Ошибка сети'); }
}

// --- ТАРИФЫ ---
function renderUserTariffsList() {
    document.getElementById('user-tariffs-list').innerHTML = appState.tariffs.map(t => {
        const isSoldOut = t.limit_count > 0 && t.sold_count >= t.limit_count;
        return `
        <div class="card" style="padding: 15px; display: flex; justify-content: space-between; align-items: center; ${isSoldOut ? 'opacity: 0.6;' : ''}">
            <div>
                <div style="font-size: 18px; font-weight: bold; color: ${isSoldOut ? 'var(--text-muted)' : 'var(--success)'};">${t.price} Rub</div>
                <div style="font-size: 13px; color: var(--text-muted);">${t.desc}</div>
                ${t.limit_count > 0 ? `<div style="font-size: 11px; color: var(--promo); margin-top: 5px;">Осталось: ${t.limit_count - t.sold_count} из ${t.limit_count}</div>` : ''}
            </div>
            <button class="btn ${isSoldOut ? '' : 'btn-success'}" style="width: auto; padding: 10px;" 
                ${isSoldOut || appState.user.activeFixed ? 'disabled' : ''} 
                onclick="buyFixedTariff(${t.id})">
                ${isSoldOut ? 'Распродан' : 'Купить'}
            </button>
        </div>
    `}).join('');
}

async function buyFixedTariff(id) {
    if (appState.user.activeFixed) return tg.showAlert('У вас уже есть активный пакет.');
    const tariff = appState.tariffs.find(t => t.id === id);
    if (appState.user.balance < tariff.price) return tg.showAlert('Недостаточно средств!');
    
    tg.showConfirm(`Купить "${tariff.desc}" за ${tariff.price}₽?`, async (ok) => {
        if (ok) {
            const res = await fetch('/api/tariff/buy', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tg_id: appState.user.tg_id, tariff_id: id })
            });
            const data = await res.json();
            if (data.ok) {
                appState.user.balance = data.balance;
                appState.user.activeFixed = { desc: tariff.desc, expires: Date.now() + (tariff.days * 86400000) };
                appState.user.activeFixedDevices = tariff.devices;
                tg.showAlert('Куплено!');
                switchTab('home');
            } else { tg.showAlert(data.error); }
        }
    });
}

async function cancelTariff() {
    tg.showConfirm('Вы уверены, что хотите отменить тариф? Мы вернем деньги за неиспользованные дни.', async (ok) => {
        if (!ok) return;
        const res = await fetch('/api/tariff/cancel', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tg_id: appState.user.tg_id })
        });
        const data = await res.json();
        if (data.ok) {
            appState.user.balance = data.balance;
            appState.user.activeFixed = null;
            tg.showAlert(`Тариф отменен. Вам возвращено ${data.refund} ₽.`);
            switchTab('home');
        } else { tg.showAlert(data.error); }
    });
}

// --- АДМИНКА ---
async function fetchAdminUsers() {
    const list = document.getElementById('admin-users-list');
    list.innerHTML = 'Загрузка...';
    try {
        const res = await fetch('/api/users/all');
        const data = await res.json();
        if(data.ok) {
            appState.allUsers = data.users;
            renderAdminUsers();
        }
    } catch(e) { list.innerHTML = 'Ошибка загрузки'; }
}

function renderAdminUsers() {
    const search = (document.getElementById('admin-search-user')?.value || '').toLowerCase();
    const list = document.getElementById('admin-users-list');
    const filtered = appState.allUsers.filter(u => u.username && u.username.toLowerCase().includes(search));
    
    list.innerHTML = filtered.length === 0 ? '<div style="text-align: center;">Никого не найдено</div>' : filtered.map((u) => `
        <div class="user-row ${u.is_blocked ? 'blocked' : ''}" onclick="editUser(${u.id}, ${u.balance}, ${u.is_blocked})">
            <div>
                <div style="font-size:14px; font-weight:bold;">${u.username} ${u.is_blocked ? '(БАН)' : ''}</div>
                <div style="font-size:11px; color:var(--text-muted);">${u.nickname} (ID: ${u.id})</div>
            </div>
            <div><span style="color:${u.is_blocked ? 'var(--danger)' : 'var(--success)'}; font-weight:bold;">${u.balance.toFixed(2)} ₽</span></div>
        </div>
    `).join('');
}

function editUser(tgId, currentBal, isBlocked) {
    const newBalStr = window.prompt(`Введите новый баланс для ID ${tgId}:`, currentBal);
    if (newBalStr === null) return;
    
    const newBal = parseFloat(newBalStr);
    if (isNaN(newBal)) return tg.showAlert('Неверный формат суммы');

    const blockAction = window.confirm(`Заблокировать пользователя?\n(OK = Заблокировать, Отмена = Разблокировать)`);
    
    fetch('/api/admin/user_update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_id: tgId, new_balance: newBal, is_blocked: blockAction })
    }).then(() => {
        tg.showAlert('Данные обновлены!');
        fetchAdminUsers();
    });
}

function renderAdminTariffs() {
    const list = document.getElementById('admin-tariffs-list');
    list.innerHTML = appState.tariffs.map((t, index) => `
        <div class="user-row" style="justify-content: flex-start;">
            <div style="flex:1;">
                <div style="font-weight:bold; color:var(--success);">${t.price} Rub (${t.days} дн., ${t.devices} устр.)</div>
                <div style="font-size:12px; color:var(--text-muted);">${t.desc} | Лимит: ${t.limit_count} | Продано: ${t.sold_count}</div>
            </div>
            <button class="btn btn-danger" style="width:auto; padding:5px 10px; font-size:12px;" onclick="deleteTariff(${t.id})">Удалить</button>
        </div>
    `).join('');
}

async function addNewTariff() {
    const price = document.getElementById('new-tariff-price').value;
    const desc = document.getElementById('new-tariff-desc').value;
    const days = document.getElementById('new-tariff-days').value;
    const devices = document.getElementById('new-tariff-devices').value;
    const limit = document.getElementById('new-tariff-limit').value || 0;
    
    if(!price || !desc || !days || !devices) return tg.showAlert('Заполните все поля!');
    
    await fetch('/api/tariffs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: parseInt(price), desc, days: parseInt(days), devices: parseInt(devices), limit_count: parseInt(limit) })
    });
    const res = await fetch('/api/tariffs');
    const data = await res.json();
    appState.tariffs = data.tariffs;
    renderAdminTariffs();
    tg.showAlert('Тариф добавлен!');
}

async function deleteTariff(id) {
    await fetch(`/api/tariffs/${id}`, { method: 'DELETE' });
    const res = await fetch('/api/tariffs');
    const data = await res.json();
    appState.tariffs = data.tariffs;
    renderAdminTariffs();
}

function renderAdminWheelList() {
    const list = document.getElementById('admin-wheel-list');
    list.innerHTML = appState.wheelItems.map((item, index) => `
        <div class="wheel-item-row" data-id="${item.id}" style="border-left-color: ${item.color}">
            <div style="font-weight:bold; font-size:14px;">${item.label} <span style="color:var(--success); font-size:12px;">(${item.value}₽)</span></div>
            <div><button class="btn btn-danger" style="width:auto; padding:5px 10px; font-size:12px;" onclick="deleteWheelItem(${item.id})">✕</button></div>
        </div>
    `).join('');

    new Sortable(list, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: async function (evt) {
            const itemEls = list.querySelectorAll('.wheel-item-row');
            const newOrderIds = Array.from(itemEls).map(el => parseInt(el.getAttribute('data-id')));
            await fetch('/api/wheel_items/order', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: newOrderIds })
            });
            const res = await fetch('/api/wheel_items');
            const data = await res.json();
            appState.wheelItems = data.items;
            drawWheel();
        }
    });
}

async function addWheelItem() {
    const label = document.getElementById('new-wheel-label').value;
    const value = document.getElementById('new-wheel-value').value;
    const color = document.getElementById('new-wheel-color').value;
    if(!label) return tg.showAlert('Введите текст!');
    
    await fetch('/api/wheel_items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, color, value: parseInt(value) || 0 })
    });
    const res = await fetch('/api/wheel_items');
    const data = await res.json();
    appState.wheelItems = data.items;
    renderAdminWheelList();
    drawWheel();
    tg.showAlert('Сектор добавлен!');
}

async function deleteWheelItem(id) {
    await fetch(`/api/wheel_items/${id}`, { method: 'DELETE' });
    const res = await fetch('/api/wheel_items');
    const data = await res.json();
    appState.wheelItems = data.items;
    renderAdminWheelList();
    drawWheel();
}

function toggleWheelVisibility() {
    appState.wheelEnabled = !appState.wheelEnabled;
    const btn = document.getElementById('wheel-toggle-btn');
    btn.textContent = appState.wheelEnabled ? 'Отключить колесо' : 'Включить колесо';
    btn.className = appState.wheelEnabled ? 'btn btn-danger' : 'btn btn-success';
    updateWheelState();
}

function resetAllCooldowns() {
    tg.showConfirm('Сбросить кулдаун?', (ok) => {
        if(ok) {
            localStorage.setItem('nc_vpn_lastSpin', 0);
            appState.user.lastSpin = 0;
            updateCooldownUI();
            tg.showAlert('Кулдаун сброшен!');
        }
    });
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

// --- КОЛЕСО ФОРТУНЫ ---
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

// --- АПГРЕЙД (ГЭМБЛ) ЛОГИКА ---
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

updateWheelState();
