// CRM v2 — crm-kpis
// GET /.netlify/functions/crm-kpis
//   Headers: Authorization: Bearer <supabase user JWT>
// Response: 200 {
//   week: { revenue, margin, jobs_done, jobs_scheduled, close_rate, leads_created, leads_closed },
//   pipeline: { open_value, open_count }
// }
//
// Admin-only. Computes the trailing-7-day window from now.

const { getAdminClient, verifyUserJWT } = require('./_lib/supabase-admin');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
function respond(s, b) {
  return { statusCode: s, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(b) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  let profile;
  try {
    ({ profile } = await verifyUserJWT(event.headers.authorization || event.headers.Authorization));
  } catch (e) {
    return respond(401, { error: e.message || 'Unauthorized' });
  }
  if (profile.role !== 'admin') return respond(403, { error: 'Admin only' });

  const admin = getAdminClient();
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - 7);
  const weekStartIso = weekStart.toISOString();
  const weekStartDate = weekStartIso.slice(0, 10);
  const todayDate = now.toISOString().slice(0, 10);

  // Jobs scheduled in the last 7 days.
  const { data: weekJobs } = await admin
    .from('jobs')
    .select('customer_total, internal_cost_total, scheduled_date, payment_status')
    .gte('scheduled_date', weekStartDate)
    .lte('scheduled_date', todayDate);
  const wj = weekJobs || [];
  const revenue = wj.reduce((a, j) => a + Number(j.customer_total || 0), 0);
  const margin = wj.reduce(
    (a, j) => a + (Number(j.customer_total || 0) - Number(j.internal_cost_total || 0)),
    0,
  );
  const jobsScheduled = wj.length;
  const jobsDone = wj.filter(j => j.payment_status === 'paid').length;

  // Leads created in the last 7 days → close rate.
  const { data: weekLeads } = await admin
    .from('leads').select('stage, created_at')
    .gte('created_at', weekStartIso);
  const wl = weekLeads || [];
  const closedStages = ['booked', 'done'];
  const leadsCreated = wl.length;
  const leadsClosed = wl.filter(l => closedStages.includes(l.stage)).length;
  const closeRate = leadsCreated > 0 ? leadsClosed / leadsCreated : 0;

  // Open pipeline value.
  const { data: openLeads } = await admin
    .from('leads').select('estimated_value')
    .in('stage', ['new', 'contacted', 'quoted']);
  const ol = openLeads || [];
  const pipelineValue = ol.reduce((a, l) => a + Number(l.estimated_value || 0), 0);

  return respond(200, {
    week: {
      revenue,
      margin,
      jobs_done: jobsDone,
      jobs_scheduled: jobsScheduled,
      close_rate: closeRate,
      leads_created: leadsCreated,
      leads_closed: leadsClosed,
    },
    pipeline: {
      open_value: pipelineValue,
      open_count: ol.length,
    },
  });
};
