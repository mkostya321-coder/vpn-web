import os
import aiohttp
from fastapi import FastAPI, Depends
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select, delete, update, func
from sqlalchemy.ext.asyncio import AsyncSession
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import List

from database import (init_db, get_db, User, Tariff, WheelItem, 
                       PromoCode, UserPromo, Transaction, Admin, async_session)

class NoCacheStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        r = await super().get_response(path, scope)
        if r.status_code == 200:
            r.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            r.headers["Pragma"] = "no-cache"
            r.headers["Expires"] = "0"
        return r

scheduler = AsyncIOScheduler(timezone="Europe/Moscow")

def is_owner(tg_id: int) -> bool:
    owner = os.getenv("OWNER_ID")
    if not owner: return False
    try: return int(owner) == int(tg_id)
    except: return False

async def send_tg_log(chat_env, text, topic_env=None):
    token = os.getenv("BOT_TOKEN")
    chat = os.getenv(chat_env)
    if not token or not chat: return
    payload = {"chat_id": chat, "text": text, "parse_mode": "HTML"}
    if topic_env:
        topic = os.getenv(topic_env)
        if topic and topic.strip():
            try: payload["message_thread_id"] = int(topic)
            except: pass
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    async with aiohttp.ClientSession() as s:
        async with s.post(url, json=payload) as r:
            if r.status != 200:
                payload.pop("parse_mode", None)
                await s.post(url, json=payload)

async def daily_charge():
    async with async_session() as session:
        res = await session.execute(select(User).where(User.balance > 0, User.is_blocked == False))
        for u in res.scalars().all():
            if u.active_fixed_expires and u.active_fixed_expires > datetime.now(): continue
            u.balance = max(0, u.balance - u.daily_price)
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
app.mount("/static", NoCacheStaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html", headers={
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache", "Expires": "0"
    })

# --- Модели ---
class UserSync(BaseModel):
    tg_id: int; username: str; nickname: str
class BalanceUpdate(BaseModel):
    tg_id: int; amount: float
class AdminUserUpdate(BaseModel):
    tg_id: int; new_balance: float; is_blocked: bool
class FixedTariffBuy(BaseModel):
    tg_id: int; tariff_id: int
class TariffCancel(BaseModel):
    tg_id: int
class SpinResult(BaseModel):
    tg_id: int; prize_value: float; prize_label: str; is_other_prize: bool = False
class SupportRequest(BaseModel):
    user_id: int; username: str; subject: str; message: str
class CreateUserRequest(BaseModel):
    telegram_id: int; devices: int = 1
class GambleRequest(BaseModel):
    tg_id: int; original_win: float; won_gamble: bool
class TariffCreate(BaseModel):
    price: int; desc: str; days: int; devices: int; limit_count: int
class WheelItemCreate(BaseModel):
    label: str; color: str; value: int; prize_type: str
class WheelOrderUpdate(BaseModel):
    items: List[int]
class AdminGrantTariff(BaseModel):
    tg_id: int; tariff_id: int
class AdminResetCooldown(BaseModel):
    tg_id: int
class PromoActivate(BaseModel):
    user_id: int; code: str
class PromoCreate(BaseModel):
    code: str; discount_percent: int = 0; balance_bonus: float = 0.0
    usage_limit: int = 0; valid_days: int = 0
class AdminLoginRequest(BaseModel):
    tg_username: str; login: str; password: str
class AdminCreateRequest(BaseModel):
    requester_id: int; name: str; tg_username: str; login: str; password: str

async def add_transaction(db, user_id, amount, type_):
    db.add(Transaction(user_id=user_id, amount=amount, type=type_))
    await db.commit()

# --- Базовые ---
@app.post("/api/user/sync")
async def sync_user(data: UserSync, db: AsyncSession = Depends(get_db)):
    u = await db.get(User, data.tg_id)
    if not u:
        u = User(id=data.tg_id, username=data.username, nickname=data.nickname)
        db.add(u)
    else:
        u.username = data.username; u.nickname = data.nickname
    await db.commit()
    return {"ok": True}

