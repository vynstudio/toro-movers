// CRM v2 — email-balance
// POST /.netlify/functions/email-balance
//   Headers: Authorization: Bearer <user JWT>
//   Body:    { job_id }
//
// Emails the customer a branded "Pay the balance" link that opens
// /.netlify/functions/balance-checkout?j=<job_id>. Admin/dispatch only.

const { Resend } = require('resend');
const { getAdminClient, verifyUserJWT } = require('./_lib/supabase-admin');

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'hello@toromovers.net';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function respond(s, b) {
  return { statusCode: s, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(b) };
}
function fmtUsd(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const COPY = {
  en: {
    subject: (amount) => `Toro Movers — balance ${amount} due`,
    hi: 'Hi',
    lead: (amount, total) => `Thanks again for moving with Toro. Your remaining balance of <strong>${amount}</strong> (of ${total}) is ready to pay online.`,
    cta: 'Pay balance now',
    fallback: 'Or call (321) 758-0094 — we can also take payment by phone.',
    tagline: 'Moving People Forward',
  },
  es: {
    subject: (amount) => `Toro Movers — saldo pendiente ${amount}`,
    hi: 'Hola',
    lead: (amount, total) => `Gracias de nuevo por mudarte con Toro. Tu saldo pendiente de <strong>${amount}</strong> (de ${total}) ya esta listo para pagar en linea.`,
    cta: 'Pagar saldo ahora',
    fallback: 'O llama al (321) 758-0094 — tambien recibimos pago por telefono.',
    tagline: 'Mudanzas honestas. Manos fuertes.',
  },
};

function renderHtml({ firstName, lang, payUrl, balance, total }) {
  const L = COPY[lang];
  return `<!DOCTYPE html>
<html lang="${lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>Toro Movers</title>
<style>:root{color-scheme:light only;supported-color-schemes:light only}
@media (prefers-color-scheme: dark){body,.tm-shell,.tm-card{background:#ffffff !important;color:#1C1C1E !important}.tm-footer-bg{background:#F9FAFB !important;color:#6B7280 !important}}</style>
</head>
<body class="tm-shell" style="margin:0;padding:0;background:#ffffff;color:#1C1C1E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" class="tm-shell" style="background:#ffffff;padding:32px 16px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" class="tm-card" style="max-width:560px;background:#ffffff;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden">
<tr><td style="background:#C8102E;padding:22px 28px;color:#ffffff">
<div style="font-weight:800;font-size:22px;letter-spacing:-0.01em;color:#ffffff">TORO MOVERS</div>
<div style="font-size:12px;margin-top:4px;color:#FFE8EC">${L.tagline}</div>
</td></tr>
<tr><td style="padding:32px 28px;background:#ffffff;color:#1C1C1E">
<p style="margin:0 0 14px 0;font-size:15px;color:#1C1C1E">${L.hi} ${firstName},</p>
<p style="margin:0 0 22px 0;font-size:15px;line-height:1.55;color:#1C1C1E">${L.lead(fmtUsd(balance), fmtUsd(total))}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:4px 0 10px 0">
<a href="${payUrl}" style="display:inline-block;background:#C8102E;color:#ffffff;font-weight:800;font-size:15px;text-decoration:none;padding:14px 28px;border-radius:9999px">${L.cta}</a>
</td></tr></table>
<p style="margin:4px 0 0 0;font-size:12px;color:#6B7280;text-align:center">${L.fallback}</p>
</td></tr>
<tr><td class="tm-footer-bg" style="background:#F9FAFB;padding:14px 28px;text-align:center;color:#6B7280;font-size:11px">TORO MOVERS · Orlando, FL · (321) 758-0094 · toromovers.net</td></tr>
</table></td></tr></table>
</body></html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  if (!process.env.RESEND_API_KEY) return respond(500, { error: 'Resend not configured' });

  let profile;
  try {
    ({ profile } = await verifyUserJWT(event.headers.authorization || event.headers.Authorization));
  } catch (e) { return respond(401, { error: e.message }); }
  if (!['admin', 'dispatch'].includes(profile.role)) return respond(403, { error: 'Admin/dispatch only' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON' }); }
  const { job_id } = payload;
  if (!job_id) return respond(400, { error: 'job_id required' });

  const admin = getAdminClient();
  const { data: job, error } = await admin
    .from('jobs').select('*, leads(*, customers(*))').eq('id', job_id).maybeSingle();
  if (error || !job) return respond(404, { error: 'Job not found' });

  const customer = job.leads && job.leads.customers ? job.leads.customers : null;
  if (!customer || !customer.email) return respond(400, { error: 'Customer has no email' });
  if (Number(job.balance_due || 0) <= 0) return respond(400, { error: 'No balance due' });

  const origin = process.env.URL || `https://${event.headers.host}`;
  const payUrl = `${origin}/.netlify/functions/balance-checkout?j=${encodeURIComponent(job_id)}`;
  const lang = customer.language_preference === 'es' ? 'es' : 'en';
  const L = COPY[lang];
  const firstName = String(customer.full_name || '').split(/\s+/)[0] || '';

  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    const { error: sendErr } = await resend.emails.send({
      from: `Toro Movers <${FROM_EMAIL}>`,
      to: [customer.email],
      replyTo: profile.email || FROM_EMAIL,
      subject: L.subject(fmtUsd(job.balance_due)),
      html: renderHtml({ firstName, lang, payUrl, balance: job.balance_due, total: job.customer_total }),
    });
    if (sendErr) return respond(500, { error: 'Email send failed: ' + (sendErr.message || '') });
  } catch (e) {
    return respond(500, { error: 'Email send failed: ' + e.message });
  }

  await admin.from('activity_log').insert({
    entity_type: 'job',
    entity_id: job_id,
    actor_id: profile.id,
    event_type: 'balance_link_sent',
    payload: { to: customer.email, amount: job.balance_due, language: lang },
  });

  return respond(200, { sent_to: customer.email, pay_url: payUrl });
};
