import { NextRequest, NextResponse } from 'next/server';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

let MOVIES: any[] = [];
let uploadState: any = {}; // { chatId: { videos: [], step: 'uploading' | 'waiting_title' } }

async function tg(method: string, body: any) {
  return fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function mainMenu(balance = 0) {
  return {
    inline_keyboard: [
      [{ text: "🎥 Browse Movies", callback_data: "browse" }, { text: "🔥 Latest 10 Releases", callback_data: "latest" }],
      [{ text: "🔍 Search Movies", callback_data: "search" }],
      [{ text: "🎟️ Purchase Unlimited Access Pass", callback_data: "buy_pass" }],
      [{ text: "💳 Deposit Funds", callback_data: "deposit" }],
      [{ text: `💰 Balance: KSH ${balance}`, callback_data: "balance" }],
      [{ text: "💼 My Purchases", callback_data: "purchases" }, { text: "🛒 View Cart", callback_data: "cart" }],
      [{ text: "🟢 Alerts: ON", callback_data: "alerts" }, { text: "🔄 Reset Account", callback_data: "reset" }],
      [{ text: "📢 Join Channel", url: "https://t.me/djafromovies" }],
      [{ text: "👨‍💼 Contact Admin", url: "https://t.me/willy_gavudia" }],
      [{ text: "🛠️ ADMIN PANEL", callback_data: "admin_panel" }],
    ]
  };
}

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();

    // BUTTONS
    if (update.callback_query) {
      const chatId = update.callback_query.message.chat.id;
      const data = update.callback_query.data;

      if (data === "browse") {
        if (MOVIES.length === 0) {
          await tg('sendMessage', { chat_id: chatId, text: "😔 Bado hakuna movies. Admin bado haja-upload." });
        } else {
          const buttons = MOVIES.slice(0, 20).map((m: any, i: number) => [{ text: `🎬 ${m.title}`, callback_data: `get_${i}` }]);
          await tg('sendMessage', { chat_id: chatId, text: `🎬 <b>Movies (${MOVIES.length}):</b>\nBonyeza kutazama:`, parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
        }
      }
      if (data === "latest") {
        const latest = MOVIES.slice(-10).reverse().map((m: any) => `• ${m.title}`).join('\n') || 'Bado hakuna';
        await tg('sendMessage', { chat_id: chatId, text: `🔥 Latest:\n\n${latest}` });
      }
      if (data.startsWith("get_")) {
        const idx = parseInt(data.split('_')[1]);
        const movie = MOVIES[idx];
        if (movie) {
          await tg('sendVideo', { chat_id: chatId, video: movie.file_id, caption: `🎬 ${movie.title}\n\n@djafromoviebot` });
        }
      }
      if (data === "admin_panel") {
        const isAdmin =!ADMIN_ID || String(chatId) === String(ADMIN_ID);
        if (isAdmin) {
          await tg('sendMessage', { chat_id: chatId, text: "🛠️ ADMIN PANEL\n\n/upload - Anza ku-upload\n/finish - Maliza upload\n\nTuma video kwanza, kisha /finish, kisha jina." });
        } else {
          await tg('sendMessage', { chat_id: chatId, text: "🚫 Wewe sio Admin!" });
        }
      }
      if (data === "buy_pass") {
        await tg('sendMessage', { chat_id: chatId, text: "🎟️ Pass: KSH 10 (2hrs), KSH 40 (24hrs), KSH 99 (7days), KSH 299 (30days)\n\nM-Pesa bado tunaunganisha..." });
      }

      await tg('answerCallbackQuery', { callback_query_id: update.callback_query.id });
      return NextResponse.json({ ok: true });
    }

    const msg = update.message;
    if (!msg) return NextResponse.json({ ok: true });
    const chatId = msg.chat.id;
    const text = msg.text || '';

    // ADMIN COMMANDS
    if (text === '/upload') {
      const isAdmin =!ADMIN_ID || String(chatId) === String(ADMIN_ID);
      if (!isAdmin) {
        await tg('sendMessage', { chat_id: chatId, text: "🚫 Sio admin!" });
        return NextResponse.json({ ok: true });
      }
      uploadState[chatId] = { videos: [], step: 'uploading' };
      await tg('sendMessage', { chat_id: chatId, text: "📤 Sawa! Tuma movie video sasa...\n\nUkimaliza kutuma video zote, andika /finish" });
      return NextResponse.json({ ok: true });
    }

    if (text === '/finish') {
      const state = uploadState[chatId];
      if (!state || state.videos.length === 0) {
        await tg('sendMessage', { chat_id: chatId, text: "❌ Bado hujatuma video yoyote! Tuma video kwanza, kisha /finish" });
        return NextResponse.json({ ok: true });
      }
      uploadState[chatId].step = 'waiting_title';
      await tg('sendMessage', { chat_id: chatId, text: `✅ Nimepokea ${state.videos.length} video!\n\nSasa tuma JINA la movie:\nMf: The Beekeeper 2024 DJ AFRO` });
      return NextResponse.json({ ok: true });
    }

    // RECEIVE VIDEO
    if (msg.video || msg.document) {
      const state = uploadState[chatId];
      if (state && state.step === 'uploading') {
        const fileId = msg.video? msg.video.file_id : msg.document.file_id;
        state.videos.push(fileId);
        await tg('sendMessage', { chat_id: chatId, text: `✅ Video ${state.videos.length} imepokelewa! Tuma nyingine au andika /finish` });
        return NextResponse.json({ ok: true });
      }
    }

    // RECEIVE TITLE AFTER /finish
    const state = uploadState[chatId];
    if (state && state.step === 'waiting_title' && text &&!text.startsWith('/')) {
      const title = text;
      state.videos.forEach((fid: string) => {
        MOVIES.push({ title, file_id: fid, id: Date.now() + Math.random() });
      });
      delete uploadState[chatId];
      await tg('sendMessage', { chat_id: chatId, text: `🎉 SUCCESS! Movie "${title}" ime-save! (${MOVIES.length} total)\n\nSasa watu wakiandika /start -> Browse Movies wataiona!`, reply_markup: mainMenu() });
      return NextResponse.json({ ok: true });
    }

    if (text === '/start') {
      await tg('sendMessage', {
        chat_id: chatId,
        text: `🌟 1. How to Buy Movies/Series Directly\n- Browse the catalog and click on any Title.\n- Choose 'Direct M-Pesa' or choose a 🎟️ Subscription Pass!\n\n🎟️ Pass Plans:\n• PREMIUM HOUR: KSH 10 (2 hours)\n• FREE MOVIE 24HR: KSH 40\n• Weekly: KSH 99\n• Monthly: KSH 299\n\n🎬 Wilmond Ray Bot 🟢 Active\nSelect an option below:`,
        reply_markup: mainMenu(0)
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ ok: true });
  }
}

export async function GET() {
  return NextResponse.json({ movies: MOVIES.length, status: "DJ AFRO - Wilmond Ray Clone Active" });
    }
