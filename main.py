import os
import aiohttp
from fastapi import FastAPI, Depends
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from database import init_db, get_db, User, async_session

# --- Планировщик задач ---
scheduler = AsyncIOScheduler(timezone="Europe/Moscow")

async def daily_charge():
    """Фоновая задача: списание средств раз в сутки в 00:00."""
    print(f"[{datetime.now()}] Запуск ежедневного списания...")
    async with async_session() as session:
        result = await session.execute(select(User).where(User.balance > 0))
        users = result.scalars().all()
        for user in users:
            # Если есть активный пакетный тариф, пропускаем ежедневное списание
            if user.active_fixed_expires and user.active_fixed_expires > datetime.now():
                continue
            user.balance -= user.daily_price
            if user.balance < 0:
                user.balance = 0
        await session.commit()
    print(f"[{datetime.now()}] Списание завершено.")

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db() # Создаем таблицы при старте
    scheduler.add_job(daily_charge, 'cron', hour=0, minute=0) # Запуск в 00:00
    scheduler.start()
    yield
    scheduler.shutdown()

app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

# --- Модели данных для API ---
class UserSync(BaseModel):
    tg_id: int
    username: str
    nickname: str

class BalanceUpdate(BaseModel):
    tg_id: int
    amount: float

class FixedTariffBuy(BaseModel):
    tg_id: int
    price: float
    desc: str
    days: int

class SpinResult(BaseModel):
    tg_id: int
    prize_value: float
    prize_label: str

class SupportRequest(BaseModel):
    user_id: int
    username: str
    subject: str
    message: str

class CreateUserRequest(BaseModel):
    telegram_id: int
    devices: int = 1

# --- Эндпоинты ---

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
        "id": user.id,
        "username": user.username,
        "nickname": user.nickname,
        "balance": user.balance,
        "selected_devices": user.selected_devices,
        "daily_price": user.daily_price,
        "active_fixed_desc": user.active_fixed_desc,
        "active_fixed_expires": user.active_fixed_expires.isoformat() if user.active_fixed_expires else None
    }}

@app.post("/api/user/balance")
async def update_balance(data: BalanceUpdate, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, data.tg_id)
    if user:
        user.balance += data.amount
        await db.commit()
    return {"ok": True, "balance": user.balance if user else 0}

@app.post("/api/tariff/buy")
async def buy_tariff(data: FixedTariffBuy, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, data.tg_id)
    if not user:
        return {"ok": False, "error": "Пользователь не найден"}
    if user.balance < data.price:
        return {"ok": False, "error": "Недостаточно средств"}
    
    user.balance -= data.price
    user.active_fixed_expires = datetime.now() + timedelta(days=data.days)
    user.active_fixed_desc = data.desc
    await db.commit()
    return {"ok": True, "balance": user.balance}

@app.post("/api/wheel/spin")
async def record_spin(data: SpinResult, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, data.tg_id)
    if user:
        user.last_spin = datetime.now()
        user.balance += data.prize_value
        await db.commit()
    return {"ok": True}

@app.get("/api/users/all")
async def get_all_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User))
    users = result.scalars().all()
    return {"ok": True, "users": [{"id": u.id, "balance": u.balance, "daily_price": u.daily_price} for u in users]}

@app.post("/api/create-vpn")
async def create_vpn(req: CreateUserRequest):
    return {"ok": True, "subscription_url": f"vless://TEST-LINK-FOR-{req.devices}-DEVICES@127.0.0.1:443"}

@app.post("/api/support")
async def send_support(req: SupportRequest):
    BOT_TOKEN = os.getenv("BOT_TOKEN")
    CHAT_ID = os.getenv("SUPPORT_CHAT_ID")
    TOPIC_ID = os.getenv("SUPPORT_TOPIC_ID")
    
    if not BOT_TOKEN or not CHAT_ID:
        return {"ok": False, "error": "Переменные BOT_TOKEN или SUPPORT_CHAT_ID не заданы"}

    text = f"🆘 **Обращение в поддержку!**\n\n👤 От: {req.username} (ID: {req.user_id})\n📌 Тема: {req.subject}\n\n💬 Сообщение:\n{req.message}"
    
    payload = {"chat_id": CHAT_ID, "text": text, "parse_mode": "Markdown"}
    if TOPIC_ID and TOPIC_ID.strip() != "":
        try: payload["message_thread_id"] = int(TOPIC_ID)
        except ValueError: pass

    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload) as resp:
            if resp.status == 200: return {"ok": True}
            else: return {"ok": False, "error": f"Ошибка ТГ: {await resp.text()}"}
