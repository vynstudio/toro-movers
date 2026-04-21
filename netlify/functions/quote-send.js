// CRM v2 — quote-send
// POST /.netlify/functions/quote-send
//   Headers: Authorization: Bearer <supabase user JWT>
//   Body:    { lead_id, quote }
// Response: 200 { quote_id, sent_to, sent_at, signed_url, language }
//
// Generates the quote PDF (via shared createQuote flow), emails it to
// the customer via Resend with a bilingual branded HTML body + PDF
// attachment, sets quotes.sent_at, and logs a 'quote_sent' activity.
// Also bumps leads.stage from new/contacted to 'quoted' if still early.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
//      (optional) RESEND_FROM_EMAIL  (defaults 'hello@toromovers.net').

const { Resend } = require('resend');
const { getAdminClient, verifyUserJWT } = require('./_lib/supabase-admin');
const { createQuote } = require('./_lib/quote-flow');

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'hello@toromovers.net';

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

function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

const EMAIL_COPY = {
  en: {
    subject: (total) => `Your Toro Movers quote — ${total}`,
    hi: 'Hi',
    lead: 'Here is your moving quote. The PDF is attached.',
    summary: 'Summary',
    crew: 'Crew', hours: 'Hours', rate: 'Hourly rate',
    truck: 'Truck (26-ft)', deposit: 'Deposit', total: 'Total',
    cta: 'To book, just reply to this email or call (321) 758-0094.',
    tagline: 'Moving People Forward',
    perMoverHr: '/ mover / hr',
  },
  es: {
    subject: (total) => `Tu cotizacion de Toro Movers — ${total}`,
    hi: 'Hola',
    lead: 'Aqui esta tu cotizacion de mudanza. El PDF va adjunto.',
    summary: 'Resumen',
    crew: 'Cuadrilla', hours: 'Horas', rate: 'Tarifa por hora',
    truck: 'Camion (26 pies)', deposit: 'Deposito', total: 'Total',
    cta: 'Para reservar, responde este correo o llama al (321) 758-0094.',
    tagline: 'Mudanzas honestas. Manos fuertes.',
    perMoverHr: '/ mov. / h',
  },
};

function renderEmailHtml({ customer, quote, lang }) {
  const L = EMAIL_COPY[lang];
  const truckLine = quote.truck_included
    ? `<tr><td style="padding:6px 0;color:#6B7280">${L.truck}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1C1C1E">+${fmtMoney(quote.truck_fee)}</td></tr>`
    : '';
  const firstName = String(customer.full_name || '').split(/\s+/)[0] || '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1C1C1E">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
<tr><td style="background:#C8102E;padding:22px 28px;color:#fff">
<div style="font-weight:800;font-size:22px;letter-spacing:-0.01em">TORO MOVERS</div>
<div style="font-size:12px;opacity:0.9;margin-top:4px">${L.tagline}</div>
</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 12px 0;font-size:15px">${L.hi} ${firstName},</p>
<p style="margin:0 0 18px 0;font-size:15px;line-height:1.55">${L.lead}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6E9;border-radius:10px;padding:16px 18px;margin-bottom:18px">
<tr><td colspan="2" style="font-weight:800;font-size:14px;color:#1C1C1E;padding-bottom:10px">${L.summary}</td></tr>
<tr><td style="padding:6px 0;color:#6B7280">${L.crew}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1C1C1E">${quote.crew_size}</td></tr>
<tr><td style="padding:6px 0;color:#6B7280">${L.hours}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1C1C1E">${quote.estimated_hours} h</td></tr>
<tr><td style="padding:6px 0;color:#6B7280">${L.rate}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1C1C1E">${fmtMoney(quote.hourly_rate)} ${L.perMoverHr}</td></tr>
${truckLine}
<tr><td style="padding:6px 0;color:#6B7280">${L.deposit}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1C1C1E">${fmtMoney(quote.deposit_amount)}</td></tr>
<tr><td style="padding:12px 0 0 0;color:#1C1C1E;font-weight:800;font-size:15px;border-top:1px solid #E5E7EB">${L.total}</td><td style="padding:12px 0 0 0;text-align:right;color:#C8102E;font-weight:800;font-size:22px;border-top:1px solid #E5E7EB">${fmtMoney(quote.total)}</td></tr>
</table>
<p style="margin:0;font-size:14px;line-height:1.55;color:#3A3A3D">${L.cta}</p>
</td></tr>
<tr><td style="background:#F9FAFB;padding:14px 28px;text-align:center;color:#6B7280;font-size:11px">TORO MOVERS · Orlando, FL · (321) 758-0094 · toromovers.net</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  if (!process.env.RESEND_API_KEY) return respond(500, { error: 'Resend not configured' });

  // Auth
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

  // Payload
  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }
  const { lead_id, quote } = payload;
  if (!lead_id || !quote) return respond(400, { error: 'lead_id and quote required' });

  const admin = getAdminClient();

  // Generate + upload quote
  let out;
  try {
    out = await createQuote({ admin, actorId: profile.id, lead_id, quote });
  } catch (e) {
    return respond(e.statusCode || 500, { error: e.message });
  }

  const toEmail = out.customer && out.customer.email;
  if (!toEmail) return respond(400, { error: 'Customer has no email on file' });

  // Send email
  const resend = new Resend(process.env.RESEND_API_KEY);
  const L = EMAIL_COPY[out.language];
  const subject = L.subject(fmtMoney(out.quote.total));
  const html = renderEmailHtml({
    customer: out.customer,
    quote: out.quote,
    lang: out.language,
  });
  const qNum = String(out.quote.id).replace(/-/g, '').slice(0, 8).toUpperCase();

  try {
    const { error: sendErr } = await resend.emails.send({
      from: `Toro Movers <${FROM_EMAIL}>`,
      to: [toEmail],
      replyTo: profile.email || FROM_EMAIL,
      subject,
      html,
      attachments: [{
        filename: `toro-quote-${qNum}.pdf`,
        content: out.pdfBuffer.toString('base64'),
      }],
    });
    if (sendErr) {
      return respond(500, { error: 'Email send failed: ' + (sendErr.message || JSON.stringify(sendErr)) });
    }
  } catch (e) {
    return respond(500, { error: 'Email send failed: ' + e.message });
  }

  // Mark sent + log
  const sentAt = new Date().toISOString();
  await admin.from('quotes').update({ sent_at: sentAt }).eq('id', out.quote.id);
  await admin.from('activity_log').insert({
    entity_type: 'quote',
    entity_id: out.quote.id,
    actor_id: profile.id,
    event_type: 'quote_sent',
    payload: { lead_id, to: toEmail, subject, language: out.language },
  });

  // Bump lead to 'quoted' if still early in funnel
  await admin.from('leads')
    .update({ stage: 'quoted' })
    .eq('id', lead_id)
    .in('stage', ['new', 'contacted']);

  return respond(200, {
    quote_id: out.quote.id,
    sent_to: toEmail,
    sent_at: sentAt,
    signed_url: out.signedUrl,
    language: out.language,
  });
};
