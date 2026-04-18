// WhatsApp Cloud API webhook — incoming messages + status updates.
//
// Multi-tenant via ?client=<slug>. Meta configures one webhook URL per
// app, so each client's Meta app points to a different ?client= value.
//
// GET  — Meta's subscription challenge (verify_token match)
// POST — Message / status payloads → forwarded to the client's Telegram
//        ops bot so Diler sees incoming WhatsApps in real time.
//
// Webhook URL for OMG: https://toromovers.net/.netlify/functions/whatsapp-webhook?client=omg
// Verify token: use VYN_BOT_WEBHOOK_SECRET value.

const crypto = require('crypto');

const VERIFY_TOKEN = process.env.VYN_BOT_WEBHOOK_SECRET;

// Which Telegram bot to forward each client's incoming WhatsApps to.
// Matches the CLIENTS map in client-bot-send.js.
const CLIENT_TG = {
  omg:    'omg',
  toro:   null, // Toro ops already has its own pipelines
  stael:  'stael',
  connie: 'connie',
  cura:   'cura',
};

// Optional per-client app secret for signature validation
// (X-Hub-Signature-256). Set {CLIENT}_WA_APP_SECRET in env to enable.
const APP_SECRET_ENV = {
  omg:    'OMG_WA_APP_SECRET',
  stael:  'STAEL_WA_APP_SECRET',
  connie: 'CONNIE_WA_APP_SECRET',
  cura:   'CURA_WA_APP_SECRET',
  toro:   'TORO_WA_APP_SECRET',
};

const json = (status, body = '') => ({
  statusCode: status,
  headers: { 'Content-Type': 'text/plain' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

function verifySignature(rawBody, signatureHeader, appSecret){
  if (!appSecret || !signatureHeader) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody, 'utf8')
    .digest('hex');
  // Timing-safe comparison
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function sendToOpsBot(clientKey, text){
  const tgClient = CLIENT_TG[clientKey];
  if (!tgClient) return;
  try {
    await fetch(
      `https://toromovers.net/.netlify/functions/client-bot-send?client=${tgClient}&token=${encodeURIComponent(VERIFY_TOKEN)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, disable_web_page_preview: true }),
      }
    );
  } catch (err) {
    console.error('forward to TG failed:', err);
  }
}

function formatIncoming(clientKey, value){
  const lines = [`💬 *WhatsApp (${clientKey.toUpperCase()})*`];
  const contacts = value.contacts || [];
  const messages = value.messages || [];
  const meta = value.metadata || {};

  messages.forEach(msg => {
    const contact = contacts.find(c => c.wa_id === msg.from) || {};
    const name = (contact.profile && contact.profile.name) || '(unknown)';
    lines.push('');
    lines.push(`From *${name}* (+${msg.from})`);
    lines.push(`To: ${meta.display_phone_number || '?'}`);
    if (msg.type === 'text' && msg.text) {
      lines.push('');
      lines.push(msg.text.body || '');
    } else if (msg.type === 'image') {
      lines.push('[image]');
    } else if (msg.type === 'audio') {
      lines.push('[voice note]');
    } else if (msg.type === 'location' && msg.location) {
      lines.push(`📍 ${msg.location.latitude}, ${msg.location.longitude}`);
    } else if (msg.type === 'button' && msg.button) {
      lines.push(`tapped: ${msg.button.text}`);
    } else if (msg.type === 'interactive' && msg.interactive) {
      const i = msg.interactive;
      if (i.button_reply) lines.push(`tapped button: ${i.button_reply.title}`);
      else if (i.list_reply) lines.push(`picked: ${i.list_reply.title}`);
    } else {
      lines.push(`[${msg.type}]`);
    }
  });

  return lines.join('\n');
}

function formatStatus(clientKey, value){
  const statuses = value.statuses || [];
  if (!statuses.length) return null;
  // Only alert for failures — delivered/read noise would spam the ops channel
  const failed = statuses.filter(s => s.status === 'failed');
  if (!failed.length) return null;
  const lines = [`⚠️ *WhatsApp delivery failed (${clientKey.toUpperCase()})*`];
  failed.forEach(s => {
    lines.push('');
    lines.push(`id: ${s.id}`);
    if (s.errors) {
      s.errors.forEach(e => lines.push(`${e.code}: ${e.title} — ${e.message || ''}`));
    }
  });
  return lines.join('\n');
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const clientKey = String(qs.client || '').toLowerCase();

  // --- GET: subscription challenge ---
  if (event.httpMethod === 'GET') {
    if (
      qs['hub.mode'] === 'subscribe' &&
      qs['hub.verify_token'] === VERIFY_TOKEN &&
      qs['hub.challenge']
    ) {
      return json(200, qs['hub.challenge']);
    }
    return json(403, 'Forbidden');
  }

  // --- POST: event payload ---
  if (event.httpMethod !== 'POST') return json(405, 'Method not allowed');
  if (!clientKey || !CLIENT_TG.hasOwnProperty(clientKey)) {
    return json(400, 'unknown client');
  }

  // Optional signature validation
  const appSecret = process.env[APP_SECRET_ENV[clientKey] || ''];
  const rawBody = event.body || '';
  if (appSecret) {
    const sigHeader = event.headers['x-hub-signature-256'] || event.headers['X-Hub-Signature-256'];
    if (!verifySignature(rawBody, sigHeader, appSecret)) {
      return json(401, 'bad signature');
    }
  }

  let payload;
  try { payload = JSON.parse(rawBody || '{}'); }
  catch { return json(400, 'invalid JSON'); }

  // Iterate each change and dispatch
  const entries = payload.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      const value = change.value || {};
      if (value.messages && value.messages.length) {
        await sendToOpsBot(clientKey, formatIncoming(clientKey, value));
      }
      const statusText = formatStatus(clientKey, value);
      if (statusText) await sendToOpsBot(clientKey, statusText);
    }
  }

  // Always 200 so Meta doesn't retry aggressively
  return json(200, 'OK');
};