@app.get("/api/user/{tg_id}")
async def get_user(tg_id: int, db: AsyncSession = Depends(get_db)):
    u = await db.get(User, tg_id)
    if not u: return {"ok": False}
    now = datetime.now()
    ap = await db.execute(select(UserPromo).where(UserPromo.user_id == tg_id, UserPromo.expires_at > now))
    active_promo = ap.scalars().first()
    discount = 0
    discount_expires = None
    if active_promo:
        pc = await db.execute(select(PromoCode).where(PromoCode.code == active_promo.promo_code))
        p = pc.scalars().first()
        if p:
            discount = p.discount_percent
            discount_expires = active_promo.expires_at.isoformat() if active_promo.expires_at else None
    return {"ok": True, "user": {
        "id": u.id, "username": u.username, "nickname": u.nickname,
        "balance": u.balance, "is_blocked": u.is_blocked,
        "active_fixed_desc": u.active_fixed_desc,
        "active_fixed_expires": u.active_fixed_expires.isoformat() if u.active_fixed_expires else None,
        "active_fixed_devices": u.active_fixed_devices,
        "last_spin": u.last_spin.isoformat() if u.last_spin else None,
        "active_discount": discount,
        "discount_expires": discount_expires
    }}

@app.get("/api/user/{tg_id}/transactions")
async def get_transactions(tg_id: int, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Transaction).where(Transaction.user_id == tg_id).order_by(Transaction.created_at.desc()).limit(100))
    return {"ok": True, "transactions": [
        {"amount": t.amount, "type": t.type, "created_at": t.created_at.isoformat()} for t in res.scalars().all()
    ]}

@app.get("/api/users/all")
async def get_all_users(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User))
    return {"ok": True, "users": [
        {"id": u.id, "username": u.username, "nickname": u.nickname, "balance": u.balance, "is_blocked": u.is_blocked}
        for u in res.scalars().all()
    ]}

# --- Баланс ---
@app.post("/api/user/balance")
async def update_balance(data: BalanceUpdate, db: AsyncSession = Depends(get_db)):
    u = await db.get(User, data.tg_id)
    if u:
        u.balance += data.amount
        await add_transaction(db, u.id, data.amount, "topup")
        await send_tg_log("LOG_TOPUP_CHAT_ID", f"💰 <b>Пополнение</b>\n\n👤 {u.username}\n💵 +{data.amount} ₽", "LOG_TOPUP_TOPIC_ID")
    return {"ok": True, "balance": u.balance if u else 0}

@app.post("/api/admin/add_balance")
async def admin_add_balance(data: BalanceUpdate, db: AsyncSession = Depends(get_db)):
    u = await db.get(User, data.tg_id)
    if u:
        u.balance += data.amount
        await add_transaction(db, u.id, data.amount, "admin_add")
    return {"ok": True, "balance": u.balance if u else 0}

@app.post("/api/admin/set_balance")
async def admin_set_balance(data: AdminUserUpdate, db: AsyncSession = Depends(get_db)):
    u = await db.get(User, data.tg_id)
    if u:
        diff = data.new_balance - u.balance
        u.balance = data.new_balance
        await add_transaction(db, u.id, diff, "admin_set")
        await db.commit()
    return {"ok": True, "balance": u.balance if u else 0}

