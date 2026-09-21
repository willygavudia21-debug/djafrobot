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
        top10_ids = _get_top10_ids()
    return movie.get("movie_id") in top10_ids

def get_movie_title_with_icon(movie, top10_ids=None):
    """Appends the fire icon permanently if it sits inside the top 10 latest entries."""
    if is_movie_in_top10(movie, top10_ids=top10_ids):
        return f"🔥 {movie['title']}"
    return movie['title']

def sync_check_and_clean_expired_user(uid):
    user = get_user(uid)
    sub_expires_at = user.get("sub_expires_at")
    if sub_expires_at and user.get("sub_tier", "free") != "free":
        try:
            expiry_dt = datetime.datetime.fromisoformat(sub_expires_at.replace("Z", "+00:00"))
            if expiry_dt <= datetime.datetime.now(KENYAN_TZ):
                msg_ids = user.get("sent_movie_msg_ids", [])
                for msg_id in msg_ids:
                    try:
                        requests.post(f"https://api.telegram.org/bot{TOKEN}/deleteMessage", json={"chat_id": uid, "message_id": msg_id})
                    except: pass
                user["sub_tier"] = "free"
                user["sub_expires_at"] = None
                user["sent_movie_msg_ids"] = []
                save_user(uid, user)
                try:
                    requests.post(f"https://api.telegram.org/bot{TOKEN}/sendMessage", json={
                        "chat_id": uid, "text": "⚠️ **Your active viewing subscription pass has expired.** Access to temporary movie streams has been deleted from chat windows.", "parse_mode": "Markdown"
                    })
                except: pass
        except Exception as e:
            print(f"Auto-cleanup processing failure: {e}")

# ---------------- AUTOMATED CHANNEL ENGAGEMENT MATRIX ENGINE ----------------
async def send_latest_10_grid_to_channels(context_title="NEW COMPLETION RELEASE"):
    """Pushes a clean text block containing exactly the current top 10 movies into your channels."""
    latest_10 = get_movies(limit=10, order_by_recent=True)
    if not latest_10: return

    top10_ids = {m["movie_id"] for m in latest_10}
    text = f"🍿 **DJ E MOVIES — LATEST RELEASES ({context_title})** 🍿\n\nTap on any movie below to watch or stream instantly inside the bot configuration!"
    kb = []
    current_row = []

    for movie in latest_10:
        m_id = movie['movie_id']
        title_with_icon = get_movie_title_with_icon(movie, top10_ids=top10_ids)
        bot_deep_link = f"https://t.me/{BOT_USERNAME}?start={m_id}"
        button = InlineKeyboardButton(text=title_with_icon, url=bot_deep_link)
        current_row.append(button)
        if len(current_row) == 2:
            kb.append(current_row)
            current_row = []
    if current_row:
        kb.append(current_row)

    reply_markup = InlineKeyboardMarkup(kb)

    for channel in CHANNEL_CHAT_IDS:
        try:
            await application.bot.send_message(chat_id=channel, text=text, reply_markup=reply_markup, parse_mode="Markdown")
            await asyncio.sleep(0.4)
        except Exception as e:
            print(f"Failed broadcasting 10-grid matrix stack update to channel {channel}: {e}")

async def post_catalog_to_channel(movies_list, context_title="INDEX"):
    """Pushes an explicit segmented chunk list directly as an index button matrix into registered channels."""
    if not movies_list: return

    top10_ids = _get_top10_ids()
    text = f"🚨 **WILLY GAVUDIA MOVIE SHOP 🚨 ({context_title})** \n\nTap on any button title line row sequence below to launch configuration inside the bot:"
    kb = []
    current_row = []

    for movie in movies_list:
        m_id = movie['movie_id']
        title_with_icon = get_movie_title_with_icon(movie, top10_ids=top10_ids)
        bot_deep_link = f"https://t.me/{BOT_USERNAME}?start={m_id}"
        button = InlineKeyboardButton(text=title_with_icon, url=bot_deep_link)
        current_row.append(button)
        if len(current_row) == 2:
            kb.append(current_row)
            current_row = []
    if current_row:
        kb.append(current_row)

    reply_markup = InlineKeyboardMarkup(kb)

    for channel in CHANNEL_CHAT_IDS:
        try:
            await application.bot.send_message(chat_id=channel, text=text, reply_markup=reply_markup, parse_mode="Markdown")
            await asyncio.sleep(0.4)
        except Exception as e:
            print(f"Failed broadcasting index grid row selection to channel {channel}: {e}")

