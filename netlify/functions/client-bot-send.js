// Generic client bot push endpoint.
//
// Routes a Telegram message to one of the client-specific bots based on
// ?client=<stael|omg|connie|cura>. Each client's token + chat id live in
// separate Netlify env vars so we add future clients by just setting
// env + updating the CLIENTS map below.
//
// Auth: reuses VYN_BOT_WEBHOOK_SECRET for all clients (single secret to
// rotate). Pass as `?token=<secret>` or `Authorization: Bearer <secret>`.
//
// Usage:
//   POST /.netlify/functions/client-bot-send?client=stael&token=<secret>
//   Body: { "text": "...", "parse_mode": "Markdown"?,
//           "disable_web_page_preview": true? }

const WEBHOOK_SECRET = process.env.VYN_BOT_WEBHOOK_SECRET;

const CLIENTS = {
  stael:  { tokenEnv: 'STAEL_BOT_TOKEN',  chatEnv: 'STAEL_BOT_CHAT_ID',  label: '@StaelFogartyBot' },
  omg:    { tokenEnv: 'OMG_BOT_TOKEN',    chatEnv: 'OMG_BOT_CHAT_ID',    label: '@OhMyGrillBot' },
  connie: { tokenEnv: 'CONNIE_BOT_TOKEN', chatEnv: 'CONNIE_BOT_CHAT_ID', label: '@ConnieCakesBot' },
  cura:   { tokenEnv: 'CURA_BOT_TOKEN',   chatEnv: 'CURA_BOT_CHAT_ID',   label: '@curabatree_bot' },
};

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

  if (!WEBHOOK_SECRET) {
    return json(500, { error: 'VYN_BOT_WEBHOOK_SECRET not configured' });
  }

  const qs = event.queryStringParameters || {};
  const provided =
    qs.token ||
    (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (provided !== WEBHOOK_SECRET) {
    return json(401, { error: 'Unauthorized' });
  }

  const clientKey = String(qs.client || '').toLowerCase();
  const entry = CLIENTS[clientKey];
  if (!entry) {
    return json(400, { error: `unknown client; expected one of: ${Object.keys(CLIENTS).join(', ')}` });
  }

  const token = process.env[entry.tokenEnv];
  const chatId = process.env[entry.chatEnv];
  if (!token || !chatId) {
    return json(500, { error: `${entry.label} not configured — missing ${entry.tokenEnv} or ${entry.chatEnv}` });
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
    chat_id: chatId,
    text,
    parse_mode: body.parse_mode || qs.parse_mode || undefined,
    disable_web_page_preview:
      body.disable_web_page_preview ?? qs.no_preview === '1' ?? undefined,
  };

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return json(res.ok ? 200 : 502, data);
  } catch (err) {
    return json(502, { error: 'telegram upstream failed', detail: String(err) });
  }
};
