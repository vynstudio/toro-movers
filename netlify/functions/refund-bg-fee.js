// CRM v2 — refund-bg-fee
// POST /.netlify/functions/refund-bg-fee
//   Headers: Authorization: Bearer <user JWT>
//   Body:    { application_id }
//
// Admin-only. Issues a full refund on the stored
// bg_fee_payment_intent_id via Stripe. The charge.refunded webhook
// will also update crew_applications.bg_fee_refunded_at, but this
// function sets it immediately in case the webhook is delayed.

const Stripe = require('stripe');
const { getAdminClient, verifyUserJWT } = require('./_lib/supabase-admin');
const { notifyTelegramTeam } = require('./_lib/crm-notifications');

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
  if (!process.env.STRIPE_SECRET_KEY) return respond(500, { error: 'Stripe not configured' });

  let profile;
  try {
    ({ profile } = await verifyUserJWT(event.headers.authorization || event.headers.Authorization));
  } catch (e) { return respond(401, { error: e.message }); }
  // Owner-only: refunds move money out of Stael's Stripe account. Admins
  // (incl. Stephanie) are not authorised — prevents a compromised admin
  // session from draining funds. Diler = is_owner=true is the sole gate.
  if (!profile.is_owner) return respond(403, { error: 'Owner only — refunds are restricted to the business owner' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON' }); }
  const { application_id } = payload;
  if (!application_id) return respond(400, { error: 'application_id required' });

  const admin = getAdminClient();
  const { data: app, error } = await admin
    .from('crew_applications').select('*').eq('id', application_id).maybeSingle();
  if (error || !app) return respond(404, { error: 'Application not found' });
  if (!app.bg_fee_payment_intent_id) return respond(400, { error: 'No bg-fee payment on file for this applicant.' });
  if (app.bg_fee_refunded_at) return respond(400, { error: 'Fee was already refunded.' });

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-10-28.acacia' });
  let refund;
  try {
    refund = await stripe.refunds.create({
      payment_intent: app.bg_fee_payment_intent_id,
      reason: 'requested_by_customer',
      metadata: {
        purpose: 'bg_check_fee_refund',
        application_id,
        refunded_by: profile.email || profile.id,
      },
    });
  } catch (e) {
    return respond(500, { error: 'Refund failed: ' + e.message });
  }

  const nowIso = new Date().toISOString();
  await admin.from('crew_applications')
    .update({ bg_fee_refunded_at: nowIso })
    .eq('id', application_id);

  await admin.from('activity_log').insert({
    entity_type: 'application',
    entity_id: application_id,
    actor_id: profile.id,
    event_type: 'bg_fee_refunded',
    payload: { amount: refund.amount / 100, refund_id: refund.id, payment_intent: app.bg_fee_payment_intent_id },
  });

  notifyTelegramTeam([
    '*BG fee refunded (manual)*',
    '',
    `Applicant: *${app.first_name} ${app.last_name}*`,
    `Email: ${app.email}`,
    `Refund: *$${(refund.amount / 100).toFixed(2)}*`,
    `By: ${profile.email}`,
  ]).catch(e => console.error('tg failed:', e.message));

  return respond(200, { ok: true, refund_id: refund.id, amount: refund.amount / 100, refunded_at: nowIso });
};
