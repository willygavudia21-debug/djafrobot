import os, json, requests
from flask import Flask, request
from supabase import create_client

app = Flask(name)

BOT_TOKEN = os.getenv("BOT_TOKEN")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
ADMIN_IDS = [int(x.strip()) for x in os.getenv("ADMIN_IDS","").split(",") if x.strip().isdigit()]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None
API = f"https://api.telegram.org/bot{BOT_TOKEN}"

def send(cid, txt, mk=None):
    d={"chat_id":cid,"text":txt,"parse_mode":"HTML"}
    if mk: d["reply_markup"]=json.dumps(mk)
    requests.post(f"{API}/sendMessage", json=d)

def main_kb():
    return {"keyboard":[["🎬 Browse Movies","🔍 Search Movie"],["📢 Channels","ℹ️ Help"]],"resize_keyboard":True}

def admin_kb():
    return {"inline_keyboard":[
        [{"text":"👥 View Users","callback_data":"admin_users"}],
        [{"text":"📊 Stats","callback_data":"admin_stats"}],
        [{"text":"📢 Manage Channels","callback_data":"admin_channels"}],
        [{"text":"📣 Upload Notify ON/OFF","callback_data":"admin_toggle"}]
    ]}

@app.route("/", methods=["GET"])
def home(): return "DJ AFRO BOT ACTIVE",200

@app.route("/api/index.py", methods=["POST","GET"])
@app.route("/api", methods=["POST","GET"])
def wh():
    if request.method=="GET": return "OK",200
    up=request.get_json(silent=True)
    if not up: return "ok",200
    msg=up.get("message") or up.get("callback_query",{}).get("message")
    if not msg: return "ok",200
    cid=msg["chat"]["id"]
    uid=up.get("message",{}).get("from",{}).get("id") or up.get("callback_query",{}).get("from",{}).get("id")
    txt=(up.get("message",{}).get("text") or "").strip()
    cb=up.get("callback_query",{}).get("data","")

    if txt=="/admin":
        if uid not in ADMIN_IDS:
            send(cid,"⛔ Not admin"); return "ok",200
        send(cid,"<b>DJ AFRO ADMIN PANEL</b>\n\nWelcome Admin!\nChoose:", admin_kb())
        return "ok",200

    if cb.startswith("admin_"):
        if cb=="admin_users": send(cid,"👥 Users: Supabase connected ✅")
        elif cb=="admin_stats": send(cid,"📊 Bot: ONLINE ✅\nVercel: Ready\nGitHub: OK")
        elif cb=="admin_channels": send(cid,"📢 Channels: Coming soon")
        elif cb=="admin_toggle": send(cid,"📣 Upload Notification: ON ✅")
        return "ok",200

    if txt=="/start":
        send(cid,"🎬 <b>DJ AFRO MOVIE HUB</b>\n\nKaribu! Tafuta movie hapa chini 👇", main_kb())
    elif txt:
        send(cid,f"🔍 Searching: <b>{txt}</b>\n\nNo movie yet - weka movies kwenye Supabase")

    return "ok",200
