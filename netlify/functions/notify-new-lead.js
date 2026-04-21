// CRM v2 — notify-new-lead
// POST /.netlify/functions/notify-new-lead
//   Headers: Authorization: Bearer <supabase user JWT>
//   Body:    { lead_id }
//
// Fires a Telegram message to the ops team after a CRM-created lead. Called
// from the UI (saveNewLead) since Supabase doesn't natively push to Telegram.

const { getAdminClient, verifyUserJWT } = require('./_lib/supabase-admin');
const { notifyTelegramTeam, fmtMoney } = require('./_lib/crm-notifications');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function respond(s, b) {
  return { statusCode: s, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(b) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let profile;
  try {
    ({ profile } = await verifyUserJWT(event.headers.authorization || event.headers.Authorization));
  } catch (e) {
    return respond(401, { error: e.message || 'Unauthorized' });
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }
  const { lead_id } = payload;
  if (!lead_id) return respond(400, { error: 'lead_id required' });

  const admin = getAdminClient();
  const { data: lead } = await admin
    .from('leads').select('*, customers(*)').eq('id', lead_id).maybeSingle();
  if (!lead) return respond(404, { error: 'Lead not found' });

  const customer = lead.customers || {};
  const zone = lead.from_zone && lead.to_zone ? `${lead.from_zone} → ${lead.to_zone}` : '';
  const size = lead.size || '';

  const result = await notifyTelegramTeam([
    '*New CRM lead*',
    '',
    customer.full_name ? `Name: *${customer.full_name}*` : '',
    customer.phone ? `Phone: \`${customer.phone}\`` : '',
    customer.email ? `Email: ${customer.email}` : '',
    '',
    size ? `Size: ${size}` : '',
    zone ? `Route: ${zone}` : '',
    lead.move_date ? `Move date: ${lead.move_date}` : '',
    lead.estimated_value ? `Est. value: ${fmtMoney(lead.estimated_value)}` : '',
    lead.notes ? `Notes: ${String(lead.notes).slice(0, 160)}` : '',
    '',
    `Created by: ${profile.email}`,
  ]);

  return respond(200, { ok: !!result.ok, reason: result.reason || null });
};
