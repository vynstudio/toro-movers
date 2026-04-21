// CRM v2 — reserve
// GET  /.netlify/functions/reserve?q=<quote_id>
//
// Creates a Stripe Checkout Session for the quote's deposit amount and
// 303-redirects to the Stripe-hosted checkout page. Designed to be the
// href behind the "Reserve my spot now" button in the quote email.
//
// Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Prefer a test-mode key (sk_test_...) on the preview Netlify site so
// customers can't accidentally be charged during CRM testing.

const Stripe = require('stripe');
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
    body: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Toro Movers</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#ffffff;color:#1C1C1E;margin:0;padding:48px 20px;text-align:center}h1{color:#C8102E;margin:0 0 16px 0;font-weight:800;letter-spacing:-0.01em}a{color:#C8102E;font-weight:700;text-decoration:none}</style></head><body><h1>TORO MOVERS</h1><p style="font-size:16px;line-height:1.5;max-width:460px;margin:0 auto;color:#3A3A3D">${escapeHtml(message)}</p><p style="margin-top:28px;color:#6B7280;font-size:14px">Call us at <a href="tel:+13217580094">(321) 758-0094</a>.</p></body></html>`,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: {}, body: 'Method not allowed' };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return errPage('Payments are not configured yet. Please call us to reserve your spot.');
  }

  const q = event.queryStringParameters && event.queryStringParameters.q;
  if (!q) return errPage('Missing quote reference. Use the link from your quote email.');

  // Load quote + lead + customer
  const admin = getAdminClient();
  const { data: quote, error: qErr } = await admin
    .from('quotes')
    .select('*, leads(*, customers(*))')
    .eq('id', q)
    .maybeSingle();
  if (qErr || !quote) {
    return errPage('We could not find that quote. If your email is older than 30 days, ask us to resend.');
  }

  const customer = quote.leads && quote.leads.customers;
  const depositCents = Math.round(Number(quote.deposit_amount || 0) * 100);
  if (depositCents <= 0) {
    return errPage('Deposit amount missing on this quote. Please call us to book.');
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-10-28.acacia' });
  const lang = quote.language === 'es' ? 'es' : 'en';
  const productName = lang === 'es' ? 'Deposito — Toro Movers' : 'Toro Movers Deposit';
  const productDesc = lang === 'es'
    ? `Deposito para reservar tu mudanza. Total estimado: ${fmtUsd(quote.total)}. Se aplica al total final.`
    : `Deposit to reserve your move. Estimated total: ${fmtUsd(quote.total)}. Applied to the final bill.`;

  const origin = process.env.URL
    || (event.headers.host ? `https://${event.headers.host}` : 'https://toromovers-crm.netlify.app');

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: productName, description: productDesc },
          unit_amount: depositCents,
        },
        quantity: 1,
      }],
      customer_email: customer && customer.email ? customer.email : undefined,
      metadata: {
        quote_id: q,
        lead_id: quote.lead_id,
        customer_id: customer && customer.id ? customer.id : '',
        purpose: 'deposit',
        quote_total: String(quote.total || ''),
      },
      success_url: `${origin}/reserved.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
      locale: lang === 'es' ? 'es' : 'en',
    });

    // Log the checkout initiation
    await admin.from('activity_log').insert({
      entity_type: 'quote',
      entity_id: q,
      actor_id: null,
      event_type: 'deposit_checkout_opened',
      payload: { session_id: session.id, amount: depositCents, language: lang },
    });

    return {
      statusCode: 303,
      headers: { Location: session.url, 'Cache-Control': 'no-store' },
      body: '',
    };
  } catch (e) {
    return errPage('We hit a glitch creating your secure checkout page. Please call (321) 758-0094 — we can book you manually.');
  }
};
