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
  const previewTo = (q.to || '').trim();
  const isSample = q.sample === '1' || q.sample === 'true';

  // Sample preview mode — no real lead lookup, uses fake data, sends to ?to=
  if (isSample) {
    if (!previewTo) return json(400, { error: 'Sample mode requires ?to=email' });
    const sampleLead = {
      id: 'sample',
      name: 'Jane Preview',
      email: previewTo,
      phone: '(321) 555-0100',
      zip_from: '32801',
      zip_to: '32789',
      furniture_size: '2 bedroom apartment',
      floor: '3rd floor',
      stairs_elevator: 'elevator',
      move_date: 'Saturday, April 20, 2026',
      boxes_count: '25',
      tv_count: '2',
      assembly: 'yes',
      wrapping: 'yes',
      estimate: { hours: 4, total: 600, movers: 2 },
    };
    try {
      const result = await sendBookingConfirmation(sampleLead, depositOverride ?? 150);
      return json(200, { ok: true, preview: true, to: previewTo, resendId: result?.data?.id || null });
    } catch(e) {
      return json(500, { error: e.message });
    }
  }

  if (!email && !leadId) {
    return json(400, { error: 'Provide ?email= or ?leadId= (or ?sample=1&to=YOUR_EMAIL for preview)' });
  }

  let lead;
  if (leadId) {
    lead = await getLead(leadId);
  } else {
    const index = await listLeads();
    const match = index.find(l => l.email && l.email.toLowerCase() === email);
    if (match) lead = await getLead(match.id);
  }

  // Manual mode — customer paid via direct Stripe link, no CRM lead exists.
  // Build a lead object from query params. Usage:
  //   ?email=X&manual=1&name=X&move_date=X&zip_from=X&zip_to=X&hours=X&movers=X&total=X&deposit=X
  if (!lead && q.manual === '1') {
    lead = {
      id: 'manual-' + Date.now().toString(36),
      name: q.name || '',
      email: email,
      phone: q.phone || '',
      zip_from: q.zip_from || '',
      zip_to: q.zip_to || '',
      furniture_size: q.furniture_size || '',
      floor: q.floor || '',
      stairs_elevator: q.stairs_elevator || '',
      move_date: q.move_date || '',
      boxes_count: q.boxes_count || '',
      tv_count: q.tv_count || '',
      assembly: q.assembly || '',
      wrapping: q.wrapping || '',
      estimate: {
        hours: Number(q.hours) || 0,
        movers: Number(q.movers) || 0,
        total: Number(q.total) || 0,
        truck: q.truck === '1' || q.truck === 'true',
      },
    };
  }

  if (!lead) return json(404, { error: 'Lead not found. Add &manual=1&name=...&move_date=... for customers who paid via direct Stripe link.', email, leadId });
  if (!lead.email) return json(400, { error: 'Lead has no email on file', leadId: lead.id });

  // Preview: override recipient but keep real lead data
  if (previewTo) lead = { ...lead, email: previewTo };

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
