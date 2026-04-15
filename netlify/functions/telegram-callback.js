// Telegram callback query handler — receives button taps from Telegram
// alerts and updates lead status without opening the CRM.
//
// Expected callback_data format: "action:leadId"
//   contacted:abc123  → set status to 'contacted'
//   quoted:abc123     → set status to 'quoted'
//   lost:abc123       → set status to 'lost'
//   booked:abc123     → set status to 'booked'

const { getStore } = require('@netlify/blobs'); // surface for scanner
const { Resend } = require('resend');
const { setStatus, getLead, listLeads, addNote } = require('./_lib/leads');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT = process.env.TELEGRAM_CHAT_ID; // allowlist: only this chat can command

async function tg(method, body){
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch(e){ console.error('TG '+method+' error:', e); return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 200, body: 'ok' };

  let update;
  try { update = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 200, body: 'ok' }; }

  // Text message handler — commands from the user's phone
  if (update.message && update.message.text) {
    return handleTextMessage(update.message);
  }

  const cb = update.callback_query;
  if (!cb) return { statusCode: 200, body: 'ok' };

  // Allowlist check — only the designated chat can tap buttons too
  if (ALLOWED_CHAT && String(cb.message?.chat?.id) !== String(ALLOWED_CHAT)) {
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Not authorized.' });
    return { statusCode: 200, body: 'ok' };
  }

  const data = cb.data || '';
  const [action, leadId] = data.split(':');
  if (!leadId) {
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Invalid button.' });
    return { statusCode: 200, body: 'ok' };
  }

  const statusMap = {
    contacted: 'contacted',
    quoted:    'quoted',
    booked:    'booked',
    lost:      'lost',
    done:      'done',
  };
  const newStatus = statusMap[action];
  if (!newStatus) {
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Unknown action.' });
    return { statusCode: 200, body: 'ok' };
  }

  let lead;
  try { lead = await setStatus(leadId, newStatus); }
  catch(e) { console.error('setStatus error:', e); }

  if (!lead) {
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '❌ Lead not found.' });
    return { statusCode: 200, body: 'ok' };
  }

  // Acknowledge in Telegram chat
  const emoji = { contacted:'✅', quoted:'💬', booked:'🎉', lost:'❌', done:'🏁' }[newStatus];
  await tg('answerCallbackQuery', {
    callback_query_id: cb.id,
    text: `${emoji} ${lead.name} → ${newStatus.toUpperCase()}`,
    show_alert: false,
  });

  // Edit the original message to show the new state (append update line)
  try {
    const originalText = cb.message?.text || '';
    const newText = originalText + `\n\n${emoji} Status → *${newStatus.toUpperCase()}* by ${cb.from?.first_name || 'admin'}`;
    await tg('editMessageText', {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      text: newText,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Open in CRM', url: `https://toromovers.net/crm#lead/${lead.id}` }],
        ],
      },
    });
  } catch(e) { console.error('edit message failed:', e); }

  // ===== DONE → REVIEW REQUEST FLOW =====
  // Fires when a move is marked complete. Sends immediate review email +
  // schedules a +3 day follow-up (Resend handles the queue).
  if (newStatus === 'done' && lead.email && process.env.RESEND_API_KEY) {
    try {
      const result = await sendReviewRequest(lead);
      await tg('sendMessage', {
        chat_id: cb.message.chat.id,
        text: `⭐ Review request sent to ${lead.email}\n+3 day follow-up scheduled.`,
        reply_to_message_id: cb.message.message_id,
      });
      console.log('[telegram-callback] review-request sent:', result);
    } catch(e) {
      console.error('review-request send failed:', e);
      await tg('sendMessage', {
        chat_id: cb.message.chat.id,
        text: `⚠️ Couldn't send review email to ${lead.email}: ${e.message}`,
        reply_to_message_id: cb.message.message_id,
      });
    }
  }

  return { statusCode: 200, body: 'ok' };
};

