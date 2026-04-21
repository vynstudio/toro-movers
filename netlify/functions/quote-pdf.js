// CRM v2 — quote-pdf
// POST /.netlify/functions/quote-pdf
//   Headers: Authorization: Bearer <supabase user JWT>
//   Body:    { lead_id, quote: { type, package_key?, crew_size, estimated_hours,
//                                hourly_rate?, truck_included, truck_fee?,
//                                deposit_amount?, total, valid_until? } }
// Response: 200 { quote_id, signed_url, expires_in, path }
//
// Behavior:
//   1. Verify caller JWT → must be active user with role sales|dispatch|admin.
//   2. Insert a quotes row (service-role, bypasses RLS).
//   3. Render branded PDF via _lib/quote-template (EN/ES from customer language).
//   4. Upload to private 'quotes' bucket at <lead_id>/<quote_id>-<ts>.pdf.
//   5. Create signed URL (default 30d TTL), write back to quotes.pdf_url.
//   6. Insert activity_log row (entity_type='quote', event='quote_generated').
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, (optional) QUOTE_PDF_BUCKET,
//      (optional) QUOTE_SIGNED_URL_TTL_SECONDS.

const { getAdminClient, verifyUserJWT } = require('./_lib/supabase-admin');
const { renderQuotePdf } = require('./_lib/quote-template');

const BUCKET = process.env.QUOTE_PDF_BUCKET || 'quotes';
const TTL = parseInt(process.env.QUOTE_SIGNED_URL_TTL_SECONDS || '2592000', 10); // 30 days

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

  // ===== 1. Auth =====
  let profile;
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    const out = await verifyUserJWT(authHeader);
    profile = out.profile;
  } catch (e) {
    return respond(401, { error: e.message || 'Unauthorized' });
  }
  if (!['sales', 'dispatch', 'admin'].includes(profile.role)) {
    return respond(403, { error: 'Forbidden' });
  }

  // ===== 2. Payload =====
  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const { lead_id, quote } = payload;
  if (!lead_id || !quote) {
    return respond(400, { error: 'lead_id and quote required' });
  }

  const admin = getAdminClient();

  // ===== 3. Load lead + joined customer =====
  const { data: lead, error: leadErr } = await admin
    .from('leads')
    .select('*, customers(*)')
    .eq('id', lead_id)
    .maybeSingle();
  if (leadErr) return respond(500, { error: 'Lead lookup failed: ' + leadErr.message });
  if (!lead) return respond(404, { error: 'Lead not found' });

  const customer = lead.customers || {};
  const lang = customer.language_preference === 'es' ? 'es' : 'en';

  // ===== 4. Normalize + insert quote row =====
  const truckIncluded = !!quote.truck_included;
  const quoteRow = {
    lead_id,
    type: quote.type === 'package' ? 'package' : 'custom',
    package_key: quote.type === 'package' ? (quote.package_key || null) : null,
    crew_size: Number(quote.crew_size || quote.movers || 2),
    hourly_rate: Number(quote.hourly_rate || 75),
    estimated_hours: Number(quote.estimated_hours || quote.hours || 0),
    truck_included: truckIncluded,
    truck_fee: Number(quote.truck_fee || 275),
    deposit_amount: Number(quote.deposit_amount || (truckIncluded ? 125 : 50)),
    total: Number(quote.total || 0),
    valid_until: quote.valid_until || null,
    language: lang,
  };

  const { data: quoteRec, error: qErr } = await admin
    .from('quotes').insert(quoteRow).select().single();
  if (qErr) return respond(500, { error: 'Save quote failed: ' + qErr.message });

  // ===== 5. Render PDF =====
  let pdfBuffer;
  try {
    pdfBuffer = await renderQuotePdf({ lead, customer, quote: quoteRec });
  } catch (e) {
    return respond(500, { error: 'PDF render failed: ' + e.message });
  }

  // ===== 6. Upload =====
  const objectPath = `${lead_id}/${quoteRec.id}-${Date.now()}.pdf`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(objectPath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (upErr) return respond(500, { error: 'Upload failed: ' + upErr.message });

  // ===== 7. Signed URL =====
  const { data: signed, error: sErr } = await admin.storage.from(BUCKET)
    .createSignedUrl(objectPath, TTL);
  if (sErr) return respond(500, { error: 'Signed URL failed: ' + sErr.message });

  // ===== 8. Write pdf_url back =====
  await admin.from('quotes').update({ pdf_url: signed.signedUrl }).eq('id', quoteRec.id);

  // ===== 9. Activity log =====
  await admin.from('activity_log').insert({
    entity_type: 'quote',
    entity_id: quoteRec.id,
    actor_id: profile.id,
    event_type: 'quote_generated',
    payload: { lead_id, total: quoteRec.total, language: lang, path: objectPath },
  });

  return respond(200, {
    quote_id: quoteRec.id,
    signed_url: signed.signedUrl,
    expires_in: TTL,
    path: objectPath,
    language: lang,
  });
};
