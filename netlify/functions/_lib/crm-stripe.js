// CRM v2 — Stripe webhook handling.
//
// Dispatched from stripe-webhook.js based on event.data.object.metadata.purpose.
// The v1 lead-in-Blobs flow (stripe-webhook.js proper) is untouched; CRM v2
// events are identified by purpose='deposit' or 'balance' and routed here.

const { getAdminClient } = require('./supabase-admin');
const { notifyTelegramTeam, sendBookingConfirmationEmail, fmtMoney } = require('./crm-notifications');

// Returns true if the event was handled as a CRM v2 event; false if it should
// fall through to the v1 lead lookup logic.
async function handleCrmV2Event(evt) {
  const session = evt.data.object || {};
  const md = session.metadata || {};

  // checkout.session.completed — customer / applicant just paid
  if (evt.type === 'checkout.session.completed') {
    if (!md.purpose) return false;
    if (md.purpose === 'deposit' && (md.quote_id || md.lead_id)) {
      await handleDepositPaid(session, md);
      return true;
    }
    if (md.purpose === 'balance' && md.job_id) {
      await handleBalancePaid(session, md);
      return true;
    }
    if (md.purpose === 'bg_check_fee' && md.application_id) {
      await handleBgFeePaid(session, md);
      return true;
    }
  }

  // charge.refunded — we issued a refund via the admin button (or manually)
  if (evt.type === 'charge.refunded') {
    const charge = session; // object is a charge
    const pi = charge.payment_intent;
    if (pi) {
      const admin = getAdminClient();
      const { data: app } = await admin
        .from('crew_applications').select('id, first_name, last_name, email')
        .eq('bg_fee_payment_intent_id', pi).maybeSingle();
      if (app) {
        await admin.from('crew_applications')
          .update({ bg_fee_refunded_at: new Date().toISOString() })
          .eq('id', app.id);
        await notifyTelegramTeam([
          '*BG fee refunded*',
          '',
          `Applicant: *${app.first_name} ${app.last_name}*`,
          `Email: ${app.email}`,
          `Refund: *$${(charge.amount_refunded / 100).toFixed(2)}*`,
        ]);
        return true;
      }
    }
  }

  return false;
}

async function handleBgFeePaid(session, md) {
  const admin = getAdminClient();
  const appId = md.application_id;
  const paymentIntent = session.payment_intent || null;
  const amount = session.amount_total ? session.amount_total / 100 : 0;

  await admin.from('crew_applications').update({
    bg_fee_paid_at: new Date().toISOString(),
    bg_fee_payment_intent_id: paymentIntent,
    bg_fee_stripe_session_id: session.id,
  }).eq('id', appId);

  await notifyTelegramTeam([
    '*BG fee paid — $' + amount.toFixed(2) + '*',
    '',
    `Applicant: *${md.applicant_name || '—'}*`,
    `Email: ${md.applicant_email || '—'}`,
    '',
    paymentIntent ? `[Stripe](https://dashboard.stripe.com/payments/${paymentIntent})` : '',
    'Review in CRM → Crew applications',
  ]);
}

