// Creates a Stripe Checkout Session from an email CTA link click.
// Called via GET with query params — redirects (302) to Stripe.
//
// Example link in email:
//   /.netlify/functions/reserve-from-email?truck=true&total=875&movers=2&hours=4&name=Maria&email=maria@email.com&phone=3215551234
//
// Deposit logic: truck=true → $125, truck=false → $50

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { statusCode: 302, headers: { Location: 'https://toromovers.net/#book' }, body: '' };
  }

  const q = event.queryStringParameters || {};
  const truck = q.truck === 'true';
  const deposit = truck ? 125 : 50;
  const total = parseInt(q.total, 10) || 0;
  const movers = q.movers || '2';
  const hours = q.hours || '2';
  const name = q.name || '';
  const email = q.email || '';
  const phone = q.phone || '';

  const label = truck ? 'Move with Truck' : 'Labor Only';

  const description = [
    `${label} — ${movers} movers × ${hours} hrs`,
    `Estimated total: $${total}`,
    name ? `Customer: ${name}` : '',
    phone ? `Phone: ${phone}` : '',
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
              name: `Toro Movers — ${label} Deposit`,
              description: description,
            },
            unit_amount: deposit * 100,
          },
          quantity: 1,
        },
      ],
      customer_email: email || undefined,
      metadata: {
        source: 'email-quote-cta',
        estimate_total: String(total),
        movers: movers,
        hours: hours,
        truck: String(truck),
        customer_name: name,
        customer_phone: phone,
      },
      success_url: 'https://toromovers.net/thanks?payment=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://toromovers.net/#packages',
    }, { idempotencyKey: require('crypto').randomUUID() });

    return {
      statusCode: 302,
      headers: { Location: session.url },
      body: '',
    };
  } catch (err) {
    console.error('Stripe error:', err.message);
    return {
      statusCode: 302,
      headers: { Location: 'https://toromovers.net/#book' },
      body: '',
    };
  }
};
