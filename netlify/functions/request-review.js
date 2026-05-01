// CRM v2 — request-review
// POST /.netlify/functions/request-review
//   Headers: Authorization: Bearer <supabase user JWT>
//   Body:    { lead_id }
// Response: 200 { sent_to, review_url, job_id? }
//
// Sends a branded "leave us a review" email to the customer via Resend,
// sets jobs.review_requested_at = now (if a job exists for the lead),
// logs a 'review_requested' activity event.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
//      RESEND_FROM_EMAIL (default hello@toromovers.net),
//      GOOGLE_REVIEW_URL (default google.com search — set a real place URL).

const { Resend } = require('resend');
const { getAdminClient, verifyUserJWT } = require('./_lib/supabase-admin');

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'hello@toromovers.net';
const REVIEW_URL = process.env.GOOGLE_REVIEW_URL
  || 'https://g.page/r/CYAKurQHh5TvEAI/review';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function respond(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const COPY = {
  en: {
    subject: (name) => `${name ? name + ', h' : 'H'}ow did we do?`,
    hi: 'Hi',
    body: "Hope the move went smoothly. We're a small family-owned crew — a quick Google review goes a long way for us.",
    cta: 'Leave a review',
    fallback: 'Or call (689) 600-2720 if anything needs fixing.',
    tagline: 'Moving People Forward',
  },
  es: {
    subject: (name) => `${name ? name + ', c' : 'C'}omo nos fue?`,
    hi: 'Hola',
    body: 'Esperamos que tu mudanza haya salido bien. Somos una cuadrilla familiar — una resena rapida en Google nos ayuda muchisimo.',
    cta: 'Dejar una resena',
    fallback: 'O llama al (689) 600-2720 si algo necesita arreglarse.',
    tagline: 'Mudanzas honestas. Manos fuertes.',
  },
};

function renderHtml({ firstName, lang }) {
  const L = COPY[lang];
  return `<!DOCTYPE html>
<html lang="${lang}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Toro Movers</title>
<style>:root{color-scheme:light only;supported-color-schemes:light only}
@media (prefers-color-scheme: dark){body,.tm-shell,.tm-card{background:#ffffff !important;color:#1C1C1E !important}.tm-footer-bg{background:#F9FAFB !important;color:#6B7280 !important}}</style>
</head>
<body class="tm-shell" style="margin:0;padding:0;background:#ffffff;color:#1C1C1E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="tm-shell" style="background:#ffffff;padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="tm-card" style="max-width:560px;background:#ffffff;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden">
<tr><td style="background:#C8102E;padding:22px 28px;color:#ffffff">
<div style="font-weight:800;font-size:22px;letter-spacing:-0.01em;color:#ffffff">TORO MOVERS</div>
<div style="font-size:12px;margin-top:4px;color:#FFE8EC">${L.tagline}</div>
</td></tr>
<tr><td style="padding:32px 28px;background:#ffffff;color:#1C1C1E">
<p style="margin:0 0 12px 0;font-size:15px;color:#1C1C1E">${L.hi} ${firstName},</p>
<p style="margin:0 0 22px 0;font-size:15px;line-height:1.55;color:#1C1C1E">${L.body}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:4px 0 10px 0">
<a href="${REVIEW_URL}" style="display:inline-block;background:#C8102E;color:#ffffff;font-weight:800;font-size:15px;text-decoration:none;padding:14px 28px;border-radius:9999px">${L.cta}</a>
</td></tr></table>
<p style="margin:2px 0 0 0;font-size:12px;color:#6B7280;text-align:center">${L.fallback}</p>
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
  const { lead_id } = payload;
  if (!lead_id) return respond(400, { error: 'lead_id required' });

  const admin = getAdminClient();
  const { data: lead, error: leadErr } = await admin
    .from('leads').select('*, customers(*)').eq('id', lead_id).maybeSingle();
  if (leadErr || !lead) return respond(404, { error: 'Lead not found' });

  const customer = lead.customers || {};
  const toEmail = customer.email;
  if (!toEmail) return respond(400, { error: 'Customer has no email on file' });

  const lang = customer.language_preference === 'es' ? 'es' : 'en';
  const firstName = String(customer.full_name || '').split(/\s+/)[0] || '';
  const L = COPY[lang];

  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    const { error: sendErr } = await resend.emails.send({
      from: `Toro Movers <${FROM_EMAIL}>`,
      to: [toEmail],
      replyTo: profile.email || FROM_EMAIL,
      subject: L.subject(firstName),
      html: renderHtml({ firstName, lang }),
    });
    if (sendErr) return respond(500, { error: 'Email send failed: ' + (sendErr.message || JSON.stringify(sendErr)) });
  } catch (e) {
    return respond(500, { error: 'Email send failed: ' + e.message });
  }

  // Mark the most recent job for this lead as review-requested.
  const { data: job } = await admin
    .from('jobs').select('id').eq('lead_id', lead_id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const requestedAt = new Date().toISOString();
  if (job) {
    await admin.from('jobs').update({ review_requested_at: requestedAt }).eq('id', job.id);
  }

  await admin.from('activity_log').insert({
    entity_type: job ? 'job' : 'lead',
    entity_id: job ? job.id : lead_id,
    actor_id: profile.id,
    event_type: 'review_requested',
    payload: { lead_id, to: toEmail, language: lang, review_url: REVIEW_URL },
  });

  return respond(200, {
    sent_to: toEmail,
    review_url: REVIEW_URL,
    job_id: job ? job.id : null,
    requested_at: requestedAt,
  });
};
