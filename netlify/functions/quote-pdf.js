// CRM v2 — quote-pdf
// POST /.netlify/functions/quote-pdf
//   Headers: Authorization: Bearer <supabase user JWT>
//   Body:    { lead_id, quote }
// Response: 200 { quote_id, signed_url, expires_in, path, language }
//
// Generates a branded quote PDF and returns a signed URL. No email.
// For the email-sending variant, see quote-send.js (same inputs, same
// quote row, also sets quotes.sent_at + emails the PDF via Resend).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      (optional) QUOTE_PDF_BUCKET, QUOTE_SIGNED_URL_TTL_SECONDS.

const { getAdminClient, verifyUserJWT } = require('./_lib/supabase-admin');
const { createQuote } = require('./_lib/quote-flow');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function respond(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let profile;
  try {
    const out = await verifyUserJWT(event.headers.authorization || event.headers.Authorization);
    profile = out.profile;
  } catch (e) {
    return respond(401, { error: e.message || 'Unauthorized' });
  }
  if (!['sales', 'dispatch', 'admin'].includes(profile.role)) {
    return respond(403, { error: 'Forbidden' });
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const { lead_id, quote } = payload;
  if (!lead_id || !quote) return respond(400, { error: 'lead_id and quote required' });

  try {
    const admin = getAdminClient();
    const out = await createQuote({ admin, actorId: profile.id, lead_id, quote });
    return respond(200, {
      quote_id: out.quote.id,
      signed_url: out.signedUrl,
      expires_in: out.ttl,
      path: out.objectPath,
      language: out.language,
    });
  } catch (e) {
    return respond(e.statusCode || 500, { error: e.message || 'Quote PDF failed' });
  }
};
