// Lightweight in-memory rate limiter for public Netlify endpoints.
//
// Netlify Function instances are short-lived but warm for a few minutes
// between invocations — enough to catch rapid-fire abuse from a single
// IP or email. For slow-drip attacks across cold starts this is not
// sufficient; combine with Netlify's built-in rate limiting on the
// function URL for that. This is our first-line defence.
//
// Usage:
//   const { checkRateLimit } = require('./_lib/rate-limit');
//   const rl = checkRateLimit(event, { bucket: 'crew-apply', max: 3, windowMs: 60_000 });
//   if (rl.blocked) return rl.response;

const buckets = new Map(); // bucketName → Map<key, [{t}, {t}, ...]>
const LIMIT_BUCKETS_MAX = 32;

function clientKey(event) {
  // Prefer Netlify's own geo IP header, fall back to x-forwarded-for, fall
  // back to a literal 'anon' so the function doesn't crash when neither is
  // present (local dev, curl without --header, etc.).
  const h = event.headers || {};
  return (
    h['x-nf-client-connection-ip'] ||
    (h['x-forwarded-for'] || '').split(',')[0].trim() ||
    h['client-ip'] ||
    'anon'
  );
}

function getBucket(name) {
  let b = buckets.get(name);
  if (!b) {
    if (buckets.size >= LIMIT_BUCKETS_MAX) buckets.delete(buckets.keys().next().value);
    b = new Map();
    buckets.set(name, b);
  }
  return b;
}

// Evicts entries whose full window has expired. Runs inline on every check —
// cheap amortized since the window is usually short.
function prune(bucket, now, windowMs) {
  for (const [k, times] of bucket) {
    while (times.length && now - times[0] > windowMs) times.shift();
    if (!times.length) bucket.delete(k);
  }
}

function checkRateLimit(event, { bucket, max, windowMs, keyExtra }) {
  const now = Date.now();
  const b = getBucket(bucket);
  prune(b, now, windowMs);

  const key = [clientKey(event), keyExtra].filter(Boolean).join('|');
  const hits = b.get(key) || [];
  hits.push(now);
  b.set(key, hits);

  if (hits.length > max) {
    const retryAfter = Math.ceil((hits[0] + windowMs - now) / 1000);
    return {
      blocked: true,
      response: {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.max(1, retryAfter)),
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Too many requests — please slow down and try again shortly.',
          retry_after_seconds: retryAfter,
        }),
      },
    };
  }
  return { blocked: false };
}

module.exports = { checkRateLimit };
