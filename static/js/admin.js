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

// --- Пользователи ---
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
    
    list.innerHTML = filtered.length === 0 ? '<div style="text-align: center;">Никого не найдено</div>' : filtered.map((u) => {
        const isSelected = appState.selectedUserId === u.id;
        return `
        <div class="user-row ${u.is_blocked ? 'blocked' : ''} ${isSelected ? 'selected' : ''}" onclick="selectAdminUser(${u.id})">
            <div>
                <div style="font-size:14px; font-weight:bold;">${u.username} ${u.is_blocked ? '(БАН)' : ''}</div>
                <div style="font-size:11px; color:var(--text-muted);">${u.nickname} (ID: ${u.id})</div>
            </div>
            <div>
                <span style="color:${u.is_blocked ? 'var(--danger)' : 'var(--success)'}; font-weight:bold;">${u.balance.toFixed(2)} ₽</span>
                ${isSelected ? `<button class="btn" style="width:auto; padding:5px 10px; margin-left:10px;" onclick="event.stopPropagation(); openUserModal(${u.id})">Открыть</button>` : ''}
            </div>
        </div>
    `}).join('');
}

function selectAdminUser(id) {
    appState.selectedUserId = (appState.selectedUserId === id) ? null : id;
    renderAdminUsers();
}

function openUserModal(id) {
    const user = appState.allUsers.find(u => u.id === id);
    if(!user) return;

    document.getElementById('manage-username').textContent = `${user.username} (${user.nickname})`;
    document.getElementById('add-balance-input').value = '';
    
    // Заполняем селект тарифов
    const select = document.getElementById('admin-tariff-select');
    select.innerHTML = appState.tariffs.map(t => `<option value="${t.id}">${t.desc} (${t.price}₽)</option>`).join('');

    // Сохраняем текущего юзера в модалке
    window.currentManageUser = user;

    document.getElementById('user-manage-modal').classList.add('open');
}

function closeUserModal() {
    document.getElementById('user-manage-modal').classList.remove('open');
}

async function adminAddBal() {
    if(!window.currentManageUser) return;
    const amount = parseFloat(document.getElementById('add-balance-input').value);
    if(isNaN(amount) || amount <= 0) return tg.showAlert('Введите корректную сумму');

    await fetch('/api/user/balance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_id: window.currentManageUser.id, amount: amount })
    });
    
    tg.showAlert('Баланс начислен!');
    fetchAdminUsers();
    closeUserModal();
}

async function adminResetUserCd() {
    if(!window.currentManageUser) return;
    await fetch('/api/admin/reset_cooldown', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_id: window.currentManageUser.id })
    });
    tg.showAlert('Кулдаун сброшен!');
    closeUserModal();
}

async function adminGiveTariff() {
    if(!window.currentManageUser) return;
    const tariffId = parseInt(document.getElementById('admin-tariff-select').value);
    
    await fetch('/api/admin/grant_tariff', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_id: window.currentManageUser.id, tariff_id: tariffId })
    });
    tg.showAlert('Тариф выдан!');
    closeUserModal();
}

// --- Тарифы ---
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

// --- Колесо ---
function toggleWheelValueInput() {
    const type = document.getElementById('new-wheel-type').value;
    const valInput = document.getElementById('new-wheel-value');
    if (type === 'other') {
        valInput.value = '0';
        valInput.disabled = true;
        valInput.style.opacity = '0.5';
    } else {
        valInput.disabled = false;
        valInput.style.opacity = '1';
    }
}

function renderAdminWheelList() {
    const list = document.getElementById('admin-wheel-list');
    list.innerHTML = appState.wheelItems.map((item, index) => {
        const prizeLabel = item.prize_type === 'other' ? 'Приз' : `${item.value}₽`;
        return `
        <div class="wheel-item-row" data-id="${item.id}" style="border-left-color: ${item.color}">
            <div style="font-weight:bold; font-size:14px;">${item.label} <span style="color:var(--success); font-size:12px;">(${prizeLabel})</span></div>
            <div><button class="btn btn-danger" style="width:auto; padding:5px 10px; font-size:12px;" onclick="deleteWheelItem(${item.id})">✕</button></div>
        </div>
    `}).join('');

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
    const type = document.getElementById('new-wheel-type').value;
    const value = document.getElementById('new-wheel-value').value;
    const color = document.getElementById('new-wheel-color').value;
    if(!label) return tg.showAlert('Введите текст!');
    
    await fetch('/api/wheel_items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, color, value: parseInt(value) || 0, prize_type: type })
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
