// CRM v2 — dispatch-crew
// POST /.netlify/functions/dispatch-crew
//   Headers: Authorization: Bearer <user JWT>
//   Body:    { job_id }
//
// Emails the assigned crew with the job details + offered hourly payout.
// Falls back to a team Telegram alert if the crew has no email on file.
// Admin/dispatch only.

const { Resend } = require('resend');
const { getAdminClient, verifyUserJWT } = require('./_lib/supabase-admin');
const { notifyTelegramTeam } = require('./_lib/crm-notifications');

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
function fmtDate(d) {
  if (!d) return 'TBD';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(d);
  const dt = new Date(+m[1], +m[2] - 1, +m[3]);
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function fmtTime(t) {
  if (!t) return '';
  const m = String(t).match(/^(\d{2}):(\d{2})/);
  if (!m) return String(t);
  let h = +m[1];
  const mm = m[2];
  const ap = h >= 12 ? 'PM' : 'AM';
  h = ((h + 11) % 12) + 1;
  return `${h}:${mm} ${ap}`;
}

function renderCrewEmail({ crew, customer, lead, job, responseBase }) {
  const arrival = fmtTime(job.arrival_window_start);
  const endWin = fmtTime(job.arrival_window_end);
  const offeredRate = Number(job.offered_hourly_rate || 0);
  const estHours = Number(job.actual_hours || 0);
  const estMovers = Number(job.actual_movers || lead.crew_size || 2);
  const minHours = 2;
  const hoursForMin = estHours || minHours;
  const payoutEst = (offeredRate * estMovers * hoursForMin).toFixed(2);
  const rUrl = (r) => `${responseBase}&r=${r}`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>Toro dispatch</title>
<style>:root{color-scheme:light only}
@media (prefers-color-scheme: dark){body,.tm-shell,.tm-card{background:#ffffff !important;color:#1C1C1E !important}}</style>
</head>
<body class="tm-shell" style="margin:0;padding:0;background:#ffffff;color:#1C1C1E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" class="tm-shell" style="background:#ffffff;padding:32px 16px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" class="tm-card" style="max-width:620px;background:#ffffff;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden">
<tr><td style="background:#1C1C1E;padding:22px 28px;color:#ffffff">
<div style="font-weight:800;font-size:22px;letter-spacing:-0.01em;color:#ffffff">TORO <span style="color:#C8102E">DISPATCH</span></div>
<div style="font-size:12px;margin-top:4px;color:#D1D5DB">Crew: ${crew.name}</div>
</td></tr>
<tr><td style="padding:28px;background:#ffffff;color:#1C1C1E">
<p style="margin:0 0 6px 0;font-size:13px;color:#6B7280">JOB</p>
<h2 style="margin:0 0 20px 0;font-size:20px;font-weight:800">${customer.full_name || 'Customer'}</h2>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6E9;border-radius:10px;margin-bottom:18px"><tr><td style="padding:16px 18px">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:6px 0;color:#6B7280;width:40%">Move date</td><td style="padding:6px 0;text-align:right;font-weight:700">${fmtDate(job.scheduled_date)}</td></tr>
<tr><td style="padding:6px 0;color:#6B7280">Arrival window</td><td style="padding:6px 0;text-align:right;font-weight:700">${arrival ? arrival + (endWin ? ' – ' + endWin : '') : 'TBD'}</td></tr>
<tr><td style="padding:6px 0;color:#6B7280">Crew size</td><td style="padding:6px 0;text-align:right;font-weight:700">${estMovers} movers</td></tr>
<tr><td style="padding:6px 0;color:#6B7280">Estimated hours</td><td style="padding:6px 0;text-align:right;font-weight:700">${estHours || '—'} h ${estHours ? '' : '(open-ended)'}</td></tr>
</table>
</td></tr></table>

<p style="margin:0 0 6px 0;font-size:13px;color:#6B7280">CUSTOMER</p>
<p style="margin:0 0 4px 0;font-size:15px;font-weight:700">${customer.full_name || '—'}</p>
<p style="margin:0 0 2px 0;font-size:14px">${customer.phone || '—'}</p>
<p style="margin:0 0 18px 0;font-size:14px;color:#6B7280">${customer.email || ''}</p>

<p style="margin:0 0 6px 0;font-size:13px;color:#6B7280">FROM</p>
<p style="margin:0 0 16px 0;font-size:14px;line-height:1.5;white-space:pre-line">${lead.origin_address || '—'}</p>

<p style="margin:0 0 6px 0;font-size:13px;color:#6B7280">TO</p>
<p style="margin:0 0 24px 0;font-size:14px;line-height:1.5;white-space:pre-line">${lead.destination_address || '—'}</p>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#1C1C1E;border-radius:10px;margin-bottom:16px"><tr><td style="padding:16px 18px;color:#ffffff">
<div style="font-size:12px;color:#FFE8EC;letter-spacing:0.05em;text-transform:uppercase;font-weight:700;margin-bottom:6px">Your offer</div>
<div style="font-size:28px;font-weight:800;color:#ffffff">${fmtUsd(offeredRate)} <span style="font-size:14px;color:#D1D5DB;font-weight:600">/ mover / hr</span></div>
<div style="font-size:12px;color:#D1D5DB;margin-top:4px">Estimated payout this job: <strong style="color:#ffffff">${fmtUsd(payoutEst)}</strong> (${estMovers} × ${hoursForMin}h ${minHours}h min)</div>
</td></tr></table>

${lead.notes ? `<p style="margin:0 0 6px 0;font-size:13px;color:#6B7280">NOTES FROM SALES</p><p style="margin:0 0 18px 0;font-size:14px;line-height:1.5;color:#3A3A3D">${String(lead.notes).replace(/\n/g, '<br>')}</p>` : ''}
${job.notes ? `<p style="margin:0 0 6px 0;font-size:13px;color:#6B7280">JOB NOTES</p><p style="margin:0 0 18px 0;font-size:14px;line-height:1.5;color:#3A3A3D">${String(job.notes).replace(/\n/g, '<br>')}</p>` : ''}

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 6px 0"><tr><td align="center" style="padding:10px 0">
<a href="${rUrl('accept')}" style="display:inline-block;background:#16A34A;color:#ffffff;font-weight:800;font-size:15px;text-decoration:none;padding:13px 22px;border-radius:9999px;margin:4px 4px">Accept</a>
<a href="${rUrl('decline')}" style="display:inline-block;background:#ffffff;color:#6B7280;font-weight:700;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:9999px;border:2px solid #D1D5DB;margin:4px 4px">Can't take it</a>
<a href="${rUrl('info')}" style="display:inline-block;background:#ffffff;color:#C8102E;font-weight:700;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:9999px;border:2px solid #C8102E;margin:4px 4px">Ask for info</a>
</td></tr></table>

<p style="margin:10px 0 0 0;font-size:13px;color:#6B7280;text-align:center">Or call ops: <a href="tel:+13217580094" style="color:#C8102E">(321) 758-0094</a>.</p>
</td></tr>
<tr><td style="background:#F9FAFB;padding:14px 28px;text-align:center;color:#6B7280;font-size:11px">TORO MOVERS · Orlando, FL · (321) 758-0094 · toromovers.net</td></tr>
</table></td></tr></table>
</body></html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

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
  if (!job.crew_id) return respond(400, { error: 'No crew assigned to this job' });

  const { data: crew } = await admin.from('crews').select('*').eq('id', job.crew_id).maybeSingle();
  if (!crew) return respond(404, { error: 'Crew not found' });

  const lead = job.leads || {};
  const customer = lead.customers || {};

  // Offered rate fallback: if job.offered_hourly_rate is 0/null, use the crew's own 4hr flat rate / hours or a default.
  if (!job.offered_hourly_rate) {
    return respond(400, { error: 'Set the offered hourly rate on the job first.' });
  }

  // Reset crew response + rotate the dispatch token so stale or forwarded
  // emails (from a previous dispatch) stop working.
  const dispatchToken = require('crypto').randomUUID();
  await admin.from('jobs').update({
    crew_response: 'pending',
    crew_responded_at: null,
    crew_response_note: null,
    crew_dispatch_token: dispatchToken,
  }).eq('id', job_id);

  // Per-dispatch token `t` is required by crm-crew-response; it must match
  // jobs.crew_dispatch_token or the click is rejected as "Link expired".
  const origin = process.env.URL || `https://${event.headers.host}` || 'https://toromovers-crm.netlify.app';
  const responseBase = `${origin}/.netlify/functions/crm-crew-response?j=${encodeURIComponent(job_id)}&c=${encodeURIComponent(crew.id)}&t=${encodeURIComponent(dispatchToken)}`;

  // Send email if crew has one, else Telegram-only fallback.
  let channelUsed = 'telegram';
  if (crew.email && process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const { error: sendErr } = await resend.emails.send({
        from: `Toro Dispatch <${FROM_EMAIL}>`,
        to: [crew.email],
        replyTo: profile.email || FROM_EMAIL,
        subject: `Job offer — ${customer.full_name || 'Customer'} · ${fmtDate(job.scheduled_date)}`,
        html: renderCrewEmail({ crew, customer, lead, job, responseBase }),
      });
      if (sendErr) return respond(500, { error: 'Email send failed: ' + (sendErr.message || '') });
      channelUsed = 'email';
    } catch (e) {
      return respond(500, { error: 'Email send failed: ' + e.message });
    }
  }

  // Always also ping the ops team on Telegram so dispatch is audited.
  notifyTelegramTeam([
    '*Crew dispatched*',
    '',
    `Crew: *${crew.name}*${crew.email ? ' · ' + crew.email : ' (no email — telegram only)'}`,
    `Customer: ${customer.full_name || '—'}${customer.phone ? ' · ' + customer.phone : ''}`,
    `Date: ${fmtDate(job.scheduled_date)}${job.arrival_window_start ? ' · ' + fmtTime(job.arrival_window_start) : ''}`,
    `Offer: *${fmtUsd(job.offered_hourly_rate)}/mover/hr*`,
    `From: ${lead.origin_address || '—'}`,
    `To: ${lead.destination_address || '—'}`,
    '',
    `Dispatched by: ${profile.email}`,
  ]).catch(e => console.error('dispatch telegram failed:', e.message));

  await admin.from('activity_log').insert({
    entity_type: 'job',
    entity_id: job_id,
    actor_id: profile.id,
    event_type: 'crew_dispatched',
    payload: {
      crew_id: crew.id,
      crew_name: crew.name,
      channel: channelUsed,
      offered_hourly_rate: job.offered_hourly_rate,
    },
  });

  return respond(200, {
    ok: true,
    channel: channelUsed,
    crew: crew.name,
    to: crew.email || null,
    offered_hourly_rate: job.offered_hourly_rate,
  });
};
