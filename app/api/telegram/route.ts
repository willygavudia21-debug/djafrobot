import { NextRequest, NextResponse } from 'next/server';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// MOVIES DATABASE - Ongeza movies zako hapa!
const MOVIES = [
  { title: "Extraction 2 (2023) DJ AFRO", desc: "Action kali ya Chris Hemsworth", link: "https://t.me/+YourChannelLink", year: "2023" },
  { title: "John Wick 4 DJ AFRO", desc: "John Wick anarudi kulipiza kisasi", link: "https://t.me/+YourChannelLink", year: "2023" },
  { title: "Fast X DJ AFRO", desc: "Fast and Furious 10", link: "https://t.me/+YourChannelLink", year: "2023" },
];

async function sendMessage(chatId: number, text: string) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const chatId = body.message?.chat?.id;
    const text = body.message?.text || '';
    if (!chatId) return NextResponse.json({ ok: true });

    if (text === '/start') {
      await sendMessage(chatId, 
`🔥 <b>WILLY DJ AFRO BOT IPO LIVE! ✅</b>

Karibu kwenye Bot ya Movies kali!

<b>Jinsi ya kutumia:</b>
Tuma tu jina la movie, mfano:
<code>Extraction</code>
<code>John Wick</code>
<code>Fast X</code>

Tuna movies ${MOVIES.length} kwa sasa.

Tuma jina sasa! 🎬`);
      return NextResponse.json({ ok: true });
    }

    // Tafuta movie
    const query = text.toLowerCase();
    const found = MOVIES.filter(m => m.title.toLowerCase().includes(query));

    if (found.length === 0) {
      await sendMessage(chatId, `😔 Sijapata "${text}"\n\nMovies zilizopo:\n${MOVIES.map(m=>`• ${m.title}`).join('\n')}\n\nJaribu kutafuta tena.`);
    } else {
      for (const movie of found.slice(0,5)) {
        await sendMessage(chatId, `🎬 <b>${movie.title}</b> (${movie.year})\n\n${movie.desc}\n\n🔗 <b>DOWNLOAD:</b> ${movie.link}\n\n<i>Powered by DJ AFRO Willy</i>`);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: true });
  }
}

export async function GET() {
  return NextResponse.json({ bot: 'DJ AFRO LIVE', movies: MOVIES.length });
                                }
