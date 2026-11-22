function handleAdminAuthClick() {
    if (appState.isAdmin) {
        appState.isAdmin = false;
        document.getElementById('admin-menu').style.display = 'none';
        document.getElementById('admin-auth-btn').innerHTML = '⚙️ Войти в АдмПрофиль';
        switchTab('home');
    } else switchTab('admin-login');
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
    } else tg.showAlert('Неверный логин или пароль!');
}

// Пользователи
async function fetchAdminUsers() {
    const list = document.getElementById('admin-users-list');
    list.innerHTML = 'Загрузка...';
    try {
        const res = await fetch('/api/users/all');
        const data = await res.json();
        if (data.ok) { appState.allUsers = data.users; renderAdminUsers(); }
    } catch(e) { list.innerHTML = 'Ошибка'; }
}

function renderAdminUsers() {
    const search = (document.getElementById('admin-search-user')?.value || '').toLowerCase();
    const list = document.getElementById('admin-users-list');
    const filtered = appState.allUsers.filter(u => u.username && u.username.toLowerCase().includes(search));
    list.innerHTML = filtered.length === 0 ? '<div style="text-align:center;">Никого не найдено</div>' : filtered.map(u => {
        const isSel = appState.selectedUserId === u.id;
        return `
        <div class="user-row ${u.is_blocked ? 'blocked' : ''} ${isSel ? 'selected' : ''}" onclick="selectAdminUser(${u.id})">
            <div>
                <div style="font-size:14px; font-weight:bold;">${u.username} ${u.is_blocked ? '(БАН)' : ''}</div>
                <div style="font-size:11px; color:var(--text-muted);">${u.nickname} (ID: ${u.id})</div>
            </div>
            <div>
                <span style="color:${u.is_blocked ? 'var(--danger)' : 'var(--success)'}; font-weight:bold;">${u.balance.toFixed(2)} ₽</span>
                ${isSel ? `<button class="btn" style="width:auto; padding:5px 10px; margin-left:10px;" onclick="event.stopPropagation(); openUserModal(${u.id})">Открыть</button>` : ''}
            </div>
        </div>`;
    }).join('');
}

function selectAdminUser(id) {
    appState.selectedUserId = (appState.selectedUserId === id) ? null : id;
    renderAdminUsers();
}

async function openUserModal(id) {
    const user = appState.allUsers.find(u => u.id === id);
    if (!user) return;
    document.getElementById('manage-username').textContent = `${user.username} (${user.nickname})`;
    document.getElementById('add-balance-input').value = '';
    document.getElementById('set-balance-input').value = '';
    document.getElementById('admin-promo-for-user').value = '';
    const select = document.getElementById('admin-tariff-select');
    select.innerHTML = appState.tariffs.map(t => `<option value="${t.id}">${t.desc} (${t.price}₽)</option>`).join('');
    window.currentManageUser = user;
    // Загружаем активные промо
    const res = await fetch(`/api/admin/user_promos/${id}`);
    const data = await res.json();
    const promosDiv = document.getElementById('user-promos-in-modal');
    if (data.ok && data.user_promos.length > 0) {
        promosDiv.innerHTML = data.user_promos.map(up => `
            <div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid var(--border);">
                <span>${up.promo_code}</span>
                <button class="btn btn-danger" style="width:auto; padding:3px 8px; font-size:11px;" onclick="adminRemovePromo(${up.id})">✕</button>
            </div>`).join('');
    } else promosDiv.innerHTML = '<div style="color:var(--text-muted); font-size:12px;">Нет</div>';
    
    document.getElementById('user-manage-modal').classList.add('open');
}

function closeUserModal() {
    document.getElementById('user-manage-modal').classList.remove('open');
}

async function adminAddBal() {
    if (!window.currentManageUser) return;
    const amount = parseFloat(document.getElementById('add-balance-input').value);
    if (isNaN(amount) || amount <= 0) return tg.showAlert('Введите сумму');
    await fetch('/api/admin/add_balance', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({tg_id: window.currentManageUser.id, amount})
    });
    tg.showAlert('Баланс пополнен!');
    fetchAdminUsers();
    closeUserModal();
}

async function adminSetBal() {
    if (!window.currentManageUser) return;
    const newBalance = parseFloat(document.getElementById('set-balance-input').value);
    if (isNaN(newBalance) || newBalance < 0) return tg.showAlert('Введите корректный баланс');
    await fetch('/api/admin/set_balance', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({tg_id: window.currentManageUser.id, new_balance: newBalance, is_blocked: window.currentManageUser.is_blocked})
    });
    tg.showAlert('Баланс изменён!');
    fetchAdminUsers();
    closeUserModal();
}

async function adminResetUserCd() {
    if (!window.currentManageUser) return;
    await fetch('/api/admin/reset_cooldown', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({tg_id: window.currentManageUser.id})
    });
    tg.showAlert('Кулдаун сброшен!');
    closeUserModal();
}

async function adminGiveTariff() {
    if (!window.currentManageUser) return;
    const tariffId = parseInt(document.getElementById('admin-tariff-select').value);
    await fetch('/api/admin/grant_tariff', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({tg_id: window.currentManageUser.id, tariff_id: tariffId})
    });
    tg.showAlert('Тариф выдан!');
    closeUserModal();
}

async function adminActivatePromoOnUser() {
    if (!window.currentManageUser) return;
    const code = document.getElementById('admin-promo-for-user').value.trim().toUpperCase();
    if (!code) return tg.showAlert('Введите код');
    // Админ может активировать без 24ч кулдауна — вызываем тот же эндпоинт, но он проверяет кулдаун.
    // Для админа лучше сделать обходной путь: используем прямой insert через отдельный эндпоинт.
    const res = await fetch('/api/promo/activate', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({user_id: window.currentManageUser.id, code})
    });
    const data = await res.json();
    if (data.ok) {
        tg.showAlert('Активировано!');
        fetchAdminUsers();
        closeUserModal();
    } else tg.showAlert(data.error);
}

