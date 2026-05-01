// Send follow-up email templates to leads.
// Auth: CRM_PASSWORD via ?pw= or x-crm-password header.
// Params: ?leadId=xxx&template=day1|day2|day3|day4|day5|referral
//
// Day 1-5 are standard follow-up drips for unconverted leads.
// "referral" is the day-6+ template offering $50 off + referral ask.

const { getStore } = require('@netlify/blobs');
const { Resend } = require('resend');
const { getLead, addNote } = require('./_lib/leads');

const json = (status, data) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(data),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-crm-password', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: '' };

  const pw = event.headers['x-crm-password'] || event.queryStringParameters?.pw || '';
  if (!process.env.CRM_PASSWORD || pw !== process.env.CRM_PASSWORD) return json(401, { error: 'Unauthorized' });

  const q = event.queryStringParameters || {};
  const leadId = (q.leadId || '').trim();
  const template = (q.template || '').trim();

  if (!leadId) return json(400, { error: 'leadId required' });
  if (!template) return json(400, { error: 'template required (day1-day5 or referral)' });

  const lead = await getLead(leadId);
  if (!lead) return json(404, { error: 'Lead not found' });
  if (!lead.email) return json(400, { error: 'Lead has no email' });

  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'hello@toromovers.net';
  const firstName = (lead.name || '').split(' ')[0] || 'there';
  const adminBcc = process.env.ADMIN_BCC_EMAIL || 'dilerbizz@gmail.com';
  const est = lead.estimate || {};
  const total = est.total || 0;
  const reviewUrl = process.env.GOOGLE_REVIEW_URL || 'https://g.page/r/CYAKurQHh5TvEAI/review';

  // Deposit rules: truck+labor=$125, labor-only=$50, single-item=$50
  const deposit = est.truck ? 125 : 50;
  const depositLabel = est.truck ? '$125' : '$50';
  const bookUrl = `https://toromovers.net/.netlify/functions/reserve-from-email?truck=${!!est.truck}&total=${total}&movers=${est.movers||2}&hours=${est.hours||2}&name=${encodeURIComponent(lead.name||'')}&email=${encodeURIComponent(lead.email||'')}&phone=${encodeURIComponent(lead.phone||'')}`;
  const bookCta = `<div style="text-align:center;margin:24px 0"><a href="${bookUrl}" style="display:inline-block;background:#C8102E;color:#fff;padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:800;font-size:15px">Book Now — ${depositLabel} deposit →</a><div style="font-size:12px;color:#6b7280;margin-top:8px">Secure your date. Balance paid after the move.</div></div>`;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const templates = {
    day1: {
      subject: `${firstName}, thanks for reaching out to Toro Movers`,
      body: `
        <h2 style="margin:0 0 14px;font-size:22px">Hey ${esc(firstName)} — we got your inquiry!</h2>
        <p style="margin:0 0 16px;color:#3a3a3a;font-size:15px;line-height:1.6">Thanks for reaching out. Here's what happens next:</p>
        <ol style="color:#3a3a3a;font-size:15px;line-height:1.8;padding-left:20px">
          <li><strong>We review your move details</strong> (usually within 1 hour)</li>
          <li><strong>We call or text you</strong> to confirm the plan and crew size</li>
          <li><strong>You lock in your date</strong> with a small deposit — balance paid after the move</li>
        </ol>
        ${total ? '<p style="margin:16px 0;color:#3a3a3a;font-size:15px">Your estimated total: <strong>$'+total+'</strong> ($75/mover/hour, no hidden fees).</p>' : ''}
        ${bookCta}
        <p style="margin:16px 0;color:#3a3a3a;font-size:15px">Questions? Just reply to this email or call <a href="tel:+16896002720" style="color:#C8102E;font-weight:700">(689) 600-2720</a>.</p>
      `,
    },
    day2: {
      subject: `Quick question about your move, ${firstName}`,
      body: `
        <h2 style="margin:0 0 14px;font-size:22px">Hey ${esc(firstName)} — quick question</h2>
        <p style="margin:0 0 16px;color:#3a3a3a;font-size:15px;line-height:1.6">I wanted to make sure we have the right details for your move. A couple of things that help us give you the most accurate quote:</p>
        <ul style="color:#3a3a3a;font-size:15px;line-height:1.8;padding-left:20px">
          <li>Will there be <strong>stairs or an elevator</strong> at either location?</li>
          <li>Any <strong>heavy items</strong> (piano, safe, gym equipment)?</li>
          <li>Do you need <strong>packing help</strong> or just loading/unloading?</li>
        </ul>
        <p style="margin:16px 0;color:#3a3a3a;font-size:15px">A quick reply with these details and I'll lock in your quote within minutes. No obligation.</p>
      `,
    },
    day3: {
      subject: `Still need help with your move, ${firstName}?`,
      body: `
        <h2 style="margin:0 0 14px;font-size:22px">Hey ${esc(firstName)} — still planning your move?</h2>
        <p style="margin:0 0 16px;color:#3a3a3a;font-size:15px;line-height:1.6">Just checking in. I know moving is stressful and things get busy — no pressure at all.</p>
        <p style="margin:0 0 16px;color:#3a3a3a;font-size:15px;line-height:1.6">If you're still looking for movers, here's why families choose us:</p>
        <ul style="color:#3a3a3a;font-size:15px;line-height:1.8;padding-left:20px">
          <li><strong>$75/mover/hour</strong> — flat rate, no surprises</li>
          <li><strong>Same-day availability</strong> for last-minute moves</li>
          <li><strong>Insured</strong> — your stuff is protected</li>
          <li><strong>Family-owned</strong> — we treat your home like ours</li>
        </ul>
        ${bookCta}
        <p style="margin:16px 0;color:#3a3a3a;font-size:15px">Or reply here / call <a href="tel:+16896002720" style="color:#C8102E;font-weight:700">(689) 600-2720</a>.</p>
      `,
    },
    day4: {
      subject: `Your moving estimate is waiting, ${firstName}`,
      body: `
        <h2 style="margin:0 0 14px;font-size:22px">${esc(firstName)}, your estimate is ready</h2>
        ${total ? '<div style="background:#f0fdf4;border:1px solid #16a34a;border-radius:10px;padding:18px;text-align:center;margin:16px 0"><div style="font-size:14px;color:#15803d;margin-bottom:4px">Your estimated total</div><div style="font-size:32px;font-weight:900;color:#111">$'+total+'</div><div style="font-size:12px;color:#6b7280;margin-top:4px">$75/mover/hr · no hidden fees · balance after the job</div></div>' : ''}
        <p style="margin:16px 0;color:#3a3a3a;font-size:15px;line-height:1.6">Our calendar is filling up. Lock in your preferred date with a small deposit ($50 labor-only / $125 with truck) and we'll handle the rest.</p>
        ${bookCta}
      `,
    },
    day5: {
      subject: `Last call — your moving quote expires soon, ${firstName}`,
      body: `
        <h2 style="margin:0 0 14px;font-size:22px">Last chance, ${esc(firstName)}</h2>
        <p style="margin:0 0 16px;color:#3a3a3a;font-size:15px;line-height:1.6">I don't want to bug you — this is my last follow-up. If you've found another mover, no hard feelings at all.</p>
        <p style="margin:0 0 16px;color:#3a3a3a;font-size:15px;line-height:1.6">But if you're still on the fence:</p>
        <ul style="color:#3a3a3a;font-size:15px;line-height:1.8;padding-left:20px">
          <li>We still have availability for your date</li>
          <li>Your quote hasn't changed — same flat rate</li>
          <li>One reply or call and you're booked in 2 minutes</li>
        </ul>
        <p style="margin:16px 0;color:#3a3a3a;font-size:15px">Either way, I wish you a smooth move. We're here if you need us.</p>
        ${bookCta}
      `,
    },
    referral: {
      subject: `${firstName}, here's $50 off your next move (+ a favor)`,
      body: `
        <h2 style="margin:0 0 14px;font-size:22px">Hey ${esc(firstName)} — thanks again for choosing Toro Movers!</h2>
        <p style="margin:0 0 16px;color:#3a3a3a;font-size:15px;line-height:1.6">We loved helping with your move and hope everything's settling in nicely.</p>
        <p style="margin:0 0 16px;color:#3a3a3a;font-size:15px;line-height:1.6">Quick favor — <strong>know anyone who's moving soon?</strong> Friends, family, coworkers? We'd love to help them too.</p>
        <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:10px;padding:18px;margin:18px 0;text-align:center">
          <div style="font-size:18px;font-weight:900;color:#78350f;margin-bottom:6px">🎁 REFERRAL DEAL</div>
          <div style="font-size:15px;color:#78350f;line-height:1.6">
            <strong>Your friend gets $50 off</strong> their first move<br>
            <strong>You get $50 off</strong> your next move with us
          </div>
          <div style="font-size:13px;color:#92400e;margin-top:8px">Just have them mention your name when they book!</div>
        </div>
        <p style="margin:16px 0;color:#3a3a3a;font-size:15px;line-height:1.6">And if you haven't already — a quick Google review would mean the world to our family business:</p>
        <div style="text-align:center;margin:20px 0">
          <a href="${reviewUrl}" style="display:inline-block;background:#16a34a;color:#fff;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:800;font-size:14px">⭐ Leave a Review</a>
        </div>
        <p style="margin:16px 0;color:#3a3a3a;font-size:15px">Thanks for being part of the Toro family,<br><strong>The Toro Movers Team</strong></p>
      `,
    },
  };

  const tpl = templates[template];
  if (!tpl) return json(400, { error: 'Unknown template. Use: day1, day2, day3, day4, day5, referral' });

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
      <div style="background:#C8102E;color:#fff;padding:22px 24px;border-radius:12px 12px 0 0;text-align:center">
        <div style="font-weight:900;font-size:22px;letter-spacing:-.3px">TORO <span style="opacity:.85">MOVERS</span></div>
      </div>
      <div style="background:#fff;padding:28px 24px;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 12px 12px">
        ${tpl.body}
        <hr style="margin:28px 0 18px;border:none;border-top:1px solid #e5e5e5">
        <div style="font-size:12px;color:#9ca3af;line-height:1.6">
          <strong>Toro Movers</strong> · Orlando, FL · Insured<br>
          <a href="tel:+16896002720" style="color:#9ca3af">(689) 600-2720</a> ·
          <a href="mailto:hello@toromovers.net" style="color:#9ca3af">hello@toromovers.net</a> ·
          <a href="https://toromovers.net/" style="color:#9ca3af">toromovers.net</a>
        </div>
      </div>
    </div>
  `;

  try {
    const result = await resend.emails.send({
      from: `Toro Movers <${fromEmail}>`,
      to: [lead.email],
      bcc: adminBcc ? [adminBcc] : undefined,
      replyTo: fromEmail,
      subject: tpl.subject,
      html,
    });

    await addNote(leadId, `Follow-up email sent: ${template}`, 'crm');
    return json(200, { ok: true, template, to: lead.email, resendId: result?.data?.id });
  } catch(e) {
    console.error('send-followup failed:', e);
    return json(500, { error: e.message });
  }
};