# ---------------- KEYBOARDS & UI ----------------
def main_menu_keyboard(uid):
    user = get_user(uid)
    bal_btn = f"💰 Balance: KSH {user.get('balance', 0)}"
    notif_status = "🟢 Alerts: ON" if user.get("notifications", True) else "🔴 Alerts: OFF"

    if is_user_subscribed(user):
        plans = get_sub_plans()
        matching_plan = next((p for p in plans if p["id"] == user.get("sub_tier")), None)
        tier_label = matching_plan["title"] if matching_plan else user.get("sub_tier").upper()
        sub_btn_text = f"⭐ Pass Status: Active ({tier_label})"
    else:
        sub_btn_text = "🎟️ Purchase Unlimited Access Pass"

    kb = [
        [InlineKeyboardButton("🎥 Browse Movies", callback_data="browse_0"), InlineKeyboardButton("🔥 Latest 10 Releases", callback_data="view_latest_10_text")],
        [InlineKeyboardButton("🔍 Search Movies", callback_data="trigger_chat_search")],
        [InlineKeyboardButton(sub_btn_text, callback_data="open_subscription_menu")],
        [InlineKeyboardButton("💳 Deposit Funds", callback_data="deposit")],
        [InlineKeyboardButton(bal_btn, callback_data="bal")],
        [InlineKeyboardButton("💼 My Purchases", callback_data="myp"), InlineKeyboardButton("🛒 View Cart", callback_data="view_cart")],
        [InlineKeyboardButton(notif_status, callback_data="toggle_notifications"), InlineKeyboardButton("🔄 Reset Account", callback_data="req_reset")],
        [InlineKeyboardButton("📢 Join Channel", url="https://t.me/+Hp3SR7UuRqA0YTM0")],
        [InlineKeyboardButton("👨‍💻 Contact Admin", url="https://t.me/willygavudia")],
    ]
    if int(uid) in ADMIN_IDS:
        kb.append([InlineKeyboardButton("🛠 ADMIN PANEL", callback_data="admin_panel")])
    return InlineKeyboardMarkup(kb)

def get_subscription_menu_keyboard():
    plans = get_sub_plans()
    kb = []
    for p in plans:
        kb.append([InlineKeyboardButton(f"⚡ {p['title']} — KSH {p['price']}", callback_data=f"buy_sub_{p['id']}")])
    kb.append([InlineKeyboardButton("🔙 Back to Main Menu", callback_data="menu")])
    return InlineKeyboardMarkup(kb)

