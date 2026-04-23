// Stripe webhook — listens for checkout.session.completed and marks
// the matching lead as Booked + deposit paid.
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getStore } = require('@netlify/blobs'); // surface for Netlify scanner
const { listLeads, updateLead, notifyTelegram, getLead } = require('./_lib/leads');
const { sendBookingConfirmation } = require('./_lib/emails');
const { sendSms } = require('./_lib/sms');
const { handleCrmV2Event } = require('./_lib/crm-stripe');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // No secret means we cannot trust any event — fail closed, force an ops
    // response rather than silently processing unsigned payloads (audit
    // 2026-04-23: forged checkout.session.completed was a financial fraud
    // vector via the old JSON.parse fallback).
    console.error('STRIPE_WEBHOOK_SECRET not configured — refusing to process');
    return { statusCode: 503, body: 'Webhook endpoint not configured' };
  }

  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  if (!sig) {
    return { statusCode: 400, body: 'Missing stripe-signature header' };
  }

  let evt;
  try {
    evt = stripe.webhooks.constructEvent(event.body, sig, secret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // CRM v2: route deposit/balance events to the Supabase-backed handler.
  // Returns true if handled — skip the v1 Netlify Blobs lead lookup.
  try {
    const handled = await handleCrmV2Event(evt);
    if (handled) return { statusCode: 200, body: JSON.stringify({ received: true, handler: 'crm-v2' }) };
  } catch (e) {
    console.error('CRM v2 webhook handler failed:', e);
    // Fall through to v1 logic so unrelated Stripe events still work.
  }

  if (evt.type === 'checkout.session.completed') {
    const session = evt.data.object;
    const email = session.customer_email || session.customer_details?.email || '';
    const amount = session.amount_total ? (session.amount_total / 100) : 0;

    try {
      // Prefer metadata lead_id if set, fall back to email match
      const metaLeadId = session.metadata?.lead_id || session.client_reference_id || '';
      const leads = await listLeads();
      let match;
      if (metaLeadId) {
        match = leads.find(l => l.id === metaLeadId);
      }
      if (!match && email) {
        match = leads.find(l => l.email && l.email.toLowerCase() === email.toLowerCase());
      }

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
                [{ text: '📋 Open in CRM', url: `https://toromovers.net/crm#lead/${match.id}` }],
                [{ text: '💳 Open in Stripe', url: `https://dashboard.stripe.com/payments/${session.payment_intent}` }],
              ]},
            }),
          }).catch(e => console.error('TG booking alert failed:', e));
        }

        // Send branded booking confirmation email to the customer
        if (updated?.email && process.env.RESEND_API_KEY) {
          try {
            await sendBookingConfirmation(updated, amount);
          } catch(e) { console.error('booking confirmation email failed:', e); }
        }

        // Send SMS confirmation — no-op until TWILIO_* env vars are set
        if (updated?.phone) {
          try {
            const moveDate = updated.move_date || '';
            const moveTime = updated.move_time || '';
            const when = [moveDate, moveTime].filter(Boolean).join(' at ');
            const sms =
              `Toro Movers — booking confirmed${when ? ' for ' + when : ''}. ` +
              `Deposit $${amount} received. Confirmation emailed. ` +
              `Call (321) 758-0094 if you need to change anything.`;
            await sendSms(updated.phone, sms);
          } catch(e) { console.error('booking confirmation SMS failed:', e); }
        }

        // NOTE: Review request is now fired when job is marked Done in Telegram
        // (see telegram-callback.js). Previously this fired +24h after deposit,
        // but that's premature — the move hasn't actually happened yet.
      } else {
        console.log('Stripe webhook: no lead matched email', email);
      }
    } catch (e) {
      console.error('Stripe webhook lead update failed:', e);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
