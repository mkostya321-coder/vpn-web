import os
import aiohttp
from fastapi import FastAPI, Depends
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select, delete, update
from sqlalchemy.ext.asyncio import AsyncSession
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import List

from database import init_db, get_db, User, Tariff, WheelItem, async_session

scheduler = AsyncIOScheduler(timezone="Europe/Moscow")

# --- Вспомогательная функция для логов ---
async def send_tg_log(chat_id_env, text):
    BOT_TOKEN = os.getenv("BOT_TOKEN")
    CHAT_ID = os.getenv(chat_id_env)
    if not BOT_TOKEN or not CHAT_ID: return

    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {"chat_id": CHAT_ID, "text": text, "parse_mode": "HTML"}
    async with aiohttp.ClientSession() as session:
        await session.post(url, json=payload)

async def daily_charge():
    print(f"[{datetime.now()}] Запуск ежедневных задач...")
    async with async_session() as session:
        result = await session.execute(select(User).where(User.balance > 0, User.is_blocked == False))
        users = result.scalars().all()
        for user in users:
            if user.active_fixed_expires and user.active_fixed_expires > datetime.now():
                continue
            user.balance -= user.daily_price
            if user.balance < 0:
                user.balance = 0

        await session.execute(update(Tariff).values(sold_count=0))
        await session.commit()

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db() 
    scheduler.add_job(daily_charge, 'cron', hour=0, minute=0) 
    scheduler.start()
    yield
    scheduler.shutdown()

app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

class UserSync(BaseModel):
    tg_id: int
    username: str
    nickname: str

class BalanceUpdate(BaseModel):
    tg_id: int
    amount: float

class AdminUserUpdate(BaseModel):
    tg_id: int
    new_balance: float
    is_blocked: bool

class FixedTariffBuy(BaseModel):
    tg_id: int
    tariff_id: int

class TariffCancel(BaseModel):
    tg_id: int

class SpinResult(BaseModel):
    tg_id: int
    prize_value: float
    prize_label: str
    is_other_prize: bool = False

class SupportRequest(BaseModel):
    user_id: int
    username: str
    subject: str
    message: str

class CreateUserRequest(BaseModel):
    telegram_id: int
    devices: int = 1

class GambleRequest(BaseModel):
    tg_id: int
    original_win: float
    won_gamble: bool

class TariffCreate(BaseModel):
    price: int
    desc: str
    days: int
    devices: int
    limit_count: int

class WheelItemCreate(BaseModel):
    label: str
    color: str
    value: int
    prize_type: str

class WheelOrderUpdate(BaseModel):
    items: List[int]

class AdminGrantTariff(BaseModel):
    tg_id: int
    tariff_id: int

class AdminResetCooldown(BaseModel):
    tg_id: int

@app.post("/api/user/sync")
async def sync_user(user_data: UserSync, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_data.tg_id)
    if not user:
        user = User(id=user_data.tg_id, username=user_data.username, nickname=user_data.nickname)
        db.add(user)
    else:
        user.username = user_data.username
        user.nickname = user_data.nickname
    await db.commit()
    return {"ok": True}

@app.get("/api/user/{tg_id}")
async def get_user(tg_id: int, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, tg_id)
    if not user:
        return {"ok": False, "error": "User not found"}
    return {"ok": True, "user": {
        "id": user.id, "username": user.username, "nickname": user.nickname,
        "balance": user.balance, "is_blocked": user.is_blocked, "selected_devices": user.selected_devices,
        "daily_price": user.daily_price, "active_fixed_desc": user.active_fixed_desc,
        "active_fixed_expires": user.active_fixed_expires.isoformat() if user.active_fixed_expires else None,
        "active_fixed_devices": user.active_fixed_devices,
        "last_spin": user.last_spin.isoformat() if user.last_spin else None
    }}

@app.get("/api/users/all")
async def get_all_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User))
    users = result.scalars().all()
    return {"ok": True, "users": [{"id": u.id, "username": u.username, "nickname": u.nickname, "balance": u.balance, "is_blocked": u.is_blocked} for u in users]}

@app.post("/api/admin/user_update")
async def admin_update_user(data: AdminUserUpdate, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, data.tg_id)
    if user:
        user.balance = data.new_balance
        user.is_blocked = data.is_blocked
        await db.commit()
    return {"ok": True}

@app.post("/api/user/balance")
async def update_balance(data: BalanceUpdate, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, data.tg_id)
    if user:
        user.balance += data.amount
        await db.commit()
        # Лог пополнения
        await send_tg_log("LOG_TOPUP_CHAT_ID", f"💰 <b>Новое пополнение!</b>\n\n👤 {user.username}\n💵 +{data.amount} ₽")
    return {"ok": True, "balance": user.balance if user else 0}

@app.post("/api/tariff/buy")
async def buy_tariff(data: FixedTariffBuy, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, data.tg_id)
    tariff = await db.get(Tariff, data.tariff_id)
    
    if not user or not tariff: return {"ok": False, "error": "Ошибка данных"}
    if user.is_blocked: return {"ok": False, "error": "Вы заблокированы"}
    if user.balance < tariff.price: return {"ok": False, "error": "Недостаточно средств"}
    if tariff.limit_count > 0 and tariff.sold_count >= tariff.limit_count: return {"ok": False, "error": "Товар распродан"}

    user.balance -= tariff.price
    user.active_fixed_expires = datetime.now() + timedelta(days=tariff.days)
    user.active_fixed_desc = tariff.desc
    user.active_fixed_devices = tariff.devices
    tariff.sold_count += 1
    
    await db.commit()
    return {"ok": True, "balance": user.balance}

