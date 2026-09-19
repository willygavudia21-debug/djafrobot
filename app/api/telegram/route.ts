import { NextRequest, NextResponse } from 'next/server';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let MOVIES: any[] = []; // tutaweka DB baadaye

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
      [{ text: "📢 Join Channel", url: "https://t.me/yourchannel" }],
      [{ text: "👨‍💼 Contact Admin", url: "https://t.me/youradmin" }],
      [{ text: "🛠️ ADMIN PANEL", callback_data: "admin_panel" }],
    ]
  };
}

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();

    // HANDLE BUTTON CLICKS
    if (update.callback_query) {
      const chatId = update.callback_query.message.chat.id;
      const data = update.callback_query.data;

      if (data === "browse") {
        await tg('sendMessage', { chat_id: chatId, text: `🎬 <b>Browse Movies (${MOVIES.length})</b>\n\nTuma jina kutafuta.`, parse_mode: 'HTML' });
      }
      if (data === "latest") {
        const latest = MOVIES.slice(0, 10).map(m=>`• ${m.title}`).join('\n') || 'Bado hakuna movies';
        await tg('sendMessage', { chat_id: chatId, text: `🔥 <b>Latest 10 Releases:</b>\n\n${latest}`, parse_mode: 'HTML' });
      }
      if (data === "search") {
        await tg('sendMessage', { chat_id: chatId, text: `🔍 Tuma jina la movie kutafuta...` });
      }
      if (data === "buy_pass") {
        await tg('sendMessage', { 
          chat_id: chatId, 
          text: `🎟️ <b>Unlimited Access Pass Plans:</b>\n\n🔹 PREMIUM HOUR: KSH 10 (2 hours)\n🔹 FREE MOVIE 24HR: KSH 40 (24 hours)\n🔹 Weekly Pass: KSH 99 (7 days)\n🔹 Monthly Pass: KSH 299 (30 days)\n\nBonyeza kulipia:`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: "Pay KSH 10", callback_data: "pay_10" }, { text: "Pay KSH 40", callback_data: "pay_40" }]] }
        });
      }
      if (data === "admin_panel") {
        await tg('sendMessage', { 
          chat_id: chatId, 
          text: `🛠️ <b>ADMIN PANEL</b>\n\n/upload - Upload movie\n/finish - Maliza`,
          parse_mode: 'HTML' 
        });
      }
      await tg('answerCallbackQuery', { callback_query_id: update.callback_query.id });
      return NextResponse.json({ ok: true });
    }

    const msg = update.message;
    if (!msg) return NextResponse.json({ ok: true });
    const chatId = msg.chat.id;
    const text = msg.text || '';

    if (text === '/start') {
      await tg('sendMessage', {
        chat_id: chatId,
        text: `🌟 1. <b>How to Buy Movies/Series Directly</b>\n- Browse the catalog and click on any Title.\n- Choose 'Direct M-Pesa' or choose a 🎟️ Subscription Pass to unlock unlimited viewing streams immediately!\n\n🎟️ <b>Unlimited Access Pass Plans Configured:</b>\n• PREMIUM HOUR: KSH 10 (2 hours)\n• FREE MOVIE FOR 24 HR: KSH 40 (24 hours)\n• Weekly Pass: KSH 99 (7 days)\n• Monthly Pass: KSH 299 (30 days)\n\n⚠️ Note: All streams delivered via subscription passes have forwarding disabled.\n\n🎬 Wilmond Ray Bot 🟢 Active\nSelect an option below:`,
        parse_mode: 'HTML',
        reply_markup: mainMenu(0)
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: true });
  }
}

export async function GET() {
  return NextResponse.json({ bot: 'DJ AFRO - Wilmond Ray Clone', movies: MOVIES.length });
}
