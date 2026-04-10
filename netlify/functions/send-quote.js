// Send moving quote email via Resend
//
// Env vars required (Netlify UI → Site settings → Environment variables):
//   RESEND_API_KEY     — re_...
//   RESEND_FROM_EMAIL  — hello@toromovers.net (domain must be verified in Resend)

const { Resend } = require('resend');

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
    page = '',
  } = payload;

  if (!email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email required' }) };
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
      This is an estimate based on the details you provided. If the move takes less time, you pay less. No hidden fees, no fuel surcharges, no surprises. The number you see is the number you pay.
    </p>
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:0 32px 32px;text-align:center">
    <p style="margin:0 0 16px;font-size:14px;color:#374151;font-weight:600">Ready to reserve your move?</p>
    <a href="https://toromovers.net/#book" style="display:inline-block;background:#C8102E;color:#fff;font-weight:800;font-size:15px;padding:16px 36px;border-radius:999px;text-decoration:none">Reserve This Move</a>
    <p style="margin:16px 0 0;font-size:13px;color:#6B7280">Or call <a href="tel:3217580094" style="color:#C8102E;font-weight:700;text-decoration:none">(321) 758-0094</a></p>
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
    // Send quote to customer
    await resend.emails.send({
      from: `Toro Movers <${fromEmail}>`,
      to: [email],
      subject: `Your Moving Quote — $${total} Estimate | Toro Movers`,
      html: htmlEmail,
    });

    // Send lead notification to Toro Movers team
    await resend.emails.send({
      from: `Toro Movers Leads <${fromEmail}>`,
      to: [fromEmail],
      subject: `New Quote Lead: ${name} — $${total} (${movers} movers, ${hours}hrs)`,
      html: `
        <h2>New lead from the move calculator</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Quote:</strong> $${total} (${movers} movers × ${hours} hrs${truck ? ' + truck' : ''}${packing !== 'none' ? ' + packing: ' + packing : ''})</p>
        <p><strong>Source page:</strong> ${page}</p>
        <p><a href="tel:${phone}">Call ${name} now</a></p>
      `,
    });

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('Resend error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Email failed', detail: err.message }),
    };
  }
};
