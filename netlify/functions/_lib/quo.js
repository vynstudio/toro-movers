// Quo (formerly OpenPhone) helpers beyond plain SMS sending.
//
// Env vars:
//   OPENPHONE_API_KEY          — workspace API key
//   OPENPHONE_WEBHOOK_SECRET   — signing key returned when the webhook is
//                                registered. Used to verify incoming-event
//                                payloads from Quo.
//
// API quirks worth knowing:
//   • Auth header is the bare key, no "Bearer " prefix.
//   • Contacts: POST /v1/contacts creates a new contact every time. We
//     dedupe ourselves by querying GET /v1/contacts?phoneNumbers= first.

const crypto = require('crypto');

function normalizeE164(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return '+' + d;
}

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// Look up an existing contact by E.164 phone. Returns the first match or null.
async function findContactByPhone(phone) {
  const apiKey = process.env.OPENPHONE_API_KEY;
  if (!apiKey) return null;
  const e164 = normalizeE164(phone);
  if (!e164) return null;
  const url = `https://api.openphone.com/v1/contacts?phoneNumbers=${encodeURIComponent(e164)}`;
  try {
    const r = await fetch(url, {
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({}));
    const list = j.data || [];
    return list[0] || null;
  } catch {
    return null;
  }
}

// Create a Quo contact for a lead so the inbox shows a name instead of just
// a phone number. Skips silently if the contact already exists.
async function upsertContactFromLead(lead) {
  const apiKey = process.env.OPENPHONE_API_KEY;
  if (!apiKey) return { ok: false, skipped: true, reason: 'no_api_key' };
  const e164 = normalizeE164(lead.phone);
  if (!e164) return { ok: false, skipped: true, reason: 'no_phone' };

  const existing = await findContactByPhone(e164);
  if (existing) return { ok: true, id: existing.id, deduped: true };

  const { firstName, lastName } = splitName(
    lead.name || `${lead.first_name || ''} ${lead.last_name || ''}`
  );

  const payload = {
    defaultFields: {
      firstName,
      lastName,
      emails: lead.email ? [{ name: 'Email', value: lead.email }] : [],
      phoneNumbers: [{ name: 'Phone', value: e164 }],
    },
    source: 'toromovers.net',
    externalId: lead.id || undefined,
  };

  try {
    const r = await fetch('https://api.openphone.com/v1/contacts', {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: j };
    return { ok: true, id: j?.data?.id || j.id };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Verify the `openphone-signature` header on an incoming webhook payload.
// Header format: `hmac;<version>;<timestamp>;<base64-sig>`. Signature is
// HMAC-SHA256 over `<timestamp>.<rawBody>` using the webhook signing key.
function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.OPENPHONE_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: 'no_secret' };
  if (!signatureHeader) return { ok: false, reason: 'no_signature' };

  const parts = String(signatureHeader).split(';');
  if (parts.length < 4 || parts[0] !== 'hmac') {
    return { ok: false, reason: 'bad_format' };
  }
  const timestamp = parts[2];
  const provided = parts[3];

  const ageMs = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(ageMs) || ageMs > 5 * 60 * 1000) {
    return { ok: false, reason: 'stale_or_bad_timestamp' };
  }

  const signingKey = Buffer.from(secret, 'base64');
  const computed = crypto
    .createHmac('sha256', signingKey)
    .update(`${timestamp}.${rawBody}`)
    .digest('base64');

  const a = Buffer.from(computed);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return { ok: false, reason: 'len_mismatch' };
  const ok = crypto.timingSafeEqual(a, b);
  return ok ? { ok: true } : { ok: false, reason: 'sig_mismatch' };
}

const STOP_KEYWORDS = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|revoke)\s*[!.\s]*$/i;
const HELP_KEYWORDS = /^\s*(help|info|support)\s*[!.\s]*$/i;

function classifyKeyword(text) {
  const s = String(text || '');
  if (STOP_KEYWORDS.test(s)) return 'stop';
  if (HELP_KEYWORDS.test(s)) return 'help';
  return null;
}

module.exports = {
  normalizeE164,
  findContactByPhone,
  upsertContactFromLead,
  verifyWebhookSignature,
  classifyKeyword,
};
