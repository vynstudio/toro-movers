// Shared quote creation flow used by quote-pdf and quote-send.
//
// createQuote: loads the lead, inserts a quotes row, renders a branded
// PDF, uploads to the 'quotes' storage bucket, issues a signed URL,
// writes pdf_url back, logs a 'quote_generated' activity event, and
// returns { lead, customer, quote, signedUrl, objectPath, language,
// pdfBuffer, ttl }.
//
// Caller is responsible for auth + role checks.

const { renderQuotePdf } = require('./quote-template');

const BUCKET = process.env.QUOTE_PDF_BUCKET || 'quotes';
const TTL = parseInt(process.env.QUOTE_SIGNED_URL_TTL_SECONDS || '2592000', 10);

function normalizeQuote(input, lang) {
  const truckIncluded = !!input.truck_included;
  return {
    type: input.type === 'package' ? 'package' : 'custom',
    package_key: input.type === 'package' ? (input.package_key || null) : null,
    crew_size: Number(input.crew_size || input.movers || 2),
    hourly_rate: Number(input.hourly_rate || 75),
    estimated_hours: Number(input.estimated_hours || input.hours || 0),
    truck_included: truckIncluded,
    truck_fee: Number(input.truck_fee || 275),
    deposit_amount: Number(input.deposit_amount || (truckIncluded ? 125 : 50)),
    total: Number(input.total || 0),
    valid_until: input.valid_until || null,
    language: lang,
  };
}

async function createQuote({ admin, actorId, lead_id, quote }) {
  // 1. Load lead + joined customer
  const { data: lead, error: leadErr } = await admin
    .from('leads').select('*, customers(*)').eq('id', lead_id).maybeSingle();
  if (leadErr) throw new Error('Lead lookup failed: ' + leadErr.message);
  if (!lead) {
    const err = new Error('Lead not found');
    err.statusCode = 404;
    throw err;
  }
  const customer = lead.customers || {};
  const lang = customer.language_preference === 'es' ? 'es' : 'en';

  // 2. Insert quote row
  const quoteRow = { lead_id, ...normalizeQuote(quote, lang) };
  const { data: quoteRec, error: qErr } = await admin
    .from('quotes').insert(quoteRow).select().single();
  if (qErr) throw new Error('Save quote failed: ' + qErr.message);

  // 3. Render PDF
  const pdfBuffer = await renderQuotePdf({ lead, customer, quote: quoteRec });

  // 4. Upload
  const objectPath = `${lead_id}/${quoteRec.id}-${Date.now()}.pdf`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(objectPath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (upErr) throw new Error('Upload failed: ' + upErr.message);

  // 5. Signed URL
  const { data: signed, error: sErr } = await admin.storage.from(BUCKET)
    .createSignedUrl(objectPath, TTL);
  if (sErr) throw new Error('Signed URL failed: ' + sErr.message);

  // 6. Write pdf_url + activity
  await admin.from('quotes').update({ pdf_url: signed.signedUrl }).eq('id', quoteRec.id);
  await admin.from('activity_log').insert({
    entity_type: 'quote',
    entity_id: quoteRec.id,
    actor_id: actorId || null,
    event_type: 'quote_generated',
    payload: { lead_id, total: quoteRec.total, language: lang, path: objectPath },
  });

  return {
    lead,
    customer,
    quote: quoteRec,
    signedUrl: signed.signedUrl,
    objectPath,
    language: lang,
    pdfBuffer,
    ttl: TTL,
  };
}

module.exports = { createQuote, normalizeQuote };
