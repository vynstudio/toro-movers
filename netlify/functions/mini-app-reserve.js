// Toro Movers Mini App backend: validates Telegram initData,
// creates a CRM lead, opens a Stripe Checkout session for the deposit,
// and alerts ops via @Toromoversbot.
//
// Called from /mini/toro (Telegram WebApp) on "Reserve" tap.
//
// Security: initData is HMAC-SHA256 signed by Telegram using the bot
// token (per-app). We validate it here before trusting any user claim.

const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createLead } = require('./_lib/leads');

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

const json = (status, data, extra = {}) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', ...extra },
  body: JSON.stringify(data),
});

// Verify Telegram WebApp initData signature.
// initData is a URL-encoded string: "query_id=...&user=...&auth_date=...&hash=..."
// Return the parsed user object if valid, null otherwise.
function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const keys = [...params.keys()].sort();
  const dataCheckString = keys.map(k => `${k}=${params.get(k)}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (calc !== hash) return null;

  // Reject stale initData (older than 24h)
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch { user = null; }
  return user;
}

async function notifyOps(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
  } catch (_) { /* never block on notify */ }
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' }, cors);

  if (!process.env.STRIPE_SECRET_KEY) {
    return json(500, { error: 'Stripe not configured' }, cors);
  }

  let p;
  try { p = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON' }, cors); }

  const {
    initData = '', movers = 2, hours = 2, truck = false, total = 0,
    name = '', phone = '', email = '',
    move_date = '', move_time = '',
    pickup_address = '', dropoff_address = '',
  } = p;

  // Validate inputs
  if (!name || !phone || !email) return json(400, { error: 'name, phone, email required' }, cors);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'invalid email' }, cors);
  const mv = parseInt(movers, 10);
  const hr = parseInt(hours, 10);
  if (![2, 3, 4].includes(mv)) return json(400, { error: 'invalid movers' }, cors);
  if (![2, 3, 4, 5, 6, 8].includes(hr)) return json(400, { error: 'invalid hours' }, cors);

  const hasTruck = !!truck;
  const depositAmount = hasTruck ? 125 : 50;

  // Verify Telegram identity (soft — continue even if missing, but flag it)
  const tgUser = verifyInitData(initData, TG_TOKEN);
  const tgSource = tgUser
    ? `telegram:${tgUser.id}${tgUser.username ? ' @' + tgUser.username : ''}`
    : 'telegram:unverified';

  // Create CRM lead
  let lead = null;
  try {
    lead = await createLead({
      name,
      email,
      phone,
      move_date,
      move_time,
      pickup_address,
      dropoff_address,
      estimate: {
        movers: mv,
        hours: hr,
        total: parseInt(total, 10) || (mv * hr * 75 + (hasTruck ? 275 : 0)),
        truck: hasTruck,
      },
      page: 'mini-app',
      utm_source: 'telegram',
      utm_medium: 'mini_app',
      utm_campaign: 'toro_mini_app_v0',
      utm_content: tgSource,
    });
  } catch (e) {
    console.error('createLead failed:', e.message);
  }

  // Create Stripe Checkout session for deposit
  let checkoutUrl = null;
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Toro Movers — Deposit (Mini App)`,
            description: `${mv} movers × ${hr} hrs${hasTruck ? ' · truck' : ''}${move_date ? ' · ' + move_date : ''}`,
          },
          unit_amount: depositAmount * 100,
        },
        quantity: 1,
      }],
      customer_email: email,
      metadata: {
        source: 'mini-app',
        lead_id: lead ? lead.id : '',
        tg_source: tgSource,
        movers: String(mv),
        hours: String(hr),
        truck: String(hasTruck),
        move_date, move_time,
        customer_name: name,
        customer_phone: phone,
        deposit: String(depositAmount),
        total: String(p.total || 0),
      },
      success_url: 'https://toromovers.net/thanks?payment=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://toromovers.net/mini/toro',
    }, { idempotencyKey: require('crypto').randomUUID() });
    checkoutUrl = session.url;
  } catch (err) {
    console.error('Stripe error:', err.message);
    return json(500, { error: 'Checkout creation failed', detail: err.message }, cors);
  }

  // Fire ops alert (best-effort)
  const verifiedTag = tgUser ? '✅ verified' : '⚠️ unverified';
  await notifyOps([
    `🤖 *Mini App reservation*`,
    '',
    `*${name}* · ${tgSource} ${verifiedTag}`,
    `📞 ${phone} · ✉ ${email}`,
    move_date ? `📅 ${move_date}${move_time ? ' ' + move_time : ''}` : '',
    pickup_address ? `📍 ${pickup_address} → ${dropoff_address || '?'}` : '',
    `👥 ${mv} movers · ${hr}h${hasTruck ? ' · 🚚 truck' : ''}`,
    `💰 est $${p.total || 0} · deposit $${depositAmount} (Stripe session created)`,
  ].filter(Boolean).join('\n'));

  return json(200, {
    ok: true,
    leadId: lead ? lead.id : null,
    checkoutUrl,
    tgVerified: !!tgUser,
  }, cors);
};
