// CRM v2 — balance-checkout
// GET /.netlify/functions/balance-checkout?j=<job_id>
//
// Public endpoint (no JWT). Customer clicks this from the balance email
// we send after the move. Creates a Stripe Checkout Session for the
// remaining balance and 303-redirects. The existing stripe-webhook.js
// routes metadata.purpose='balance' to handleBalancePaid in _lib/crm-stripe.js.

const { getStripe } = require('./_lib/stripe-client');
const { getAdminClient } = require('./_lib/supabase-admin');

function fmtUsd(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function errPage(message) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Toro Movers</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#ffffff;color:#1C1C1E;margin:0;padding:48px 20px;text-align:center}h1{color:#C8102E;margin:0 0 16px 0;font-weight:800}a{color:#C8102E;font-weight:700;text-decoration:none}</style></head><body><h1>TORO MOVERS</h1><p style="font-size:16px;line-height:1.5;max-width:460px;margin:0 auto;color:#3A3A3D">${escapeHtml(message)}</p><p style="margin-top:28px;color:#6B7280;font-size:14px">Call us at <a href="tel:+13217580094">(321) 758-0094</a>.</p></body></html>`,
  };
}

const { checkRateLimit } = require('./_lib/rate-limit');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };

  // Balance checkout creates a Stripe session per hit. 10 per IP per 10 min
  // so a bot iterating job IDs can't thrash Stripe.
  const rl = checkRateLimit(event, { bucket: 'balance-checkout', max: 10, windowMs: 10 * 60_000 });
  if (rl.blocked) return rl.response;

  if (!process.env.STRIPE_SECRET_KEY) return errPage('Payments are not configured yet. Please call us to pay.');

  const j = event.queryStringParameters && event.queryStringParameters.j;
  if (!j) return errPage('Missing job reference. Use the link from your balance email.');

  const admin = getAdminClient();
  const { data: job, error } = await admin
    .from('jobs').select('*, leads(*, customers(*))').eq('id', j).maybeSingle();
  if (error || !job) return errPage('We could not find that job.');

  const balanceCents = Math.round(Number(job.balance_due || 0) * 100);
  if (balanceCents <= 0) return errPage('This move is already paid in full. Thanks!');

  const tipParam = event.queryStringParameters && event.queryStringParameters.tip;
  const tipCents = Math.max(0, Math.round(Number(tipParam || 0) * 100));

  const customer = job.leads && job.leads.customers ? job.leads.customers : {};
  const lang = customer.language_preference === 'es' ? 'es' : 'en';
  const productName = lang === 'es' ? 'Saldo final — Toro Movers' : 'Toro Movers Final Balance';
  const productDesc = lang === 'es'
    ? `Saldo final de tu mudanza. Total: ${fmtUsd(job.customer_total)}. Deposito ya pagado: ${fmtUsd(job.deposit_paid)}.`
    : `Final balance for your move. Total: ${fmtUsd(job.customer_total)}. Deposit already paid: ${fmtUsd(job.deposit_paid)}.`;

  const lineItems = [{
    price_data: {
      currency: 'usd',
      product_data: { name: productName, description: productDesc },
      unit_amount: balanceCents,
    },
    quantity: 1,
  }];

  if (tipCents > 0) {
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: {
          name: lang === 'es' ? 'Propina para la cuadrilla' : 'Tip for the crew',
          description: lang === 'es' ? '100% va directo a los movers.' : '100% goes straight to the movers.',
        },
        unit_amount: tipCents,
      },
      quantity: 1,
    });
  }

  const stripe = getStripe();
  const origin = process.env.URL || `https://${event.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      customer_email: customer.email || undefined,
      metadata: {
        purpose: 'balance',
        job_id: j,
        lead_id: job.lead_id,
        quote_id: job.quote_id || '',
        balance_amount: String(Number(job.balance_due || 0).toFixed(2)),
        tip_amount: String((tipCents / 100).toFixed(2)),
      },
      success_url: `${origin}/reserved.html?session_id={CHECKOUT_SESSION_ID}&t=balance`,
      cancel_url: `${origin}/`,
      locale: lang === 'es' ? 'es' : 'en',
    }, { idempotencyKey: require('crypto').randomUUID() });

    await admin.from('activity_log').insert({
      entity_type: 'job',
      entity_id: j,
      actor_id: null,
      event_type: 'balance_checkout_opened',
      payload: { session_id: session.id, balance_cents: balanceCents, tip_cents: tipCents, language: lang },
    });

    return { statusCode: 303, headers: { Location: session.url, 'Cache-Control': 'no-store' }, body: '' };
  } catch (e) {
    return errPage('We hit a glitch creating your checkout page. Please call (321) 758-0094 — we can take payment over the phone.');
  }
};
