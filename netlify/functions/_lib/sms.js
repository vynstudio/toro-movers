// Thin Twilio wrapper used by multiple functions (booking confirmation,
// move reminders, review request). No-ops when Twilio env vars are missing,
// so adding this to a function is always safe even before Twilio is wired.
//
// Env vars (set in Netlify → Site settings → Environment variables):
//   TWILIO_ACCOUNT_SID   — e.g. "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
//   TWILIO_AUTH_TOKEN    — secret
//   TWILIO_FROM_NUMBER   — e.g. "+13217580094" (must be verified in Twilio)
//
// Usage:
//   const { sendSms } = require('./_lib/sms');
//   await sendSms('+15617677284', 'Your Toro Movers crew is on the way — ETA 10:00 AM.');

function normalizeTo(to) {
  const digits = String(to || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return '+' + digits;
}

async function sendSms(to, body, opts = {}) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_NUMBER;

  // Twilio not configured — silently no-op. Keeps callers safe before wiring.
  if (!sid || !token || !from) {
    return { ok: false, skipped: true, reason: 'twilio_not_configured' };
  }

  const normalizedTo = normalizeTo(to);
  if (!normalizedTo) return { ok: false, skipped: true, reason: 'no_to_number' };
  if (!body || !String(body).trim()) return { ok: false, skipped: true, reason: 'empty_body' };

  // Truncate to Twilio's hard limit (1600 chars) — warn on very long SMS.
  const safeBody = String(body).slice(0, 1600);

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const form = new URLSearchParams();
  form.set('To', normalizedTo);
  form.set('From', from);
  form.set('Body', safeBody);
  if (opts.statusCallback) form.set('StatusCallback', opts.statusCallback);

  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: data };
    return { ok: true, sid: data.sid, to: normalizedTo, status: data.status };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

module.exports = { sendSms, normalizeTo };
