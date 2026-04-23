// Centralised Stripe SDK bootstrap. One place to bump the API version
// so every function stays in lockstep after a Stripe release.
const Stripe = require('stripe');

const STRIPE_API_VERSION = '2024-10-28.acacia';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  return Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

module.exports = { getStripe, STRIPE_API_VERSION };
