// Thin OpenPhone wrapper used by multiple functions (booking confirmation,
// move reminders, review request). No-ops when OpenPhone env vars are missing,
// so adding this to a function is always safe even before SMS is wired.
//
// Env vars (set in Netlify → Site settings → Environment variables):
//   OPENPHONE_API_KEY         — from OpenPhone dashboard → Settings → API
//                               (requires Business plan; starts with a long token)
//   OPENPHONE_PHONE_NUMBER_ID — from /v1/phone-numbers endpoint (e.g. "PNxxxxxxxx")
//                               This is the OpenPhone number ID to send from.
//                               OR set OPENPHONE_FROM_NUMBER (+1...) as fallback.
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
  const apiKey   = process.env.OPENPHONE_API_KEY;
  const phoneId  = process.env.OPENPHONE_PHONE_NUMBER_ID;
  const fromNum  = process.env.OPENPHONE_FROM_NUMBER;

  // OpenPhone not configured — silently no-op. Keeps callers safe before wiring.
  if (!apiKey || (!phoneId && !fromNum)) {
    return { ok: false, skipped: true, reason: 'openphone_not_configured' };
  }

  const normalizedTo = normalizeTo(to);
  if (!normalizedTo) return { ok: false, skipped: true, reason: 'no_to_number' };
  if (!body || !String(body).trim()) return { ok: false, skipped: true, reason: 'empty_body' };

  // OpenPhone limit per message is 1600 chars; longer messages are split but
  // charged per segment. Truncate defensively.
  const safeBody = String(body).slice(0, 1600);

  // Payload shape per Quo (formerly OpenPhone) docs at https://quo.com/docs.
  // Quo's API requires `from` (E.164). Older OpenPhone API accepted
  // `phoneNumberId`; we keep that as a fallback but prefer `from`.
  const payload = {
    content: safeBody,
    to: [normalizedTo],
  };
  if (fromNum) payload.from = fromNum;
  else if (phoneId) payload.phoneNumberId = phoneId;
  if (opts.setInboxStatus) payload.setInboxStatus = opts.setInboxStatus; // e.g. 'done'

  try {
    const r = await fetch('https://api.openphone.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': apiKey,   // OpenPhone uses bare API key, no "Bearer" prefix
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: data };
    return { ok: true, id: data?.data?.id || data.id, to: normalizedTo, status: data?.data?.status || data.status };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

module.exports = { sendSms, normalizeTo };
