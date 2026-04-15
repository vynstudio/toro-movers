// Stripe webhook — listens for checkout.session.completed and marks
// the matching lead as Booked + deposit paid.
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
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
                [{ text: '📋 Open in CRM', url: `https://toromovers.net/crm#lead/${match.id}` }],
                [{ text: '💳 Open in Stripe', url: `https://dashboard.stripe.com/payments/${session.payment_intent}` }],
              ]},
            }),
          }).catch(e => console.error('TG booking alert failed:', e));
        }

        // Schedule a Google review request email 24h from now.
        // Uses Resend's scheduledAt so it fires automatically without another cron.
        if (email && process.env.RESEND_API_KEY) {
          try {
            const resend = new Resend(process.env.RESEND_API_KEY);
            const fromEmail = process.env.RESEND_FROM_EMAIL || 'hello@toromovers.net';
            const firstName = (match.name || '').split(' ')[0] || 'there';
            const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

            await resend.emails.send({
              from: `Toro Movers <${fromEmail}>`,
              to: [email],
              replyTo: fromEmail,
              scheduledAt,
              subject: `${firstName}, how did your move go? (30-sec favor)`,
              html: `
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
                  <div style="background:#C8102E;color:#fff;padding:22px 24px;border-radius:12px 12px 0 0;text-align:center">
                    <div style="font-weight:900;font-size:22px;letter-spacing:-.3px">TORO <span style="opacity:.85">MOVERS</span></div>
                  </div>
                  <div style="background:#fff;padding:28px 24px;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 12px 12px">
                    <h2 style="margin:0 0 14px;font-size:22px;line-height:1.2">Hey ${firstName} — did we make your move easy?</h2>
                    <p style="margin:0 0 16px;color:#3a3a3a;font-size:15px;line-height:1.6">If our crew did a solid job, a Google review takes about <strong>30 seconds</strong> and means the world to a family-run business like ours.</p>
                    <div style="text-align:center;margin:28px 0">
                      <a href="https://search.google.com/local/writereview?placeid=ChIJzd_MJ2B654gRXJGWP5ydFy8" style="display:inline-block;background:#16a34a;color:#fff;padding:16px 36px;border-radius:999px;text-decoration:none;font-weight:800;font-size:15px;box-shadow:0 8px 20px rgba(22,163,74,.35)">⭐ Leave a Google review</a>
                    </div>
                    <p style="margin:18px 0;color:#3a3a3a;font-size:14px;line-height:1.6">If anything wasn't perfect, please reply to this email so we can make it right before you post. Your feedback helps us — and future customers.</p>
                    <p style="margin:18px 0 0;color:#3a3a3a;font-size:15px">Thanks for trusting us with your move.</p>
                    <p style="margin:6px 0 0;color:#3a3a3a;font-size:15px">— The Toro Movers Team</p>
                    <hr style="margin:28px 0 18px;border:none;border-top:1px solid #e5e5e5">
                    <div style="font-size:12px;color:#9ca3af;line-height:1.6"><strong>Toro Movers</strong> · Orlando, FL · Licensed &amp; insured<br><a href="https://toromovers.net/" style="color:#9ca3af">toromovers.net</a></div>
                  </div>
                </div>
              `,
            });
            console.log(`Review-request scheduled for ${email} at ${scheduledAt}`);
          } catch(e) {
            console.error('Review-request scheduling failed:', e.message);
          }
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
