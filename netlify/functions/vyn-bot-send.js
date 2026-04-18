// Vyn Studio ops bot — ad-hoc message push endpoint.
//
// Use to send cross-client tasks, reminders, status nudges, and ops
// alerts to the user's private Telegram chat with @Vynstudio_bot.
// Separate from the Toro leads bot (@Toromoversbot) so operational
// messages don't bury real-time lead pings.
//
// Env vars (set on this Netlify site):
//   VYN_BOT_TOKEN            — bot token from @BotFather
//   VYN_BOT_CHAT_ID          — user's private chat id (int)
//   VYN_BOT_WEBHOOK_SECRET   — shared secret guarding this endpoint
//
// Usage:
//   POST /.netlify/functions/vyn-bot-send?token=<secret>
//   Body: { "text": "Message content", "parse_mode": "Markdown"?,
//           "disable_web_page_preview": true? }
//
// Or with GET for quick curl testing:
//   GET /.netlify/functions/vyn-bot-send?token=<secret>&text=Hello
//
// Returns Telegram's sendMessage response JSON verbatim (or an error
// envelope on misuse).

const TOKEN = process.env.VYN_BOT_TOKEN;
const CHAT_ID = process.env.VYN_BOT_CHAT_ID;
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
    return json(500, { error: 'vyn-bot not configured — missing env vars' });
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
