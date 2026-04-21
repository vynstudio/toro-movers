// CRM v2 — balance-info
// GET /.netlify/functions/balance-info?j=<job_id>
//
// Public, read-only. Returns { balance_due, customer_total, deposit_paid,
// currency } for the tip picker page (balance.html) to display tip %s.
// No PII — just dollar amounts.

const { getAdminClient } = require('./_lib/supabase-admin');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
function respond(s, b) {
  return { statusCode: s, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(b) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  const j = event.queryStringParameters && event.queryStringParameters.j;
  if (!j) return respond(400, { error: 'Missing job reference' });

  const admin = getAdminClient();
  const { data: job, error } = await admin
    .from('jobs').select('balance_due, customer_total, deposit_paid').eq('id', j).maybeSingle();
  if (error || !job) return respond(404, { error: 'Job not found' });

  return respond(200, {
    balance_due: Number(job.balance_due || 0),
    customer_total: Number(job.customer_total || 0),
    deposit_paid: Number(job.deposit_paid || 0),
    currency: 'usd',
  });
};