# --- Тарифы ---
@app.post("/api/tariff/buy")
async def buy_tariff(data: FixedTariffBuy, db: AsyncSession = Depends(get_db)):
    u = await db.get(User, data.tg_id); t = await db.get(Tariff, data.tariff_id)
    if not u or not t: return {"ok": False, "error": "Ошибка"}
    if u.is_blocked: return {"ok": False, "error": "Заблокированы"}
    if t.limit_count > 0 and t.sold_count >= t.limit_count: return {"ok": False, "error": "Распродан"}
    now = datetime.now()
    ap = await db.execute(select(UserPromo).where(UserPromo.user_id == u.id, UserPromo.expires_at > now))
    active = ap.scalars().first()
    price = t.price
    if active:
        pc = await db.execute(select(PromoCode).where(PromoCode.code == active.promo_code))
        p = pc.scalars().first()
        if p and p.discount_percent > 0:
            price = round(t.price * (1 - p.discount_percent / 100), 1)
    if u.balance < price: return {"ok": False, "error": "Недостаточно средств"}
    u.balance -= price
    u.active_fixed_expires = datetime.now() + timedelta(days=t.days)
    u.active_fixed_desc = t.desc
    u.active_fixed_devices = t.devices
    t.sold_count += 1
    await add_transaction(db, u.id, -price, "tariff_buy")
    return {"ok": True, "balance": u.balance}

@app.post("/api/tariff/cancel")
async def cancel_tariff(data: TariffCancel, db: AsyncSession = Depends(get_db)):
    u = await db.get(User, data.tg_id)
    if not u or not u.active_fixed_expires: return {"ok": False, "error": "Нет тарифа"}
    res = await db.execute(select(Tariff).where(Tariff.desc == u.active_fixed_desc))
    t = res.scalars().first()
    if not t: return {"ok": False, "error": "Не найден"}
    left = max(0, (u.active_fixed_expires - datetime.now()).total_seconds() / 86400)
    refund = round((t.price / t.days) * left, 1)
    u.balance += refund
    u.active_fixed_expires = None; u.active_fixed_desc = None; u.active_fixed_devices = None
    await add_transaction(db, u.id, refund, "tariff_cancel")
    return {"ok": True, "refund": refund, "balance": u.balance}

@app.post("/api/admin/grant_tariff")
async def admin_grant_tariff(data: AdminGrantTariff, db: AsyncSession = Depends(get_db)):
    u = await db.get(User, data.tg_id); t = await db.get(Tariff, data.tariff_id)
    if u and t:
        u.active_fixed_expires = datetime.now() + timedelta(days=t.days)
        u.active_fixed_desc = t.desc; u.active_fixed_devices = t.devices
        await db.commit()
    return {"ok": True}

@app.post("/api/admin/cancel_tariff")
async def admin_cancel_tariff(data: AdminResetCooldown, db: AsyncSession = Depends(get_db)):
    u = await db.get(User, data.tg_id)
    if u:
        u.active_fixed_expires = None
        u.active_fixed_desc = None
        u.active_fixed_devices = None
        await db.commit()
    return {"ok": True}

@app.get("/api/tariffs")
async def get_tariffs(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Tariff))
    return {"ok": True, "tariffs": res.scalars().all()}

@app.post("/api/tariffs")
async def add_tariff(data: TariffCreate, db: AsyncSession = Depends(get_db)):
    db.add(Tariff(price=data.price, desc=data.desc, days=data.days, devices=data.devices, limit_count=data.limit_count))
    await db.commit()
    return {"ok": True}

@app.delete("/api/tariffs/{id}")
async def delete_tariff(id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Tariff).where(Tariff.id == id))
    await db.commit()
    return {"ok": True}

# --- Кулдаун ---
@app.post("/api/admin/reset_cooldown")
async def admin_reset_cooldown(data: AdminResetCooldown, db: AsyncSession = Depends(get_db)):
    u = await db.get(User, data.tg_id)
    if u:
        u.last_spin = None
        await db.commit()
    return {"ok": True}

@app.post("/api/admin/reset_all_cooldowns")
async def reset_all_cooldowns(db: AsyncSession = Depends(get_db)):
    await db.execute(update(User).values(last_spin=None))
    await db.commit()
    return {"ok": True}

