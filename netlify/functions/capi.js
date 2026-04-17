// Meta Conversions API (CAPI) relay for Toro Movers
// Receives events from the browser and forwards them to Meta's
// server-side Conversions API with hashed PII for deduplication
// with the browser Pixel (matched by event_id).
//
// Env vars required (set in Netlify UI → Site settings → Environment variables):
//   META_PIXEL_ID      — primary pixel id (legacy / historical)
//   META_PIXEL_ID_LP   — optional second pixel id (LP/campaign pixel).
//                        When set, every event is relayed to BOTH pixels so
//                        server-side dedup works for both fbq('init') pixels.
//   META_CAPI_TOKEN    — long-lived CAPI access token (must have access to
//                        all configured pixels)
//
// POST body shape (JSON):
//   {
//     event_name:  "Lead" | "Contact" | "ViewContent" | "PageView",
//     event_id:    string,          // must match fbq(..., {eventID})
//     event_source_url: string,     // page url
//     user_data: {                  // optional, plaintext — hashed here
//       email?: string,
//       phone?: string,
//       first_name?: string,
//       last_name?: string,
//       zip?: string,
//     },
//     custom_data?: object          // passed through (value, currency, etc.)
//   }

const crypto = require('crypto');

const PIXEL_IDS = [process.env.META_PIXEL_ID, process.env.META_PIXEL_ID_LP].filter(Boolean);
const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;
const API_VERSION = 'v21.0';

const sha256 = (v) =>
  crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');

// Phone: strip all non-digits before hashing
const normalizePhone = (p) => String(p).replace(/\D/g, '');

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method not allowed' };
  }

  if (PIXEL_IDS.length === 0 || !ACCESS_TOKEN) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'CAPI not configured (missing env vars)' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: 'Invalid JSON' };
  }

  const {
    event_name,
    event_id,
    event_source_url,
    user_data = {},
    custom_data = {},
  } = payload;

  if (!event_name || !event_id) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: 'event_name and event_id required',
    };
  }

  // Meta requires at least one user identifier. We always have client IP and UA
  // from the request headers, plus fbp/fbc cookies from the browser if present.
  const clientIp =
    event.headers['x-nf-client-connection-ip'] ||
    event.headers['client-ip'] ||
    (event.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const userAgent = event.headers['user-agent'] || '';

  const hashedUser = {
    client_ip_address: clientIp || undefined,
    client_user_agent: userAgent || undefined,
  };
  if (user_data.email) hashedUser.em = [sha256(user_data.email)];
  if (user_data.phone) hashedUser.ph = [sha256(normalizePhone(user_data.phone))];
  if (user_data.first_name) hashedUser.fn = [sha256(user_data.first_name)];
  if (user_data.last_name) hashedUser.ln = [sha256(user_data.last_name)];
  if (user_data.zip) hashedUser.zp = [sha256(user_data.zip)];
  if (user_data.fbp) hashedUser.fbp = user_data.fbp;
  if (user_data.fbc) hashedUser.fbc = user_data.fbc;

  const body = {
    data: [
      {
        event_name,
        event_time: Math.floor(Date.now() / 1000),
        event_id,
        event_source_url,
        action_source: 'website',
        user_data: hashedUser,
        custom_data,
      },
    ],
  };

  // Fan out to every configured pixel in parallel. One failure shouldn't kill
  // the other — each pixel result is captured independently.
  const results = await Promise.all(
    PIXEL_IDS.map(async (pixelId) => {
      try {
        const res = await fetch(
          `https://graph.facebook.com/${API_VERSION}/${pixelId}/events?access_token=${ACCESS_TOKEN}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        );
        const text = await res.text();
        return { pixel_id: pixelId, ok: res.ok, status: res.status, body: text };
      } catch (err) {
        return { pixel_id: pixelId, ok: false, status: 0, error: String(err) };
      }
    })
  );

  const anyOk = results.some((r) => r.ok);
  return {
    statusCode: anyOk ? 200 : 502,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ results }),
  };
};