@app.post("/api/tariff/cancel")
async def cancel_tariff(data: TariffCancel, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, data.tg_id)
    if not user or not user.active_fixed_expires:
        return {"ok": False, "error": "Нет активного тарифа"}
    
    res = await db.execute(select(Tariff).where(Tariff.desc == user.active_fixed_desc))
    tariff = res.scalars().first()
    if not tariff: return {"ok": False, "error": "Тариф не найден"}

    now = datetime.now()
    left_seconds = (user.active_fixed_expires - now).total_seconds()
    left_days = max(0, left_seconds / (24 * 60 * 60))
    
    price_per_day = tariff.price / tariff.days
    refund = round(price_per_day * left_days, 1)

    user.balance += refund
    user.active_fixed_expires = None
    user.active_fixed_desc = None
    user.active_fixed_devices = None
    
    await db.commit()
    return {"ok": True, "refund": refund, "balance": user.balance}

@app.post("/api/admin/grant_tariff")
async def admin_grant_tariff(data: AdminGrantTariff, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, data.tg_id)
    tariff = await db.get(Tariff, data.tariff_id)
    if user and tariff:
        user.active_fixed_expires = datetime.now() + timedelta(days=tariff.days)
        user.active_fixed_desc = tariff.desc
        user.active_fixed_devices = tariff.devices
        await db.commit()
    return {"ok": True}

@app.post("/api/admin/reset_cooldown")
async def admin_reset_cooldown(data: AdminResetCooldown, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, data.tg_id)
    if user:
        user.last_spin = None
        await db.commit()
    return {"ok": True}

@app.get("/api/tariffs")
async def get_tariffs(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Tariff))
    return {"ok": True, "tariffs": res.scalars().all()}

@app.post("/api/tariffs")
async def add_tariff(data: TariffCreate, db: AsyncSession = Depends(get_db)):
    new_t = Tariff(price=data.price, desc=data.desc, days=data.days, devices=data.devices, limit_count=data.limit_count)
    db.add(new_t)
    await db.commit()
    return {"ok": True}

@app.delete("/api/tariffs/{id}")
async def delete_tariff(id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Tariff).where(Tariff.id == id))
    await db.commit()
    return {"ok": True}

@app.post("/api/wheel/spin")
async def record_spin(data: SpinResult, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, data.tg_id)
    if user:
        user.last_spin = datetime.now()
        if not data.is_other_prize:
            user.balance += data.prize_value
            await send_tg_log("LOG_WHEEL_CHAT_ID", f"🎰 <b>Колесо удачи!</b>\n\n👤 {user.username}\n💰 Выигрыш: {data.prize_label}")
        else:
            await send_tg_log("LOG_WHEEL_CHAT_ID", f"🎁 <b>Заявка на выдачу приза!</b>\n\n👤 {user.username}\n🏆 Приз: {data.prize_label}\n\n<i>Требуется ручная выдача.</i>")
        await db.commit()
    return {"ok": True}

@app.post("/api/wheel/gamble")
async def gamble(data: GambleRequest, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, data.tg_id)
    if user and not data.won_gamble:
        user.balance -= data.original_win
        await db.commit()
    return {"ok": True}

@app.get("/api/wheel_items")
async def get_wheel_items(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(WheelItem).order_by(WheelItem.order))
    return {"ok": True, "items": res.scalars().all()}

@app.post("/api/wheel_items")
async def add_wheel_item(data: WheelItemCreate, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(WheelItem))
    count = len(res.scalars().all())
    new_item = WheelItem(label=data.label, color=data.color, value=data.value, order=count, prize_type=data.prize_type)
    db.add(new_item)
    await db.commit()
    return {"ok": True}

@app.delete("/api/wheel_items/{id}")
async def delete_wheel_item(id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(WheelItem).where(WheelItem.id == id))
    await db.commit()
    return {"ok": True}

@app.post("/api/wheel_items/order")
async def update_wheel_order(data: WheelOrderUpdate, db: AsyncSession = Depends(get_db)):
    for idx, item_id in enumerate(data.items):
        await db.execute(update(WheelItem).where(WheelItem.id == item_id).values(order=idx))
    await db.commit()
    return {"ok": True}

@app.post("/api/create-vpn")
async def create_vpn(req: CreateUserRequest):
    return {"ok": True, "subscription_url": f"vless://TEST-LINK-FOR-{req.devices}-DEVICES@127.0.0.1:443"}

@app.post("/api/support")
async def send_support(req: SupportRequest):
    BOT_TOKEN = os.getenv("BOT_TOKEN")
    CHAT_ID = os.getenv("SUPPORT_CHAT_ID")
    TOPIC_ID = os.getenv("SUPPORT_TOPIC_ID")
    
    if not BOT_TOKEN or not CHAT_ID:
        return {"ok": False, "error": "Переменные не заданы"}

    text = f"🆘 Обращение в поддержку!\n\n👤 От: {req.username} (ID: {req.user_id})\n📌 Тема: {req.subject}\n\n💬 Сообщение:\n{req.message}"
    payload = {"chat_id": CHAT_ID, "text": text}
    if TOPIC_ID and TOPIC_ID.strip() != "":
        try: payload["message_thread_id"] = int(TOPIC_ID)
        except ValueError: pass

    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload) as resp:
            if resp.status == 200: return {"ok": True}
            else: return {"ok": False, "error": f"Ошибка ТГ: {await resp.text()}"}
