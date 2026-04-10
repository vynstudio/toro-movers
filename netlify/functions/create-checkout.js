// Stripe Checkout Session creator for Toro Movers deposit payments
//
// Env vars required (set in Netlify UI → Site settings → Environment variables):
//   STRIPE_SECRET_KEY  — sk_test_... (test) or sk_live_... (production)
//
// POST body (JSON):
//   {
//     package: "loading" | "intown" | "big" | "custom",
//     deposit: 50 | 125,
//     estimate: 900,
//     movers: 2,
//     hours: 3,
//     truck: false,
//     packing: "none" | "fragile" | "full",
//     bedrooms: "2",
//     stairs: "none" | "2nd" | "3rd",
//     date: "2026-04-15",
//     zip_from: "32801",
//     zip_to: "32746",
//     special: "piano",
//     name: "Maria Sanchez",
//     phone: "3215551234",
//     email: "maria@email.com"
//   }

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method not allowed' };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Stripe not configured' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: 'Invalid JSON' };
  }

  const {
    package: pkg = 'custom',
    deposit = 50,
    estimate = 0,
    movers = 2,
    hours = 2,
    truck = false,
    packing = 'none',
    bedrooms = '1',
    stairs = 'none',
    date = '',
    zip_from = '',
    zip_to = '',
    special = '',
    name = '',
    phone = '',
    email = '',
  } = payload;

  // Validate deposit amount
  const validDeposit = truck ? 125 : 50;
  const depositCents = validDeposit * 100;

  // Package labels
  const pkgLabels = {
    loading: 'Loading Help',
    intown: 'In-Town Move',
    big: 'Big Move',
    custom: 'Custom Move',
  };

  // Build description for Stripe receipt
  const description = [
    `${pkgLabels[pkg] || 'Move'} — ${bedrooms}BR`,
    `${movers} movers × ${hours} hrs`,
    truck ? 'Truck included' : 'Labor only',
    packing !== 'none' ? `Packing: ${packing}` : '',
    date ? `Date: ${date}` : '',
    zip_from ? `From: ${zip_from}` : '',
    zip_to ? `To: ${zip_to}` : '',
    special ? `Special: ${special}` : '',
  ].filter(Boolean).join(' · ');

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Toro Movers — ${pkgLabels[pkg] || 'Move'} Deposit`,
              description: description,
              images: ['https://toromovers.net/assets/img/photos/team-family-portrait.webp'],
            },
            unit_amount: depositCents,
          },
          quantity: 1,
        },
      ],
      customer_email: email || undefined,
      metadata: {
        package: pkg,
        estimate_total: String(estimate),
        movers: String(movers),
        hours: String(hours),
        truck: String(truck),
        packing: packing,
        bedrooms: bedrooms,
        stairs: stairs,
        date: date,
        zip_from: zip_from,
        zip_to: zip_to,
        special_items: special,
        customer_name: name,
        customer_phone: phone,
      },
      success_url: 'https://toromovers.net/thanks?payment=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: event.headers.referer || 'https://toromovers.net/#packages',
    });

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('Stripe error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Checkout failed', detail: err.message }),
    };
  }
};
