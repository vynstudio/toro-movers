// Sends an email notification when someone requests a quote or callback.
// Captures the full multi-step quote form from /quote.html plus legacy
// compact-form submissions (name/phone/email/page).
//
// Env vars: RESEND_API_KEY, RESEND_FROM_EMAIL

const { Resend } = require('resend');

const esc = (v) =>
  String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

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
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: 'Invalid JSON' }; }

  // Contact fields (support both legacy `name` and new `first_name`+`last_name`)
  const first_name = payload.first_name || '';
  const last_name  = payload.last_name  || '';
  const fullName   = (payload.name || `${first_name} ${last_name}`).trim() || '(no name)';
  const phone      = payload.phone || '';
  const email      = payload.email || '';
  const page       = payload.page  || '';

  // Move details
  const zip_from       = payload.zip_from       || '';
  const zip_to         = payload.zip_to         || '';
  const property_type  = payload.property_type  || '';
  const stairs_elev    = payload.stairs_elevator|| '';
  const code_access    = payload.code_access    || '';
  const boxes_count    = payload.boxes_count    || '';
  const tv_count       = payload.tv_count       || '';
  const furniture_size = payload.furniture_size || '';
  const assembly       = payload.assembly       || '';
  const wrapping       = payload.wrapping       || '';
  const move_date      = payload.move_date      || '';

  // Attribution
  const utm_source   = payload.utm_source   || '';
  const utm_medium   = payload.utm_medium   || '';
  const utm_campaign = payload.utm_campaign || '';
  const utm_content  = payload.utm_content  || '';
  const utm_term     = payload.utm_term     || '';
  const fbclid       = payload.fbclid       || '';
  const gclid        = payload.gclid        || '';

  const isQuoteForm = !!(zip_from || zip_to || property_type || boxes_count);
  const subjectTag  = isQuoteForm ? 'QUOTE REQUEST' : 'Callback Request';

  const row = (label, value) => value
    ? `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;white-space:nowrap">${esc(label)}</td><td style="padding:6px 0;color:#1a1a1a;font-size:14px;font-weight:500">${esc(value)}</td></tr>`
    : '';

  const moveDetailsHtml = isQuoteForm ? `
    <h3 style="margin:24px 0 8px;font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">Move Details</h3>
    <table style="border-collapse:collapse;width:100%">
      ${row('From ZIP', zip_from)}
      ${row('To ZIP', zip_to)}
      ${row('Property', property_type)}
      ${row('Stairs/Elevator', stairs_elev)}
      ${row('Code access', code_access)}
      ${row('Boxes', boxes_count)}
      ${row('TVs', tv_count)}
      ${row('Furniture', furniture_size)}
      ${row('Disassembly needed', assembly)}
      ${row('Wrapping needed', wrapping)}
      ${row('Preferred date', move_date)}
    </table>
  ` : '';

  const hasUtm = utm_source || utm_medium || utm_campaign || utm_content || fbclid || gclid;
  const utmHtml = hasUtm ? `
    <h3 style="margin:24px 0 8px;font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">Attribution</h3>
    <table style="border-collapse:collapse;width:100%">
      ${row('Source',   utm_source)}
      ${row('Medium',   utm_medium)}
      ${row('Campaign', utm_campaign)}
      ${row('Content',  utm_content)}
      ${row('Term',     utm_term)}
      ${row('Facebook click ID', fbclid)}
      ${row('Google click ID',   gclid)}
    </table>
  ` : '';

  const resend = new Resend(apiKey);

  try {
    await resend.emails.send({
      from: `Toro Movers Leads <${fromEmail}>`,
      to: [fromEmail],
      subject: `${subjectTag}: ${fullName} — ${phone}`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto">
          <div style="background:#C8102E;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
            <h1 style="margin:0;font-size:22px">${esc(subjectTag)}</h1>
            <p style="margin:4px 0 0;opacity:.9;font-size:14px">From ${esc(page || 'website')}</p>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 12px 12px">
            <h3 style="margin:0 0 8px;font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">Contact</h3>
            <table style="border-collapse:collapse;width:100%">
              ${row('Name',  fullName)}
              ${row('Phone', phone)}
              ${row('Email', email)}
            </table>
            ${moveDetailsHtml}
            ${utmHtml}
            <div style="margin-top:28px;display:flex;gap:10px;flex-wrap:wrap">
              <a href="tel:${esc(phone)}" style="background:#C8102E;color:#fff;padding:14px 22px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px">📞 Call ${esc(fullName.split(' ')[0])}</a>
              ${email ? `<a href="mailto:${esc(email)}" style="background:#1a1a1a;color:#fff;padding:14px 22px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px">✉️ Reply by Email</a>` : ''}
            </div>
          </div>
        </div>
      `,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Resend error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