// ===== REVIEW REQUEST EMAILS =====
async function sendReviewRequest(lead){
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'hello@toromovers.net';
  const firstName = (lead.name || '').split(' ')[0] || 'there';
  // Google Review link — use env var if set, otherwise a best-guess placeholder
  const reviewUrl = process.env.GOOGLE_REVIEW_URL
    || 'https://search.google.com/local/writereview?placeid=ChIJzd_MJ2B654gRXJGWP5ydFy8';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // IMMEDIATE — fires now
  const immediate = {
    from: `Toro Movers <${fromEmail}>`,
    to: [lead.email],
    replyTo: fromEmail,
    subject: `${firstName}, how'd your move go? 30-second favor`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
        <div style="background:#C8102E;color:#fff;padding:22px 24px;border-radius:12px 12px 0 0;text-align:center">
          <div style="font-weight:900;font-size:22px;letter-spacing:-.3px">TORO <span style="opacity:.85">MOVERS</span></div>
        </div>
        <div style="background:#fff;padding:28px 24px;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 12px 12px">
          <h2 style="margin:0 0 14px;font-size:22px;line-height:1.2">Hey ${esc(firstName)} — did we make it easy?</h2>
          <p style="margin:0 0 16px;color:#3a3a3a;font-size:15px;line-height:1.6">Thanks for trusting our crew with your move today. We hope everything arrived safely and on time.</p>
          <p style="margin:0 0 16px;color:#3a3a3a;font-size:15px;line-height:1.6">If we did a solid job, <strong>a Google review takes about 30 seconds</strong> and makes a huge difference for a family-run business like ours. Every review helps another family find us.</p>
          <div style="text-align:center;margin:28px 0">
            <a href="${reviewUrl}" style="display:inline-block;background:#16a34a;color:#fff;padding:16px 36px;border-radius:999px;text-decoration:none;font-weight:800;font-size:15px;box-shadow:0 8px 20px rgba(22,163,74,.35)">⭐ Leave a Google review</a>
          </div>
          <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:10px;padding:14px 16px;margin:20px 0;font-size:13px;color:#78350f">
            <strong>Was anything not perfect?</strong> Reply to this email first and we'll make it right before you review. Your feedback matters.
          </div>
          <p style="margin:18px 0 0;color:#3a3a3a;font-size:15px">Thanks again,<br>The Toro Movers Team</p>
          <hr style="margin:28px 0 18px;border:none;border-top:1px solid #e5e5e5">
          <div style="font-size:12px;color:#9ca3af;line-height:1.6"><strong>Toro Movers</strong> · Orlando, FL · Licensed &amp; insured<br><a href="https://toromovers.net/" style="color:#9ca3af">toromovers.net</a></div>
        </div>
      </div>
    `,
  };

  // FOLLOW-UP — +3 days
  const followUp = {
    from: `Toro Movers <${fromEmail}>`,
    to: [lead.email],
    replyTo: fromEmail,
    scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    subject: `${firstName}, got 30 seconds for a quick favor?`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
        <div style="background:#C8102E;color:#fff;padding:22px 24px;border-radius:12px 12px 0 0;text-align:center">
          <div style="font-weight:900;font-size:22px;letter-spacing:-.3px">TORO <span style="opacity:.85">MOVERS</span></div>
        </div>
        <div style="background:#fff;padding:28px 24px;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 12px 12px">
          <h2 style="margin:0 0 14px;font-size:20px">Still unpacking, ${esc(firstName)}?</h2>
          <p style="margin:0 0 16px;color:#3a3a3a;font-size:15px;line-height:1.6">If our crew did a good job last week, a quick Google review is the best way to say thanks. Literally 30 seconds — click, star, type, done.</p>
          <div style="text-align:center;margin:28px 0">
            <a href="${reviewUrl}" style="display:inline-block;background:#16a34a;color:#fff;padding:16px 36px;border-radius:999px;text-decoration:none;font-weight:800;font-size:15px">⭐ Leave a review</a>
          </div>
          <p style="margin:18px 0;color:#6b7280;font-size:13px;text-align:center">If this is the last thing you want to deal with right now, no worries — we won't ask again.</p>
          <hr style="margin:28px 0 18px;border:none;border-top:1px solid #e5e5e5">
          <div style="font-size:12px;color:#9ca3af;line-height:1.6"><strong>Toro Movers</strong> · Orlando, FL · Licensed &amp; insured<br><a href="https://toromovers.net/" style="color:#9ca3af">toromovers.net</a></div>
        </div>
      </div>
    `,
  };

  const [now, later] = await Promise.all([
    resend.emails.send(immediate),
    resend.emails.send(followUp),
  ]);
  return { immediate: now?.data?.id, followUp: later?.data?.id };
}

module.exports.sendReviewRequest = sendReviewRequest;

