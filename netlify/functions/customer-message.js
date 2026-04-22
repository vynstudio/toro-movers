// CRM v2 — customer-initiated message.
// POST /.netlify/functions/customer-message
//   Body: { lead_id, message, topic?, name?, email?, phone? }
// Public (unauthenticated) — reached from the customer-facing /message page
// that's linked from booking-confirmation emails. Validates the lead exists,
// rate-limits via message length + basic shape checks, writes an activity_log
// entry, and pings the team on Telegram.
//
// Topic values (soft-enum, used as label only):
//   "changes"   — reschedule / update-quote
//   "chat"      — general question
//   (other)     — falls through as a generic inquiry

const { getAdminClient } = require('./_lib/supabase-admin');
const { notifyTelegramTeam } = require('./_lib/crm-notifications');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function respond(s, b) {
  return { statusCode: s, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(b) };
}

const TOPIC_LABEL = {
  changes: '📝 Change request',
  chat: '💬 Customer message',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON' }); }
  const leadId = String(payload.lead_id || '').trim();
  const message = String(payload.message || '').trim();
  const topic = String(payload.topic || 'chat').trim().toLowerCase();
  const nameOverride = String(payload.name || '').trim();
  const emailOverride = String(payload.email || '').trim();
  const phoneOverride = String(payload.phone || '').trim();

  if (!leadId) return respond(400, { error: 'lead_id required' });
  if (!message) return respond(400, { error: 'message required' });
  if (message.length > 2000) return respond(400, { error: 'Message too long (max 2000 chars)' });

  const admin = getAdminClient();
  const { data: lead, error: leadErr } = await admin
    .from('leads')
    .select('id, stage, move_date, move_time, customers(id, full_name, email, phone)')
    .eq('id', leadId)
    .maybeSingle();
  if (leadErr || !lead) return respond(404, { error: 'Lead not found' });

  const customer = lead.customers || {};
  const displayName = nameOverride || customer.full_name || '—';
  const displayEmail = emailOverride || customer.email || '—';
  const displayPhone = phoneOverride || customer.phone || '—';
  const topicLabel = TOPIC_LABEL[topic] || '💬 Customer message';

  // Truncate for the Telegram body — full message is in activity_log.
  const preview = message.length > 800 ? message.slice(0, 800) + '…' : message;

  await notifyTelegramTeam([
    `*${topicLabel}*`,
    '',
    `Customer: *${displayName}*`,
    displayPhone !== '—' ? `Phone: \`${displayPhone}\`` : '',
    displayEmail !== '—' ? `Email: ${displayEmail}` : '',
    lead.move_date ? `Move: ${lead.move_date}${lead.move_time ? ' at ' + lead.move_time : ''}` : '',
    '',
    preview,
    '',
    `Lead: \`${String(leadId).slice(0, 8)}\` — open in CRM`,
  ]);

  await admin.from('activity_log').insert({
    entity_type: 'lead',
    entity_id: leadId,
    actor_id: null,
    event_type: 'customer_message',
    payload: { topic, message, name: displayName, email: displayEmail, phone: displayPhone },
  });

  return respond(200, { received: true });
};
