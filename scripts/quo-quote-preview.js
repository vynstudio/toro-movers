#!/usr/bin/env node
// One-off: send a sample quote SMS to OPENPHONE_OWNER_PHONE so we can
// see what customers will see. Uses the same SMS_COPY template that
// quote-send-sms.js builds in production.
//
// Usage: node scripts/quo-quote-preview.js [en|es]

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const lang = (process.argv[2] || 'en').toLowerCase();
const apiKey = process.env.OPENPHONE_API_KEY;
const fromNum = process.env.OPENPHONE_FROM_NUMBER || '+16896002720';
const toNum = process.env.OPENPHONE_OWNER_PHONE || '+13217580094';

if (!apiKey) { console.error('OPENPHONE_API_KEY not set'); process.exit(1); }

function fmtMoney(n) {
  return n % 1 === 0 ? `$${n.toLocaleString('en-US')}` : `$${n.toFixed(2)}`;
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

// Realistic sample quote (a 3-hour 2-mover labor-only move — typical Toro job)
const sample = {
  first: 'Diler',
  total: fmtMoney(450),
  crew: 2,
  hours: 3,
  rate: fmtMoney(75),
  truck: false,
  deposit: fmtMoney(50),
  reserveUrl: 'https://toromovers.net/.netlify/functions/reserve?q=preview-test-quote',
};

const body = `[PREVIEW] ${SMS_COPY[lang](sample)}`;

(async () => {
  console.log('Sending sample quote SMS to', toNum);
  console.log('Body:');
  console.log(body);
  console.log('---');
  const r = await fetch('https://api.openphone.com/v1/messages', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: body, to: [toNum], from: fromNum }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Send failed:', r.status, JSON.stringify(j));
    process.exit(2);
  }
  console.log('Sent. id:', j?.data?.id, 'status:', j?.data?.status);
})();
