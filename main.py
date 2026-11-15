import os
import aiohttp
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

class CreateUserRequest(BaseModel):
    telegram_id: int
    devices: int = 1

class SupportRequest(BaseModel):
    user_id: int
    username: str
    subject: str
    message: str

@app.post("/api/create-vpn")
async def create_vpn(req: CreateUserRequest):
    return {"ok": True, "subscription_url": f"vless://TEST-LINK-FOR-{req.devices}-DEVICES@127.0.0.1:443"}

@app.post("/api/support")
async def send_support(req: SupportRequest):
    BOT_TOKEN = os.getenv("BOT_TOKEN")
    CHAT_ID = os.getenv("SUPPORT_CHAT_ID")
    TOPIC_ID = os.getenv("SUPPORT_TOPIC_ID")
    
    if not BOT_TOKEN:
        return {"ok": False, "error": "В Amvera не задана переменная BOT_TOKEN!"}
    if not CHAT_ID:
        return {"ok": False, "error": "В Amvera не задана переменная SUPPORT_CHAT_ID!"}

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
