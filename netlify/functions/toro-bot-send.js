// Toro Movers ops bot — ad-hoc message push endpoint.
//
// Mirror of vyn-bot-send.js but uses the @Toromoversbot token for
// Toro-business operational alerts (move-day pings, ad status, lead
// notifications, daily ops brief).
//
// Env vars (set on this Netlify site):
//   TELEGRAM_BOT_TOKEN        — @Toromoversbot token from @BotFather
//   TELEGRAM_CHAT_ID          — admin's private chat id (int)
//   VYN_BOT_WEBHOOK_SECRET    — reused shared secret guarding this endpoint
//
// Usage:
//   POST /.netlify/functions/toro-bot-send?token=<secret>
//   Body: { "text": "Message content", "parse_mode": "Markdown"?,
//           "disable_web_page_preview": true? }
//
// Returns Telegram's sendMessage response JSON verbatim.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const WEBHOOK_SECRET = process.env.VYN_BOT_WEBHOOK_SECRET;

const json = (status, data) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
      body: '',
    };
  }

  if (!TOKEN || !CHAT_ID || !WEBHOOK_SECRET) {
    return json(500, { error: 'toro-bot not configured — missing env vars' });
  }

  const qs = event.queryStringParameters || {};
  const provided =
    qs.token ||
    (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (provided !== WEBHOOK_SECRET) {
    return json(401, { error: 'Unauthorized' });
  }

  let body = {};
  if (event.httpMethod === 'POST') {
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'invalid JSON body' });
    }
  }

  const text = body.text || qs.text;
  if (!text) return json(400, { error: 'text required (body or ?text=)' });

  const payload = {
    chat_id: CHAT_ID,
    text,
    parse_mode: body.parse_mode || qs.parse_mode || undefined,
    disable_web_page_preview:
      body.disable_web_page_preview ?? qs.no_preview === '1' ?? undefined,
  };

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    const data = await res.json();
    return json(res.ok ? 200 : 502, data);
  } catch (err) {
    return json(502, { error: 'telegram upstream failed', detail: String(err) });
  }
};
