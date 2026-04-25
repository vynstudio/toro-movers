// CRM_PASSWORD-gated dev tool — send a one-off SMS preview through Quo
// using the function's live env vars. Useful for previewing what
// quote / reminder / opt-out messages will look like before wiring
// them into a real customer flow.
//
// POST /.netlify/functions/crm-sms-preview
//   Headers: x-crm-password: <CRM_PASSWORD>
//   Body:    { to: "+1...", body: "...", template?: "quote" }
// Response: 200 { ok, smsResult }
//
// If `template: "quote"` is passed without a body, sends the same
// preview text the quote-send-sms.js function would generate, using
// hardcoded sample data.

const { sendSms } = require('./_lib/sms');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-crm-password',
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
  return n % 1 === 0 ? `$${n.toLocaleString('en-US')}` : `$${n.toFixed(2)}`;
}

function quoteTemplate(lang, sample) {
  const s = sample || {
    first: 'Diler',
    total: 450, crew: 2, hours: 3, rate: 75,
    truck: false, deposit: 50,
    reserveUrl: 'https://toromovers.net/.netlify/functions/reserve?q=preview',
  };
  if (lang === 'es') {
    return `Toro Movers — cotización para ${s.first}: ${fmtMoney(s.total)} (${s.crew} ayudantes × ${s.hours}h × ${fmtMoney(s.rate)}/hr${s.truck ? ' + camión 26ft' : ''}). ` +
      `Reserva tu fecha con un depósito de ${fmtMoney(s.deposit)}: ${s.reserveUrl}\n` +
      `Responde STOP para cancelar.`;
  }
  return `Toro Movers — quote for ${s.first}: ${fmtMoney(s.total)} (${s.crew} movers × ${s.hours}h × ${fmtMoney(s.rate)}/hr${s.truck ? ' + 26ft truck' : ''}). ` +
    `Reserve your date with a ${fmtMoney(s.deposit)} deposit: ${s.reserveUrl}\n` +
    `Reply STOP to opt out.`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  const provided =
    event.headers['x-crm-password'] ||
    event.headers['X-CRM-Password'] ||
    new URLSearchParams(event.queryStringParameters || {}).get('pw');
  if (!provided || provided !== process.env.CRM_PASSWORD) {
    return respond(401, { error: 'Unauthorized' });
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const to = payload.to;
  if (!to) return respond(400, { error: 'to required' });

  let body = payload.body;
  if (!body && payload.template === 'quote') {
    body = quoteTemplate(payload.lang || 'en', payload.sample);
  }
  if (!body) return respond(400, { error: 'body or template required' });

  // Prefix [PREVIEW] so the recipient knows it's not a real customer message
  if (!/^\[PREVIEW\]/.test(body)) body = `[PREVIEW] ${body}`;

  const r = await sendSms(to, body);
  return respond(r.ok ? 200 : 502, { ok: r.ok, smsResult: r, body });
};
