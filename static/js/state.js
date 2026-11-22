const tg = Telegram.WebApp;
tg.ready();
tg.expand();

const savedNickname = localStorage.getItem('nc_vpn_nickname');
const tgFirstName = tg.initDataUnsafe?.user?.first_name || 'User';

let appState = {
    isAdmin: false,
    isOwner: false,
    selectedUserId: null,
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
        activeDiscount: 0,
        lastSpin: Number(localStorage.getItem('nc_vpn_lastSpin')) || 0,
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
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({tg_id: appState.user.tg_id, username: appState.user.tg_username, nickname: appState.user.nickname})
        });

        // Проверка овнера
        const ownerRes = await fetch(`/api/owner/check/${appState.user.tg_id}`);
        const ownerData = await ownerRes.json();
        if (ownerData.ok) appState.isOwner = ownerData.is_owner;

        const resUser = await fetch(`/api/user/${appState.user.tg_id}`);
        const dataUser = await resUser.json();
        if (dataUser.ok) {
            appState.user.balance = dataUser.user.balance;
            appState.user.is_blocked = dataUser.user.is_blocked;
            appState.user.activeFixed = dataUser.user.active_fixed_expires 
                ? { expires: new Date(dataUser.user.active_fixed_expires).getTime(), desc: dataUser.user.active_fixed_desc } 
                : null;
            appState.user.activeFixedDevices = dataUser.user.active_fixed_devices || 1;
            appState.user.activeDiscount = dataUser.user.active_discount || 0;
            if (dataUser.user.last_spin) appState.user.lastSpin = new Date(dataUser.user.last_spin).getTime();
        }

        const resTariffs = await fetch('/api/tariffs');
        const dataTariffs = await resTariffs.json();
        if (dataTariffs.ok) appState.tariffs = dataTariffs.tariffs;

        const resWheel = await fetch('/api/wheel_items');
        const dataWheel = await resWheel.json();
        if (dataWheel.ok) appState.wheelItems = dataWheel.items;

        updateUI();
        drawWheel();
        updateCooldownUI();
        loadTransactions();
    } catch(e) { console.error(e); }
}

async function loadTransactions() {
    try {
        const res = await fetch(`/api/user/${appState.user.tg_id}/transactions`);
        const data = await res.json();
        const list = document.getElementById('transactions-history');
        if (!data.ok || !data.transactions || data.transactions.length === 0) {
            list.innerHTML = '<li style="color:var(--text-muted);">Пока пусто</li>';
            return;
        }
        const icons = { topup: '💰 Пополнение', admin_add: '👑 Адм. пополнение', admin_set: '👑 Адм. изменение', 
                        wheel_win: '🎰 Колесо', tariff_buy: '💳 Покупка', tariff_cancel: '↩️ Возврат', promo_bonus: '🎁 Промокод' };
        list.innerHTML = data.transactions.map(t => {
            const d = new Date(t.created_at).toLocaleDateString();
            const sign = t.amount >= 0 ? '+' : '';
            const color = t.amount >= 0 ? 'var(--success)' : 'var(--danger)';
            return `<li><span>${d} — ${icons[t.type] || t.type}</span><b style="color:${color};">${sign}${t.amount.toFixed(1)} ₽</b></li>`;
        }).join('');
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
    const adminTabs = ['admin-users', 'admin-tariffs', 'admin-wheel', 'admin-promos', 'admin-list'];
    if (adminTabs.includes(tab) && !appState.isAdmin) return tg.showAlert('Доступ запрещен.');
    if (tab === 'admin-list' && !appState.isOwner) return tg.showAlert('Только для владельца');

    document.querySelectorAll('.main-content > div').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
    
    document.getElementById('view-' + tab).style.display = 'block';
    if(document.getElementById('tab-' + tab)) document.getElementById('tab-' + tab).classList.add('active');
    
    const titles = { home: 'Главная', profile: 'Профиль', wheel: 'Колесо', tariffs: 'Тарифы', 
                     support: 'Поддержка', promo: 'Промокод', 'admin-login': 'Вход', 
                     'admin-users': 'Пользователи', 'admin-tariffs': 'Тарифы', 
                     'admin-wheel': 'Колесо', 'admin-promos': 'Промокоды', 
                     'admin-list': 'Админы', connect: 'Подключение' };
    document.getElementById('header-title').textContent = titles[tab] || '';

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
    if(tab === 'admin-promos') fetchAdminPromos();
    if(tab === 'admin-list') fetchAdminList();
    if(tab === 'tariffs') renderUserTariffsList();
    if(tab === 'wheel') updateCooldownUI();
    if(tab === 'profile') loadTransactions();
    updateUI();
}

function updateUI() {
    document.getElementById('home-balance').textContent = appState.user.balance.toFixed(2) + ' ₽';
    document.getElementById('user-nickname').textContent = appState.user.nickname;
    document.getElementById('user-tg-username').textContent = appState.user.tg_username;

    const wheelList = document.getElementById('wheel-history');
    if (appState.user.wheelHistory.length === 0) wheelList.innerHTML = '<li style="color:var(--text-muted);">Пока пусто</li>';
    else wheelList.innerHTML = appState.user.wheelHistory.map(item => `<li><span>${item.date}</span><span style="color:var(--promo);">${item.prize}</span></li>`).join('');

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
        mainPlans.innerHTML = appState.dailyPlans.map((t) => `
            <div class="plan-btn ${t.devices === appState.user.selectedDevices ? 'active' : ''}" onclick="selectDailyPlan(${t.devices}, ${t.priceDay})">
                <div class="plan-devices">${t.devices} устр.</div>
                <div class="plan-price-day">${t.priceDay} ₽/день</div>
            </div>
        `).join('');
    }
}
