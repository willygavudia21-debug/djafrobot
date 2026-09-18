import { NextRequest, NextResponse } from 'next/server';
export async function POST(req: NextRequest) {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  try {
    const body = await req.json();
    const chatId = body.message?.chat.id;
    if (!chatId) return NextResponse.json({ ok: true });
    const text = body.message.text || ''
    let reply = text === '/start' ? '🎬 WILLY DJ AFRO BOT IPO LIVE! ✅\n\nTuma jina la movie!' : `Umetafuta: ${text}\nBot inafanya kazi!`;
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: reply })
    });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ ok: true }); }
}
export async function GET() { return NextResponse.json({ bot: 'LIVE' }); }
