// Morning follow-up reminder — fires every day at 8am Eastern.
// Scans the CRM for leads still in "new" or "partial" status and sends
// one Telegram message PER untouched lead with quick-action buttons
// so Quely can triage without opening the CRM.
//
// Schedule: configured in netlify.toml under [functions."follow-up-reminder"]
//
// Logic:
// • Only leads older than 3 hours (fresh leads already alerted)
// • Only status in ('new', 'partial')
// • Cap at 15 leads so we don't spam
// • Sorted oldest-first (oldest needs attention most)

const { getStore } = require('@netlify/blobs'); // scanner hint
const { listLeads } = require('./_lib/leads');

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

async function tg(method, body){
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch(e){ console.error('TG '+method+' err:', e); return null; }
}

function esc(s){
  return String(s == null ? '' : s)
    .replace(/\\/g,'\\\\')
    .replace(/_/g,'\\_')
    .replace(/\*/g,'\\*')
    .replace(/\[/g,'\\[')
    .replace(/`/g,'\\`');
}

function prettyPhone(p){
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith('1')) return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return p || '';
}

function hoursAgo(iso){
  return Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
}

exports.handler = async () => {
  if (!TG_TOKEN || !TG_CHAT) {
    return { statusCode: 500, body: 'missing telegram env' };
  }

  try {
    const all = await listLeads();
    const MIN_AGE_MS = 3 * 60 * 60 * 1000;  // 3 hours
    const now = Date.now();

    const untouched = all
      .filter(l => (l.status === 'new' || l.status === 'partial') && !l.depositPaid)
      .filter(l => (now - new Date(l.createdAt).getTime()) >= MIN_AGE_MS)
      .sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt))  // oldest first
      .slice(0, 15);

    if (untouched.length === 0) {
      // Quiet victory — 1 line telling the team they're caught up
      await tg('sendMessage', {
        chat_id: TG_CHAT,
        text: '☕ *Morning follow-ups*\n\n✨ All caught up — no untouched leads.',
        parse_mode: 'Markdown',
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true, count: 0 }) };
    }

    // Header summary
    await tg('sendMessage', {
      chat_id: TG_CHAT,
      text: `☕ *Morning follow-ups*\n\n${untouched.length} lead${untouched.length === 1 ? '' : 's'} still need${untouched.length === 1 ? 's' : ''} a call today:`,
      parse_mode: 'Markdown',
    });

    // One message per lead with action buttons
    for (const lead of untouched) {
      const lines = [
        `${lead.status === 'partial' ? '🟡' : '🟢'} *${esc(lead.name || '(no name)')}* · _${hoursAgo(lead.createdAt)}h ago_`,
        '',
        lead.phone ? `📱 \`${esc(prettyPhone(lead.phone))}\`` : '',
        lead.email ? `✉️ ${esc(lead.email)}` : '',
        '',
        lead.zip_from && lead.zip_to ? `📍 ${esc(lead.zip_from)} → ${esc(lead.zip_to)}` : '',
        lead.furniture_size ? `🏠 ${esc(lead.furniture_size)}` : '',
        lead.floor ? `🏢 ${esc(lead.floor)}${lead.stairs_elevator ? ' · ' + esc(lead.stairs_elevator) : ''}` : '',
        lead.move_date ? `📅 ${esc(lead.move_date)}` : '',
        lead.estimate_total ? `💰 *$${lead.estimate_total}*` : '',
        '',
        lead.utm_content ? `🎯 Ad: \`${esc(lead.utm_content)}\`` : '',
      ].filter(Boolean).join('\n');

      const kb = [
        [
          { text: '✅ Contacted', callback_data: `contacted:${lead.id}` },
          { text: '💬 Quoted',    callback_data: `quoted:${lead.id}` },
        ],
        [
          { text: '🎉 Booked', callback_data: `booked:${lead.id}` },
          { text: '🏁 Done',   callback_data: `done:${lead.id}` },
        ],
        [
          { text: '❌ Lost', callback_data: `lost:${lead.id}` },
          { text: '📋 Open in CRM', url: `https://toromovers.net/crm#lead/${lead.id}` },
        ],
      ];

      await tg('sendMessage', {
        chat_id: TG_CHAT,
        text: lines,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: kb },
      });

      // Small pause so Telegram doesn't rate-limit
      await new Promise(r => setTimeout(r, 250));
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, count: untouched.length }) };
  } catch (err) {
    console.error('follow-up-reminder error:', err);
    return { statusCode: 500, body: err.message };
  }
};
