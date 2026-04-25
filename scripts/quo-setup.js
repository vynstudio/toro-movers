#!/usr/bin/env node
// One-off: list Quo (OpenPhone) phone numbers + messaging status.
// Reads OPENPHONE_API_KEY from .env. Prints PN IDs, numbers, messaging
// restrictions. Run: `node scripts/quo-setup.js`

// Tiny .env loader (no dotenv dep)
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const key = process.env.OPENPHONE_API_KEY;
if (!key) {
  console.error('OPENPHONE_API_KEY not set (check .env)');
  process.exit(1);
}

(async () => {
  const r = await fetch('https://api.openphone.com/v1/phone-numbers', {
    headers: { Authorization: key, 'Content-Type': 'application/json' },
  });
  const j = await r.json();
  if (!r.ok) {
    console.error('API error', r.status, JSON.stringify(j));
    process.exit(2);
  }
  const nums = j.data || [];
  console.log(`Found ${nums.length} phone number(s):\n`);
  for (const n of nums) {
    console.log(`  number:     ${n.number || n.formattedNumber || '?'}`);
    console.log(`  id:         ${n.id}`);
    console.log(`  name:       ${n.name || '(none)'}`);
    const msg = n.restrictions?.messaging || n.messaging || {};
    console.log(`  messaging:  US=${msg.US || '?'} CA=${msg.CA || '?'}`);
    console.log('');
  }
})().catch((e) => {
  console.error('fetch failed:', e.message);
  process.exit(3);
});
