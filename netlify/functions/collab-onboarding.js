// Vyn Studio collaborator onboarding submissions.
// Receives POST from /collab, stores in Netlify Blobs, pings @Vynstudio_bot.

const { getStore } = require('@netlify/blobs');

const VYN_TOKEN = process.env.VYN_BOT_TOKEN;
const VYN_CHAT = process.env.VYN_BOT_CHAT_ID;

const json = (status, data) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

function fmt(d){
  const lines = [];
  lines.push('👥 *New collaborator onboarding*');
  lines.push('');
  lines.push(`*${d.name || '?'}*`);
  if (d.email) lines.push(`📧 ${d.email}`);
  if (d.tg) lines.push(`📱 ${d.tg}`);
  if (d.loc) lines.push(`📍 ${d.loc}`);
  lines.push('');
  lines.push(`Role: ${d.role || '—'}${d.role_other ? ' (' + d.role_other + ')' : ''}`);
  lines.push(`Arrangement: ${d.arrangement || '—'}`);
  lines.push(`Pay: ${d.pay_model || '—'} ${d.rate ? '· ' + d.rate : ''}`);
  lines.push(`Hours/wk: ${d.hours || '—'}${d.hours_detail ? ' · ' + d.hours_detail : ''}`);
  lines.push(`Security: ${d.security || '—'}${d.secrets ? ' · ' + d.secrets : ''}`);
  lines.push('');
  if (d.stack && d.stack.length) {
    lines.push(`Stack: ${d.stack.join(', ')}`);
    if (d.stack_other) lines.push(`  other: ${d.stack_other}`);
  }
  if (d.interests && d.interests.length) {
    lines.push(`Interests: ${d.interests.join(', ')}`);
  }
  if (d.portfolio) lines.push(`Portfolio: ${d.portfolio}`);
  if (d.github) lines.push(`GitHub: ${d.github}`);
  if (d.proud) lines.push(`Proud: ${d.proud}`);
  if (d.notes) lines.push(`Notes: ${d.notes}`);
  if (d.source) lines.push(`Source: ${d.source}`);
  return lines.join('\n');
}

async function sendTG(text){
  if (!VYN_TOKEN || !VYN_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${VYN_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: VYN_CHAT, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
    });
  } catch (_) { /* never block submit on notify */ }
}

function store(){
  const siteID = process.env.NETLIFY_SITE_ID || '5d1b562a-d00c-4a66-8dd3-5b083eb11ce9';
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (token) return getStore({ name: 'collab-applicants', siteID, token, consistency: 'strong' });
  return getStore({ name: 'collab-applicants', consistency: 'strong' });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid JSON' }); }

  // Light validation
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim();
  if (!name || !email) return json(400, { error: 'name and email required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'invalid email' });

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const record = { id, receivedAt: new Date().toISOString(), ...payload };

  // Persist (best-effort — don't fail submit if blobs hiccups)
  try { await store().set(id, JSON.stringify(record)); } catch (e) { /* continue */ }

  // Telegram notify
  await sendTG(fmt(record));

  return json(200, { ok: true, id });
};
