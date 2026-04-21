// CRM v2 — centralized notification helpers.
//
// Notification split (per feedback 2026-04-21, until SMS unblocks):
//   - Clients → Resend email (branded, light-locked, bilingual where applicable)
//   - Team    → Telegram  (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)
//
// All CRM v2 functions should go through these helpers so the channels stay
// consistent and the copy stays brand-coherent.

const { Resend } = require('resend');

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'hello@toromovers.net';

function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
  catch { return String(iso); }
}

// ---- Telegram (team) ----
async function notifyTelegramTeam(lines) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false, reason: 'telegram not configured' };
  try {
    const body = Array.isArray(lines) ? lines.filter(Boolean).join('\n') : String(lines);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: body, parse_mode: 'Markdown', disable_web_page_preview: true }),
    });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ---- Booking confirmation email (customer, after deposit paid) ----
const BOOKING_COPY = {
  en: {
    subject: (amount) => `You're booked with Toro Movers — deposit ${amount} received`,
    tagline: 'Moving People Forward',
    hi: 'Hi',
    lead: "You're all set — your deposit is in and your move is reserved.",
    summaryHeader: 'Your move',
    dateLabel: 'Move date',
    crewLabel: 'Crew',
    hoursLabel: 'Estimated hours',
    depositLabel: 'Deposit paid',
    balanceLabel: 'Balance due on move day',
    totalLabel: 'Estimated total',
    next: "We'll reach out within a few hours to confirm the crew and arrival window.",
    cta: 'Questions? Call (321) 758-0094',
    footer: 'TORO MOVERS · Orlando, FL · (321) 758-0094 · toromovers.net',
  },
  es: {
    subject: (amount) => `Reservado con Toro Movers — deposito ${amount} recibido`,
    tagline: 'Mudanzas honestas. Manos fuertes.',
    hi: 'Hola',
    lead: 'Ya esta listo — tu deposito esta registrado y tu mudanza esta reservada.',
    summaryHeader: 'Tu mudanza',
    dateLabel: 'Fecha',
    crewLabel: 'Cuadrilla',
    hoursLabel: 'Horas estimadas',
    depositLabel: 'Deposito pagado',
    balanceLabel: 'Saldo el dia de la mudanza',
    totalLabel: 'Total estimado',
    next: 'Te contactaremos en las proximas horas para confirmar la cuadrilla y la ventana de llegada.',
    cta: '¿Preguntas? Llama al (321) 758-0094',
    footer: 'TORO MOVERS · Orlando, FL · (321) 758-0094 · toromovers.net',
  },
};

function renderBookingHtml({ customer, lead, quote, amountPaid, lang }) {
  const L = BOOKING_COPY[lang];
  const firstName = String(customer.full_name || '').split(/\s+/)[0] || '';
  const balance = Math.max(0, Number(quote.total || 0) - Number(amountPaid || 0));
  return `<!DOCTYPE html>
<html lang="${lang}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Toro Movers</title>
<style>:root{color-scheme:light only;supported-color-schemes:light only}
@media (prefers-color-scheme: dark){body,.tm-shell,.tm-card{background:#ffffff !important;color:#1C1C1E !important}.tm-sand{background:#FBF6E9 !important;color:#1C1C1E !important}.tm-footer-bg{background:#F9FAFB !important;color:#6B7280 !important}.tm-muted{color:#6B7280 !important}}</style>
</head>
<body class="tm-shell" style="margin:0;padding:0;background:#ffffff;color:#1C1C1E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="tm-shell" style="background:#ffffff;padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="tm-card" style="max-width:560px;background:#ffffff;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden">
<tr><td style="background:#C8102E;padding:22px 28px;color:#ffffff">
<div style="font-weight:800;font-size:22px;letter-spacing:-0.01em;color:#ffffff">TORO MOVERS</div>
<div style="font-size:12px;margin-top:4px;color:#FFE8EC">${L.tagline}</div>
</td></tr>
<tr><td style="padding:28px;background:#ffffff;color:#1C1C1E">
<p style="margin:0 0 12px 0;font-size:15px">${L.hi} ${firstName},</p>
<p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;font-weight:700">${L.lead}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="tm-sand" style="background:#FBF6E9;border-radius:10px;margin-bottom:22px"><tr><td style="padding:16px 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td colspan="2" style="font-weight:800;font-size:14px;color:#1C1C1E;padding-bottom:10px">${L.summaryHeader}</td></tr>
<tr><td class="tm-muted" style="padding:6px 0;color:#6B7280">${L.dateLabel}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1C1C1E">${fmtDate(lead.move_date)}</td></tr>
<tr><td class="tm-muted" style="padding:6px 0;color:#6B7280">${L.crewLabel}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1C1C1E">${quote.crew_size}</td></tr>
<tr><td class="tm-muted" style="padding:6px 0;color:#6B7280">${L.hoursLabel}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1C1C1E">${quote.estimated_hours} h</td></tr>
<tr><td class="tm-muted" style="padding:6px 0;color:#6B7280">${L.depositLabel}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#16A34A">${fmtMoney(amountPaid)}</td></tr>
<tr><td class="tm-muted" style="padding:6px 0;color:#6B7280">${L.balanceLabel}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1C1C1E">${fmtMoney(balance)}</td></tr>
<tr><td style="padding:12px 0 0 0;color:#1C1C1E;font-weight:800;font-size:15px;border-top:1px solid #E5E7EB">${L.totalLabel}</td><td style="padding:12px 0 0 0;text-align:right;color:#C8102E;font-weight:800;font-size:22px;border-top:1px solid #E5E7EB">${fmtMoney(quote.total)}</td></tr>
</table>
</td></tr></table>
<p style="margin:0 0 18px 0;font-size:14px;line-height:1.55">${L.next}</p>
<p class="tm-muted" style="margin:0;font-size:13px;color:#6B7280">${L.cta}</p>
</td></tr>
<tr><td class="tm-footer-bg" style="background:#F9FAFB;padding:14px 28px;text-align:center;color:#6B7280;font-size:11px">${L.footer}</td></tr>
</table></td></tr></table>
</body></html>`;
}

async function sendBookingConfirmationEmail({ customer, lead, quote, amountPaid }) {
  if (!process.env.RESEND_API_KEY) return { ok: false, reason: 'Resend not configured' };
  if (!customer || !customer.email) return { ok: false, reason: 'no customer email' };
  const lang = customer.language_preference === 'es' ? 'es' : 'en';
  const L = BOOKING_COPY[lang];
  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    const { error } = await resend.emails.send({
      from: `Toro Movers <${FROM_EMAIL}>`,
      to: [customer.email],
      replyTo: FROM_EMAIL,
      subject: L.subject(fmtMoney(amountPaid)),
      html: renderBookingHtml({ customer, lead, quote, amountPaid, lang }),
    });
    if (error) return { ok: false, reason: error.message || 'resend error' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = {
  notifyTelegramTeam,
  sendBookingConfirmationEmail,
  fmtMoney,
};
