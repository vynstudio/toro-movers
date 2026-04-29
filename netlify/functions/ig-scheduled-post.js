// Scheduled IG poster — fires daily at 22:00 UTC (6 PM ET, EDT).
// Looks up today's date in the POSTS schedule below; if a match exists,
// publishes the matching image+caption to the Toro IG Business account.
//
// IG Graph API has no native scheduling — we keep a static schedule here
// and let Netlify's cron drive the timing.
//
// Manual trigger (back-fill / immediate post):
//   GET /.netlify/functions/ig-scheduled-post?pw=<CRM_PASSWORD>&day=2026-04-27
//   GET /.netlify/functions/ig-scheduled-post?pw=<CRM_PASSWORD>&force=post-1
//
// Env required: META_ACCESS_TOKEN (system user), TELEGRAM_BOT_TOKEN +
// TELEGRAM_CHAT_ID (optional ping on success/failure).

const TOKEN = process.env.META_ACCESS_TOKEN;
const IG_USER_ID = '17841470412443785'; // @toromovers
const BASE_IMG = 'https://toromovers.net/assets/img/ig';

// IG schedule — must mirror the FB schedule:
//   FB: post-1 live now (Apr 27), then post-2..5 scheduled Apr 29 → May 2 at 6pm ET.
const POSTS = [
  { date: '2026-04-29', image: 'post-2.png', caption:
`The same crew that loads your living room is the one that puts your bed back together. 🛏️

That's the Toro difference — one team, start to finish. Local, long-distance, or storage moves.

📅 Book online: https://toromovers.net/book
📞 Or call us: (689) 600-2720` },

  { date: '2026-04-30', image: 'post-3.png', caption:
`Furniture wrapped. Floors protected. Boxes where you want them. 📦

Loading, unloading, packing, unpacking — Toro does it all at $75/mover/hour. Family-owned in Central Florida.

📅 Book online: https://toromovers.net/book
📞 Or call us: (689) 600-2720` },

  { date: '2026-05-01', image: 'post-4.png', caption:
`Two movers. Two-hour minimum. Zero hidden fees. ✅

Serving Orlando, Kissimmee, Sanford, Lake Mary, Apopka, Winter Park, Clermont, and all of Central Florida.

📅 Book online: https://toromovers.net/book
📞 Or call us: (689) 600-2720` },

  { date: '2026-05-02', image: 'post-5.png', caption:
`Weekend move coming up? Lock in your slot. 🐂

The whole Toro family is ready to help — fast, careful, and on time. Same-week availability across Central Florida.

📅 Book online: https://toromovers.net/book
📞 Or call us: (689) 600-2720` },
];

// Day-1 caption is kept here so the manual trigger can publish it for Apr 27.
const POST_1 = {
  date: '2026-04-27',
  image: 'post-1.png',
  caption:
`Moving day shouldn't feel like moving mountains. 💪

Toro Movers — family-owned and built for Central Florida.
$75/mover/hr · 2-hour minimum · No surprise fees.

📅 Book online: https://toromovers.net/book
📞 Or call us: (689) 600-2720`,
};
const ALL_POSTS = [POST_1, ...POSTS];

const GRAPH = 'https://graph.facebook.com/v19.0';

async function waitForContainerReady(containerId, { maxMs = 60000, intervalMs = 3000 } = {}) {
  // Meta's IG container goes IN_PROGRESS → FINISHED (or ERROR/EXPIRED) before
  // it can be published. Without this poll, calling media_publish too early
  // returns: code 9007 / subcode 2207027 "Media is not ready for publishing".
  // Observed in prod 2026-04-29 — three consecutive failures.
  const deadline = Date.now() + maxMs;
  let lastStatus = null;
  while (Date.now() < deadline) {
    const r = await fetch(
      `${GRAPH}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(TOKEN)}`,
    );
    const j = await r.json();
    if (!r.ok || j.error) throw new Error('status check failed: ' + JSON.stringify(j));
    lastStatus = j.status_code;
    if (lastStatus === 'FINISHED') return;
    if (lastStatus === 'ERROR' || lastStatus === 'EXPIRED') {
      throw new Error('container ' + lastStatus + ': ' + JSON.stringify(j));
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('container not ready after ' + maxMs + 'ms (last status: ' + lastStatus + ')');
}

async function publishToIG({ imageUrl, caption }) {
  // 1) Create container
  const c = await fetch(`${GRAPH}/${IG_USER_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ image_url: imageUrl, caption, access_token: TOKEN }),
  });
  const cj = await c.json();
  if (!c.ok || cj.error) throw new Error('container failed: ' + JSON.stringify(cj));

  // 2) Wait for the container to reach FINISHED before publishing
  await waitForContainerReady(cj.id);

  // 3) Publish
  const p = await fetch(`${GRAPH}/${IG_USER_ID}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: cj.id, access_token: TOKEN }),
  });
  const pj = await p.json();
  if (!p.ok || pj.error) throw new Error('publish failed: ' + JSON.stringify(pj));

  return { container_id: cj.id, post_id: pj.id };
}

async function notifyTelegram(text) {
  const tk = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!tk || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${tk}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (_) {}
}

function todayET() {
  // Late April–May = EDT (UTC-4)
  return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

exports.handler = async (event) => {
  if (!TOKEN) return { statusCode: 500, body: 'META_ACCESS_TOKEN not set' };

  const params = event.queryStringParameters || {};
  const isManual = !!(params.day || params.force);

  // Manual trigger requires CRM password
  if (isManual) {
    if (params.pw !== process.env.CRM_PASSWORD) return { statusCode: 401, body: 'unauthorized' };
  }

  let target;
  if (params.force) {
    target = ALL_POSTS.find(p => p.image === params.force || p.image === `${params.force}.png`);
  } else {
    const day = params.day || todayET();
    target = ALL_POSTS.find(p => p.date === day);
  }

  if (!target) {
    const msg = `No IG post scheduled for ${params.day || todayET()}`;
    return { statusCode: 200, body: msg };
  }

  try {
    const res = await publishToIG({
      imageUrl: `${BASE_IMG}/${target.image}`,
      caption: target.caption,
    });
    await notifyTelegram(`📸 IG post live · ${target.date} · ${target.image}\nhttps://www.instagram.com/p/${res.post_id}/`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, target, ...res }) };
  } catch (e) {
    await notifyTelegram(`⚠️ IG post FAILED · ${target.date} · ${target.image}\n${e.message}`);
    return { statusCode: 500, body: JSON.stringify({ ok: false, target, error: e.message }) };
  }
};
