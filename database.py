import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import text
from datetime import datetime

if not os.path.exists("/data"):
    os.makedirs("/data")

DATABASE_URL = "sqlite+aiosqlite:////data/vpn_users.db"

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(nullable=True)
    nickname: Mapped[str] = mapped_column(default="User")
    balance: Mapped[float] = mapped_column(default=0.0)
    is_blocked: Mapped[bool] = mapped_column(default=False)
    selected_devices: Mapped[int] = mapped_column(default=1)
    daily_price: Mapped[int] = mapped_column(default=6)
    active_fixed_desc: Mapped[str] = mapped_column(nullable=True)
    active_fixed_expires: Mapped[datetime] = mapped_column(nullable=True)
    active_fixed_devices: Mapped[int] = mapped_column(nullable=True)
    last_spin: Mapped[datetime] = mapped_column(nullable=True)

class Tariff(Base):
    __tablename__ = "tariffs"
    id: Mapped[int] = mapped_column(primary_key=True)
    price: Mapped[int]
    desc: Mapped[str]
    days: Mapped[int]
    devices: Mapped[int]
    limit_count: Mapped[int] = mapped_column(default=0)
    sold_count: Mapped[int] = mapped_column(default=0)

class WheelItem(Base):
    __tablename__ = "wheel_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str]
    color: Mapped[str]
    value: Mapped[int]
    order: Mapped[int] = mapped_column(default=0)
    prize_type: Mapped[str] = mapped_column(default="topup") # НОВОЕ: "topup" или "other"

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
        # Миграция для старых баз
        result = await conn.execute(text("PRAGMA table_info(users)"))
        columns = [row[1] for row in result.fetchall()]
        if 'is_blocked' not in columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN is_blocked BOOLEAN DEFAULT 0"))
        if 'active_fixed_devices' not in columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN active_fixed_devices INTEGER"))
            
        result = await conn.execute(text("PRAGMA table_info(tariffs)"))
        columns = [row[1] for row in result.fetchall()]
        if 'limit_count' not in columns:
            await conn.execute(text("ALTER TABLE tariffs ADD COLUMN limit_count INTEGER DEFAULT 0"))
        if 'sold_count' not in columns:
            await conn.execute(text("ALTER TABLE tariffs ADD COLUMN sold_count INTEGER DEFAULT 0"))
            
        result = await conn.execute(text("PRAGMA table_info(wheel_items)"))
        columns = [row[1] for row in result.fetchall()]
        if 'prize_type' not in columns:
            await conn.execute(text("ALTER TABLE wheel_items ADD COLUMN prize_type VARCHAR DEFAULT 'topup'"))
            
        print("Проверка базы данных завершена.")

        from sqlalchemy import select
        async with async_session() as session:
            res = await session.execute(select(Tariff))
            if not res.scalars().first():
                session.add(Tariff(price=350, desc='3 Месяца на 4 устройства', days=90, devices=4, limit_count=10))
                session.add(Tariff(price=500, desc='1 Год на 5 устройств', days=365, devices=5, limit_count=5))
                await session.commit()
                
            res_wheel = await session.execute(select(WheelItem))
            if not res_wheel.scalars().first():
                default_items = [
                    WheelItem(label='186₽', color='#ff3b30', value=186, order=0, prize_type='topup'),
                    WheelItem(label='Lose', color='#555555', value=0, order=1, prize_type='topup'),
                    WheelItem(label='6₽', color='#34c759', value=6, order=2, prize_type='topup'),
                    WheelItem(label='Lose', color='#555555', value=0, order=3, prize_type='topup'),
                    WheelItem(label='10₽', color='#007aff', value=10, order=4, prize_type='topup'),
                    WheelItem(label='Lose', color='#555555', value=0, order=5, prize_type='topup'),
                    WheelItem(label='6₽', color='#34c759', value=6, order=6, prize_type='topup'),
                    WheelItem(label='50₽', color='#ff2d55', value=50, order=7, prize_type='topup'),
                    WheelItem(label='Lose', color='#555555', value=0, order=8, prize_type='topup'),
                    WheelItem(label='6₽', color='#34c759', value=6, order=9, prize_type='topup'),
                    WheelItem(label='10₽', color='#007aff', value=10, order=10, prize_type='topup'),
                    WheelItem(label='Lose', color='#555555', value=0, order=11, prize_type='topup')
                ]
                session.add_all(default_items)
                await session.commit()

async def get_db():
    async with async_session() as session:
        yield session
