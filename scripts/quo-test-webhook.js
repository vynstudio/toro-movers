#!/usr/bin/env node
// Self-test for the Quo webhook receiver. Fetches the signing key from
// Quo's API into memory (never printed), constructs a fake
// message.received payload, signs it, and POSTs to the live webhook
// URL. Prints the receiver's response so we can verify wiring without
// needing a real phone to text the line.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const apiKey = process.env.OPENPHONE_API_KEY;
const webhookUrl = process.env.QUO_WEBHOOK_URL || 'https://toromovers.net/.netlify/functions/quo-webhook';
const fromNumber = process.argv[2] || '+15555550100';
const messageBody = process.argv.slice(3).join(' ') || 'Test reply from quo-test-webhook script';

if (!apiKey) {
  console.error('OPENPHONE_API_KEY not set');
  process.exit(1);
}

(async () => {
  // 1. Find the active toro-inbound-sms webhook
  const list = await fetch('https://api.openphone.com/v1/webhooks', {
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
  });
  const lj = await list.json();
  const hook = (lj.data || []).find(h => h.url === webhookUrl && h.status !== 'disabled');
  if (!hook) {
    console.error('No active webhook found at', webhookUrl);
    process.exit(2);
  }

  // 2. Get its signing key (fetched into memory only)
  const det = await fetch(`https://api.openphone.com/v1/webhooks/${hook.id}`, {
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
  });
  const dj = await det.json();
  const key = (dj.data || dj).key;
  if (!key) { console.error('No signing key on webhook'); process.exit(3); }

  // 3. Construct payload
  const payload = {
    type: 'message.received',
    data: {
      object: {
        id: 'AC' + crypto.randomBytes(6).toString('hex'),
        direction: 'incoming',
        from: fromNumber,
        to: ['+16896002720'],
        body: messageBody,
        createdAt: new Date().toISOString(),
      },
    },
  };
  const rawBody = JSON.stringify(payload);
  const ts = String(Date.now());
  const signingKey = Buffer.from(key, 'base64');
  const sig = crypto.createHmac('sha256', signingKey).update(`${ts}.${rawBody}`).digest('base64');
  const sigHeader = `hmac;1;${ts};${sig}`;

  console.log('POSTing simulated message.received');
  console.log('  from :', fromNumber);
  console.log('  body :', messageBody);

  const r = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'openphone-signature': sigHeader },
    body: rawBody,
  });
  const txt = await r.text();
  console.log('  status:', r.status);
  console.log('  body  :', txt);
})();
