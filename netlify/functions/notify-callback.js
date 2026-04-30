// Sends an email notification when someone requests a quote or callback.
// Captures the full multi-step quote form from /quote.html plus legacy
// compact-form submissions (name/phone/email/page).
//
// Env vars: RESEND_API_KEY, RESEND_FROM_EMAIL

const { Resend } = require('resend');
const { getStore } = require('@netlify/blobs'); // surfaced here so Netlify's scanner enables Blobs for this function
const { createLead, notifyTelegram } = require('./_lib/leads');
const { sendSms } = require('./_lib/sms');
const { upsertContactFromLead } = require('./_lib/quo');
const { upsertCrmLeadFromPublic } = require('./_lib/crm-leads');
const { autoSendQuote } = require('./_lib/auto-quote');
const { getAdminClient } = require('./_lib/supabase-admin');

const esc = (v) =>
  String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Strip non-digits + prepend +1 if missing — required for valid tel: URLs
const cleanPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return '+' + d; // international or unexpected
};
// Pretty format for display: (xxx) xxx-xxxx
const prettyPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith('1')) return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return p || '';
};

const { checkRateLimit } = require('./_lib/rate-limit');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  // Public form endpoint. 5 per IP per 5 minutes stops obvious spam bursts
  // without punishing a real prospect who re-submits a correction.
  const rl = checkRateLimit(event, { bucket: 'notify-callback', max: 5, windowMs: 5 * 60_000 });
  if (rl.blocked) return rl.response;

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

  // ===== QUOTE ESTIMATE CALCULATOR =====
  // Returns { movers, hours, total, rate } or null. Compute whenever the
  // submission has furniture_size (bedrooms) — earlier we required zip /
  // boxes too, but city LP top-forms only collect bedrooms and were
  // shipping the customer email with an empty price block.
  function calcEstimate() {
    if (isPartial || isAbandon) return null;
    if (!furniture_size) return null;

    var RATE = 75; // $/mover/hour
    var MOVERS = 2;

    var baseHours = {
      'Studio / just a few': 2,
      '1 bedroom':           3,
      '2 bedrooms':          5,
      '3+ bedrooms':         7,
    };
    var movers = MOVERS;
    var hours = baseHours[furniture_size] || 3;

    // Optional extras — still captured if provided on a legacy form
    var boxAdd = { 'Under 10': 0, '10-25': 0.5, '25-50': 1, '50+': 1.5 };
    hours += boxAdd[boxes_count] || 0;
    var tvMap = { '0': 0, '1': 0.25, '2': 0.5, '3+': 0.75 };
    hours += tvMap[tv_count] || 0;

    // Floor + access time add-ons (matches client-side estimator in quote.html)
    var floor = payload.floor || '';
    var floorAdd = {
      'Ground floor': { Stairs: 0,   Elevator: 0    },
      '2nd floor':    { Stairs: 0.5, Elevator: 0.25 },
      '3rd floor':    { Stairs: 1,   Elevator: 0.5  },
      '4th+ floor':   { Stairs: 1.5, Elevator: 0.75 },
    };
    if (floor && floorAdd[floor]) {
      hours += floorAdd[floor][stairs_elev] || (floor !== 'Ground floor' ? 0.5 : 0);
    } else {
      // Legacy form fallback: plain stairs/elevator without explicit floor
      if (stairs_elev === 'Stairs')   hours += 0.5;
      if (stairs_elev === 'Elevator') hours += 0.25;
    }

    if (assembly === 'Yes') hours += 1;
    if (wrapping === 'Yes') hours += 0.5;

    // 2-hour minimum + round to 0.5
    hours = Math.max(2, Math.round(hours * 2) / 2);

    var total = Math.round(RATE * movers * hours);

    return { movers: movers, hours: hours, total: total, rate: RATE };
  }

  const estimate = calcEstimate();

  const row = (label, value) => value
    ? `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;white-space:nowrap">${esc(label)}</td><td style="padding:6px 0;color:#1a1a1a;font-size:14px;font-weight:500">${esc(value)}</td></tr>`
    : '';

  // Rendered phone as a tap-to-call link with pretty display
  const phoneLink = phone
    ? `<a href="tel:${cleanPhone(phone)}" style="color:#C8102E;font-weight:700;text-decoration:none">${esc(prettyPhone(phone))}</a>`
    : '';

  const moveDetailsHtml = isQuoteForm ? `
    <h3 style="margin:24px 0 8px;font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">Move Details</h3>
    <table style="border-collapse:collapse;width:100%">
      ${row('From ZIP', zip_from)}
      ${row('To ZIP', zip_to)}
      ${row('Property', property_type)}
      ${row('Floor', payload.floor)}
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

  // Book Now link → directly creates Stripe checkout via /book endpoint
  const baseUrl = process.env.SITE_BASE_URL || 'https://toromovers.net';
  const bookParams = estimate ? new URLSearchParams({
    hours: String(estimate.hours),
    total: String(estimate.total),
    movers: String(estimate.movers),
    name: fullName,
    email: email,
    phone: phone,
    zip_from: zip_from,
    zip_to: zip_to,
    size: furniture_size,
    stairs: stairs_elev,
    date: move_date,
  }).toString() : '';
  const bookNowUrl = estimate ? `${baseUrl}/.netlify/functions/book?${bookParams}` : null;

  // Quote block — INTERNAL email
  const internalQuoteBlock = estimate ? `
    <div style="margin:18px 0;background:#fef3c7;border:1px solid #fbbf24;border-radius:10px;padding:14px 16px;font-size:14px">
      <strong style="color:#78350f">Auto-quote sent to customer:</strong>
      <span style="font-weight:700">$${estimate.total}</span>
      <span style="color:#6b7280">· ${estimate.movers} movers · ${estimate.hours} hrs · $75/hr</span>
    </div>
  ` : '';

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
          ${internalQuoteBlock}
          <h3 style="margin:0 0 8px;font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">Contact</h3>
          <table style="border-collapse:collapse;width:100%">
            ${row('Name',  fullName)}
            ${phone ? `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px">Phone</td><td style="padding:6px 0;font-size:14px;font-weight:600">${phoneLink}</td></tr>` : ''}
            ${row('Email', email)}
          </table>
          ${moveDetailsHtml}
          ${utmHtml}
          <div style="margin-top:28px;display:flex;gap:10px;flex-wrap:wrap">
            <a href="tel:${cleanPhone(phone)}" style="background:#C8102E;color:#fff;padding:14px 22px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px">📞 Call ${esc(fullName.split(' ')[0])}</a>
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
      ${customerRow('Floor', payload.floor)}
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

  // Quote block — CUSTOMER email (hero)
  // Mirror the LP's "YOUR ESTIMATE" dark panel: big price + breakdown +
  // trust badges row (stars · 100+ moves · 15-min callback promise),
  // then the Book Now CTA.
  const customerQuoteBlock = estimate ? `
    <div style="margin:24px 0;background:linear-gradient(135deg,#0a0a0a 0%,#2a1a1a 50%,#3a1a1a 100%);color:#fff;border-radius:16px;padding:32px 24px;text-align:center;box-shadow:0 12px 32px rgba(0,0,0,.25);border:1px solid rgba(200,16,46,.3)">
      <div style="font-size:11px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,.6);margin-bottom:10px">Your Estimate</div>
      <div style="font-size:56px;font-weight:900;letter-spacing:-.03em;line-height:1;margin-bottom:10px;color:#fff">$${estimate.total}</div>
      <div style="font-size:14px;color:rgba(255,255,255,.75);margin-bottom:20px">${estimate.movers} movers  ·  ${estimate.hours} hours  ·  $75/hr per mover</div>

      ${bookNowUrl ? `
        <a href="${bookNowUrl}" style="display:inline-block;background:#C8102E;color:#fff;padding:16px 32px;border-radius:999px;text-decoration:none;font-weight:800;font-size:15px;margin:4px 0 10px;box-shadow:0 8px 20px rgba(200,16,46,.45)">Book Now · Pay $50 Deposit →</a>
        <div style="font-size:11px;color:rgba(255,255,255,.55)">Refundable up to 24hr before move · Secured by Stripe</div>
      ` : ''}

      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto 0;border-top:1px solid rgba(255,255,255,.12);padding-top:20px;width:100%">
        <tr>
          <td style="width:33.33%;text-align:center">
            <div style="color:#fbbf24;font-size:14px;letter-spacing:2px;margin-bottom:3px">★★★★★</div>
            <div style="font-size:18px;font-weight:900;color:#fff;line-height:1">4.9</div>
            <div style="font-size:10px;color:rgba(255,255,255,.55);letter-spacing:1.5px;text-transform:uppercase;margin-top:3px">Google</div>
          </td>
          <td style="width:33.33%;text-align:center;border-left:1px solid rgba(255,255,255,.12);border-right:1px solid rgba(255,255,255,.12)">
            <div style="font-size:18px;font-weight:900;color:#fff;line-height:1;margin-bottom:6px">100+</div>
            <div style="font-size:10px;color:rgba(255,255,255,.55);letter-spacing:1.5px;text-transform:uppercase">Central FL<br>moves</div>
          </td>
          <td style="width:33.33%;text-align:center">
            <div style="font-size:18px;font-weight:900;color:#fff;line-height:1;margin-bottom:6px">15 min</div>
            <div style="font-size:10px;color:rgba(255,255,255,.55);letter-spacing:1.5px;text-transform:uppercase">Callback<br>promise</div>
          </td>
        </tr>
      </table>
      <div style="font-size:11px;color:rgba(255,255,255,.5);margin-top:16px">No hidden fees · no fuel surcharge · no per-mile charges</div>
    </div>
  ` : '';

  // Night-mode: if submitted between 9pm-7am ET, set expectations that
  // we're closed instead of promising an immediate 15-minute callback.
  const etHour = parseInt(new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', hour12: false
  }), 10);
  const isNightTime = etHour >= 21 || etHour < 7;
  const callbackLine = isNightTime
    ? `<p style="margin:18px 0;color:#3a3a3a;font-size:14px;line-height:1.6"><strong style="color:#C8102E">We're closed for the night.</strong> A team member will call you at <strong>8am tomorrow morning</strong> to confirm the price and lock in your date. If nothing unusual comes up, the quote above is what you'll pay.</p>`
    : `<p style="margin:18px 0;color:#3a3a3a;font-size:14px;line-height:1.6">A team member will call you within 15 minutes during business hours (7am-8pm) to confirm the final price and lock in your date. If nothing unusual comes up, the quote above is what you'll pay.</p>`;

  const subjectLine = estimate
    ? (isNightTime
        ? `Your Toro Movers quote: $${estimate.total} — we'll call you at 8am`
        : `Your Toro Movers quote: $${estimate.total} — ready to book?`)
    : `Your Toro Movers quote request — ${fullName.split(' ')[0]}`;

  // Only send customer confirmation on FULL submission (not partial / abandon)
  const customerEmail = (email && !isPartial && !isAbandon) ? {
    from: `Toro Movers <${fromEmail}>`,
    to: [email],
    replyTo: fromEmail,
    subject: subjectLine,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
        <div style="background:#C8102E;color:#fff;padding:28px 24px;border-radius:12px 12px 0 0;text-align:center">
          <div style="font-weight:900;font-size:24px;letter-spacing:-.3px">TORO <span style="opacity:.85">MOVERS</span></div>
          <div style="margin-top:6px;font-size:14px;opacity:.95">Family-owned movers · Central Florida</div>
        </div>
        <div style="background:#fff;padding:28px 24px;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 12px 12px">
          <h2 style="margin:0 0 10px;font-size:22px">Thanks, ${esc(fullName.split(' ')[0] || 'there')}! Here's your quote.</h2>
          <p style="margin:0 0 4px;color:#3a3a3a;font-size:15px;line-height:1.6">Based on the details you provided, here's what your move should cost:</p>

          ${customerQuoteBlock}

          ${callbackLine}

          ${customerQuoteSummary}

          <h3 style="margin:28px 0 10px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:1.5px">Need us sooner?</h3>
          <p style="margin:0 0 14px;color:#3a3a3a;font-size:14px">If it's urgent, call us directly — we answer fast.</p>
          <a href="tel:6896002720" style="display:inline-block;background:#C8102E;color:#fff;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px">📞 (689) 600-2720</a>

          <hr style="margin:32px 0 20px;border:none;border-top:1px solid #e5e5e5">
          <div style="font-size:12px;color:#9ca3af;line-height:1.6">
            <div style="margin-bottom:4px"><strong>Toro Movers</strong> · Orlando, FL · Licensed & insured</div>
            <div><a href="https://toromovers.net/" style="color:#9ca3af">toromovers.net</a> · <a href="mailto:${esc(fromEmail)}" style="color:#9ca3af">${esc(fromEmail)}</a></div>
          </div>
        </div>
      </div>
    `,
  } : null;

  // ===== DRIP SEQUENCE =====
  // Schedules 5 follow-up emails after the immediate quote.
  // Uses Resend's `scheduledAt` (ISO 8601 UTC).
  // Timing: +2hr, +6hr, Day 2 @ 12:15pm ET, Day 3 @ 12:15pm ET, Day 4 @ 12:15pm ET.

  // Convert "12:15pm America/New_York N days from today" → UTC ISO string
  function nextNoonEasternISO(daysOffset){
    // Get current ET date parts
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year:'numeric', month:'2-digit', day:'2-digit'
    });
    const parts = {};
    fmt.formatToParts(new Date()).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
    // Build an ISO-ish date string for noon:15 ET
    const baseMidnightUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day);
    const target = new Date(baseMidnightUtc + daysOffset * 24 * 60 * 60 * 1000);
    // Set to 12:15 local (ET): figure out offset for that specific date
    // Crude DST check: EDT is roughly Mar 2nd Sunday–Nov 1st Sunday (months 2-10 inclusive most years)
    const m = target.getUTCMonth();
    const etOffset = (m >= 2 && m <= 10) ? 4 : 5; // EDT=-4, EST=-5
    // Target UTC time = 12:15 ET + offset hours
    target.setUTCHours(12 + etOffset, 15, 0, 0);
    return target.toISOString();
  }

  function plusHours(h){
    return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
  }

  // Drip templates — only send to customer after FULL submission (not partial/abandon)
  const dripList = (email && !isPartial && !isAbandon && estimate) ? [
    {
      scheduledAt: plusHours(2),
      subject: `Quick reminder: your $${estimate.total} Toro Movers quote`,
      html: dripEmail('2hr', fullName, estimate, bookNowUrl, fromEmail),
    },
    {
      scheduledAt: plusHours(6),
      subject: `Still thinking about your move? Here's your quote again`,
      html: dripEmail('6hr', fullName, estimate, bookNowUrl, fromEmail),
    },
    {
      scheduledAt: nextNoonEasternISO(1),
      subject: `${fullName.split(' ')[0]}, your moving quote is waiting`,
      html: dripEmail('day2', fullName, estimate, bookNowUrl, fromEmail),
    },
    {
      scheduledAt: nextNoonEasternISO(2),
      subject: `Last few spots this week — reserve your moving date`,
      html: dripEmail('day3', fullName, estimate, bookNowUrl, fromEmail),
    },
    {
      scheduledAt: nextNoonEasternISO(3),
      subject: `Should we release your $${estimate.total} quote slot?`,
      html: dripEmail('day4', fullName, estimate, bookNowUrl, fromEmail),
    },
  ] : [];

  // Save lead to CRM + ping Telegram + email (redundant delivery — if one fails, others still fire)
  let savedLead = null;
  try {
    savedLead = await createLead({ ...payload, estimate });
    console.log('[notify] lead saved:', savedLead?.id);
  } catch(e) {
    console.error('[notify] CRM save FAILED:', e.message, e.stack);
  }

  // Always send Telegram — even if Blobs/CRM failed, use raw payload as fallback
  try {
    const tgLead = savedLead || { ...payload, estimate, id: 'UNSAVED-' + Date.now(), status: 'new', name: payload.name || ((payload.first_name || '') + ' ' + (payload.last_name || '')).trim() };
    const tgResult = await notifyTelegram(tgLead);
    console.log('[notify] telegram result:', JSON.stringify(tgResult));
    if (!savedLead) {
      // Extra warning in Telegram that CRM save failed
      const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
      if (TG_TOKEN && TG_CHAT) {
        await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHAT, text: '⚠️ *CRM SAVE FAILED* — lead above was NOT saved to the database. Add it manually in the CRM.', parse_mode: 'Markdown' }),
        }).catch(() => {});
      }
    }
  } catch(e) {
    console.error('[notify] Telegram FAILED:', e.message, e.stack);
  }

  // Owner SMS — redundant alert alongside Telegram. No-ops if Quo env missing.
  try {
    const ownerPhone = process.env.OPENPHONE_OWNER_PHONE;
    if (ownerPhone && !isAbandon) {
      const tag = isPartial ? 'partial lead' : (isQuoteForm ? 'quote' : 'callback');
      const priceLine = estimate ? ` $${estimate.total}` : '';
      const smsBody = `Toro: new ${tag} — ${fullName} ${prettyPhone(phone)}${priceLine} (${page || 'web'})`;
      const r = await sendSms(ownerPhone, smsBody);
      console.log('[notify] sms result:', JSON.stringify(r));
    }
  } catch(e) {
    console.error('[notify] SMS FAILED:', e.message);
  }

  // Quo contact upsert + CRM v2 bridge + Toro CRM (new SaaS). All must be awaited —
  // Netlify Functions freeze the container as soon as the handler returns, so
  // fire-and-forget promises get killed mid-request and silently lose data.
  // Run them in parallel and wait for all.
  let v2BridgeResult = null;
  if (!isAbandon && phone) {
    const leadForContact = savedLead || { ...payload, name: fullName, phone, email };
    const v2Payload = {
      ...payload,
      name: fullName,
      phone,
      email,
      page,
      bedrooms: furniture_size,
      stairs: stairs_elev,
      estimate,
    };

    // Toro CRM (the new multi-tenant SaaS at toro-crm.netlify.app).
    // Toro Movers is workspace #1 — we forward the lead to its public ingestion
    // endpoint as a parallel write. Old Blobs/v2 stay live until cutover.
    const TORO_CRM_URL = process.env.TORO_CRM_URL || 'https://toro-crm.netlify.app';
    const utmSource = (utm_source || '').toLowerCase();
    const detectedSource = utmSource.includes('meta') || utmSource.includes('facebook') || utmSource.includes('instagram')
      ? 'meta'
      : utmSource.includes('google')
        ? 'google_ads'
        : utmSource.includes('seo') || utmSource.includes('organic')
          ? 'seo'
          : null;
    const notesBits = [
      property_type ? `Property: ${property_type}` : null,
      payload.floor ? `Floor: ${payload.floor}` : null,
      stairs_elev ? `Access: ${stairs_elev}` : null,
      furniture_size ? `Furniture: ${furniture_size}` : null,
      boxes_count ? `Boxes: ${boxes_count}` : null,
      tv_count ? `TVs: ${tv_count}` : null,
      assembly === 'Yes' ? 'Disassembly needed' : null,
      wrapping === 'Yes' ? 'Wrapping needed' : null,
      estimate ? `Auto-quote: $${estimate.total} (${estimate.movers}m × ${estimate.hours}h @ $${estimate.rate}/hr)` : null,
    ].filter(Boolean).join(' | ');
    const toroCrmPayload = {
      full_name: fullName,
      phone: cleanPhone(phone) || phone,
      email: email || null,
      move_date: move_date || null,
      from_zip: zip_from || null,
      to_zip: zip_to || null,
      notes: notesBits || null,
      source_page: page || null,
      utm_source: utm_source || null,
      utm_medium: utm_medium || null,
      utm_campaign: utm_campaign || null,
      utm_content: utm_content || null,
      utm_term: utm_term || null,
      fbclid: fbclid || null,
      lead_source: detectedSource,
      estimated_hours: estimate ? estimate.hours : null,
      movers_count: estimate ? estimate.movers : null,
      quoted_amount: estimate ? estimate.total : null,
    };
    const toroCrmFetch = fetch(`${TORO_CRM_URL}/api/leads?workspace=toro-movers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toroCrmPayload),
    }).then(r => r.json().catch(() => ({}))).then(j => ({ ok: !!j.id, id: j.id, error: j.error }));

    const [contactRes, v2Res, toroRes] = await Promise.allSettled([
      upsertContactFromLead(leadForContact),
      upsertCrmLeadFromPublic(v2Payload),
      toroCrmFetch,
    ]);
    console.log('[notify] quo contact:', JSON.stringify(contactRes.status === 'fulfilled' ? contactRes.value : { ok: false, error: String(contactRes.reason && contactRes.reason.message || contactRes.reason) }));
    console.log('[notify] crm v2 bridge:', JSON.stringify(v2Res.status === 'fulfilled' ? v2Res.value : { ok: false, error: String(v2Res.reason && v2Res.reason.message || v2Res.reason) }));
    console.log('[notify] toro-crm forward:', JSON.stringify(toroRes.status === 'fulfilled' ? toroRes.value : { ok: false, error: String(toroRes.reason && toroRes.reason.message || toroRes.reason) }));
    if (v2Res.status === 'fulfilled' && v2Res.value && v2Res.value.ok) v2BridgeResult = v2Res.value;
  }

  // Auto-send the quote. Only fires when:
  //   - this is a real quote submission (estimate exists, not partial/abandon)
  //   - the v2 bridge succeeded (we have a real lead_id + customer)
  //   - Supabase is configured
  // Creates a quote row + PDF, emails it, texts it, bumps stage='quoted'.
  // Errors are collected but never break the response — the form still
  // sees success even if email/SMS send fails.
  let autoQuoteResult = null;
  if (
    estimate && estimate.total > 0 &&
    !isPartial && !isAbandon &&
    v2BridgeResult && v2BridgeResult.lead_id &&
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    try {
      const admin = getAdminClient();
      const { data: cust } = await admin.from('customers').select('*').eq('id', v2BridgeResult.customer_id).maybeSingle();
      autoQuoteResult = await autoSendQuote({
        admin,
        lead_id: v2BridgeResult.lead_id,
        customer: cust || { full_name: fullName, phone, email, language_preference: v2BridgeResult.language },
        estimate: {
          movers: estimate.movers,
          hours: estimate.hours,
          rate: estimate.rate || 75,
          total: estimate.total,
          truck: !!estimate.truck,
        },
      });
      console.log('[notify] auto-quote:', JSON.stringify(autoQuoteResult));
    } catch (e) {
      console.error('[notify] auto-quote FAILED:', e.message);
    }
  }

  try {
    await resend.emails.send(internalEmail);

    // Skip the legacy customer estimate email if the auto-quote already
    // emailed the official PDF — otherwise the customer gets two near-
    // identical messages.
    if (customerEmail && !(autoQuoteResult && autoQuoteResult.email_sent)) {
      try { await resend.emails.send(customerEmail); }
      catch (e) { console.error('Customer email failed:', e.message); }
    }

    // Schedule drip emails — fire-and-forget (don't block response)
    const dripResults = await Promise.allSettled(dripList.map(d =>
      resend.emails.send({
        from: `Toro Movers <${fromEmail}>`,
        to: [email],
        replyTo: fromEmail,
        subject: d.subject,
        html: d.html,
        scheduledAt: d.scheduledAt,
      })
    ));
    const scheduled = dripResults.filter(r => r.status === 'fulfilled').length;
    dripResults.forEach((r, i) => {
      if (r.status === 'rejected') console.error(`Drip ${i+1} failed:`, r.reason?.message || r.reason);
    });

    // ===== Google Sheets backup — fire and forget =====
    // Sends every new lead to a Google Apps Script Web App that appends
    // rows to a Google Sheet. Acts as a permanent backup independent of
    // Netlify Blobs.
    //
    // Setup instructions:
    //   1. Create a Google Sheet with columns matching the fields below
    //   2. Go to Extensions → Apps Script
    //   3. Paste a doPost(e) function that parses JSON and appends a row:
    //        function doPost(e) {
    //          var data = JSON.parse(e.postData.contents);
    //          var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    //          sheet.appendRow([data.name, data.phone, data.email, data.status,
    //            data.move_date, data.move_time, data.pickup_address,
    //            data.dropoff_address, data.movers, data.hours, data.truck,
    //            data.total, data.source, data.created_at, data.lead_id]);
    //          return ContentService.createTextOutput('ok');
    //        }
    //   4. Deploy → New deployment → Web App → Execute as Me → Anyone
    //   5. Copy the Web App URL and set it as GOOGLE_SHEETS_WEBHOOK env var
    //      in Netlify (Site settings → Environment variables)
    try {
      const sheetsUrl = process.env.GOOGLE_SHEETS_WEBHOOK;
      if (sheetsUrl) {
        const sheetData = savedLead || { ...payload, estimate };
        fetch(sheetsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: sheetData.name || '',
            phone: sheetData.phone || payload.phone || '',
            email: sheetData.email || payload.email || '',
            status: sheetData.status || 'new',
            move_date: sheetData.move_date || payload.move_date || '',
            move_time: sheetData.move_time || payload.move_time || '',
            pickup_address: sheetData.pickup_address || payload.pickup_address || '',
            dropoff_address: sheetData.dropoff_address || payload.dropoff_address || '',
            movers: (sheetData.estimate || estimate || {}).movers || '',
            hours: (sheetData.estimate || estimate || {}).hours || '',
            truck: (sheetData.estimate || estimate || {}).truck ? 'Yes' : 'No',
            total: (sheetData.estimate || estimate || {}).total || '',
            source: payload.page || payload.utm_source || 'web',
            created_at: new Date().toISOString(),
            lead_id: sheetData.id || '',
          }),
        }).catch(e => console.error('[sheets-sync] failed:', e.message));
      }
    } catch(e) { console.error('[sheets-sync] error:', e.message); }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, customer_email_sent: !!customerEmail, drip_scheduled: scheduled }),
    };
  } catch (err) {
    console.error('Resend error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// ===== DRIP EMAIL TEMPLATES =====
function dripEmail(stage, fullName, estimate, bookNowUrl, fromEmail){
  const first = (fullName || '').split(' ')[0] || 'there';
  const bookBtn = bookNowUrl ? `
    <a href="${bookNowUrl}" style="display:inline-block;background:#C8102E;color:#fff;padding:15px 32px;border-radius:999px;text-decoration:none;font-weight:800;font-size:15px;margin:12px 0;box-shadow:0 6px 16px rgba(200,16,46,.25)">Book Now · Pay $50 Deposit →</a>
  ` : '';

  const copy = {
    '2hr': {
      headline: `Hey ${first}, did you get your quote?`,
      body: `Our team is ready to take your move any day this week. Your quote of <strong>$${estimate.total}</strong> (${estimate.movers} movers × ${estimate.hours} hours) is locked in if you book within 24 hours.<br><br>Reserving your date takes 30 seconds with a refundable $50 deposit.`
    },
    '6hr': {
      headline: `${first}, still moving?`,
      body: `Just a heads-up — we're booking fast this week and can't hold quotes forever. Your <strong>$${estimate.total}</strong> estimate is still good, but we schedule on a first-come, first-served basis.<br><br>Secure your date now with a $50 deposit (refundable up to 24 hours before your move).`
    },
    'day2': {
      headline: `Your moving quote is still available`,
      body: `${first}, we haven't heard back — just wanted to make sure you got your Toro Movers quote.<br><br><strong>$${estimate.total}</strong> · ${estimate.movers} movers × ${estimate.hours} hours · flat $75/hr per mover.<br><br>If the timing isn't right, just reply and let us know. Otherwise, reserve your spot below.`
    },
    'day3': {
      headline: `Quick heads-up on your moving spot`,
      body: `We're getting booked up for the next few weeks. Your <strong>$${estimate.total}</strong> quote is still reserved, but if you need a specific date we'd hate for you to miss it.<br><br>Reply to this email with questions, or lock in your date below.`
    },
    'day4': {
      headline: `Should we release your slot?`,
      body: `Hey ${first} — we haven't heard from you, so we wanted to check in one last time before releasing your reserved quote slot.<br><br><strong>$${estimate.total}</strong> · ${estimate.movers} movers × ${estimate.hours} hours.<br><br>If you're still planning a move, now's the time. If not, no worries — we won't follow up again.`
    },
  }[stage] || { headline: '', body: '' };

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
      <div style="background:#C8102E;color:#fff;padding:22px 24px;border-radius:12px 12px 0 0;text-align:center">
        <div style="font-weight:900;font-size:22px;letter-spacing:-.3px">TORO <span style="opacity:.85">MOVERS</span></div>
      </div>
      <div style="background:#fff;padding:28px 24px;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 12px 12px">
        <h2 style="margin:0 0 14px;font-size:22px;line-height:1.2">${copy.headline}</h2>
        <p style="margin:0 0 18px;color:#3a3a3a;font-size:15px;line-height:1.6">${copy.body}</p>
        <div style="text-align:center;margin:24px 0">
          ${bookBtn}
          <div style="font-size:12px;color:#6b7280">or call <a href="tel:6896002720" style="color:#C8102E;font-weight:700">(689) 600-2720</a></div>
        </div>
        <hr style="margin:28px 0 18px;border:none;border-top:1px solid #e5e5e5">
        <div style="font-size:12px;color:#9ca3af;line-height:1.6">
          <strong>Toro Movers</strong> · Orlando, FL · Licensed &amp; insured<br>
          <a href="https://toromovers.net/" style="color:#9ca3af">toromovers.net</a>
        </div>
      </div>
    </div>
  `;
}
