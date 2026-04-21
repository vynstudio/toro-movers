// CRM v2 — backfill deposits from Stripe
// POST /.netlify/functions/backfill-deposits
//   Headers: Authorization: Bearer <user JWT>   (admin only)
//   Body:    { dry_run?: boolean, since_days?: number }
// Response: 200 { matched: [...], unmatched: [...], skipped: [...] }
//
// Pulls successful Stripe Checkout Sessions (payment_status='paid') from the
// last N days, matches each to a lead/job by customer email (fallback: phone),
// and writes deposit_paid + balance_due + payment_status + payment_method +
// payment_received_at on the job. Idempotent: skips jobs whose
// stripe_payment_intent_id already matches the session's PI.
//
// Use when a migrated lead never got its deposit recorded (e.g. imported from
// the v1 CRM after the Stripe payment had already cleared).

const Stripe = require('stripe');
const { getAdminClient, verifyUserJWT } = require('./_lib/supabase-admin');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function respond(s, b) {
  return { statusCode: s, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(b) };
}

function normEmail(e) {
  return e ? String(e).trim().toLowerCase() : '';
}
function normPhone(p) {
  return p ? String(p).replace(/\D+/g, '').slice(-10) : '';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let profile;
  try {
    ({ profile } = await verifyUserJWT(event.headers.authorization || event.headers.Authorization));
  } catch (e) {
    return respond(401, { error: e.message || 'Unauthorized' });
  }
  if (profile.role !== 'admin') return respond(403, { error: 'Admin only' });

  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch { /* ignore */ }
  const dryRun = payload.dry_run !== false; // default true for safety
  const sinceDays = Math.min(Math.max(Number(payload.since_days || 180), 1), 365);
  const sinceTs = Math.floor((Date.now() - sinceDays * 86400_000) / 1000);

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return respond(500, { error: 'STRIPE_SECRET_KEY not set' });
  const stripe = Stripe(stripeKey);
  const admin = getAdminClient();

  // Index all leads + their jobs so we can look up by email/phone in-memory.
  const { data: leads, error: leadErr } = await admin
    .from('leads')
    .select('id, customer_id, stage, customers(id, full_name, email, phone)');
  if (leadErr) return respond(500, { error: 'Lead fetch failed: ' + leadErr.message });

  const { data: jobs, error: jobErr } = await admin
    .from('jobs')
    .select('id, lead_id, quote_id, customer_total, deposit_paid, balance_due, stripe_payment_intent_id, payment_received_at');
  if (jobErr) return respond(500, { error: 'Job fetch failed: ' + jobErr.message });

  const jobByLead = new Map();
  for (const j of jobs || []) jobByLead.set(j.lead_id, j);

  const leadByEmail = new Map();
  const leadByPhone = new Map();
  for (const l of leads || []) {
    const c = l.customers || {};
    const e = normEmail(c.email);
    const p = normPhone(c.phone);
    if (e && !leadByEmail.has(e)) leadByEmail.set(e, l);
    if (p && !leadByPhone.has(p)) leadByPhone.set(p, l);
  }

  // Walk Stripe Checkout Sessions. We need line items / metadata, but
  // list-endpoint already returns enough (customer_email, amount_total,
  // payment_status, payment_intent, metadata, created).
  const matched = [];
  const unmatched = [];
  const skipped = [];
  let starting_after;
  let scanned = 0;

  while (true) {
    const page = await stripe.checkout.sessions.list({
      limit: 100,
      created: { gte: sinceTs },
      ...(starting_after ? { starting_after } : {}),
    });
    for (const s of page.data) {
      scanned++;
      if (s.payment_status !== 'paid') continue;
      const md = s.metadata || {};
      // Skip non-deposit flows (balance, bg_check_fee, etc.)
      if (md.purpose && md.purpose !== 'deposit') continue;
      const amount = s.amount_total ? s.amount_total / 100 : 0;
      if (amount <= 0) continue;

      const sessEmail = normEmail(s.customer_email || s.customer_details?.email);
      const sessPhone = normPhone(s.customer_details?.phone);
      const sessName = s.customer_details?.name || '';

      let lead = null;
      let matchBy = null;
      if (md.lead_id) {
        lead = (leads || []).find(l => l.id === md.lead_id) || null;
        if (lead) matchBy = 'metadata.lead_id';
      }
      if (!lead && sessEmail && leadByEmail.has(sessEmail)) {
        lead = leadByEmail.get(sessEmail); matchBy = 'email';
      }
      if (!lead && sessPhone && leadByPhone.has(sessPhone)) {
        lead = leadByPhone.get(sessPhone); matchBy = 'phone';
      }

      if (!lead) {
        unmatched.push({ session: s.id, email: sessEmail, phone: sessPhone, name: sessName, amount, created: s.created });
        continue;
      }
      const job = jobByLead.get(lead.id);
      if (!job) {
        unmatched.push({ session: s.id, email: sessEmail, name: sessName, amount, reason: 'lead has no job row', lead_id: lead.id });
        continue;
      }
      if (job.stripe_payment_intent_id && s.payment_intent && job.stripe_payment_intent_id === s.payment_intent) {
        skipped.push({ session: s.id, job_id: job.id, reason: 'already recorded (PI match)' });
        continue;
      }
      if (!dryRun) {
        const newPaid = Number(job.deposit_paid || 0) + amount;
        const newBalance = Math.max(0, Number(job.customer_total || 0) - newPaid);
        const paidAtIso = new Date((s.created || Math.floor(Date.now() / 1000)) * 1000).toISOString();
        const { error: updErr } = await admin.from('jobs').update({
          deposit_paid: newPaid,
          balance_due: newBalance,
          payment_method: 'card',
          payment_status: newBalance <= 0 ? 'paid' : 'partial',
          stripe_payment_intent_id: s.payment_intent || job.stripe_payment_intent_id,
          payment_received_at: job.payment_received_at || paidAtIso,
        }).eq('id', job.id);
        if (updErr) {
          unmatched.push({ session: s.id, job_id: job.id, reason: 'update failed: ' + updErr.message });
          continue;
        }
        // Refresh in-memory copy so further sessions from same customer stack correctly.
        job.deposit_paid = newPaid;
        job.balance_due = newBalance;
        job.stripe_payment_intent_id = s.payment_intent || job.stripe_payment_intent_id;
        job.payment_received_at = job.payment_received_at || paidAtIso;

        await admin.from('activity_log').insert({
          entity_type: 'job',
          entity_id: job.id,
          actor_id: profile.id,
          event_type: 'deposit_backfilled',
          payload: { amount, stripe_session: s.id, payment_intent: s.payment_intent, match_by: matchBy },
        });

        // If lead is still 'new'/'quoted', bump to 'booked' so it reflects reality.
        if (lead.stage === 'new' || lead.stage === 'quoted') {
          await admin.from('leads').update({ stage: 'booked' }).eq('id', lead.id);
        }
      }
      matched.push({
        session: s.id, job_id: job.id, lead_id: lead.id,
        name: sessName || lead.customers?.full_name || '—',
        email: sessEmail, amount, match_by: matchBy,
        dry_run: dryRun,
      });
    }
    if (!page.has_more) break;
    starting_after = page.data[page.data.length - 1].id;
  }

  return respond(200, {
    dry_run: dryRun,
    since_days: sinceDays,
    scanned,
    matched_count: matched.length,
    unmatched_count: unmatched.length,
    skipped_count: skipped.length,
    matched,
    unmatched,
    skipped,
  });
};