def get_movie_detail_keyboard(movie, user_bal, uid, has_sub=False):
    m_id = movie['movie_id']
    price = movie.get("price", 10)
    title_encoded = requests.utils.quote(movie['title'])
    share_url = f"https://t.me/share/url?url=https://t.me/{BOT_USERNAME}?start={m_id}&text=🎬%20Watch%20{title_encoded}%20now!"

    kb = []
    if has_sub:
        kb.append([InlineKeyboardButton("🍿 Stream Immediately (Subscription Pass Active)", callback_data=f"stream_sub_{m_id}")])
    else:
        kb.append([InlineKeyboardButton(f"💳 Pay Direct via M-Pesa (KSH {price})", callback_data=f"pay_mpesa_{m_id}")])
        kb.append([InlineKeyboardButton(f"👛 Pay with Wallet (Bal: KSH {user_bal})", callback_data=f"buy_{m_id}")])
        kb.append([InlineKeyboardButton("🛒 Add to Cart", callback_data=f"cart_add_{m_id}")])

    kb.append([InlineKeyboardButton("🔗 Share Movie with Friends", url=share_url)])
    kb.append([InlineKeyboardButton("🛒 See All Movies in Cart", callback_data="view_cart")])

    if int(uid) in ADMIN_IDS:
        kb.append([
            InlineKeyboardButton("📝 Edit Name", callback_data=f"adm_editname_{m_id}"),
            InlineKeyboardButton("💰 Edit Price", callback_data=f"adm_editprice_{m_id}"),
            InlineKeyboardButton("❌ Delete Movie", callback_data=f"adm_delmovie_{m_id}")
        ])
    kb.append([InlineKeyboardButton("🔙 Back to Catalog", callback_data="browse_0")])
    return InlineKeyboardMarkup(kb)

def get_direct_delivery_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("💼 My Purchases", callback_data="myp")],
        [InlineKeyboardButton("🎥 Browse More Movies", callback_data="browse_0")]
    ])

# ---------------- MOVIE CARD PIPELINE ----------------
async def show_single_movie_card(chat_id, movie_id):
    sync_check_and_clean_expired_user(chat_id)
    movie = get_single_movie(movie_id)
    if not movie:
        await application.bot.send_message(chat_id=chat_id, text="⚠️ Movie details could not be found.")
        return

    user = get_user(chat_id)
    price = movie.get("price", 10)
    bal = user.get("balance", 0)
    has_sub = is_user_subscribed(user)

    caption_text = (
        f"🎬 <b>{get_movie_title_with_icon(movie)}</b>\n\n"
        f"💰 <b>Single Price:</b> KSH {price}\n"
        f"👛 <b>Wallet Balance:</b> KSH {bal}\n"
        f"🎟️ <b>Subscription Pass:</b> {'ACTIVE 🟢' if has_sub else 'INACTIVE 🔴'}\n\n"
        f"🔗 <b>Click to stream:</b> <a href=\"https://t.me/{BOT_USERNAME}?start={movie['movie_id']}\">{movie['title']}</a>"
    )
    reply_markup = get_movie_detail_keyboard(movie, bal, chat_id, has_sub=has_sub)

    try:
        if movie.get("animation_id"):
            await application.bot.send_animation(chat_id=chat_id, animation=movie["animation_id"], caption=caption_text, reply_markup=reply_markup, parse_mode="HTML")
        elif movie.get("photo_id"):
            await application.bot.send_photo(chat_id=chat_id, photo=movie["photo_id"], caption=caption_text, reply_markup=reply_markup, parse_mode="HTML")
        else:
            await application.bot.send_message(chat_id=chat_id, text=caption_text, reply_markup=reply_markup, parse_mode="HTML")
    except Exception as e:
        await application.bot.send_message(chat_id=chat_id, text=caption_text, reply_markup=reply_markup, parse_mode="HTML")

# ---------------- INTERFACE ROUTER ----------------
async def start_handler(update: Update):
    uid = str(update.effective_user.id)
    sync_check_and_clean_expired_user(uid)
    user = get_user(uid)

    if not (int(uid) in ADMIN_IDS and str(user.get("state", "")).startswith("PICKQUEUE:")):
        user["state"] = None

    user["admin_action"] = None
    save_user(uid, user)

    msg_text = update.effective_message.text or ""
    args = msg_text.replace("/start", "").strip()

    if args:
        if args == "sub":
            user["state"] = None
            save_user(uid, user)
            await application.bot.send_message(chat_id=uid, text="🎟️ **Choose an Unlimited Streaming Pass:**", reply_markup=get_subscription_menu_keyboard(), parse_mode="Markdown")
            return
        await show_single_movie_card(uid, args)
        return

    instructions = (
        "🌟 **1. How to Buy Movies/Series Directly**\n"
        "▪️ Browse the catalog and click on any Title.\n"
        "▪️ Choose 'Direct M-Pesa' or choose a **🎟️ Subscription Pass** to unlock unlimited viewing streams immediately!\n\n"
        "🎟️ **Unlimited Access Pass Plans Configured:**\n"
    )
    plans = get_sub_plans()
    for p in plans:
        instructions += f"• {p['title']}: KSH {p['price']} ({p['duration_value']} {p['duration_unit']})\n"

    instructions += (
        "\n⚠️ *Note: All streams delivered via subscription passes have forwarding disabled and automatically wipe from conversation chats upon expiration pass milestones.*\n\n"
        "🎬 **Wilmond Ray Bot 🟢 Active**\nSelect an option below:"
    )
    await update.effective_message.reply_text(instructions, reply_markup=main_menu_keyboard(uid), parse_mode="Markdown")

