function changeNickname() {
    const newNick = window.prompt("Введите новый никнейм:", appState.user.nickname);
    if (newNick && newNick.trim() !== '') {
        appState.user.nickname = newNick.trim();
        localStorage.setItem('nc_vpn_nickname', appState.user.nickname);
        document.getElementById('welcome-message').innerHTML = `Привет, <b>${appState.user.nickname}</b>!<br>Рады видеть тебя в NC VPN.`;
        updateUI();
    }
}

function selectDailyPlan(devices, priceDay) {
    appState.user.selectedDevices = devices;
    appState.user.selectedPriceDay = priceDay;
    updateUI();
}

// Пополнение
function topUpBalance() {
    if (appState.user.is_blocked) return tg.showAlert('Ваш аккаунт заблокирован!');
    document.getElementById('topup-amount-input').value = '';
    document.getElementById('topup-modal').classList.add('open');
}
function closeTopupModal() {
    document.getElementById('topup-modal').classList.remove('open');
}
function setTopupAmount(a) {
    document.getElementById('topup-amount-input').value = a;
}
async function confirmTopup() {
    const amount = parseFloat(document.getElementById('topup-amount-input').value);
    if (isNaN(amount) || amount < 10) return tg.showAlert('Мин. сумма 10 ₽');
    if (amount > 100000) return tg.showAlert('Макс. сумма 100 000 ₽');
    closeTopupModal();
    try {
        const res = await fetch('/api/user/balance', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({tg_id: appState.user.tg_id, amount})
        });
        const data = await res.json();
        if (data.ok) {
            appState.user.balance = data.balance;
            updateUI();
            loadTransactions();
            tg.showAlert(`✅ Баланс пополнен на ${amount} ₽`);
        } else tg.showAlert('Ошибка: ' + (data.error || ''));
    } catch(e) { tg.showAlert('Ошибка сети'); }
}

// Подключение VPN
async function connectVpn() {
    if (appState.user.is_blocked) return tg.showAlert('Аккаунт заблокирован!');
    const devicesToUse = (appState.user.activeFixed && appState.user.activeFixed.expires > Date.now())
        ? appState.user.activeFixedDevices : appState.user.selectedDevices;
    switchTab('connect');
    document.getElementById('sub-link').textContent = 'Получение...';
    try {
        const res = await fetch('/api/create-vpn', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({telegram_id: appState.user.tg_id, devices: devicesToUse})
        });
        const data = await res.json();
        document.getElementById('sub-link').textContent = data.subscription_url || 'Ошибка';
    } catch(e) { document.getElementById('sub-link').textContent = 'Ошибка сети'; }
}
function copyLink() {
    const link = document.getElementById('sub-link').textContent;
    if (link && !link.includes('Ошибка') && !link.includes('Получение'))
        navigator.clipboard.writeText(link).then(() => tg.showAlert('Скопировано!'));
}

// Поддержка
async function sendSupport() {
    const subject = document.getElementById('support-subject').value;
    const msg = document.getElementById('support-msg').value;
    if (!subject || !msg) return tg.showAlert('Заполните поля!');
    try {
        const res = await fetch('/api/support', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({user_id: appState.user.tg_id, username: appState.user.tg_username, subject, message: msg})
        });
        const data = await res.json();
        if (data.ok) {
            tg.showAlert('Отправлено!');
            document.getElementById('support-subject').value = '';
            document.getElementById('support-msg').value = '';
        } else tg.showAlert('Ошибка: ' + data.error);
    } catch(e) { tg.showAlert('Ошибка сети'); }
}

// Промокоды
function openPromoModal() {
    document.getElementById('promo-code-input').value = '';
    document.getElementById('promo-modal').classList.add('open');
}
function closePromoModal() {
    document.getElementById('promo-modal').classList.remove('open');
}
async function activatePromo() {
    const code = document.getElementById('promo-code-input').value.trim().toUpperCase();
    if (!code) return tg.showAlert('Введите код');
    try {
        const res = await fetch('/api/promo/activate', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({user_id: appState.user.tg_id, code})
        });
        const data = await res.json();
        if (data.ok) {
            tg.showAlert('✅ Промокод активирован!');
            closePromoModal();
            await loadInitialData();
        } else tg.showAlert('❌ ' + data.error);
    } catch(e) { tg.showAlert('Ошибка сети'); }
}

// Тарифы
function renderUserTariffsList() {
    const discount = appState.user.activeDiscount || 0;
    document.getElementById('user-tariffs-list').innerHTML = appState.tariffs.map(t => {
        const isSoldOut = t.limit_count > 0 && t.sold_count >= t.limit_count;
        const finalPrice = discount > 0 ? Math.round(t.price * (1 - discount / 100) * 10) / 10 : t.price;
        const priceHtml = discount > 0
            ? `<span style="text-decoration:line-through; color:var(--text-muted); font-size:16px;">${t.price} ₽</span> <span style="color:var(--success); font-size:18px; font-weight:bold;">${finalPrice} ₽</span>`
            : `<span style="color:var(--success); font-size:18px; font-weight:bold;">${t.price} ₽</span>`;
        return `
        <div class="card" style="padding:15px; display:flex; justify-content:space-between; align-items:center; ${isSoldOut ? 'opacity:0.6;' : ''}">
            <div>
                <div>${priceHtml}</div>
                <div style="font-size:13px; color:var(--text-muted);">${t.desc}</div>
                ${t.limit_count > 0 ? `<div style="font-size:11px; color:var(--promo); margin-top:5px;">Осталось: ${t.limit_count - t.sold_count} из ${t.limit_count}</div>` : ''}
            </div>
            <button class="btn ${isSoldOut ? '' : 'btn-success'}" style="width:auto; padding:10px;"
                ${isSoldOut || appState.user.activeFixed ? 'disabled' : ''}
                onclick="buyFixedTariff(${t.id})">
                ${isSoldOut ? 'Распродан' : 'Купить'}
            </button>
        </div>`;
    }).join('');
}

async function buyFixedTariff(id) {
    if (appState.user.activeFixed) return tg.showAlert('У вас уже есть активный пакет.');
    const tariff = appState.tariffs.find(t => t.id === id);
    const discount = appState.user.activeDiscount || 0;
    const finalPrice = discount > 0 ? Math.round(tariff.price * (1 - discount / 100) * 10) / 10 : tariff.price;
    if (appState.user.balance < finalPrice) return tg.showAlert('Недостаточно средств!');
    tg.showConfirm(`Купить "${tariff.desc}" за ${finalPrice} ₽?`, async (ok) => {
        if (!ok) return;
        const res = await fetch('/api/tariff/buy', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({tg_id: appState.user.tg_id, tariff_id: id})
        });
        const data = await res.json();
        if (data.ok) {
            appState.user.balance = data.balance;
            appState.user.activeFixed = {desc: tariff.desc, expires: Date.now() + tariff.days * 86400000};
            appState.user.activeFixedDevices = tariff.devices;
            tg.showAlert('Куплено!');
            switchTab('home');
        } else tg.showAlert(data.error);
    });
}

async function cancelTariff() {
    tg.showConfirm('Отменить тариф? Вернём деньги за неиспользованные дни.', async (ok) => {
        if (!ok) return;
        const res = await fetch('/api/tariff/cancel', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({tg_id: appState.user.tg_id})
        });
        const data = await res.json();
        if (data.ok) {
            appState.user.balance = data.balance;
            appState.user.activeFixed = null;
            tg.showAlert(`Отменено. Возврат: ${data.refund} ₽`);
            switchTab('home');
        } else tg.showAlert(data.error);
    });
}