async function adminRemovePromo(id) {
    await fetch(`/api/admin/user_promos/${id}`, {method: 'DELETE'});
    tg.showAlert('Промокод снят');
    openUserModal(window.currentManageUser.id);
}

// Тарифы
function renderAdminTariffs() {
    const list = document.getElementById('admin-tariffs-list');
    list.innerHTML = appState.tariffs.map(t => `
        <div class="user-row" style="justify-content:flex-start;">
            <div style="flex:1;">
                <div style="font-weight:bold; color:var(--success);">${t.price} ₽ (${t.days}дн., ${t.devices}устр.)</div>
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
    if (!price || !desc || !days || !devices) return tg.showAlert('Заполните поля!');
    await fetch('/api/tariffs', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({price: parseInt(price), desc, days: parseInt(days), devices: parseInt(devices), limit_count: parseInt(limit)})
    });
    const res = await fetch('/api/tariffs');
    const data = await res.json();
    appState.tariffs = data.tariffs;
    renderAdminTariffs();
    tg.showAlert('Добавлено!');
}

async function deleteTariff(id) {
    await fetch(`/api/tariffs/${id}`, {method: 'DELETE'});
    const res = await fetch('/api/tariffs');
    const data = await res.json();
    appState.tariffs = data.tariffs;
    renderAdminTariffs();
}

// Колесо
function toggleWheelValueInput() {
    const type = document.getElementById('new-wheel-type').value;
    const val = document.getElementById('new-wheel-value');
    if (type === 'other') { val.value = '0'; val.disabled = true; val.style.opacity = '0.5'; }
    else { val.disabled = false; val.style.opacity = '1'; }
}

function renderAdminWheelList() {
    const list = document.getElementById('admin-wheel-list');
    list.innerHTML = appState.wheelItems.map(item => {
        const label = item.prize_type === 'other' ? 'Приз' : `${item.value}₽`;
        return `
        <div class="wheel-item-row" data-id="${item.id}" style="border-left-color:${item.color};">
            <div style="font-weight:bold; font-size:14px;">${item.label} <span style="color:var(--success); font-size:12px;">(${label})</span></div>
            <div><button class="btn btn-danger" style="width:auto; padding:5px 10px; font-size:12px;" onclick="deleteWheelItem(${item.id})">✕</button></div>
        </div>`;
    }).join('');
    new Sortable(list, {
        animation: 150,
        onEnd: async () => {
            const ids = Array.from(list.querySelectorAll('.wheel-item-row')).map(el => parseInt(el.getAttribute('data-id')));
            await fetch('/api/wheel_items/order', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({items: ids})
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
    if (!label) return tg.showAlert('Введите текст!');
    await fetch('/api/wheel_items', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({label, color, value: parseInt(value) || 0, prize_type: type})
    });
    const res = await fetch('/api/wheel_items');
    const data = await res.json();
    appState.wheelItems = data.items;
    renderAdminWheelList();
    drawWheel();
    tg.showAlert('Добавлено!');
}

async function deleteWheelItem(id) {
    await fetch(`/api/wheel_items/${id}`, {method: 'DELETE'});
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

function resetAllCooldownsAdmin() {
    tg.showConfirm('Сбросить кулдаун ВСЕМ пользователям?', async (ok) => {
        if (!ok) return;
        await fetch('/api/admin/reset_all_cooldowns', {method: 'POST'});
        tg.showAlert('Кулдаун сброшен всем!');
    });
}

// Промокоды
async function fetchAdminPromos() {
    const res = await fetch('/api/admin/promos');
    const data = await res.json();
    if (data.ok) {
        const list = document.getElementById('admin-promos-list');
        if (data.promos.length === 0) { list.innerHTML = '<div style="color:var(--text-muted);">Пусто</div>'; return; }
        list.innerHTML = data.promos.map(p => `
            <div class="user-row">
                <div>
                    <b>${p.code}</b> 
                    ${p.discount_percent > 0 ? `| Скидка ${p.discount_percent}% (${p.valid_days}дн.)` : ''}
                    ${p.balance_bonus > 0 ? `| Бонус ${p.balance_bonus}₽` : ''}
                    | ${p.used_count}/${p.usage_limit || '∞'}
                </div>
                <button class="btn btn-danger" style="width:auto; padding:5px 10px; font-size:12px;" onclick="deletePromoCode(${p.id})">Удалить</button>
            </div>
        `).join('');
    }
}

async function createPromoCode() {
    const code = document.getElementById('new-promo-code').value.trim().toUpperCase();
    const discount = parseInt(document.getElementById('new-promo-discount').value) || 0;
    const bonus = parseFloat(document.getElementById('new-promo-bonus').value) || 0;
    const limit = parseInt(document.getElementById('new-promo-limit').value) || 0;
    const days = parseInt(document.getElementById('new-promo-days').value) || 0;
    if (!code) return tg.showAlert('Введите код');
    const res = await fetch('/api/admin/promos', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({code, discount_percent: discount, balance_bonus: bonus, usage_limit: limit, valid_days: days})
    });
    const data = await res.json();
    if (data.ok) {
        tg.showAlert('Промокод создан!');
        fetchAdminPromos();
        document.getElementById('new-promo-code').value = '';
    } else tg.showAlert(data.error);
}

async function deletePromoCode(id) {
    await fetch(`/api/admin/promos/${id}`, {method: 'DELETE'});
    fetchAdminPromos();
}
