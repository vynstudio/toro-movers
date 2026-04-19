// Vyn Studio daily morning brief — fires once a day at 8am ET.
// Schedule is declared in netlify.toml under [functions."vyn-bot-daily"].
//
// Pulls live data where cheap (Toro lead counts by status from the
// Netlify Blobs leads store) and lists static cross-client open
// items. Sends a consolidated digest to @Vynstudio_bot.
//
// To change the static cross-client items, edit the OPEN_ITEMS array
// below and redeploy.

const { listLeads } = require('./_lib/leads');

const BOT_TOKEN = process.env.VYN_BOT_TOKEN;
const CHAT_ID = process.env.VYN_BOT_CHAT_ID;

// ── Static cross-client open items ────────────────────────────────
// Keep this list short and honest. Add new items when starting them,
// remove when genuinely resolved. If an item is "waiting on someone
// else," prefix with the person/system.
const OPEN_ITEMS = [
  '*Stripe consolidation* — swap Toro /quote `STRIPE_SECRET_KEY` to Vyn Studio platform key + add `statement_descriptor: "TORO MOVERS"`; then close old Toro + Diler Dynamics Stripe accounts.',
  '*OMG Connect test* — place a real €5 order at ohmygrillbrasas.com, verify 95% lands in OMG\'s Stripe and 5% in Vyn Studio platform.',
  '*Stael Connect test* — book a small service at staelfogarty.com, verify 80/20 split + 3% processing fee pass-through.',
  '*Jobber integration (deferred)* — paused pending plan upgrade. Currently entering clients manually in Jobber UI.',
  '*Netlify repo re-link for ohmygrill* — site still uses manual deploys; link to `vynstudio/omgrillbrasas` via Netlify UI so pushes auto-deploy.',
  '*Twilio toll-free SMS verification* — submitted form for Toro Movers; watch inbox for approval / follow-up requests.',
];

const STATUS_LABEL = {
  new: '🆕 New',
  contacted: '📞 Contacted',
  quoted: '💬 Quoted',
  booked: '🎉 Booked',
  partial: '🟡 Partial',
  abandoned: '⚠️ Abandoned',
  done: '🏁 Done',
  lost: '❌ Lost',
};

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/`/g, '\\`');

async function toroLeadCounts() {
  try {
    const leads = await listLeads();
    const byStatus = {};
    let last24h = 0;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const l of leads) {
      byStatus[l.status] = (byStatus[l.status] || 0) + 1;
      if (l.createdAt && Date.parse(l.createdAt) > cutoff) last24h++;
    }
    return { total: leads.length, byStatus, last24h };
  } catch (e) {
    return { error: e.message };
  }
}

function formatToro(counts) {
  if (counts.error) return `⚠️ couldn't read Toro leads: ${esc(counts.error)}`;
  const lines = [];
  lines.push(`*Toro Movers* — ${counts.total} leads total, ${counts.last24h} in last 24h`);
  const priorityOrder = ['new', 'contacted', 'quoted', 'booked', 'partial', 'abandoned', 'done', 'lost'];
  for (const s of priorityOrder) {
    const n = counts.byStatus[s];
    if (n) lines.push(`  ${STATUS_LABEL[s] || s}: ${n}`);
  }
  return lines.join('\n');
}

exports.handler = async () => {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('vyn-bot-daily: missing env vars');
    return { statusCode: 500, body: 'not configured' };
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  });

  const toro = await toroLeadCounts();

  const lines = [
    `☀️ *Vyn Studio — ${esc(today)}*`,
    '',
    formatToro(toro),
    '',
    '*Open action items*',
    ...OPEN_ITEMS.map((t, i) => `${i + 1}. ${t}`),
    '',
    '_Edit OPEN\\_ITEMS in vyn-bot-daily.js to adjust this list._',
  ];

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: lines.join('\n'),
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      }
    );
    const data = await res.json();
    if (!data.ok) console.error('vyn-bot-daily telegram send failed:', data);
    return { statusCode: res.ok ? 200 : 502, body: JSON.stringify(data) };
  } catch (err) {
    console.error('vyn-bot-daily error:', err.message);
    return { statusCode: 502, body: String(err) };
  }
};
