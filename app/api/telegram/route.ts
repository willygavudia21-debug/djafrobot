Skip to content
movie-hub-rush-254
Repository navigation
Code
Issues
Pull requests
Actions
movie-hub-rush-254/api
/index.py
willygavudia21-debug
willygavudia21-debug
last month
1505 lines (1312 loc) · 74.3 KB

Code

Blame
def get_user(uid):
import os
import re
import json
import time
import datetime
from datetime import timezone, timedelta
import requests
import asyncio
from flask import Flask, request, jsonify
from supabase import create_client, Client
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ApplicationBuilder

app = Flask(__name__)

# ---------------- CONFIGURATION ----------------
TOKEN = os.getenv("BOT_TOKEN")
ADMIN_IDS = [int(x.strip()) for x in os.getenv("ADMIN_IDS", "").split(",") if x.strip()]
PAYHERO_API_URL = 'https://backend.payhero.co.ke/api/v2/payments'

APP_DOMAIN = "movie-hub-rush-254.vercel.app"
BOT_USERNAME = os.getenv("BOT_USERNAME", "wilmondraybot")

# Multi-channel distribution lists
CHANNEL_CHAT_IDS = ["-1003792785348", "-1003555307389", "-1003946877467", "-1003598819604",]

# Supabase Client Init
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Initialize Telegram App
application = ApplicationBuilder().token(TOKEN).build()

# Kenyan Time Zone (EAT = UTC+3)
KENYAN_TZ = timezone(timedelta(hours=3))

# ---------------- RELATIONAL DATABASE HELPERS ----------------
def get_user(uid):
    try:
        res = supabase.table("users").select("*").eq("id", str(uid)).execute()
        if not res.data:
            default_row = {
                "id": str(uid), "balance": 0, "purchases": [], "cart": [],
                "state": None, "temp_amt": None, "admin_action": None, "admin_target": None,
                "notifications": True, "sub_tier": "free", "sub_expires_at": None, "sent_movie_msg_ids": []
            }
            supabase.table("users").insert(default_row).execute()
            return default_row
        return res.data[0]
    except Exception as e:
        print(f"Supabase Get User Error: {e}")
        return {"balance": 0, "purchases": [], "cart": [], "state": None, "sub_tier": "free", "sub_expires_at": None, "sent_movie_msg_ids": []}

def save_user(uid, user_dict):
    try:
        user_dict["id"] = str(uid)
        supabase.table("users").upsert(user_dict).execute()
    except Exception as e:
        print(f"Supabase Save User Error: {e}")

def get_sub_plans():
    try:
        res = supabase.table("subscription_plans").select("*").execute()
        return res.data if res.data else []
    except Exception as e:
        print(f"Fetch plans failure: {e}")
        return []

def get_movies(limit=None, offset=None, order_by_recent=True):
    """Fetches movies reliably. Uses a single order column to prevent empty composite index errors.
    NOTE: Supabase's Python client (postgrest-py) has no .offset() method -- pagination must use
    .range(start, end) instead. Using limit()+offset() together previously raised AttributeError."""
    try:
        query = supabase.table("movies").select("*")
        if order_by_recent:
            query = query.order("created_at", desc=True)
        else:
            query = query.order("title", desc=False)

        if limit is not None and offset is not None:
            query = query.range(offset, offset + limit - 1)
        elif limit is not None:
            query = query.limit(limit)

        res = query.execute()
        if res and hasattr(res, 'data') and isinstance(res.data, list):
            return res.data
        return []
    except Exception as e:
        print(f"CRITICAL Supabase Fetch Movies Error: {e}")
        return []

def get_all_movies():
    """Returns entire inventory ordered Newest to Oldest for browsing feeds without truncation limits."""
    return get_movies(limit=1000, order_by_recent=True)

def get_single_movie(movie_id):
    try:
        res = supabase.table("movies").select("*").eq("movie_id", str(movie_id)).execute()
        return res.data[0] if res.data else None
    except Exception as e:
        print(f"Supabase Fetch Single Movie Error: {e}")
        return None

def format_phone(phone):
    phone = re.sub(r"[^0-9]", "", phone)
    if (phone.startswith("07") or phone.startswith("01")) and len(phone) == 10:
        return "254" + phone[1:]
    return phone if len(phone) == 12 and phone.startswith("254") else None

def is_user_subscribed(user):
    sub_expires_at = user.get("sub_expires_at")
    if not sub_expires_at or user.get("sub_tier", "free") == "free":
        return False
    try:
        expiry_dt = datetime.datetime.fromisoformat(sub_expires_at.replace("Z", "+00:00"))
        return expiry_dt > datetime.datetime.now(KENYAN_TZ)
    except Exception as e:
        print(f"Expiry check fail: {e}")
        return False

def calculate_expiry(val, unit):
    now_kenya = datetime.datetime.now(KENYAN_TZ)
    if unit == "minutes": return now_kenya + datetime.timedelta(minutes=val)
    elif unit == "days": return now_kenya + datetime.timedelta(days=val)
    else: return now_kenya + datetime.timedelta(hours=val)

