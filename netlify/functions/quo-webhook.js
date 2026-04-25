// Quo webhook receiver. Quo POSTs here on incoming-message events. We:
//   • Verify the HMAC signature against OPENPHONE_WEBHOOK_SECRET
//   • Find the matching lead by phone (Netlify Blobs index)
//   • If the body is STOP-style, mark the lead as `sms_opted_out`
//   • Append the reply as a note on the lead's timeline
//   • Forward a Telegram alert to the owner so replies aren't trapped in
//     the Quo inbox
//
// Setup: register this URL once via `node scripts/quo-register-webhook.js`,
// then save the returned signing key to Netlify as OPENPHONE_WEBHOOK_SECRET.
//
// Env: OPENPHONE_WEBHOOK_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

const { findLeadByPhone, updateLead, addNote } = require('./_lib/leads');
const { verifyWebhookSignature, classifyKeyword } = require('./_lib/quo');

async function telegramOwner(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { skipped: true };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function tgEsc(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/`/g, '\\`');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const rawBody = event.body || '';
  const sigHeader =
    event.headers['openphone-signature'] ||
    event.headers['Openphone-Signature'] ||
    event.headers['x-openphone-signature'];
  const verify = verifyWebhookSignature(rawBody, sigHeader);
  if (!verify.ok) {
    console.warn('[quo-webhook] signature rejected:', verify.reason);
    return { statusCode: 401, body: 'invalid signature' };
  }

  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { return { statusCode: 400, body: 'bad json' }; }

  // Quo wraps events as { type, data: { object: {...} } }. Old OpenPhone
  // payloads sometimes flattened this — handle both.
  const eventType = payload.type || payload.event || '';
  const obj = payload.data?.object || payload.data || payload;

  // Ignore anything that isn't an inbound message.
  if (!/^message\.received$/i.test(eventType) && obj.direction !== 'incoming') {
    return { statusCode: 200, body: '{}' };
  }

  const fromNumber = obj.from || obj.fromNumber || '';
  const body = obj.body || obj.text || '';

  if (!fromNumber || !body) {
    return { statusCode: 200, body: '{}' };
  }

  const lead = await findLeadByPhone(fromNumber);
  const keyword = classifyKeyword(body);
  const now = new Date().toISOString();

  if (lead) {
    if (keyword === 'stop') {
      await updateLead(lead.id, {
        sms_opted_out: true,
        sms_opted_out_at: now,
        timelineEntry: { type: 'sms_opt_out', text: `Customer replied "${body.trim().slice(0, 40)}" — SMS opt-out` },
      });
    } else {
      await addNote(lead.id, `📱 SMS reply: ${body}`, 'quo-webhook');
    }
  }

  // Telegram alert
  const lines = [];
  if (keyword === 'stop') {
    lines.push(`🚫 *SMS OPT-OUT* — ${tgEsc(lead?.name || fromNumber)}`);
    lines.push(`📱 \`${tgEsc(fromNumber)}\``);
    lines.push(`💬 "${tgEsc(body)}"`);
    if (lead) lines.push(`📋 [Open in CRM](https://toromovers.net/crm#lead/${lead.id})`);
    lines.push('Future reminders + drips will skip this number.');
  } else {
    const head = keyword === 'help'
      ? `❓ *SMS HELP* — ${tgEsc(lead?.name || fromNumber)}`
      : `💬 *SMS reply* from ${tgEsc(lead?.name || fromNumber)}`;
    lines.push(head);
    lines.push(`📱 \`${tgEsc(fromNumber)}\``);
    lines.push('');
    lines.push(tgEsc(body));
    if (lead) {
      lines.push('');
      lines.push(`📋 [Open in CRM](https://toromovers.net/crm#lead/${lead.id})`);
    }
  }

  await telegramOwner(lines.join('\n'));

  return { statusCode: 200, body: JSON.stringify({ handled: true, leadId: lead?.id || null, keyword }) };
};
