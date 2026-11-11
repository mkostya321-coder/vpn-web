import os
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI()

# Отдаём статику (index.html)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

# Модель данных, которую присылает Mini App
class CreateUserRequest(BaseModel):
    telegram_id: int

@app.post("/api/create-vpn")
async def create_vpn(req: CreateUserRequest):
    # ЗАГЛУШКА: Пока нет сервера, мы просто выводим ID в логи Amvera
    print(f"Пришел запрос от пользователя {req.telegram_id}")
    
    # Возвращаем фейковую ссылку, чтобы проверить работу кнопки
    return {
        "ok": True, 
        "subscription_url": "vless://TEST-LINK-NO-SERVER-YET@127.0.0.1:443?type=tcp&security=reality"
    }
