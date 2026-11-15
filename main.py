import os
import aiohttp
from fastapi import FastAPI, Depends
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from database import init_db, get_db, User, async_session

# --- Планировщик задач ---
scheduler = AsyncIOScheduler(timezone="Europe/Moscow")

async def daily_charge():
    """Фоновая задача: списание средств раз в сутки."""
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

# Управление жизненным циклом приложения (запуск/остановка)
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

# --- Модели для API ---
class UserSync(BaseModel):
    tg_id: int
    username: str
    nickname: str

class BalanceUpdate(BaseModel):
    tg_id: int
    amount: float

class SpinResult(BaseModel):
    tg_id: int
    prize_value: float
    prize_label: str

# --- Эндпоинты ---

@app.post("/api/user/sync")
async def sync_user(user_data: UserSync, db: AsyncSession = Depends(get_db)):
    """Создает или обновляет пользователя в БД."""
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
    return {"ok": True, "user": user}

@app.post("/api/user/balance")
async def update_balance(data: BalanceUpdate, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, data.tg_id)
    if user:
        user.balance += data.amount
        await db.commit()
    return {"ok": True, "balance": user.balance if user else 0}

@app.post("/api/wheel/spin")
async def record_spin(data: SpinResult, db: AsyncSession = Depends(get_db)):
    """Записывает результат колеса и начисляет выигрыш."""
    user = await db.get(User, data.tg_id)
    if user:
        user.last_spin = datetime.now()
        user.balance += data.prize_value
        await db.commit()
    return {"ok": True}

# ... (остальные эндпоинты, например /api/support, можно оставить как есть) ...
