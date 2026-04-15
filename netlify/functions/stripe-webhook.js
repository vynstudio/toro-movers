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

        // Send branded booking confirmation email to the customer
        if (updated?.email && process.env.RESEND_API_KEY) {
          try {
            await sendBookingConfirmation(updated, amount);
          } catch(e) { console.error('booking confirmation email failed:', e); }
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

async function sendBookingConfirmation(lead, depositAmount){
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'hello@toromovers.net';
  const firstName = (lead.name || '').split(' ')[0] || 'there';
  const est = lead.estimate || {};
  const estimatedTotal = est.total || 0;
  const balanceDue = Math.max(0, estimatedTotal - depositAmount);

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const row = (label, value) => value ? `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;width:42%">${esc(label)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;color:#1a1a1a;font-size:14px;font-weight:600">${esc(value)}</td>
    </tr>` : '';

  const fromTo = (lead.zip_from && lead.zip_to) ? `${lead.zip_from} → ${lead.zip_to}` : '';
  const crew   = est.movers ? `${est.movers} movers` : '';
  const hours  = est.hours  ? `${est.hours} hrs (estimated)` : '';
  const extras = [
    lead.boxes_count ? `${lead.boxes_count} boxes` : '',
    lead.tv_count ? `${lead.tv_count} TVs` : '',
    lead.assembly === 'yes' ? 'Furniture assembly' : '',
    lead.wrapping === 'yes' ? 'Wrapping/blankets' : '',
  ].filter(Boolean).join(' · ');

  const email = {
    from: `Toro Movers <${fromEmail}>`,
    to: [lead.email],
    replyTo: fromEmail,
    subject: `You're booked, ${firstName}! Move details inside`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
        <div style="background:#C8102E;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
          <div style="font-weight:900;font-size:24px;letter-spacing:-.3px">TORO <span style="opacity:.85">MOVERS</span></div>
          <div style="margin-top:8px;font-size:14px;opacity:.9">Your move is confirmed 🎉</div>
        </div>

        <div style="background:#fff;padding:28px 24px;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 12px 12px">
          <h2 style="margin:0 0 14px;font-size:22px;line-height:1.2">Thanks, ${esc(firstName)} — you're on the schedule!</h2>
          <p style="margin:0 0 16px;color:#3a3a3a;font-size:15px;line-height:1.6">
            We received your <strong>$${depositAmount}</strong> deposit and locked in your move. Here's what we have on file:
          </p>

          <table style="width:100%;border-collapse:collapse;margin:18px 0;border:1px solid #e5e5e5;border-radius:10px;overflow:hidden">
            ${row('📅 Move date', lead.move_date)}
            ${row('📍 From → To', fromTo)}
            ${row('🏠 Home size', lead.furniture_size)}
            ${row('🏢 Floor / access', [lead.floor, lead.stairs_elevator].filter(Boolean).join(' · '))}
            ${row('👷 Crew', crew)}
            ${row('⏱️ Estimated time', hours)}
            ${row('📦 Extras', extras)}
          </table>

          <div style="background:#f0fdf4;border:1px solid #16a34a;border-radius:10px;padding:16px 18px;margin:18px 0">
            <div style="font-weight:700;color:#15803d;font-size:14px;margin-bottom:6px">💰 Payment summary</div>
            <table style="width:100%;font-size:14px;color:#1a1a1a">
              <tr><td style="padding:3px 0">Estimated total</td><td style="text-align:right;padding:3px 0">$${estimatedTotal}</td></tr>
              <tr><td style="padding:3px 0;color:#15803d">Deposit paid</td><td style="text-align:right;padding:3px 0;color:#15803d">−$${depositAmount}</td></tr>
              <tr style="font-weight:800"><td style="padding:8px 0 0;border-top:1px solid #bbf7d0">Balance on move day</td><td style="text-align:right;padding:8px 0 0;border-top:1px solid #bbf7d0">$${balanceDue}</td></tr>
            </table>
            <div style="font-size:12px;color:#6b7280;margin-top:8px">Balance is estimated — final amount depends on actual hours worked. $75/mover/hr, 2-hour minimum.</div>
          </div>

          <h3 style="margin:24px 0 10px;font-size:17px;color:#1a1a1a">📋 Before move day — quick checklist</h3>
          <ul style="margin:0 0 16px;padding-left:20px;color:#3a3a3a;font-size:14px;line-height:1.7">
            <li><strong>Reserve the elevator</strong> (if applicable) at both buildings</li>
            <li><strong>Parking</strong> — make sure our truck can park close to the entrance</li>
            <li><strong>Disconnect appliances</strong> the night before (fridge, washer)</li>
            <li><strong>Pack small loose items</strong> in boxes — we move boxes, not loose stuff</li>
            <li><strong>Gate/access codes</strong> ready for our crew lead</li>
            <li><strong>Valuables, keys, documents</strong> — keep those with you, not in the truck</li>
          </ul>

          <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:10px;padding:14px 16px;margin:20px 0;font-size:14px;color:#78350f">
            <strong>Need to change something?</strong> Reply to this email or call <a href="tel:+13217580094" style="color:#78350f;font-weight:700">(321) 758-0094</a>. Please give 24h notice for reschedules.
          </div>

          <p style="margin:22px 0 6px;color:#3a3a3a;font-size:15px">We'll text you the morning of your move with the crew's ETA.</p>
          <p style="margin:0 0 0;color:#3a3a3a;font-size:15px">Thanks for trusting us,<br><strong>The Toro Movers Team</strong></p>

          <hr style="margin:28px 0 18px;border:none;border-top:1px solid #e5e5e5">
          <div style="font-size:12px;color:#9ca3af;line-height:1.6">
            <strong>Toro Movers</strong> · Orlando, FL · Licensed &amp; insured<br>
            <a href="tel:+13217580094" style="color:#9ca3af">(321) 758-0094</a> ·
            <a href="mailto:hello@toromovers.net" style="color:#9ca3af">hello@toromovers.net</a> ·
            <a href="https://toromovers.net/" style="color:#9ca3af">toromovers.net</a>
          </div>
        </div>
      </div>
    `,
  };

  const result = await resend.emails.send(email);
  console.log('[stripe-webhook] booking confirmation sent:', result?.data?.id);
  return result;
}
