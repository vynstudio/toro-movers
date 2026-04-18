// WhatsApp Cloud API push endpoint.
//
// Per-client routing via ?client=<slug>, mirroring client-bot-send.
// Each client has its own WABA (WhatsApp Business Account) phone number +
// permanent access token. All stored as Netlify env vars.
//
// Auth: reuses VYN_BOT_WEBHOOK_SECRET.
//
// Usage:
//   POST /.netlify/functions/whatsapp-send?client=omg&token=<secret>
//   Body: { "to": "+34600000000", "text": "Hola" }
//     -- or for template messages (needed outside the 24-hour session):
//   Body: { "to": "+34600000000", "template": "hello_world", "lang": "en_US",
//           "components": [...] }
//
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api

const WEBHOOK_SECRET = process.env.VYN_BOT_WEBHOOK_SECRET;

const CLIENTS = {
  omg:    { tokenEnv: 'OMG_WA_TOKEN',    phoneEnv: 'OMG_WA_PHONE_ID',    label: 'OMG WhatsApp' },
  toro:   { tokenEnv: 'TORO_WA_TOKEN',   phoneEnv: 'TORO_WA_PHONE_ID',   label: 'Toro WhatsApp' },
  stael:  { tokenEnv: 'STAEL_WA_TOKEN',  phoneEnv: 'STAEL_WA_PHONE_ID',  label: 'Stael WhatsApp' },
  connie: { tokenEnv: 'CONNIE_WA_TOKEN', phoneEnv: 'CONNIE_WA_PHONE_ID', label: 'Connie WhatsApp' },
  cura:   { tokenEnv: 'CURA_WA_TOKEN',   phoneEnv: 'CURA_WA_PHONE_ID',   label: 'Curabatree WhatsApp' },
};

const json = (status, data) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

function normalizePhone(raw){
  // Meta expects E.164 without leading + (e.g. 34600000000). Accept a few inputs.
  return String(raw || '').replace(/[^\d]/g, '');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' },
      body: '',
    };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!WEBHOOK_SECRET) return json(500, { error: 'VYN_BOT_WEBHOOK_SECRET not configured' });

  const qs = event.queryStringParameters || {};
  const provided = qs.token || (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (provided !== WEBHOOK_SECRET) return json(401, { error: 'Unauthorized' });

  const clientKey = String(qs.client || '').toLowerCase();
  const entry = CLIENTS[clientKey];
  if (!entry) return json(400, { error: `unknown client; expected one of: ${Object.keys(CLIENTS).join(', ')}` });

  const token = process.env[entry.tokenEnv];
  const phoneId = process.env[entry.phoneEnv];
  if (!token || !phoneId) {
    return json(500, { error: `${entry.label} not configured — missing ${entry.tokenEnv} or ${entry.phoneEnv}` });
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid JSON body' }); }

  const to = normalizePhone(body.to);
  if (!to) return json(400, { error: 'to (phone, E.164) is required' });

  // Build WhatsApp Cloud API payload — text for session messages OR template for first-contact
  let waPayload;
  if (body.template) {
    waPayload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: body.template,
        language: { code: body.lang || 'en_US' },
        ...(body.components ? { components: body.components } : {}),
      },
    };
  } else if (body.text) {
    waPayload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: !!body.preview_url, body: String(body.text) },
    };
  } else {
    return json(400, { error: 'either text or template is required' });
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v22.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(waPayload),
    });
    const data = await res.json();
    return json(res.ok ? 200 : 502, data);
  } catch (err) {
    return json(502, { error: 'whatsapp upstream failed', detail: String(err) });
  }
};
