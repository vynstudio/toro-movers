#!/usr/bin/env node
// One-off: register the inbound-message webhook with Quo.
//
// Usage:
//   node scripts/quo-register-webhook.js
//
// Reads OPENPHONE_API_KEY from .env, POSTs to /v1/webhooks/messages with
// the production handler URL, and prints the resulting signing key. Save
// the printed key as OPENPHONE_WEBHOOK_SECRET in Netlify (production).
//
// Safe to re-run — Quo will create a new webhook, but you can delete the
// old one in the Quo dashboard.

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const apiKey = process.env.OPENPHONE_API_KEY;
const phoneId = process.env.OPENPHONE_PHONE_NUMBER_ID || 'PN3sKfvpYp';
const webhookUrl = process.env.QUO_WEBHOOK_URL || 'https://toromovers.net/.netlify/functions/quo-webhook';

if (!apiKey) {
  console.error('OPENPHONE_API_KEY not set (check .env)');
  process.exit(1);
}

(async () => {
  // Quo's docs publish two endpoints:
  //   POST /v1/webhooks/messages — message events
  //   POST /v1/webhooks/calls    — call events (skip for now)
  const payload = {
    url: webhookUrl,
    label: 'toro-inbound-sms',
    events: ['message.received'],
    phoneNumberId: phoneId,
  };

  const r = await fetch('https://api.openphone.com/v1/webhooks/messages', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('API error', r.status, JSON.stringify(j, null, 2));
    process.exit(2);
  }

  const data = j.data || j;
  console.log('Webhook registered:');
  console.log('  id:           ', data.id);
  console.log('  url:          ', data.url);
  console.log('  events:       ', data.events);
  console.log('  signingKey:   ', data.signingKey || data.signing_key || '(not returned — check dashboard)');
  console.log('');
  console.log('Next: copy the signingKey above and run');
  console.log('  netlify env:set OPENPHONE_WEBHOOK_SECRET "<paste>" --context production --secret');
})().catch((e) => {
  console.error('fetch failed:', e.message);
  process.exit(3);
});
