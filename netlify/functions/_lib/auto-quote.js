// Auto-send a quote when a lead arrives with enough info to compute one.
// Called from notify-callback.js after the v2 bridge has created the
// customer + lead. Mirrors what quote-send.js + quote-send-sms.js do
// when Diler clicks the buttons in the CRM, but happens automatically
// at lead intake.
//
// Steps:
//   1. createQuote()  — inserts quotes row, renders PDF, uploads
//   2. Email PDF + branded HTML body to customer (if email on file)
//   3. SMS quote summary + reserve link to customer (if phone on file
//      and not opted out)
//   4. Bump leads.stage from 'new' to 'quoted'
//   5. Log activity
//
// Returns { quote_id, email_sent, sms_sent, errors[] }. Never throws —
// errors are collected so notify-callback can keep returning success
// to the form even if a downstream channel fails.

const { Resend } = require('resend');
const { createQuote } = require('./quote-flow');
const { sendSms } = require('./sms');

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'hello@toromovers.net';

function fmtMoney(n) {
  const v = Number(n || 0);
  if (v % 1 === 0) return `$${v.toLocaleString('en-US')}`;
  return `$${v.toFixed(2)}`;
}

const EMAIL_COPY = {
  en: {
    subject: (total) => `Your Toro Movers quote — ${total}`,
    hi: 'Hi',
    lead: "Thanks for the request — here's your moving quote. The full PDF is attached.",
    summary: 'Summary',
    crew: 'Crew', hours: 'Hours', rate: 'Hourly rate',
    truck: 'Truck (26-ft)', deposit: 'Deposit', total: 'Total',
    cta: 'Reserve my spot now',
    fallback: 'Or call (689) 600-2720 — same-week scheduling.',
    tagline: 'Moving People Forward',
    perMoverHr: '/ mover / hr',
  },
  es: {
    subject: (total) => `Tu cotización de Toro Movers — ${total}`,
    hi: 'Hola',
    lead: 'Gracias por la solicitud — aquí está tu cotización. El PDF va adjunto.',
    summary: 'Resumen',
    crew: 'Cuadrilla', hours: 'Horas', rate: 'Tarifa por hora',
    truck: 'Camión (26 pies)', deposit: 'Depósito', total: 'Total',
    cta: 'Reservar mi lugar',
    fallback: 'O llama al (689) 600-2720 — agenda esta misma semana.',
    tagline: 'Mudanzas honestas. Manos fuertes.',
    perMoverHr: '/ mov. / h',
  },
};

const SMS_COPY = {
  en: ({ first, total, crew, hours, rate, truck, deposit, reserveUrl }) =>
    `Toro Movers — quote for ${first}: ${total} (${crew} movers × ${hours}h × ${rate}/hr${truck ? ' + 26ft truck' : ''}). ` +
    `Reserve your date with a ${deposit} deposit: ${reserveUrl}\n` +
    `Reply STOP to opt out.`,
  es: ({ first, total, crew, hours, rate, truck, deposit, reserveUrl }) =>
    `Toro Movers — cotización para ${first}: ${total} (${crew} ayudantes × ${hours}h × ${rate}/hr${truck ? ' + camión 26ft' : ''}). ` +
    `Reserva tu fecha con un depósito de ${deposit}: ${reserveUrl}\n` +
    `Responde STOP para cancelar.`,
};

