// Sends an email notification when someone requests a callback
// via the compact contact form.
//
// Env vars: RESEND_API_KEY, RESEND_FROM_EMAIL

const { Resend } = require('resend');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'hello@toromovers.net';
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Resend not configured' }) };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: 'Invalid JSON' }; }

  const { name = '', phone = '', email = '', page = '' } = payload;

  const resend = new Resend(apiKey);

  try {
    await resend.emails.send({
      from: `Toro Movers Leads <${fromEmail}>`,
      to: [fromEmail],
      subject: `Callback Request: ${name} — ${phone}`,
      html: `
        <h2>New callback request</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Phone:</strong> <a href="tel:${phone}">${phone}</a></p>
        <p><strong>Email:</strong> ${email || '(not provided)'}</p>
        <p><strong>Page:</strong> ${page}</p>
        <p style="margin-top:20px"><a href="tel:${phone}" style="background:#C8102E;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:700">Call ${name} Now</a></p>
      `,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Resend error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