async def callback_router(update: Update):
    q = update.callback_query
    try: await q.answer()
    except: pass

    uid = str(q.from_user.id)
    sync_check_and_clean_expired_user(uid)
    user = get_user(uid)
    data = str(q.data or "").strip()

    if data == "menu":
        try: await q.message.delete()
        except: pass
        user["admin_action"] = None
        user["state"] = None
        save_user(uid, user)
        await application.bot.send_message(chat_id=uid, text="🎬 **Wilmond Ray Bot 🟢 Active**\nSelect an option below:", reply_markup=main_menu_keyboard(uid), parse_mode="Markdown")
        return

    elif data == "view_latest_10_text":
        try: await q.message.delete()
        except: pass
        recent_movies = get_movies(limit=10, order_by_recent=True)
        if not recent_movies:
            await application.bot.send_message(chat_id=uid, text="⚠️ No movies found in the database.", reply_markup=main_menu_keyboard(uid))
            return

        top10_ids = {m["movie_id"] for m in recent_movies}
        kb = []
        for m in recent_movies:
            kb.append([InlineKeyboardButton(f"{get_movie_title_with_icon(m, top10_ids=top10_ids)}", callback_data=f"view_movie_{m['movie_id']}")])
        kb.append([InlineKeyboardButton("🔙 Back to Main Menu", callback_data="menu")])

        await application.bot.send_message(
            chat_id=uid,
            text="🔥 **Latest 10 Premium Releases:**\n*(The system auto-shifts items dynamically; top 10 persistently retain fire icons)*",
            reply_markup=InlineKeyboardMarkup(kb),
            parse_mode="Markdown"
        )
        return

    elif data == "open_subscription_menu":
        try: await q.message.delete()
        except: pass
        await application.bot.send_message(
            chat_id=uid,
            text="🎟️ **Choose an Unlimited Streaming Pass:**\n\nUnlock the full library instantly. Content streaming access lasts exactly for the duration chosen.",
            reply_markup=get_subscription_menu_keyboard(),
            parse_mode="Markdown"
        )
        return

    elif data.startswith("buy_sub_"):
        tier = data.replace("buy_sub_", "").strip()
        plans = get_sub_plans()
        plan = next((p for p in plans if p["id"] == tier), None)
        if not plan: return

        amt = plan["price"]
        user["admin_action"] = None
        user["temp_amt"] = amt
        user["state"] = f"wait_phone_sub_{tier}"
        save_user(uid, user)
        await application.bot.send_message(chat_id=uid, text=f"📱 **M-Pesa Subscription Checkout**\nPass Tier: {plan['title']}\nAmount: KSH {amt}\n\nEnter your Safaricom M-Pesa Phone Number below:")
        return

    elif data.startswith("stream_sub_"):
        m_id = data.replace("stream_sub_", "").strip()
        if not is_user_subscribed(user):
            await application.bot.send_message(chat_id=uid, text="⚠️ Your subscription has expired. Please buy a new pass.", reply_markup=main_menu_keyboard(uid))
            return

 
