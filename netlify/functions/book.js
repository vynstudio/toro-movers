// One-click booking endpoint — called from email "Book Now" CTA and from
// the homepage package cards ("Choose"). Accepts GET query params, creates
// a Stripe Checkout session for the deposit, and 302-redirects to Stripe.
//
// Query params (all strings):
//   package   — "loading" | "intown" | "big" | "custom"  (optional)
//   deposit   — "50" | "125"  (optional; auto-derived from package if omitted)
//   total     — estimated total ($)
//   movers, hours, name, email, phone, zip_from, zip_to, size, stairs, date
//   source    — short tag for attribution (e.g. "home-package", "email_book_now")

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
  const pkg     = q.package  || '';
  const source  = q.source   || 'email_book_now';

  // Deposit: $125 when a truck is included (in-town / big), $50 otherwise.
  // Accepts explicit ?deposit= override, else derives from ?package=.
  const TRUCK_PKGS = { intown: true, big: true };
  const derivedDeposit = TRUCK_PKGS[pkg] ? 125 : 50;
  const parsedDeposit = parseInt(q.deposit, 10);
  const deposit = (parsedDeposit === 50 || parsedDeposit === 125) ? parsedDeposit : derivedDeposit;
  const depositCents = deposit * 100;

  const pkgLabel = pkg === 'loading' ? 'Loading help'
                 : pkg === 'intown'  ? 'In-town move'
                 : pkg === 'big'     ? 'Big move'
                 : 'Custom move';

  const description = [
    pkgLabel + (size ? ` · ${size}` : ''),
    movers && hours ? `${movers} movers × ${hours} hrs` : '',
    zipFrom && zipTo ? `${zipFrom} → ${zipTo}` : '',
    stairs ? stairs : '',
    date ? `Date: ${date}` : '',
    total ? `Est. total: $${total}` : '',
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
      phone_number_collection: { enabled: true },
      metadata: {
        source: source,
        package: pkg,
        deposit: String(deposit),
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
