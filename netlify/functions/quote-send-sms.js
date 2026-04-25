// CRM v2 — quote-send-sms
// POST /.netlify/functions/quote-send-sms
//   Headers: Authorization: Bearer <supabase user JWT>
//   Body:    { lead_id, quote }
// Response: 200 { quote_id, sent_to, sent_at, signed_url, language, sms_status }
//
// Mirror of quote-send.js but sends the quote summary + reserve link via
// Quo SMS instead of email. Useful when the customer prefers texts or
// when we don't have an email on file.
//
// Skips silently for leads marked sms_opted_out at the customer level.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENPHONE_API_KEY,
//      OPENPHONE_FROM_NUMBER (or PHONE_NUMBER_ID), URL/DEPLOY_PRIME_URL.

const { getAdminClient, verifyUserJWT } = require('./_lib/supabase-admin');
const { createQuote } = require('./_lib/quote-flow');
const { sendSms } = require('./_lib/sms');
const { notifyTelegramTeam } = require('./_lib/crm-notifications');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function respond(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function fmtMoney(n) {
  const v = Number(n || 0);
  // SMS-friendly: no decimals when round, e.g. $450 not $450.00
  return v % 1 === 0 ? `$${v.toLocaleString('en-US')}` : `$${v.toFixed(2)}`;
}

const SMS_COPY = {
  en: ({ first, total, crew, hours, rate, truck, deposit, reserveUrl }) =>
    `Toro Movers — quote for ${first}: ${total} (${crew} movers × ${hours}h × ${rate}/hr${truck ? ' + 26ft truck' : ''}). ` +
    `Reserve your date with a ${deposit} deposit: ${reserveUrl}\n` +
    `Reply STOP to opt out.`,
  es: ({ first, total, crew, hours, rate, truck, deposit, reserveUrl }) =>
    `Toro Movers — cotización para ${first}: ${total} (${crew} ayudantes × ${hours}h × ${rate}/hr${truck ? ' + camión 26ft' : ''}). ` +
    `Reserva tu fecha con un depósito de ${deposit}: ${reserveUrl}\n` +
    `Responde STOP para cancelar.`,
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  // Auth
  let profile;
  try {
    const out = await verifyUserJWT(event.headers.authorization || event.headers.Authorization);
    profile = out.profile;
  } catch (e) {
    return respond(401, { error: e.message || 'Unauthorized' });
  }
  if (!['sales', 'dispatch', 'admin'].includes(profile.role)) {
    return respond(403, { error: 'Forbidden' });
  }

  // Payload
  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }
  const { lead_id, quote } = payload;
  if (!lead_id || !quote) return respond(400, { error: 'lead_id and quote required' });

  const admin = getAdminClient();

  // Generate + persist quote (creates a new quotes row with PDF too — same as
  // email path, so the quote ID is consistent across channels).
  let out;
  try {
    out = await createQuote({ admin, actorId: profile.id, lead_id, quote });
  } catch (e) {
    return respond(e.statusCode || 500, { error: e.message });
  }

  const phone = out.customer && out.customer.phone;
  if (!phone) return respond(400, { error: 'Customer has no phone on file' });
  if (out.customer.sms_opted_out) {
    return respond(409, { error: 'Customer has opted out of SMS' });
  }

  const origin = process.env.URL
    || process.env.DEPLOY_PRIME_URL
    || 'https://toromovers.net';
  const reserveUrl = `${origin}/.netlify/functions/reserve?q=${encodeURIComponent(out.quote.id)}`;

  const first = String(out.customer.full_name || '').split(/\s+/)[0] || 'there';
  const body = SMS_COPY[out.language]({
    first,
    total: fmtMoney(out.quote.total),
    crew: out.quote.crew_size,
    hours: out.quote.estimated_hours,
    rate: fmtMoney(out.quote.hourly_rate),
    truck: !!out.quote.truck_included,
    deposit: fmtMoney(out.quote.deposit_amount),
    reserveUrl,
  });

  const smsResult = await sendSms(phone, body);
  if (!smsResult.ok) {
    return respond(502, { error: 'SMS send failed', sms: smsResult });
  }

  // Mark sent + log
  const sentAt = new Date().toISOString();
  await admin.from('quotes').update({ sent_at: sentAt }).eq('id', out.quote.id);
  await admin.from('activity_log').insert({
    entity_type: 'quote',
    entity_id: out.quote.id,
    actor_id: profile.id,
    event_type: 'quote_sent_sms',
    payload: { lead_id, to: phone, language: out.language, message_id: smsResult.id || null },
  });

  // Bump lead to 'quoted' if still early
  await admin.from('leads')
    .update({ stage: 'quoted' })
    .eq('id', lead_id)
    .in('stage', ['new', 'contacted']);

  // Team Telegram alert
  notifyTelegramTeam([
    '*Quote sent (SMS)*',
    '',
    out.customer.full_name ? `Customer: *${out.customer.full_name}*` : '',
    `Phone: \`${phone}\``,
    `Total: *${fmtMoney(out.quote.total)}*` + (out.quote.truck_included ? ' · truck' : ''),
    out.language === 'es' ? 'Idioma: ES' : '',
    '',
    `Sent by: ${profile.email}`,
  ]).catch(e => console.error('quote-send-sms telegram failed:', e.message));

  return respond(200, {
    quote_id: out.quote.id,
    sent_to: phone,
    sent_at: sentAt,
    signed_url: out.signedUrl,
    language: out.language,
    sms_status: smsResult.status || 'sent',
  });
};
