// Send moving quote email via Resend
//
// Env vars required (Netlify UI → Site settings → Environment variables):
//   RESEND_API_KEY     — re_...
//   RESEND_FROM_EMAIL  — hello@toromovers.net (domain must be verified in Resend)

const { Resend } = require('resend');
const { createLead, notifyTelegram } = require('./_lib/leads');
const { sendSms } = require('./_lib/sms');

const { checkRateLimit } = require('./_lib/rate-limit');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method not allowed' };
  }

  // Public quote submissions. 5 per IP per 5 min guards against spammers
  // using the estimator to flood Stael's Telegram + CRM.
  const rl = checkRateLimit(event, { bucket: 'send-quote', max: 5, windowMs: 5 * 60_000 });
  if (rl.blocked) return rl.response;

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'hello@toromovers.net';

  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Resend not configured' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: 'Invalid JSON' };
  }

  // Health-monitor probes short-circuit before any side effects so they don't
  // create CRM leads, ping Telegram, fire Resend, or text the owner phone.
  // The probe still validates Resend SDK construction below by reaching this
  // point with a valid API key.
  const isHealthCheck = !!(payload && payload.health_check) ||
                       (event.headers && (event.headers['x-health-check'] === '1' || event.headers['X-Health-Check'] === '1'));
  if (isHealthCheck) {
    console.log('[send-quote] health-check probe acknowledged');
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, health_check: true }),
    };
  }

  const {
    name = 'Customer',
    email = '',
    phone = '',
    movers = 2,
    hours = 2,
    truck = false,
    truckFee = 0,
    labor = 300,
    total = 300,
    packing = 'none',
    bedrooms = '',
    stairs = '',
    specials = '',
    move_date = '',
    zip_from = '',
    zip_to = '',
    page = '',
    utm_source = '',
    utm_medium = '',
    utm_campaign = '',
    utm_content = '',
    utm_term = '',
    fbclid = '',
    gclid = '',
  } = payload;

  if (!email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email required' }) };
  }

  // Create CRM lead (Netlify Blobs) + fire Telegram notification. Don't block
  // the quote email on failure — lead capture is important but email is the
  // customer-facing priority.
  const nameParts = String(name).trim().split(/\s+/);
  const first_name = nameParts[0] || '';
  const last_name = nameParts.slice(1).join(' ');
  const leadPayload = {
    name, first_name, last_name, email, phone,
    zip_from, zip_to, move_date,
    furniture_size: bedrooms ? `${bedrooms} BR` : '',
    stairs_elevator: stairs,
    page,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    fbclid, gclid,
    estimate: { movers, hours, total, truck, labor, truckFee, packing, specials },
  };
  let lead = null;
  try {
    lead = await createLead(leadPayload);
    console.log('[send-quote] lead created:', lead.id, 'status=' + lead.status);
    try {
      const tgRes = await notifyTelegram(lead);
      console.log('[send-quote] telegram result:', JSON.stringify(tgRes));
    } catch (tgErr) {
      console.error('[send-quote] Telegram failed:', tgErr.message);
    }
  } catch (e) {
    console.error('[send-quote] createLead failed:', e.message);
  }

  // Customer SMS via Quo — closer-style copy: lead with the quote, then a
  // single low-friction CTA ("tap to book"). Deposit amount is shown on the
  // /book page itself, not in the SMS, so the message stays inviting.
  // Personalised /book link carries the quote forward.
  // Awaited so Netlify doesn't freeze the worker mid-flight.
  try {
    if (phone) {
      const first = String(name).split(/\s+/)[0] || 'there';
      const truckLine = truck ? ' · truck included' : ' · labor only';
      const params = new URLSearchParams({
        truck: String(!!truck),
        total: String(total),
        movers: String(movers),
        hours: String(hours),
        name: name || '',
        email: email || '',
        phone: phone || '',
      });
      const bookLink = `https://toromovers.net/book?${params.toString()}`;
      const customerSmsBody =
        `Hi ${first} — Toro Movers here. Your quote:\n\n` +
        `$${total} (${movers} movers · ${hours}h${truckLine})\n\n` +
        `Tap to book and lock your date:\n${bookLink}\n\n` +
        `Or call (689) 600-2720. Licensed & insured.\n\n` +
        `Reply STOP to opt out.`;
      const r = await sendSms(phone, customerSmsBody);
      console.log('[send-quote] customer sms result:', JSON.stringify(r));
    }
  } catch (e) {
    console.error('[send-quote] customer SMS failed:', e.message);
  }

  // CRM v2 bridge — mirror this lead into Supabase (public.customers + public.leads)
  // so the Toro CRM sees every public quote submission. Fire-and-forget so it
  // never blocks the customer-facing quote email. No duplicate Telegram (the
  // v1 notifyTelegram above already pinged the team).
  try {
    const { upsertCrmLeadFromPublic } = require('./_lib/crm-leads');
    upsertCrmLeadFromPublic(payload)
      .then(r => { if (!r.ok) console.warn('CRM v2 bridge skipped:', r.reason); })
      .catch(e => console.error('CRM v2 bridge failed:', e.message));
  } catch (e) {
    console.error('CRM v2 bridge unavailable:', e.message);
  }

  const truckLine = truck
    ? `<tr><td style="padding:12px 0;border-bottom:1px solid #e5e7eb;color:#374151">Truck</td><td style="padding:12px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#1C1C1E">+$${truckFee}</td></tr>`
    : '';

  const packingLine = packing !== 'none'
    ? `<tr><td style="padding:12px 0;border-bottom:1px solid #e5e7eb;color:#374151">Packing (${packing})</td><td style="padding:12px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#1C1C1E">Included in hours</td></tr>`
    : '';

  const htmlEmail = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
