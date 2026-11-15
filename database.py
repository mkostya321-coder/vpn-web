import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from datetime import datetime

# Автоматически создаем папку /data при старте, если её нет
if not os.path.exists("/data"):
    os.makedirs("/data")

DATABASE_URL = "sqlite+aiosqlite:////data/vpn_users.db"

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True) # Telegram ID
    username: Mapped[str] = mapped_column(nullable=True)
    nickname: Mapped[str] = mapped_column(default="User")
    balance: Mapped[float] = mapped_column(default=0.0)
    selected_devices: Mapped[int] = mapped_column(default=1)
    daily_price: Mapped[int] = mapped_column(default=6)
    active_fixed_desc: Mapped[str] = mapped_column(nullable=True)
    active_fixed_expires: Mapped[datetime] = mapped_column(nullable=True)
    last_spin: Mapped[datetime] = mapped_column(nullable=True)

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def get_db():
    async with async_session() as session:
        yield session