def _get_top10_ids():
    """Fetches the top-10 latest movie IDs once, so callers can check membership without
    re-querying Supabase for every single movie rendered on a page."""
    top_10 = get_movies(limit=10, order_by_recent=True)
    return {m["movie_id"] for m in top_10}

def is_movie_in_top10(movie, top10_ids=None):
    """Checks if the movie falls inside the latest 10 premium entries.
    Pass top10_ids (a set) when checking many movies in a loop to avoid N+1 queries."""
    if top10_ids is None:
@app.route("/", methods=["GET", "POST"])
@app.route("/api", methods=["GET", "POST"])
def telegram_webhook():
    if request.method == "GET": return "Operational", 200
    update_data = request.get_json(force=True)
    if "inline_query" in update_data:
        sync_inline_search_handler(update_data["inline_query"])
        return "OK", 200
    async def process():
        async with application:
            update = Update.de_json(update_data, application.bot)
            if update.message:
                if update.message.text and update.message.text.startswith("/start"): await start_handler(update)
                else: await text_handler(update)
            elif update.callback_query: await callback_router(update)
    try: asyncio.run(process())
    except Exception as e: print(f"Trace error: {e}")
    return "OK", 200

# ---------------- PAYHERO CALL TRANSACTION RESOLUTION ----------------
@app.route("/payhero-callback", methods=["POST"])
@app.route("/api/payhero-callback", methods=["POST"])
def payhero_callback():
    payload = request.get_json(force=True)
    d = payload.get("response", payload.get("data", payload))
    status = str(d.get("Status", d.get("status", d.get("success", "")))).lower()
    ref = d.get("ExternalReference", d.get("external_reference", ""))

    if any(k in ref for k in ["_TOPUP_", "_CART_", "_DIRECT_", "_SUB_"]):
        if "_DIRECT_" in ref: prefix, _, rem = ref.partition("_DIRECT_"); uid = prefix; m_id = rem.rsplit("_", 1)[0]
        elif "_SUB_" in ref: prefix, _, rem = ref.partition("_SUB_"); uid = prefix; tier_type = rem.rsplit("_", 1)[0]
        elif "_CART_" in ref: prefix, _, _ = ref.partition("_CART_"); uid = prefix; m_id = None
        else: prefix, _, _ = ref.partition("_TOPUP_"); uid = prefix; m_id = None

        u = get_user(uid)
        if status in ["success", "successful", "completed", "true"] or d.get("success") is True:
            if "_DIRECT_" in ref:
                movie = get_single_movie(m_id)
                if movie:
                    if movie["movie_id"] not in u["purchases"]: u["purchases"].append(movie["movie_id"])
                    save_user(uid, u)
                    requests.post(f"https://api.telegram.org/bot{TOKEN}/sendVideo", json={
                        "chat_id": uid, "video": movie["file_id"], "caption": f"🎬 **{movie['title']}**\n\n🍿 Confirmed!",
                        "reply_markup": get_direct_delivery_keyboard().to_dict(), "parse_mode": "Markdown"
                    })
            elif "_SUB_" in ref:
                plans = get_sub_plans()
                plan = next((p for p in plans if p["id"] == tier_type), None)
                val = plan["duration_value"] if plan else 1
                unit = plan["duration_unit"] if plan else "hours"

                expiry = calculate_expiry(val, unit)
                u["sub_tier"] = tier_type
                u["sub_expires_at"] = expiry.isoformat()
                u["sent_movie_msg_ids"] = []
                save_user(uid, u)

                enjoy_msg = f"🎉 **Subscription Activated!**\n\nEnjoy all movies inside here. Subscription valid for exactly {val} {unit}."
                requests.post(f"https://api.telegram.org/bot{TOKEN}/sendMessage", json={"chat_id": uid, "text": enjoy_msg, "reply_markup": main_menu_keyboard(uid).to_dict(), "parse_mode": "Markdown"})
            elif "_CART_" in ref:
                all_movies = get_all_movies()
                for title in u.get("cart", []):
                    movie = next((m for m in all_movies if m["title"] == title), None)
                    if movie and movie["movie_id"] not in u["purchases"]: u["purchases"].append(movie["movie_id"])
                u["cart"] = []; save_user(uid, u)
                requests.post(f"https://api.telegram.org/bot{TOKEN}/sendMessage", json={"chat_id": uid, "text": "✅ **Cart Complete.**"})
            else:
                u["balance"] += int(float(d.get("Amount", d.get("amount", 0))))
                save_user(uid, u)
                requests.post(f"https://api.telegram.org/bot{TOKEN}/sendMessage", json={"chat_id": uid, "text": "✅ **Wallet Funded.**", "reply_markup": main_menu_keyboard(uid).to_dict(), "parse_mode": "Markdown"})
        else:
            requests.post(f"https://api.telegram.org/bot{TOKEN}/sendMessage", json={"chat_id": uid, "text": "❌ **Payment Failed.**", "reply_markup": main_menu_keyboard(uid).to_dict(), "parse_mode": "Markdown"})

    return "OK", 200
 
