// CRM v2 — update-job
// POST /.netlify/functions/update-job
//   Headers: Authorization: Bearer <user JWT>
//   Body:    { job_id, actual_hours, actual_movers, materials, fees,
//              notes, offered_hourly_rate }
// Response: 200 { job }
//
// Admin/dispatch only. Recomputes customer_total + balance_due if any of
// {actual_hours, actual_movers, materials, fees} changed. Logs activity.

const { getAdminClient, verifyUserJWT } = require('./_lib/supabase-admin');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function respond(s, b) {
  return { statusCode: s, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(b) };
}

function num(v, dflt = null) {
  if (v === '' || v == null) return dflt;
  const n = Number(v);
  return isNaN(n) ? dflt : n;
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
  if (!['admin', 'dispatch'].includes(profile.role)) {
    return respond(403, { error: 'Admin or dispatch only' });
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON' }); }
  const { job_id } = payload;
  if (!job_id) return respond(400, { error: 'job_id required' });

  const admin = getAdminClient();
  const { data: job, error: jErr } = await admin.from('jobs').select('*').eq('id', job_id).maybeSingle();
  if (jErr || !job) return respond(404, { error: 'Job not found' });

  const patch = {};
  for (const k of ['actual_hours', 'actual_movers', 'materials', 'fees', 'offered_hourly_rate']) {
    if (k in payload) patch[k] = num(payload[k]);
  }
  if ('notes' in payload) patch.notes = payload.notes == null ? null : String(payload.notes).trim() || null;

  // Recompute customer_total if any driver changed. Formula:
  //   (hourly_rate × crew_size × hours) + materials + fees
  // Uses actual_* when set, falls back to quoted values.
  const drivers = ['actual_hours', 'actual_movers', 'materials', 'fees'];
  if (drivers.some(k => k in patch)) {
    const hours = (patch.actual_hours != null ? patch.actual_hours : job.actual_hours) ?? 0;
    const movers = (patch.actual_movers != null ? patch.actual_movers : job.actual_movers) ?? null;
    const crewSize = movers ?? 2; // fall back to 2 movers
    const rate = Number(job.hourly_rate || 75);
    const materials = patch.materials != null ? patch.materials : Number(job.materials || 0);
    const fees = patch.fees != null ? patch.fees : Number(job.fees || 0);
    const truckFeeIncluded = fees > 0;
    const labor = rate * crewSize * Number(hours);
    const newTotal = labor + Number(materials) + Number(fees);
    patch.customer_total = Number(newTotal.toFixed(2));
    patch.balance_due = Math.max(0, patch.customer_total - Number(job.deposit_paid || 0));
  }

  const { data: updated, error: upErr } = await admin
    .from('jobs').update(patch).eq('id', job_id).select().single();
  if (upErr) return respond(500, { error: 'Update failed: ' + upErr.message });

  await admin.from('activity_log').insert({
    entity_type: 'job',
    entity_id: job_id,
    actor_id: profile.id,
    event_type: 'job_updated',
    payload: { patch, new_total: patch.customer_total ?? job.customer_total, new_balance: patch.balance_due ?? job.balance_due },
  });

  return respond(200, { job: updated });
};
