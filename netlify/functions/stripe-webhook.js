// Stripe webhook — listens for checkout.session.completed and marks
// the matching lead as Booked + deposit paid.
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getStore } = require('@netlify/blobs'); // surface for Netlify scanner
const { listLeads, updateLead, notifyTelegram, getLead } = require('./_lib/leads');

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  let evt;

  try {
    if (secret && sig) {
      evt = stripe.webhooks.constructEvent(event.body, sig, secret);
    } else {
      // No signature verification configured — parse best-effort (dev mode)
      evt = JSON.parse(event.body);
    }
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (evt.type === 'checkout.session.completed') {
    const session = evt.data.object;
    const email = session.customer_email || session.customer_details?.email || '';
    const amount = session.amount_total ? (session.amount_total / 100) : 0;

    try {
      // Find the most recent lead with matching email (index is newest-first)
      const leads = await listLeads();
      const match = leads.find(l => l.email && l.email.toLowerCase() === email.toLowerCase());

      if (match) {
        const updated = await updateLead(match.id, {
          status: 'booked',
          depositPaid: true,
          stripeSessionId: session.id,
          timelineEntry: {
            type: 'payment',
            text: `Deposit paid: $${amount} · Stripe session ${session.id.slice(-8)}`,
          },
        });

        // Fire Telegram alert for the booking
        const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (telegramToken && chatId) {
          const text = [
            `🎉 *DEPOSIT PAID — BOOKED*`,
            ``,
            `👤 *${match.name}*`,
            match.phone ? `📱 \`${match.phone}\`` : '',
            match.email ? `✉️ ${match.email}` : '',
            ``,
            `💰 *$${amount} deposit received*`,
            match.estimate_total ? `Est. total: $${match.estimate_total}` : '',
            ``,
            `Stripe: \`${session.id}\``,
          ].filter(Boolean).join('\n');

          await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text,
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [
                [{ text: '📞 Call ' + (match.name || '').split(' ')[0], url: `tel:${match.phone}` }],
                [{ text: '📋 Open in CRM', url: `https://toromovers.net/crm#lead/${match.id}` }],
                [{ text: '💳 Open in Stripe', url: `https://dashboard.stripe.com/payments/${session.payment_intent}` }],
              ]},
            }),
          }).catch(e => console.error('TG booking alert failed:', e));
        }
      } else {
        console.log('Stripe webhook: no lead matched email', email);
      }
    } catch (e) {
      console.error('Stripe webhook lead update failed:', e);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
