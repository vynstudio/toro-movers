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
  const isPartial   = !!payload.partial;
  const isAbandon   = !!payload.abandon;
  const subjectTag  = isAbandon ? '⚠️ ABANDONED — EARLY LEAD'
                    : isPartial ? '🟡 EARLY LEAD (step 2)'
                    : isQuoteForm ? '🟢 QUOTE REQUEST'
                    : 'Callback Request';

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

  // ===== INTERNAL EMAIL (to Toro Movers team) =====
  const internalEmail = {
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
  };

  // ===== CUSTOMER EMAIL (confirmation + quote summary) =====
  // Only sent if customer provided email and this is a full quote submission
  const customerRow = (label, value) => value
    ? `<tr><td style="padding:8px 14px 8px 0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top">${esc(label)}</td><td style="padding:8px 0;color:#1a1a1a;font-size:14px;font-weight:500">${esc(value)}</td></tr>`
    : '';

  const customerQuoteSummary = isQuoteForm ? `
    <h3 style="margin:28px 0 10px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:1.5px">Your Move Details</h3>
    <table style="border-collapse:collapse;width:100%;background:#fafafa;border-radius:10px;padding:4px">
      ${customerRow('From ZIP', zip_from)}
      ${customerRow('To ZIP', zip_to)}
      ${customerRow('Property', property_type)}
      ${customerRow('Access', stairs_elev)}
      ${customerRow('Code access', code_access)}
      ${customerRow('Boxes', boxes_count)}
      ${customerRow('TVs', tv_count)}
      ${customerRow('Furniture', furniture_size)}
      ${customerRow('Disassembly', assembly)}
      ${customerRow('Wrapping', wrapping)}
      ${customerRow('Preferred date', move_date)}
    </table>
  ` : '';

  // Only send customer confirmation on FULL submission (not partial / abandon)
  const customerEmail = (email && !isPartial && !isAbandon) ? {
    from: `Toro Movers <${fromEmail}>`,
    to: [email],
    replyTo: fromEmail,
    subject: `Your Toro Movers quote request — ${fullName.split(' ')[0]}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
        <div style="background:#C8102E;color:#fff;padding:28px 24px;border-radius:12px 12px 0 0;text-align:center">
          <div style="font-weight:900;font-size:24px;letter-spacing:-.3px">TORO <span style="opacity:.85">MOVERS</span></div>
          <div style="margin-top:6px;font-size:14px;opacity:.95">Family-owned movers · Central Florida</div>
        </div>
        <div style="background:#fff;padding:28px 24px;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 12px 12px">
          <h2 style="margin:0 0 10px;font-size:22px">Thanks, ${esc(fullName.split(' ')[0] || 'there')}! We got your request.</h2>
          <p style="margin:0 0 18px;color:#3a3a3a;font-size:15px;line-height:1.6">A team member will text or call you shortly (usually within 15 minutes during business hours, 7am-8pm). We'll confirm your details and send you a firm price.</p>

          <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:10px;padding:14px 16px;margin:18px 0;font-size:14px">
            <strong style="color:#78350f">What to expect</strong> — Flat $75 per mover per hour · 2-hour minimum · no fuel fees, no per-mile charges · licensed & insured in Florida.
          </div>

          ${customerQuoteSummary}

          <h3 style="margin:28px 0 10px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:1.5px">Need us sooner?</h3>
          <p style="margin:0 0 14px;color:#3a3a3a;font-size:14px">If it's urgent, call us directly — we answer fast.</p>
          <a href="tel:3217580094" style="display:inline-block;background:#C8102E;color:#fff;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px">📞 (321) 758-0094</a>

          <hr style="margin:32px 0 20px;border:none;border-top:1px solid #e5e5e5">
          <div style="font-size:12px;color:#9ca3af;line-height:1.6">
            <div style="margin-bottom:4px"><strong>Toro Movers</strong> · Orlando, FL · Licensed & insured</div>
            <div><a href="https://toromovers.net/" style="color:#9ca3af">toromovers.net</a> · <a href="mailto:${esc(fromEmail)}" style="color:#9ca3af">${esc(fromEmail)}</a></div>
          </div>
        </div>
      </div>
    `,
  } : null;

  try {
    // Send internal first (always)
    await resend.emails.send(internalEmail);

    // Fire customer email in parallel (don't block internal response)
    if (customerEmail) {
      try { await resend.emails.send(customerEmail); }
      catch (e) { console.error('Customer email failed:', e.message); }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, customer_email_sent: !!customerEmail }) };
  } catch (err) {
    console.error('Resend error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
