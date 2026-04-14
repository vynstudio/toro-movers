// One-click booking endpoint — called from email "Book Now" CTA.
// Accepts GET query params, creates a Stripe Checkout session for the
// deposit, and 302-redirects to the Stripe hosted checkout URL.
//
// Query params expected (all strings):
//   hours, total, movers, name, email, phone, zip_from, zip_to, size,
//   stairs, date

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};

  if (!process.env.STRIPE_SECRET_KEY) {
    // Graceful fallback: redirect to the main homepage packages section
    return {
      statusCode: 302,
      headers: { Location: 'https://toromovers.net/#packages' },
    };
  }

  const hours   = q.hours   || '';
  const total   = q.total   || '';
  const movers  = q.movers  || '2';
  const name    = q.name    || '';
  const email   = q.email   || '';
  const phone   = q.phone   || '';
  const zipFrom = q.zip_from || '';
  const zipTo   = q.zip_to   || '';
  const size    = q.size     || '';
  const stairs  = q.stairs   || '';
  const date    = q.date     || '';

  const DEPOSIT = 50; // flat $50 refundable deposit
  const depositCents = DEPOSIT * 100;

  const description = [
    `${size || 'Custom move'}`,
    `${movers} movers × ${hours} hrs`,
    zipFrom && zipTo ? `${zipFrom} → ${zipTo}` : '',
    stairs ? stairs : '',
    date ? `Date: ${date}` : '',
    `Est. total: $${total}`,
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
              name: 'Toro Movers — Reservation Deposit',
              description: description,
            },
            unit_amount: depositCents,
          },
          quantity: 1,
        },
      ],
      customer_email: email || undefined,
      metadata: {
        source: 'email_book_now',
        estimate_total: total,
        movers: movers,
        hours: hours,
        home_size: size,
        stairs: stairs,
        date: date,
        zip_from: zipFrom,
        zip_to: zipTo,
        customer_name: name,
        customer_phone: phone,
      },
      success_url: 'https://toromovers.net/thanks?payment=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: `https://toromovers.net/quote?booked=cancelled&${new URLSearchParams(q).toString()}`,
    });

    return {
      statusCode: 302,
      headers: { Location: session.url, 'Cache-Control': 'no-store' },
    };
  } catch (err) {
    console.error('Stripe book.js error:', err.message);
    return {
      statusCode: 302,
      headers: { Location: 'https://toromovers.net/#packages?booking_error=1' },
    };
  }
};