// ===== TEXT COMMAND HANDLER =====
// Handles /today, /week, /tomorrow, /lead, /show, /status, /note, /help
async function handleTextMessage(msg){
  const chatId = msg.chat?.id;
  const text = (msg.text || '').trim();

  // Allowlist — only the designated chat ID may run commands
  if (ALLOWED_CHAT && String(chatId) !== String(ALLOWED_CHAT)) {
    await tg('sendMessage', { chat_id: chatId, text: '🚫 Not authorized.' });
    return { statusCode: 200, body: 'ok' };
  }

  // Extract command + args
  const match = text.match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]+))?$/);
  if (!match) {
    // Non-command text — ignore silently (future: forward to Claude chat)
    return { statusCode: 200, body: 'ok' };
  }
  const cmd = match[1].toLowerCase();
  const args = (match[2] || '').trim();

  try {
    if (cmd === 'help' || cmd === 'start') await cmdHelp(chatId);
    else if (cmd === 'today')    await cmdDayJobs(chatId, 0, 'Today');
    else if (cmd === 'tomorrow') await cmdDayJobs(chatId, 1, 'Tomorrow');
    else if (cmd === 'week')     await cmdWeek(chatId);
    else if (cmd === 'lead')     await cmdLead(chatId, args);
    else if (cmd === 'show')     await cmdShow(chatId, args);
    else if (cmd === 'status')   await cmdStatus(chatId, args);
    else if (cmd === 'note')     await cmdNote(chatId, args);
    else {
      await tg('sendMessage', { chat_id: chatId, text: `Unknown command: /${cmd}\nTry /help` });
    }
  } catch(e) {
    console.error('command error:', e);
    await tg('sendMessage', { chat_id: chatId, text: `⚠️ Command failed: ${e.message}` });
  }
  return { statusCode: 200, body: 'ok' };
}

function esc(s){
  return String(s == null ? '' : s)
    .replace(/\\/g,'\\\\').replace(/_/g,'\\_').replace(/\*/g,'\\*').replace(/\[/g,'\\[').replace(/`/g,'\\`');
}

function parseMoveDate(l){
  if (!l.move_date) return null;
  const d = new Date(l.move_date);
  return isNaN(d.getTime()) ? null : d;
}

function sameDay(a, b){ return a && b && a.toDateString() === b.toDateString(); }

function fmtLeadLine(l){
  const d = parseMoveDate(l);
  const when = d ? d.toLocaleString('en-US',{month:'short',day:'numeric'}) : '—';
  const t = l.move_time ? ' '+l.move_time : '';
  const est = l.estimate_total ? ` · $${l.estimate_total}` : '';
  return `\`${l.id}\` · *${esc(l.name||'(no name)')}* · ${when}${t}${est}`;
}

async function cmdHelp(chatId){
  const text = [
    '*Toro Movers Bot — Commands*',
    '',
    '/today — jobs scheduled for today',
    '/tomorrow — jobs scheduled for tomorrow',
    '/week — this week\'s pipeline + totals',
    '/lead `<name>` — search leads by name',
    '/show `<id>` — full detail of one lead',
    '/status `<id>` `<new>` — change status (new/contacted/quoted/booked/done/lost)',
    '/note `<id>` `<text>` — add a note to a lead',
    '/help — this menu',
    '',
    'Open CRM: https://toromovers.net/crm',
  ].join('\n');
  await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true });
}

async function cmdDayJobs(chatId, dayOffset, label){
  const target = new Date(); target.setDate(target.getDate() + dayOffset);
  const leads = await listLeads();
  const jobs = leads.filter(l => {
    const d = parseMoveDate(l);
    return sameDay(d, target) && l.status !== 'lost' && l.status !== 'abandoned';
  });
  if (!jobs.length) {
    await tg('sendMessage', { chat_id: chatId, text: `📅 *${label}* — no jobs scheduled.`, parse_mode: 'Markdown' });
    return;
  }
  const total = jobs.reduce((s,l) => s + (l.estimate_total||0), 0);
  const lines = [`📅 *${label}* — ${jobs.length} job${jobs.length>1?'s':''} · $${total}`, ''];
  jobs.forEach(l => lines.push(fmtLeadLine(l)));
  await tg('sendMessage', { chat_id: chatId, text: lines.join('\n'), parse_mode: 'Markdown', disable_web_page_preview: true });
}

async function cmdWeek(chatId){
  const now = new Date(); now.setHours(0,0,0,0);
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);

  const leads = await listLeads();
  const weekJobs = leads.filter(l => {
    const d = parseMoveDate(l);
    return d && d >= weekStart && d < weekEnd && l.status === 'booked';
  });
  const quoted = leads.filter(l => l.status === 'quoted');
  const newLeads = leads.filter(l => l.status === 'new');
  const weekRevenue = weekJobs.reduce((s,l) => s + (l.estimate_total||0), 0);
  const quotedTotal = quoted.reduce((s,l) => s + (l.estimate_total||0), 0);

  const lines = [
    '📊 *This Week*',
    '',
    `🟢 *${weekJobs.length} booked* · $${weekRevenue}`,
    `🟠 *${quoted.length} quoted* · $${quotedTotal} pipeline`,
    `🔵 *${newLeads.length} new* leads waiting`,
    '',
    weekJobs.length ? '*Scheduled moves:*' : '',
  ];
  weekJobs.sort((a,b) => new Date(a.move_date) - new Date(b.move_date));
  weekJobs.forEach(l => lines.push(fmtLeadLine(l)));
  await tg('sendMessage', { chat_id: chatId, text: lines.filter(Boolean).join('\n'), parse_mode: 'Markdown', disable_web_page_preview: true });
}

