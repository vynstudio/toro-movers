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
const { notifyTelegramTeam } = require('./_lib/crm-notifications');

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
    cta: 'Reserve my spot now',
    fallback: 'Or call (689) 600-2720 — same-week scheduling.',
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
    cta: 'Reservar mi lugar',
    fallback: 'O llama al (689) 600-2720 — agenda esta misma semana.',
    tagline: 'Mudanzas honestas. Manos fuertes.',
    perMoverHr: '/ mov. / h',
  },
};

function renderEmailHtml({ customer, quote, lang, replyEmail }) {
  const L = EMAIL_COPY[lang];
  const truckLine = quote.truck_included
    ? `<tr><td style="padding:6px 0;color:#6B7280">${L.truck}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1C1C1E">+${fmtMoney(quote.truck_fee)}</td></tr>`
    : '';
  const firstName = String(customer.full_name || '').split(/\s+/)[0] || '';

  const origin = process.env.URL
    || process.env.DEPLOY_PRIME_URL
    || 'https://toromovers-crm.netlify.app';
  const reserveHref = `${origin}/.netlify/functions/reserve?q=${encodeURIComponent(quote.id)}`;

  return `<!DOCTYPE html>
<html lang="${lang}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Toro Movers</title>
<style>
  :root { color-scheme: light only; supported-color-schemes: light only; }
  body, table, td, p, a, div { -webkit-text-size-adjust:100%; }
  @media (prefers-color-scheme: dark) {
    body, .tm-shell, .tm-card, .tm-body { background:#ffffff !important; color:#1C1C1E !important; }
    .tm-sand { background:#FBF6E9 !important; color:#1C1C1E !important; }
    .tm-muted { color:#6B7280 !important; }
    .tm-footer-bg { background:#F9FAFB !important; color:#6B7280 !important; }
  }
</style>
</head>
<body class="tm-shell" style="margin:0;padding:0;background:#ffffff;color:#1C1C1E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="tm-shell" style="background:#ffffff;padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="tm-card" style="max-width:560px;background:#ffffff;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden">

<tr><td style="background:#C8102E;padding:22px 28px;color:#ffffff">
<div style="font-weight:800;font-size:22px;letter-spacing:-0.01em;color:#ffffff">TORO MOVERS</div>
<div style="font-size:12px;margin-top:4px;color:#FFE8EC">${L.tagline}</div>
</td></tr>

<tr><td class="tm-body" style="padding:28px;background:#ffffff;color:#1C1C1E">
<p style="margin:0 0 12px 0;font-size:15px;color:#1C1C1E">${L.hi} ${firstName},</p>
<p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:#1C1C1E">${L.lead}</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="tm-sand" style="background:#FBF6E9;border-radius:10px;margin-bottom:22px">
<tr><td style="padding:16px 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td colspan="2" style="font-weight:800;font-size:14px;color:#1C1C1E;padding-bottom:10px">${L.summary}</td></tr>
<tr><td class="tm-muted" style="padding:6px 0;color:#6B7280">${L.crew}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1C1C1E">${quote.crew_size}</td></tr>
<tr><td class="tm-muted" style="padding:6px 0;color:#6B7280">${L.hours}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1C1C1E">${quote.estimated_hours} h</td></tr>
<tr><td class="tm-muted" style="padding:6px 0;color:#6B7280">${L.rate}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1C1C1E">${fmtMoney(quote.hourly_rate)} ${L.perMoverHr}</td></tr>
${truckLine}
<tr><td class="tm-muted" style="padding:6px 0;color:#6B7280">${L.deposit}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1C1C1E">${fmtMoney(quote.deposit_amount)}</td></tr>
<tr><td style="padding:12px 0 0 0;color:#1C1C1E;font-weight:800;font-size:15px;border-top:1px solid #E5E7EB">${L.total}</td><td style="padding:12px 0 0 0;text-align:right;color:#C8102E;font-weight:800;font-size:22px;border-top:1px solid #E5E7EB">${fmtMoney(quote.total)}</td></tr>
</table>
</td></tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:4px 0 10px 0">
<a href="${reserveHref}" style="display:inline-block;background:#C8102E;color:#ffffff;font-weight:800;font-size:15px;text-decoration:none;padding:14px 28px;border-radius:9999px;letter-spacing:0.01em">${L.cta}</a>
</td></tr></table>
<p class="tm-muted" style="margin:2px 0 0 0;font-size:12px;color:#6B7280;text-align:center">${L.fallback}</p>

</td></tr>

<tr><td class="tm-footer-bg" style="background:#F9FAFB;padding:14px 28px;text-align:center;color:#6B7280;font-size:11px">TORO MOVERS · Orlando, FL · (689) 600-2720 · toromovers.net</td></tr>

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
    replyEmail: profile.email || FROM_EMAIL,
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

  // Team Telegram alert
  notifyTelegramTeam([
    '*Quote sent*',
    '',
    out.customer.full_name ? `Customer: *${out.customer.full_name}*` : '',
    out.customer.phone ? `Phone: \`${out.customer.phone}\`` : '',
    `To: ${toEmail}`,
    `Total: *${fmtMoney(out.quote.total)}*` + (out.quote.truck_included ? ' · truck' : ''),
    out.language === 'es' ? 'Idioma: ES' : '',
    '',
    `Sent by: ${profile.email}`,
  ]).catch(e => console.error('quote-send telegram failed:', e.message));

  return respond(200, {
    quote_id: out.quote.id,
    sent_to: toEmail,
    sent_at: sentAt,
    signed_url: out.signedUrl,
    language: out.language,
  });
};
