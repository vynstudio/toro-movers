// CRM v2 — log a sales/dispatch call against a lead.
// POST /.netlify/functions/log-call
//   Headers: Authorization: Bearer <user JWT>
//   Body:    { lead_id, note? }
// Response: 200 { logged: true }
//
// Moved off the client after the activity_log insert policy tightened
// to service_role only (migration 021). The admin client here bypasses
// RLS legitimately; we re-verify the caller via verifyUserJWT.

const { getAdminClient, verifyUserJWT } = require('./_lib/supabase-admin');

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
  try { ({ profile } = await verifyUserJWT(event.headers.authorization || event.headers.Authorization)); }
  catch (e) { return respond(401, { error: e.message || 'Unauthorized' }); }
  if (!['admin', 'dispatch', 'sales'].includes(profile.role)) return respond(403, { error: 'Staff only' });

  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON' }); }
  const leadId = String(payload.lead_id || '').trim();
  const note = payload.note == null ? null : String(payload.note).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim().slice(0, 2000);
  if (!leadId) return respond(400, { error: 'lead_id required' });

  const admin = getAdminClient();

  // Confirm the lead exists — otherwise the log entry points nowhere.
  const { data: lead, error: leadErr } = await admin
    .from('leads').select('id, first_contact_at, stage').eq('id', leadId).maybeSingle();
  if (leadErr) return respond(500, { error: 'Lead lookup failed: ' + leadErr.message });
  if (!lead) return respond(404, { error: 'Lead not found' });

  const { error: insErr } = await admin.from('activity_log').insert({
    entity_type: 'lead',
    entity_id: leadId,
    actor_id: profile.id,
    event_type: 'call_logged',
    payload: { note: note || null, at: new Date().toISOString() },
  });
  if (insErr) return respond(500, { error: 'Log insert failed: ' + insErr.message });

  // First-call stage bump: new → contacted, stamp first_contact_at.
  const updates = {};
  if (!lead.first_contact_at) updates.first_contact_at = new Date().toISOString();
  if (lead.stage === 'new') updates.stage = 'contacted';
  if (Object.keys(updates).length) {
    await admin.from('leads').update(updates).eq('id', leadId);
  }

  return respond(200, { logged: true, bumped: 'stage' in updates });
};
