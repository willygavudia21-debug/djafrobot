import { NextRequest, NextResponse } from 'next/server';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || ""; // weka ID yako hapa Vercel env

// TEMP DATABASE - baadaye tutaweka DB ya kudumu
let MOVIES: any[] = [];
let UPLOAD_MODE: any = {}; // userId -> {files: []}
let CARTS: any = {};

async function tg(method: string, body: any) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function send(chatId: number, text: string) {
  await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

async function sendPhoto(chatId: number, photo: string, caption: string) {
  await tg('sendPhoto', { chat_id: chatId, photo, caption, parse_mode: 'HTML' });
}

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();
    const msg = update.message;
    if (!msg) return NextResponse.json({ ok: true });

    const chatId = msg.chat.id;
    const text = msg.text || '';
    const isAdmin = String(chatId) === ADMIN_ID || ADMIN_ID === "";

    // HANDLE VIDEO / FILE UPLOAD
    if (isAdmin && (msg.video || msg.document)) {
      if (UPLOAD_MODE[chatId]) {
        const fileId = msg.video?.file_id || msg.document?.file_id;
        UPLOAD_MODE[chatId].files.push({ file_id: fileId, caption: msg.caption || '' });
        await send(chatId, `✅ File ${UPLOAD_MODE[chatId].files.length} imehifadhiwa!\nTuma nyingine au andika /finish kumaliza.`);
        return NextResponse.json({ ok: true });
      }
    }

    // COMMANDS
    if (text === '/start') {
      await send(chatId, `🔥 <b>WILLY DJ AFRO BOT</b> ✅\n\nKaribu! Tuma jina la movie kutafuta.\n\nBonyeza Menu chini kuona commands zote! 👇`);
      return NextResponse.json({ ok: true });
    }

    if (text === '/upload' && isAdmin) {
      UPLOAD_MODE[chatId] = { files: [] };
      await send(chatId, `🎬 <b>UPLOAD MODE ON</b>\n\nTuma movie files sasa (video/document). Ukimaliza andika /finish`);
      return NextResponse.json({ ok: true });
    }

    if (text === '/finish' && isAdmin) {
      if (!UPLOAD_MODE[chatId] || UPLOAD_MODE[chatId].files.length === 0) {
        await send(chatId, `❌ Hujatuma file yoyote! Tuma /upload kwanza.`);
        return NextResponse.json({ ok: true });
      }
      await send(chatId, `Sawa, tuma sasa Title ya movie hii:\nMf: Extraction 2 (2023) DJ AFRO`);
      UPLOAD_MODE[chatId].awaitingTitle = true;
      return NextResponse.json({ ok: true });
    }

    // Admin anatuima title baada ya /finish
    if (isAdmin && UPLOAD_MODE[chatId]?.awaitingTitle && text!== '/finish') {
      const newMovie = {
        id: Date.now(),
        title: text,
        files: UPLOAD_MODE[chatId].files,
        uploader: chatId
      };
      MOVIES.unshift(newMovie);
      delete UPLOAD_MODE[chatId];
      await send(chatId, `✅ <b>${text}</b> imeongezwa na files ${newMovie.files.length}!\nTotal movies: ${MOVIES.length}`);
      return NextResponse.json({ ok: true });
    }

    if (text === '/cart') {
      const cart = CARTS[chatId] || [];
      if (cart.length === 0) await send(chatId, `🛒 Cart yako iko empty.`);
      else await send(chatId, `🛒 Cart yako:\n${cart.map((c:any)=>`• ${c.title}`).join('\n')}`);
      return NextResponse.json({ ok: true });
    }

    if (text === '/balance') {
      await send(chatId, `💰 Balance yako: TZS 0\nWasiliana na Admin kuweka pesa.`);
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith('/resend') && isAdmin) {
      const q = text.replace('/resend','').trim().toLowerCase();
      const m = MOVIES.find(x=>x.title.toLowerCase().includes(q));
      if (!m) { await send(chatId, `Sijapata movie`); return NextResponse.json({ ok: true }); }
      for (let f of m.files) {
        await tg('sendDocument', { chat_id: chatId, document: f.file_id, caption: `🎬 ${m.title}` });
      }
      return NextResponse.json({ ok: true });
    }

    if (text === '/help') {
      await send(chatId, `🆘 <b>HELP</b>\n\n/start - Anza\n/upload - (Admin) Upload movie\n/finish - Maliza upload\n/resend [jina] - Tuma tena movie\n/cart - Angalia cart\n/balance - Angalia balance`);
      return NextResponse.json({ ok: true });
    }

    // SEARCH MOVIE (kwa user wa kawaida)
    if (!text.startsWith('/')) {
      const q = text.toLowerCase();
      const found = MOVIES.filter(m=>m.title.toLowerCase().includes(q));
      if (found.length === 0) {
        await send(chatId, `😔 Sijapata "${text}"\nTuna movies ${MOVIES.length}. Jaribu jina lingine.`);
      } else {
        for (let movie of found.slice(0,3)) {
          for (let f of movie.files.slice(0,2)) {
            await tg('sendDocument', { chat_id: chatId, document: f.file_id, caption: `🎬 <b>${movie.title}</b>\n<i>Powered by DJ AFRO</i>`, parse_mode: 'HTML' });
          }
        }
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: true });
  }
}

export async function GET() {
  return NextResponse.json({ bot: 'DJ AFRO PRO', movies: MOVIES.length });
  }
