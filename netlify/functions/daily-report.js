// Scheduled daily Meta ads report → Telegram.
// Runs every day at 9am Eastern. Pulls yesterday's metrics for the
// Toro Movers Orlando campaign and posts a summary card to the bot
// chat with top performers, problem ads, and a 7-day trend line.
//
// Schedule: configured in netlify.toml under [functions."daily-report"]

const META_TOKEN = process.env.META_ACCESS_TOKEN;
const TG_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT    = process.env.TELEGRAM_CHAT_ID;
const ACT        = 'act_971361825561389';
const CAMP       = '120245617827210325';

async function fetchInsights(datePreset, level = 'campaign'){
  const fields = level === 'ad'
    ? 'ad_name,adset_name,spend,impressions,clicks,ctr,cpc,actions'
    : 'spend,impressions,reach,clicks,ctr,cpc,cpm,actions,frequency';
  const url = `https://graph.facebook.com/v19.0/${CAMP}/insights?fields=${fields}&date_preset=${datePreset}&level=${level}&limit=50&access_token=${META_TOKEN}`;
  const r = await fetch(url);
  const j = await r.json();
  return j.data || [];
}

function leadsFromActions(actions){
  if (!actions) return 0;
  const lead = actions.find(a => a.action_type === 'lead');
  return lead ? parseInt(lead.value, 10) : 0;
}

async function sendTG(text){
  return fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TG_CHAT,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 Open Ads Manager', url: 'https://adsmanager.facebook.com/adsmanager/manage/ads?act=971361825561389' }],
          [{ text: '🔗 Open CRM', url: 'https://toromovers.net/crm' }],
        ],
      },
    }),
  });
}

function fmt$(n){ return '$' + (Math.round(parseFloat(n||0) * 100) / 100).toFixed(2); }
function fmtPct(n){ return (Math.round(parseFloat(n||0) * 10) / 10) + '%'; }

exports.handler = async () => {
  if (!META_TOKEN || !TG_TOKEN || !TG_CHAT) {
    console.error('daily-report: missing env vars');
    return { statusCode: 500, body: 'missing env' };
  }

  try {
    // Yesterday + today + last 7 days
    const [ystd, today, week, adBreakdown] = await Promise.all([
      fetchInsights('yesterday'),
      fetchInsights('today'),
      fetchInsights('last_7d'),
      fetchInsights('yesterday', 'ad'),
    ]);

    const y = ystd[0] || {};
    const t = today[0] || {};
    const w = week[0] || {};

    const yLeads = leadsFromActions(y.actions);
    const tLeads = leadsFromActions(t.actions);
    const wLeads = leadsFromActions(w.actions);

    const yCpl = yLeads ? (parseFloat(y.spend || 0) / yLeads).toFixed(2) : '—';
    const wCpl = wLeads ? (parseFloat(w.spend || 0) / wLeads).toFixed(2) : '—';

    // Sort ads by leads, then by CTR
    const sorted = adBreakdown
      .map(ad => ({ ...ad, _leads: leadsFromActions(ad.actions), _spend: parseFloat(ad.spend || 0) }))
      .sort((a,b) => b._leads - a._leads || parseFloat(b.ctr || 0) - parseFloat(a.ctr || 0));

    const winners = sorted.filter(a => a._leads > 0 || parseFloat(a.ctr || 0) >= 2).slice(0, 3);
    const losers  = sorted.filter(a => a._spend >= 0.5 && parseFloat(a.ctr || 0) < 0.5).slice(0, 3);

    const lines = [];
    lines.push('☀️ *Toro Movers — Daily Ads Report*');
    lines.push(`_${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}_`);
    lines.push('');
    lines.push('*YESTERDAY*');
    lines.push(`💰 Spend: *${fmt$(y.spend)}*  ·  📈 CTR: *${fmtPct(y.ctr)}*  ·  CPC: *${fmt$(y.cpc)}*`);
    lines.push(`👁 ${y.impressions || 0} impr  ·  🎯 *${yLeads} leads* @ *${yLeads ? '$'+yCpl : '—'}*/lead`);
    lines.push('');
    lines.push('*LAST 7 DAYS*');
    lines.push(`💰 ${fmt$(w.spend)}  ·  🎯 ${wLeads} leads @ ${wLeads ? '$'+wCpl : '—'}/lead`);
    lines.push('');

    if (winners.length) {
      lines.push('*🏆 TOP PERFORMERS*');
      winners.forEach(a => {
        lines.push(`• \`${a.ad_name.replace('Ad · ','')}\` — ${a._leads} leads, ${fmtPct(a.ctr)} CTR, ${fmt$(a.spend)}`);
      });
      lines.push('');
    }

    if (losers.length) {
      lines.push('*⚠️ UNDERPERFORMING (consider pausing)*');
      losers.forEach(a => {
        lines.push(`• \`${a.ad_name.replace('Ad · ','')}\` — 0 leads, ${fmtPct(a.ctr)} CTR, ${fmt$(a.spend)} spent`);
      });
      lines.push('');
    }

    lines.push(`📍 Today so far: ${fmt$(t.spend)} · ${tLeads} leads`);

    await sendTG(lines.join('\n'));
    return { statusCode: 200, body: JSON.stringify({ ok: true, sent: true }) };
  } catch (err) {
    console.error('daily-report error:', err);
    try {
      await sendTG(`⚠️ Daily report failed: ${err.message}`);
    } catch(e){}
    return { statusCode: 500, body: err.message };
  }
};
