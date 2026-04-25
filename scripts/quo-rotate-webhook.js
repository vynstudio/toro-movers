#!/usr/bin/env node
// Delete an old Quo webhook and register a fresh one. Prints ONLY the new
// signing key to stdout so it can be piped directly into `netlify env:set`
// without ever appearing in the terminal.
//
// Usage:
//   OPENPHONE_WEBHOOK_SECRET="$(node scripts/quo-rotate-webhook.js <oldId>)"
//   netlify env:set OPENPHONE_WEBHOOK_SECRET "$OPENPHONE_WEBHOOK_SECRET" \
//     --context production --secret
//   unset OPENPHONE_WEBHOOK_SECRET
//
// All status messages go to stderr. Stdout is the bare signing key only.

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
const oldWebhookId = process.argv[2];

if (!apiKey) {
  console.error('OPENPHONE_API_KEY not set (check .env)');
  process.exit(1);
}

(async () => {
  if (oldWebhookId) {
    process.stderr.write(`Deleting old webhook ${oldWebhookId}…\n`);
    const d = await fetch(`https://api.openphone.com/v1/webhooks/${oldWebhookId}`, {
      method: 'DELETE',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    });
    process.stderr.write(`  status: ${d.status}\n`);
  }

  process.stderr.write('Creating new webhook…\n');
  const c = await fetch('https://api.openphone.com/v1/webhooks/messages', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      label: 'toro-inbound-sms',
      events: ['message.received'],
      phoneNumberId: phoneId,
    }),
  });
  const cj = await c.json().catch(() => ({}));
  if (!c.ok) {
    process.stderr.write(`Create failed: ${c.status} ${JSON.stringify(cj)}\n`);
    process.exit(2);
  }
  const newId = (cj.data || cj).id;
  process.stderr.write(`  new id: ${newId}\n`);

  // Fetch full record to read the signing key (POST /webhooks doesn't return it)
  const g = await fetch(`https://api.openphone.com/v1/webhooks/${newId}`, {
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
  });
  const gj = await g.json().catch(() => ({}));
  const key = (gj.data || gj).key;
  if (!key) {
    process.stderr.write('No signing key returned — check Quo dashboard.\n');
    process.exit(3);
  }

  process.stderr.write('  signingKey: <captured, will be piped>\n');
  // Bare key on stdout — nothing else.
  process.stdout.write(key);
})().catch((e) => {
  process.stderr.write(`fetch failed: ${e.message}\n`);
  process.exit(4);
});