# --- Колесо ---
@app.post("/api/wheel/spin")
async def record_spin(data: SpinResult, db: AsyncSession = Depends(get_db)):
    u = await db.get(User, data.tg_id)
    if u:
        u.last_spin = datetime.now()
        if not data.is_other_prize:
            u.balance += data.prize_value
            await add_transaction(db, u.id, data.prize_value, "wheel_win")
            await send_tg_log("LOG_WHEEL_CHAT_ID", f"🎰 <b>Колесо</b>\n\n👤 {u.username}\n💰 {data.prize_label}", "LOG_WHEEL_TOPIC_ID")
        else:
            await send_tg_log("LOG_OTHER_CHAT_ID", f"🎁 <b>Заявка</b>\n\n👤 {u.username}\n🏆 {data.prize_label}\n\n<i>Ручная выдача 48ч.</i>", "LOG_OTHER_TOPIC_ID")
        await db.commit()
    return {"ok": True}

@app.post("/api/wheel/gamble")
async def gamble(data: GambleRequest, db: AsyncSession = Depends(get_db)):
    u = await db.get(User, data.tg_id)
    if u and not data.won_gamble: u.balance -= data.original_win; await db.commit()
    return {"ok": True}

@app.get("/api/wheel_items")
async def get_wheel_items(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(WheelItem).order_by(WheelItem.order))
    return {"ok": True, "items": res.scalars().all()}

@app.post("/api/wheel_items")
async def add_wheel_item(data: WheelItemCreate, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(WheelItem))
    db.add(WheelItem(label=data.label, color=data.color, value=data.value, order=len(res.scalars().all()), prize_type=data.prize_type))
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

# --- Прочее ---
@app.post("/api/create-vpn")
async def create_vpn(req: CreateUserRequest):
    return {"ok": True, "subscription_url": f"vless://TEST-LINK-{req.devices}-DEV@127.0.0.1:443"}

@app.post("/api/support")
async def send_support(req: SupportRequest):
    token = os.getenv("BOT_TOKEN"); chat = os.getenv("SUPPORT_CHAT_ID"); topic = os.getenv("SUPPORT_TOPIC_ID")
    if not token or not chat: return {"ok": False, "error": "Переменные не заданы"}
    text = f"🆘 Обращение\n\n👤 {req.username} (ID: {req.user_id})\n📌 {req.subject}\n\n💬 {req.message}"
    payload = {"chat_id": chat, "text": text}
    if topic and topic.strip():
        try: payload["message_thread_id"] = int(topic)
        except: pass
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    async with aiohttp.ClientSession() as s:
        async with s.post(url, json=payload) as r:
            return {"ok": r.status == 200, "error": await r.text() if r.status != 200 else None}

# --- Промокоды ---
@app.post("/api/promo/activate")
async def activate_promo(data: PromoActivate, db: AsyncSession = Depends(get_db)):
    u = await db.get(User, data.user_id)
    if not u: return {"ok": False, "error": "Пользователь не найден"}
    code_upper = data.code.strip().upper()
    last = await db.execute(select(func.max(UserPromo.used_at)).where(UserPromo.user_id == u.id))
    last_used = last.scalar()
    if last_used:
        diff = (datetime.now() - last_used).total_seconds()
        if diff < 86400:
            hours = int((86400 - diff) / 3600)
            return {"ok": False, "error": f"Следующий промокод через {hours}ч"}
    check = await db.execute(select(UserPromo).where(UserPromo.user_id == u.id, UserPromo.promo_code == code_upper))
    if check.scalars().first(): return {"ok": False, "error": "Вы уже использовали этот промокод"}
    pc = await db.execute(select(PromoCode).where(PromoCode.code == code_upper, PromoCode.is_active == True))
    p = pc.scalars().first()
    if not p: return {"ok": False, "error": "Промокод не найден"}
    if p.usage_limit > 0 and p.used_count >= p.usage_limit:
        return {"ok": False, "error": "Промокод недействителен"}
    expires = None
    if p.valid_days > 0: expires = datetime.now() + timedelta(days=p.valid_days)
    db.add(UserPromo(user_id=u.id, promo_code=code_upper, expires_at=expires))
    if p.balance_bonus > 0:
        u.balance += p.balance_bonus
        await add_transaction(db, u.id, p.balance_bonus, "promo_bonus")
    if p.discount_percent > 0:
        await add_transaction(db, u.id, 0, f"promo_discount_{p.discount_percent}")
    p.used_count += 1
    await db.commit()
    return {"ok": True, "message": "Промокод активирован!"}

