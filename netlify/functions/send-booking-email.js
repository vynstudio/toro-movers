// CRM v2 — manually (re)send the booking confirmation email for a booked lead.
// POST /.netlify/functions/send-booking-email
//   Headers: Authorization: Bearer <user JWT>  (admin/dispatch)
//   Body:    { lead_id }
// Response: 200 { sent: true, email }
//
// Used for leads that were bumped to booked out-of-band (CSV migration,
// backfill, manual entry) and never fired the customer-facing confirmation.

const { getAdminClient, verifyUserJWT } = require('./_lib/supabase-admin');
const { sendBookingConfirmationEmail } = require('./_lib/crm-notifications');

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
  if (!['admin', 'dispatch'].includes(profile.role)) return respond(403, { error: 'Admin/dispatch only' });

  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON' }); }
  const leadId = payload.lead_id;
  if (!leadId) return respond(400, { error: 'lead_id required' });

  const admin = getAdminClient();
  const previewTo = (payload.preview_to || '').trim();
  const { data: lead, error: leadErr } = await admin
    .from('leads')
    .select('*, customers(*)')
    .eq('id', leadId)
    .maybeSingle();
  if (leadErr || !lead) return respond(404, { error: 'Lead not found' });
  const customer = lead.customers;
  if (!customer?.email && !previewTo) return respond(400, { error: 'Customer has no email on file' });
  // Preview mode — admin wants the email routed to themselves, not the customer.
  // Only allowed when the requester is an admin (role-checked above).
  const recipient = previewTo && profile.role === 'admin' ? previewTo : customer?.email;
  if (!recipient) return respond(400, { error: 'No recipient' });

  const { data: job } = await admin.from('jobs').select('*').eq('lead_id', leadId).maybeSingle();
  const quoteId = job?.quote_id;
  const { data: quote } = quoteId
    ? await admin.from('quotes').select('*').eq('id', quoteId).maybeSingle()
    : { data: null };

  const amountPaid = Number(job?.deposit_paid || quote?.deposit || 0);
  // For preview mode we swap the email on the customer object so the helper
  // uses the admin's address as the recipient.
  const customerForSend = { ...customer, email: recipient };
  try {
    await sendBookingConfirmationEmail({
      customer: customerForSend,
      lead,
      quote: quote || { total: job?.customer_total, deposit: amountPaid },
      amountPaid,
    });
  } catch (e) {
    return respond(500, { error: 'Email failed: ' + (e.message || e) });
  }

  // Only log real sends (not previews) so the timeline stays accurate.
  if (!previewTo) {
    await admin.from('activity_log').insert({
      entity_type: 'lead',
      entity_id: leadId,
      actor_id: profile.id,
      event_type: 'booking_confirmation_resent',
      payload: { email: recipient, amount_paid: amountPaid },
    });
  }

  return respond(200, { sent: true, email: recipient, preview: !!previewTo });
};