async function cmdLead(chatId, query){
  if (!query) return tg('sendMessage', { chat_id: chatId, text: 'Usage: /lead `<name>`', parse_mode: 'Markdown' });
  const q = query.toLowerCase();
  const leads = await listLeads();
  const matches = leads.filter(l =>
    (l.name||'').toLowerCase().includes(q) ||
    (l.email||'').toLowerCase().includes(q) ||
    (l.phone||'').replace(/\D/g,'').includes(q.replace(/\D/g,''))
  ).slice(0,5);
  if (!matches.length) {
    await tg('sendMessage', { chat_id: chatId, text: `🔍 No leads match "${esc(query)}"`, parse_mode: 'Markdown' });
    return;
  }
  const lines = [`🔍 *${matches.length} match${matches.length>1?'es':''}* for "${esc(query)}"`, ''];
  matches.forEach(l => lines.push(fmtLeadLine(l) + ` · _${l.status}_`));
  lines.push('', '_Copy an id and use /show `<id>` for details._');
  await tg('sendMessage', { chat_id: chatId, text: lines.join('\n'), parse_mode: 'Markdown', disable_web_page_preview: true });
}

async function cmdShow(chatId, id){
  if (!id) return tg('sendMessage', { chat_id: chatId, text: 'Usage: /show `<id>`', parse_mode: 'Markdown' });
  const lead = await getLead(id);
  if (!lead) return tg('sendMessage', { chat_id: chatId, text: `❌ Lead \`${esc(id)}\` not found.`, parse_mode: 'Markdown' });
  const est = lead.estimate || {};
  const d = parseMoveDate(lead);
  const route = (lead.pickup_address || lead.zip_from) && (lead.dropoff_address || lead.zip_to)
    ? `${lead.pickup_address || lead.zip_from} → ${lead.dropoff_address || lead.zip_to}`
    : '';
  const lines = [
    `*${esc(lead.name || '(no name)')}*  ·  _${lead.status}_`,
    lead.phone ? `📱 ${esc(lead.phone)}` : '',
    lead.email ? `✉️ ${esc(lead.email)}` : '',
    d ? `📅 ${d.toLocaleString('en-US',{weekday:'short',month:'short',day:'numeric'})}${lead.move_time?' '+lead.move_time:''}` : '',
    route ? `📍 ${esc(route)}` : '',
    est.movers ? `👷 ${est.movers} movers${est.truck?' + truck':''} · ${est.hours||'?'}h` : '',
    est.total ? `💰 $${est.total}${lead.depositPaid?' (deposit paid)':''}` : '',
    '',
    `Open: https://toromovers.net/crm#lead/${lead.id}`,
  ].filter(Boolean).join('\n');
  await tg('sendMessage', { chat_id: chatId, text: lines, parse_mode: 'Markdown', disable_web_page_preview: true });
}

async function cmdStatus(chatId, args){
  const parts = args.split(/\s+/);
  const id = parts[0];
  const newStatus = (parts[1] || '').toLowerCase();
  const valid = ['new','contacted','quoted','booked','done','lost'];
  if (!id || !valid.includes(newStatus)) {
    return tg('sendMessage', { chat_id: chatId, text: `Usage: /status \`<id>\` \`<${valid.join('|')}>\``, parse_mode: 'Markdown' });
  }
  const lead = await setStatus(id, newStatus);
  if (!lead) return tg('sendMessage', { chat_id: chatId, text: `❌ Lead \`${esc(id)}\` not found.`, parse_mode: 'Markdown' });
  const emoji = { new:'🔵', contacted:'✅', quoted:'💬', booked:'🎉', done:'🏁', lost:'❌' }[newStatus];
  await tg('sendMessage', { chat_id: chatId, text: `${emoji} *${esc(lead.name)}* → *${newStatus.toUpperCase()}*`, parse_mode: 'Markdown' });
}

async function cmdNote(chatId, args){
  const space = args.indexOf(' ');
  if (space < 0) return tg('sendMessage', { chat_id: chatId, text: 'Usage: /note `<id>` `<text>`', parse_mode: 'Markdown' });
  const id = args.slice(0, space).trim();
  const text = args.slice(space+1).trim();
  if (!id || !text) return tg('sendMessage', { chat_id: chatId, text: 'Usage: /note `<id>` `<text>`', parse_mode: 'Markdown' });
  const lead = await addNote(id, text, 'telegram');
  if (!lead) return tg('sendMessage', { chat_id: chatId, text: `❌ Lead \`${esc(id)}\` not found.`, parse_mode: 'Markdown' });
  await tg('sendMessage', { chat_id: chatId, text: `📝 Note added to *${esc(lead.name)}*`, parse_mode: 'Markdown' });
}
