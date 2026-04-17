// Admin endpoint to insert a fully-formed booked job into the CRM.
// Used to backfill customers who paid via direct Stripe link (outside the
// website form flow) and need CRM visibility.
//
// Auth: CRM_PASSWORD in header `x-crm-password` or ?pw=
// Body (POST JSON) accepts any lead fields. Sensible defaults:
//   status: 'booked'
//   depositPaid: true (if deposit > 0)
//
// Example:
//   curl -X POST "https://toromovers.net/.netlify/functions/insert-job?pw=..." \
//     -H "Content-Type: application/json" \
//     -d '{"name":"Maggie Colon","email":"maggie.colon02@gmail.com","phone":"(321)...",
//          "move_date":"2026-05-30","move_time":"11:00 AM",
//          "pickup_address":"...","dropoff_address":"...",
//          "estimate":{"movers":2,"hours":2,"total":575,"truck":true},
//          "deposit":125,"crew_assigned":["Ralph"]}'

const { getStore } = require('@netlify/blobs'); // Blobs runtime hint
const { createLead, updateLead } = require('./_lib/leads');

const json = (status, data) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-crm-password',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  },
  body: JSON.stringify(data),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-crm-password', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const pw = event.headers['x-crm-password'] || event.queryStringParameters?.pw || '';
  if (!process.env.CRM_PASSWORD) return json(500, { error: 'CRM_PASSWORD not configured' });
  if (pw !== process.env.CRM_PASSWORD) return json(401, { error: 'Unauthorized' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  try {
    // Create with default 'new' status, then promote to booked if deposit provided
    const lead = await createLead({ ...payload, page: payload.page || 'manual-insert' });

    const patch = {};
    if (payload.status) patch.status = payload.status;
    else patch.status = 'booked';

    if (payload.deposit && payload.deposit > 0) {
      patch.depositPaid = true;
      patch.timelineEntry = {
        type: 'payment',
        text: `Manual backfill: $${payload.deposit} deposit recorded (paid via ${payload.deposit_source || 'direct Stripe link'})`,
      };
    }

    const updated = await updateLead(lead.id, patch);
    return json(200, { ok: true, lead: updated });
  } catch(e) {
    console.error('insert-job failed:', e);
    return json(500, { error: e.message });
  }
};
