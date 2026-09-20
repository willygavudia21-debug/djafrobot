# ADMIN TOGGLES
        if is_admin(uid) and cdata.startswith("toggle_"):
            s = get_settings()
            field = {"toggle_upload":"upload_notif","toggle_loyalty":"loyalty","toggle_watermark":"watermark","toggle_branding":"branding"}[cdata]
            new_val = not s.get(field, False)
            supabase.table("settings").upsert({"id":1, field: new_val}).execute()
            s[field]=new_val
            tg("editMessageReplyMarkup", {"chat_id": chat_id, "message_id": mid, "reply_markup": admin_keyboard(s)})
            tg("answerCallbackQuery", {"callback_query_id": cq["id"], "text": f"{field} is now {'ON' if new_val else 'OFF'}"})
            return "OK",200

        if is_admin(uid):
            if cdata == "adm_counter":
                count = supabase.table("users").select("id", count="exact").execute().count or 0
                tg("answerCallbackQuery", {"callback_query_id": cq["id"], "text": f"Total Users: {count}", "show_alert": True})
            elif cdata == "adm_users":
                users = supabase.table("users").select("*").limit(10).execute().data
                text = "👥 Users (10 latest):\n" + "\n".join([f"{u['user_id']} - {u.get('username','')}" for u in users])
                tg("sendMessage", {"chat_id": chat_id, "text": text})
            elif cdata == "adm_broadcast":
                tg("sendMessage", {"chat_id": chat_id, "text": "Send me the broadcast text now. Reply to this with /broadcast YOUR MESSAGE"})
            elif cdata == "adm_push":
                tg("sendMessage", {"chat_id": chat_id, "text": "Send movie file_id + title to push. Format:\n/push file_id | Title"})
            tg("answerCallbackQuery", {"callback_query_id": cq["id"]})
            return "OK",200

        # USER GET MOVIE
        if cdata.startswith("get_"):
            movie_id = cdata.replace("get_","").split("_")[0]
            res = supabase.table("movies").select("*").eq("movie_id", movie_id).execute().data
            if res: tg("sendVideo", {"chat_id": chat_id, "video": res[0]["file_id"], "caption": f"✳️ {res[0]['title']}\n\nEnjoy! @djafromovies"})
            tg("answerCallbackQuery", {"callback_query_id": cq["id"], "text": "Sending..."})
        return "OK",200

    msg = data.get("message") or data.get("channel_post")
    if not msg: return "OK",200
    chat_id = str(msg["chat"]["id"])
    from_id = msg.get("from", {}).get("id", 0)
    text = msg.get("text","")

    # SAVE USER
    if from_id:
        try: supabase.table("users").upsert({"user_id": from_id, "username": msg.get("from",{}).get("username",""), "joined_at": datetime.datetime.now().isoformat()}).execute()
        except: pass

    # SHOP -> LIBRARY AUTO SYNC
    if chat_id == SHOP_ID and ("video" in msg or "document" in msg):
        file_id = msg["video"]["file_id"] if "video" in msg else msg["document"]["file_id"]
        title = msg.get("caption","Movie").strip()[:200]
        movie_id = str(int(time.time()*1000))
        supabase.table("movies").insert({"movie_id": movie_id, "title": title, "file_id": file_id, "created_at": datetime.datetime.now().isoformat()}).execute()
        s = get_settings()
        footer = "\n\n🎬 @djafromovies" if s.get("branding") else ""
        tg("sendVideo", {"chat_id": LIBRARY_ID, "video": file_id, "caption": f"✳️ DJ AFRO BRAND NEW 🔥\n{title} 👇⬇️{footer}", "reply_markup": {"inline_keyboard": [[{"text": title, "callback_data": f"get_{movie_id}"}], [{"text": "💎 Get All Movies Once", "switch_inline_query": ""}]]}})
        # NOTIFY
        if s.get("upload_notif"):
            users = supabase.table("users").select("user_id").limit(1000).execute().data
            for