function renderEmailHtml({ customer, quote, lang }) {
  const L = EMAIL_COPY[lang];
  const truckLine = quote.truck_included
    ? `<tr><td style="padding:6px 0;color:#6B7280">${L.truck}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1C1C1E">+${fmtMoney(quote.truck_fee)}</td></tr>`
    : '';
  const firstName = String(customer.full_name || '').split(/\s+/)[0] || '';
  const origin = process.env.URL || 'https://toromovers.net';
  const reserveHref = `${origin}/.netlify/functions/reserve?q=${encodeURIComponent(quote.id)}`;

  return `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Toro Movers</title></head>
<body style="margin:0;padding:0;background:#fff;color:#1C1C1E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden">
<tr><td style="background:#C8102E;padding:22px 28px;color:#fff">
<div style="font-weight:800;font-size:22px;letter-spacing:-0.01em">TORO MOVERS</div>
<div style="font-size:12px;margin-top:4px;color:#FFE8EC">${L.tagline}</div>
</td></tr>
<tr><td style="padding:28px;background:#fff;color:#1C1C1E">
<p style="margin:0 0 12px;font-size:15px">${L.hi} ${firstName},</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.55">${L.lead}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6E9;border-radius:10px;margin-bottom:22px"><tr><td style="padding:16px 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td colspan="2" style="font-weight:800;font-size:14px;padding-bottom:10px">${L.summary}</td></tr>
<tr><td style="padding:6px 0;color:#6B7280">${L.crew}</td><td style="padding:6px 0;text-align:right;font-weight:700">${quote.crew_size}</td></tr>
<tr><td style="padding:6px 0;color:#6B7280">${L.hours}</td><td style="padding:6px 0;text-align:right;font-weight:700">${quote.estimated_hours} h</td></tr>
<tr><td style="padding:6px 0;color:#6B7280">${L.rate}</td><td style="padding:6px 0;text-align:right;font-weight:700">${fmtMoney(quote.hourly_rate)} ${L.perMoverHr}</td></tr>
${truckLine}
<tr><td style="padding:6px 0;color:#6B7280">${L.deposit}</td><td style="padding:6px 0;text-align:right;font-weight:700">${fmtMoney(quote.deposit_amount)}</td></tr>
<tr><td style="padding:12px 0 0;font-weight:800;font-size:15px;border-top:1px solid #E5E7EB">${L.total}</td><td style="padding:12px 0 0;text-align:right;color:#C8102E;font-weight:800;font-size:22px;border-top:1px solid #E5E7EB">${fmtMoney(quote.total)}</td></tr>
</table>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:4px 0 10px">
<a href="${reserveHref}" style="display:inline-block;background:#C8102E;color:#fff;font-weight:800;font-size:15px;text-decoration:none;padding:14px 28px;border-radius:9999px">${L.cta}</a>
</td></tr></table>
<p style="margin:2px 0 0;font-size:12px;color:#6B7280;text-align:center">${L.fallback}</p>
</td></tr>
<tr><td style="background:#F9FAFB;padding:14px 28px;text-align:center;color:#6B7280;font-size:11px">TORO MOVERS · Orlando, FL · (689) 600-2720 · toromovers.net</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// Auto-send a quote at lead intake. Returns { quote_id, email_sent, sms_sent, errors }.
async function autoSendQuote({ admin, lead_id, customer, estimate }) {
  const errors = [];
  const truck = !!(estimate && estimate.truck);
  const quotePayload = {
    type: 'custom',
    crew_size: Number(estimate.movers || 2),
    hourly_rate: Number(estimate.rate || 75),
    estimated_hours: Number(estimate.hours || 0),
    truck_included: truck,
    truck_fee: 275,
    deposit_amount: truck ? 125 : 50,
    total: Number(estimate.total || 0),
  };

  // 1. createQuote — inserts row, renders PDF, uploads
  let out;
  try {
    out = await createQuote({ admin, actorId: null, lead_id, quote: quotePayload });
  } catch (e) {
    return { quote_id: null, email_sent: false, sms_sent: false, errors: ['createQuote: ' + e.message] };
  }

  let email_sent = false;
  let sms_sent = false;

  // 2. Email (if customer has email)
  if (out.customer.email && process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const L = EMAIL_COPY[out.language];
      const subject = L.subject(fmtMoney(out.quote.total));
      const html = renderEmailHtml({ customer: out.customer, quote: out.quote, lang: out.language });
      const qNum = String(out.quote.id).replace(/-/g, '').slice(0, 8).toUpperCase();
      const r = await resend.emails.send({
        from: `Toro Movers <${FROM_EMAIL}>`,
        to: [out.customer.email],
        replyTo: FROM_EMAIL,
        subject,
        html,
        attachments: [{ filename: `toro-quote-${qNum}.pdf`, content: out.pdfBuffer.toString('base64') }],
      });
      if (r.error) errors.push('email: ' + (r.error.message || JSON.stringify(r.error)));
      else email_sent = true;
    } catch (e) {
      errors.push('email: ' + e.message);
    }
  }

  // 3. SMS (if customer has phone and hasn't opted out)
  if (out.customer.phone && !out.customer.sms_opted_out) {
    try {
      const origin = process.env.URL || 'https://toromovers.net';
      const reserveUrl = `${origin}/.netlify/functions/reserve?q=${encodeURIComponent(out.quote.id)}`;
      const first = String(out.customer.full_name || '').split(/\s+/)[0] || 'there';
      const body = SMS_COPY[out.language]({
        first,
        total: fmtMoney(out.quote.total),
        crew: out.quote.crew_size,
        hours: out.quote.estimated_hours,
        rate: fmtMoney(out.quote.hourly_rate),
        truck,
        deposit: fmtMoney(out.quote.deposit_amount),
        reserveUrl,
      });
      const r = await sendSms(out.customer.phone, body);
      if (!r.ok) errors.push('sms: ' + JSON.stringify(r.error || r.reason));
      else sms_sent = true;
    } catch (e) {
      errors.push('sms: ' + e.message);
    }
  }

  // 4. Mark quote sent + bump lead stage
  try {
    const sentAt = new Date().toISOString();
    await admin.from('quotes').update({ sent_at: sentAt }).eq('id', out.quote.id);
    await admin.from('leads')
      .update({ stage: 'quoted' })
      .eq('id', lead_id)
      .in('stage', ['new']);
    await admin.from('activity_log').insert({
      entity_type: 'quote',
      entity_id: out.quote.id,
      actor_id: null,
      event_type: 'quote_auto_sent',
      payload: { lead_id, email_sent, sms_sent, language: out.language },
    });
  } catch (e) {
    errors.push('bookkeeping: ' + e.message);
  }

  return { quote_id: out.quote.id, email_sent, sms_sent, errors };
}

module.exports = { autoSendQuote };
