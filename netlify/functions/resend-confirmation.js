// Admin-only endpoint to manually resend a booking confirmation email.
// Used to backfill customers who paid before the auto-confirmation flow shipped.
//
// Auth: shared CRM_PASSWORD (header `x-crm-password` or `?pw=`).
// Lookup: pass `email` OR `leadId` in query string. Optional `deposit` overrides
// the deposit amount if the lead record doesn't have it on file.
//
// Example:
//   curl "https://toromovers.net/.netlify/functions/resend-confirmation?pw=XXX&email=jane@example.com&deposit=150"

const { getStore } = require('@netlify/blobs'); // Netlify Blobs runtime hint
const { listLeads, getLead } = require('./_lib/leads');
const { sendBookingConfirmation } = require('./_lib/emails');

const json = (status, data) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(data),
});

exports.handler = async (event) => {
  const pw = event.headers['x-crm-password'] || event.queryStringParameters?.pw || '';
  const expected = process.env.CRM_PASSWORD;
  if (!expected) return json(500, { error: 'CRM_PASSWORD not configured' });
  if (pw !== expected) return json(401, { error: 'Unauthorized' });

  const q = event.queryStringParameters || {};
  const email = (q.email || '').trim().toLowerCase();
  const leadId = (q.leadId || '').trim();
  const depositOverride = q.deposit ? Number(q.deposit) : null;

  if (!email && !leadId) {
    return json(400, { error: 'Provide ?email= or ?leadId=' });
  }

  let lead;
  if (leadId) {
    lead = await getLead(leadId);
  } else {
    const index = await listLeads();
    const match = index.find(l => l.email && l.email.toLowerCase() === email);
    if (match) lead = await getLead(match.id);
  }

  if (!lead) return json(404, { error: 'Lead not found', email, leadId });
  if (!lead.email) return json(400, { error: 'Lead has no email on file', leadId: lead.id });

  const deposit = depositOverride ?? lead.estimate?.deposit ?? 150;

  try {
    const result = await sendBookingConfirmation(lead, deposit);
    return json(200, {
      ok: true,
      leadId: lead.id,
      to: lead.email,
      deposit,
      resendId: result?.data?.id || null,
    });
  } catch(e) {
    console.error('resend-confirmation failed:', e);
    return json(500, { error: e.message });
  }
};
