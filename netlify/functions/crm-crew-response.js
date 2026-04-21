// CRM v2 — crm-crew-response
// GET /.netlify/functions/crm-crew-response?j=<job_id>&r=<action>&c=<crew_id>
//   action ∈ { accept, decline, info }
//
// Captures the crew's response to a dispatch email. Renders a branded
// confirmation page. Validates c matches job.crew_id (job_id + crew_id are
// UUIDs — reasonable security by obscurity for v1; future: add HMAC signing).

const { getAdminClient } = require('./_lib/supabase-admin');
const { notifyTelegramTeam, fmtMoney } = require('./_lib/crm-notifications');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function page({ title, message, accent = '#C8102E' }) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Toro Movers</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#ffffff;color:#1C1C1E;margin:0;padding:48px 20px;text-align:center;min-height:100vh;display:flex;align-items:center;justify-content:center}.card{max-width:480px;width:100%;background:#ffffff;border:1px solid #E5E7EB;border-radius:16px;padding:36px 28px}h1{color:${accent};margin:0 0 14px 0;font-weight:800;letter-spacing:-0.01em;font-size:22px}p{font-size:15px;line-height:1.55;color:#3A3A3D;margin:0 0 12px 0}a{color:#C8102E;font-weight:700;text-decoration:none}.foot{margin-top:24px;color:#6B7280;font-size:13px}</style></head><body><div class="card"><div style="font-weight:800;font-size:12px;letter-spacing:0.08em;color:#6B7280;text-transform:uppercase;margin-bottom:12px">TORO <span style="color:#C8102E">DISPATCH</span></div><h1>${escapeHtml(title)}</h1><p>${message}</p><p class="foot">Questions? Call ops at <a href="tel:+13217580094">(321) 758-0094</a>.</p></div></body></html>`,
  };
}

const ACTIONS = {
  accept:   { dbValue: 'accepted',   title: 'Got it — you\'re confirmed.',   message: 'Thanks for accepting. Ops has been notified.', accent: '#16A34A' },
  decline:  { dbValue: 'declined',   title: 'Thanks for letting us know.',   message: 'We\'ve marked this job as declined and ops will find another crew.', accent: '#6B7280' },
  info:     { dbValue: 'needs_info', title: 'Flagged for a call back.',      message: 'Ops has been pinged — we\'ll reach out shortly to answer your questions.', accent: '#F59E0B' },
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };

  const q = event.queryStringParameters || {};
  const { j: jobId, r: actionKey, c: crewId } = q;
  if (!jobId || !actionKey || !crewId) {
    return page({ title: 'Missing details', message: 'This link is incomplete. Use the button in your dispatch email, or reply to the email directly.' });
  }
  const action = ACTIONS[actionKey];
  if (!action) return page({ title: 'Unknown action', message: 'This link is invalid. Please reply to the dispatch email instead.' });

  const admin = getAdminClient();
  const { data: job, error } = await admin
    .from('jobs').select('*, crews(*), leads(*, customers(*))').eq('id', jobId).maybeSingle();
  if (error || !job) return page({ title: 'Job not found', message: 'We couldn\'t locate that job. It may have been reassigned.' });
  if (job.crew_id !== crewId) {
    return page({ title: 'Not assigned to you', message: 'This job is no longer assigned to your crew. Please ignore this email or call ops.' });
  }

  // Idempotent: don't overwrite a prior response with a different verb.
  const alreadyResponded = job.crew_response && job.crew_response !== 'pending' && job.crew_response !== action.dbValue;
  const nowIso = new Date().toISOString();
  await admin.from('jobs').update({
    crew_response: action.dbValue,
    crew_responded_at: nowIso,
  }).eq('id', jobId);

  const crew = job.crews || {};
  const customer = (job.leads && job.leads.customers) || {};
  const lead = job.leads || {};

  await admin.from('activity_log').insert({
    entity_type: 'job',
    entity_id: jobId,
    actor_id: null,
    event_type: 'crew_' + action.dbValue,
    payload: { crew_id: crewId, crew_name: crew.name, previous: alreadyResponded ? job.crew_response : 'pending' },
  });

  const teamLines = [
    actionKey === 'accept'  ? '*Crew ACCEPTED*' :
    actionKey === 'decline' ? '*Crew DECLINED*' :
                              '*Crew asked for info*',
    '',
    `Crew: *${crew.name || '—'}*`,
    `Customer: ${customer.full_name || '—'}${customer.phone ? ' · ' + customer.phone : ''}`,
    `Date: ${lead.move_date || '—'}`,
    job.customer_total ? `Job total: ${fmtMoney(job.customer_total)}` : '',
    alreadyResponded ? '_(Changed from previous ' + escapeHtml(job.crew_response) + ')_' : '',
  ].filter(Boolean);
  await notifyTelegramTeam(teamLines);

  return page({ title: action.title, message: action.message, accent: action.accent });
};
