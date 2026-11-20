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
