// Daily morning briefing — 6am Eastern.
// Posts today's jobs, tomorrow's preview, and pipeline snapshot to the
// operations Telegram chat.
//
// Schedule: configured in netlify.toml under [functions."morning-briefing"]

const { getStore } = require('@netlify/blobs'); // scanner hint
const { listLeads } = require('./_lib/leads');

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

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

function jobLine(l){
  const time = l.move_time || '—';
  const crew = (l.crew_assigned && l.crew_assigned.length)
    ? ` · 👷 ${l.crew_assigned.join(', ')}`
    : ' · ⚠️ _no crew_';
  const pickup = l.pickup_address && !String(l.pickup_address).startsWith('TBD')
    ? ` · ${esc(String(l.pickup_address).split(',').slice(0,2).join(','))}`
    : ' · ⚠️ _no address_';
  const truck = l.estimate?.truck ? ' 🚚' : '';
  return `  • *${time}* — ${esc(l.name || '(no name)')}${truck}${pickup}${crew}`;
}

async function sendTG(text){
  if (!TG_TOKEN || !TG_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TG_CHAT,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Open CRM', url: 'https://toromovers.net/crm' }],
        ],
      },
    }),
  }).catch(e => console.error('morning-briefing TG err:', e));
}

exports.handler = async () => {
  try {
    const leads = await listLeads();
    const now = new Date();
    const today = new Date(now); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay());
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);

    const todayJobs = leads.filter(l => {
      const d = parseMoveDate(l);
      return sameDay(d, today) && l.status !== 'lost' && l.status !== 'abandoned';
    }).sort((a,b) => (a.move_time || '').localeCompare(b.move_time || ''));

    const tomorrowJobs = leads.filter(l => {
      const d = parseMoveDate(l);
      return sameDay(d, tomorrow) && l.status !== 'lost' && l.status !== 'abandoned';
    });

    const weekBooked = leads.filter(l => {
      const d = parseMoveDate(l);
      return d && d >= weekStart && d < weekEnd && l.status === 'booked';
    });
    const weekRevenue = weekBooked.reduce((s,l) => s + (l.estimate_total||0), 0);
    const newLeads = leads.filter(l => l.status === 'new').length;
    const quotedPipeline = leads.filter(l => l.status === 'quoted').reduce((s,l) => s + (l.estimate_total||0), 0);

    const dateStr = today.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    const lines = [`☀️ *Good morning — ${dateStr}*`, ''];

    if (todayJobs.length === 0) {
      lines.push('📅 *Today:* no jobs scheduled. Rest day.');
    } else {
      lines.push(`📅 *Today — ${todayJobs.length} job${todayJobs.length>1?'s':''}*`);
      todayJobs.forEach(l => lines.push(jobLine(l)));
    }
    lines.push('');

    if (tomorrowJobs.length) {
      lines.push(`⏭️ *Tomorrow — ${tomorrowJobs.length} job${tomorrowJobs.length>1?'s':''}*`);
      tomorrowJobs.forEach(l => lines.push(jobLine(l)));
      lines.push('');
    }

    lines.push(`📊 *This week:* ${weekBooked.length} booked · $${weekRevenue}`);
    if (quotedPipeline > 0) lines.push(`💬 *Quoted pipeline:* $${quotedPipeline}`);
    if (newLeads > 0) lines.push(`🔵 *${newLeads} new lead${newLeads>1?'s':''}* waiting`);

    // Flag prep issues
    const prep = [];
    todayJobs.forEach(l => {
      if (!l.crew_assigned || !l.crew_assigned.length) prep.push(`⚠️ ${esc(l.name)} has no crew assigned`);
      if (!l.pickup_address || String(l.pickup_address).startsWith('TBD')) prep.push(`⚠️ ${esc(l.name)} has no pickup address`);
    });
    if (prep.length) {
      lines.push('');
      lines.push('*Needs attention before move day:*');
      prep.forEach(p => lines.push('  ' + p));
    }

    await sendTG(lines.join('\n'));
    return { statusCode: 200, body: JSON.stringify({ ok: true, sent: true }) };
  } catch(e) {
    console.error('morning-briefing err:', e);
    return { statusCode: 500, body: e.message };
  }
};