async function handleDepositPaid(session, md) {
  const admin = getAdminClient();
  const quoteId = md.quote_id;
  const leadId = md.lead_id;
  const amountPaid = session.amount_total ? session.amount_total / 100 : 0;
  const paymentIntent = session.payment_intent || null;

  // 1. Mark the quote accepted + load quote/lead/customer for downstream use.
  const nowIso = new Date().toISOString();
  const { data: quote } = await admin
    .from('quotes').update({ accepted_at: nowIso })
    .eq('id', quoteId).select('*').maybeSingle();

  // 2. Bump lead stage quoted→booked (trigger creates jobs row from quote).
  if (leadId) {
    await admin.from('leads').update({ stage: 'booked' })
      .eq('id', leadId)
      .eq('stage', 'quoted');
  }
  const { data: lead } = await admin
    .from('leads').select('*, customers(*)').eq('id', leadId).maybeSingle();
  const customer = lead && lead.customers ? lead.customers : null;

  // 3. Find the jobs row and record the deposit.
  const { data: job } = await admin
    .from('jobs').select('*').eq('quote_id', quoteId).maybeSingle();
  if (job) {
    const depositPaid = Number(job.deposit_paid || 0) + amountPaid;
    const balanceDue = Math.max(0, Number(job.customer_total || 0) - depositPaid);
    await admin.from('jobs').update({
      deposit_paid: depositPaid,
      balance_due: balanceDue,
      payment_method: 'card',
      payment_status: balanceDue <= 0 ? 'paid' : 'partial',
      stripe_payment_intent_id: paymentIntent,
      payment_received_at: nowIso,
    }).eq('id', job.id);
  }

  // 4. Activity log.
  const rows = [{
    entity_type: 'quote', entity_id: quoteId, actor_id: null,
    event_type: 'deposit_paid',
    payload: { amount: amountPaid, stripe_session: session.id, payment_intent: paymentIntent },
  }];
  if (job) rows.push({
    entity_type: 'job', entity_id: job.id, actor_id: null,
    event_type: 'deposit_paid',
    payload: { amount: amountPaid, stripe_session: session.id, payment_intent: paymentIntent },
  });
  await admin.from('activity_log').insert(rows);

  // 5. Client email (booking confirmation) + team Telegram alert.
  if (customer && quote) {
    await sendBookingConfirmationEmail({ customer, lead, quote, amountPaid })
      .catch(e => console.error('booking email failed:', e.message));
  }
  await notifyTelegramTeam([
    '*DEPOSIT PAID — BOOKED*',
    '',
    customer ? `Customer: *${customer.full_name || '—'}*` : '',
    customer && customer.phone ? `Phone: \`${customer.phone}\`` : '',
    customer && customer.email ? `Email: ${customer.email}` : '',
    '',
    `Deposit: *${fmtMoney(amountPaid)}*`,
    quote && quote.total ? `Est. total: ${fmtMoney(quote.total)}` : '',
    lead && lead.move_date ? `Move date: ${lead.move_date}` : '',
    '',
    paymentIntent ? `[Stripe](https://dashboard.stripe.com/payments/${paymentIntent})` : '',
  ]);
}

async function handleBalancePaid(session, md) {
  const admin = getAdminClient();
  const jobId = md.job_id;
  if (!jobId) return;
  const amountTotal = session.amount_total ? session.amount_total / 100 : 0;
  const tipAmount = Number(md.tip_amount || 0);
  const balancePart = Math.max(0, amountTotal - tipAmount);
  const paymentIntent = session.payment_intent || null;

  const { data: job } = await admin.from('jobs').select('*').eq('id', jobId).maybeSingle();
  if (!job) return;

  // Apply the balance portion to deposit_paid; tip is tracked separately.
  const newPaid = Number(job.deposit_paid || 0) + balancePart;
  const newBalanceDue = Math.max(0, Number(job.customer_total || 0) - newPaid);
  const newTipAmount = Number(job.tip_amount || 0) + tipAmount;

  await admin.from('jobs').update({
    deposit_paid: newPaid,
    balance_due: newBalanceDue,
    tip_amount: newTipAmount,
    payment_method: 'card',
    payment_status: newBalanceDue <= 0 ? 'paid' : 'partial',
    stripe_payment_intent_id: paymentIntent,
    payment_received_at: new Date().toISOString(),
  }).eq('id', jobId);

  await admin.from('activity_log').insert({
    entity_type: 'job',
    entity_id: jobId,
    actor_id: null,
    event_type: 'balance_paid',
    payload: {
      amount_total: amountTotal,
      balance_portion: balancePart,
      tip: tipAmount,
      stripe_session: session.id,
      payment_intent: paymentIntent,
    },
  });

  if (tipAmount > 0) {
    await notifyTelegramTeam([
      '*Balance + Tip received*',
      '',
      `Total charged: *$${amountTotal.toFixed(2)}*`,
      `Balance portion: $${balancePart.toFixed(2)}`,
      `Tip for crew: *$${tipAmount.toFixed(2)}*`,
      '',
      `Job: \`${String(jobId).slice(0, 8)}\``,
      paymentIntent ? `[Stripe](https://dashboard.stripe.com/payments/${paymentIntent})` : '',
    ]);
  }
}

module.exports = { handleCrmV2Event };