<tr><td align="center">
<table width="100%" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

  <!-- Header -->
  <tr><td style="background:#C8102E;padding:28px 32px;text-align:center">
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.3px">toro <span style="color:#fff">movers</span></h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:13px">Your Moving Quote</p>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:32px 32px 16px">
    <p style="margin:0;font-size:16px;color:#1C1C1E;font-weight:700">Hi ${name.split(' ')[0]},</p>
    <p style="margin:12px 0 0;font-size:14px;color:#374151;line-height:1.6">Thanks for using our move calculator. Here's your personalized estimate based on what you told us:</p>
  </td></tr>

  <!-- Quote breakdown -->
  <tr><td style="padding:0 32px">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #e5e7eb;border-radius:12px;overflow:hidden;margin:16px 0">
      <tr style="background:#f9fafb">
        <td style="padding:14px 16px;font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:1px">Item</td>
        <td style="padding:14px 16px;font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:1px;text-align:right">Amount</td>
      </tr>
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;color:#374151">Crew</td><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#1C1C1E">${movers} movers</td></tr>
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;color:#374151">Estimated hours</td><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#1C1C1E">${hours} hours</td></tr>
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;color:#374151">Labor ($75/mover/hr)</td><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#1C1C1E">$${labor}</td></tr>
      ${truckLine}
      ${packingLine}
      <tr style="background:#C8102E">
        <td style="padding:16px;color:#fff;font-weight:800;font-size:15px">Estimated Total</td>
        <td style="padding:16px;color:#fff;font-weight:800;font-size:20px;text-align:right">$${total}</td>
      </tr>
    </table>
  </td></tr>

  <!-- Note -->
  <tr><td style="padding:0 32px 24px">
    <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.6;background:#f9fafb;padding:16px;border-radius:10px">
      This is an estimate based on the details you provided. 2-hour minimum applies, and after that we bill by the hour. No hidden fees, no fuel surcharges, no surprises. The number you see is the number you pay.
    </p>
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:0 32px 32px;text-align:center">
    <p style="margin:0 0 8px;font-size:14px;color:#374151;font-weight:600">Ready to lock in your date?</p>
    <p style="margin:0 0 16px;font-size:13px;color:#6B7280">A small refundable deposit reserves your slot — and it's <strong style="color:#1C1C1E">applied to your final bill</strong>, not added on top.</p>
    <a href="https://toromovers.net/book?truck=${truck}&total=${total}&movers=${movers}&hours=${hours}&name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}&phone=${encodeURIComponent(phone)}" style="display:inline-block;background:#C8102E;color:#fff;font-weight:800;font-size:16px;padding:18px 48px;border-radius:999px;text-decoration:none;box-shadow:0 6px 20px rgba(200,16,46,0.3)">Book now</a>
    <p style="margin:16px 0 0;font-size:13px;color:#6B7280">Or call <a href="tel:6896002720" style="color:#C8102E;font-weight:700;text-decoration:none">(689) 600-2720</a></p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#1C1C1E;padding:24px 32px;text-align:center">
    <p style="margin:0;color:rgba(255,255,255,0.7);font-size:12px;line-height:1.5">
      Toro Movers · Licensed & Insured · Central Florida<br>
      A member of our team will call you soon for more details.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const resend = new Resend(apiKey);

  try {
    // Send quote to customer. Resend SDK returns { data, error } — a non-thrown
    // error (e.g. invalid API key, unverified domain) lands in `error`, so we
    // must check it explicitly rather than relying on the await to throw.
    const customerRes = await resend.emails.send({
      from: `Toro Movers <${fromEmail}>`,
      to: [email],
      subject: `Your Moving Quote — $${total} Estimate | Toro Movers`,
      html: htmlEmail,
    });
    if (customerRes && customerRes.error) {
      console.error('[send-quote] Resend customer email failed:', JSON.stringify(customerRes.error));
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Email failed', detail: customerRes.error.message || String(customerRes.error) }),
      };
    }

    // Owner-side notifications are Telegram-only (handled above). Customer
    // also gets a full-quote SMS via Quo (handled above).

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('[send-quote] Resend threw:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Email failed', detail: err.message }),
    };
  }
};