@app.get("/api/admin/promos")
async def get_promos(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(PromoCode))
    return {"ok": True, "promos": res.scalars().all()}

@app.post("/api/admin/promos")
async def create_promo(data: PromoCreate, db: AsyncSession = Depends(get_db)):
    code_up = data.code.strip().upper()
    check = await db.execute(select(PromoCode).where(PromoCode.code == code_up))
    if check.scalars().first(): return {"ok": False, "error": "Код уже существует"}
    db.add(PromoCode(code=code_up, discount_percent=data.discount_percent, balance_bonus=data.balance_bonus,
                     usage_limit=data.usage_limit, valid_days=data.valid_days))
    await db.commit()
    return {"ok": True}

@app.delete("/api/admin/promos/{id}")
async def delete_promo(id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(PromoCode).where(PromoCode.id == id))
    await db.commit()
    return {"ok": True}

@app.get("/api/admin/user_promos/{tg_id}")
async def get_user_promos(tg_id: int, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(UserPromo).where(UserPromo.user_id == tg_id))
    return {"ok": True, "user_promos": [
        {"id": up.id, "promo_code": up.promo_code,
         "expires_at": up.expires_at.isoformat() if up.expires_at else None} for up in res.scalars().all()
    ]}

@app.delete("/api/admin/user_promos/{id}")
async def remove_user_promo(id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(UserPromo).where(UserPromo.id == id))
    await db.commit()
    return {"ok": True}

# --- Овнер и админы ---
@app.get("/api/owner/check/{tg_id}")
async def check_owner(tg_id: int):
    return {"ok": True, "is_owner": is_owner(tg_id)}

@app.post("/api/admin/login")
async def admin_login(data: AdminLoginRequest, db: AsyncSession = Depends(get_db)):
    tg_username_clean = data.tg_username.lstrip('@').lower()
    login_clean = data.login.strip()
    password_clean = data.password.strip()
    res = await db.execute(select(Admin).where(
        Admin.tg_username == tg_username_clean,
        Admin.login == login_clean,
        Admin.password == password_clean
    ))
    admin = res.scalars().first()
    if not admin:
        return {"ok": False, "error": "Неверный логин, пароль или username"}
    return {"ok": True, "name": admin.name}

@app.get("/api/admin/list")
async def list_admins(requester_id: int, db: AsyncSession = Depends(get_db)):
    if not is_owner(requester_id): return {"ok": False, "error": "Доступ запрещен"}
    res = await db.execute(select(Admin))
    return {"ok": True, "admins": [
        {"id": a.id, "name": a.name, "tg_username": a.tg_username, "login": a.login, "password": a.password}
        for a in res.scalars().all()
    ]}

@app.post("/api/admin/create")
async def create_admin(data: AdminCreateRequest, db: AsyncSession = Depends(get_db)):
    if not is_owner(data.requester_id): return {"ok": False, "error": "Доступ запрещен"}
    tg_clean = data.tg_username.strip().lstrip('@').lower()
    if not tg_clean or not data.login or not data.password or not data.name:
        return {"ok": False, "error": "Заполните все поля"}
    check = await db.execute(select(Admin).where(Admin.tg_username == tg_clean))
    if check.scalars().first():
        return {"ok": False, "error": "Админ с таким username уже существует"}
    db.add(Admin(name=data.name.strip(), tg_username=tg_clean,
                 login=data.login.strip(), password=data.password.strip()))
    await db.commit()
    return {"ok": True}

@app.delete("/api/admin/{admin_id}")
async def delete_admin(admin_id: int, requester_id: int, db: AsyncSession = Depends(get_db)):
    if not is_owner(requester_id): return {"ok": False, "error": "Доступ запрещен"}
    await db.execute(delete(Admin).where(Admin.id == admin_id))
    await db.commit()
    return {"ok": True}
