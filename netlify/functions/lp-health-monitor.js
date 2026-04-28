// Scheduled health check for the move-calculator landing pages.
// Runs every 4 hours via cron (see netlify.toml).
//
// What it does:
//   1. HEAD-checks https://toromovers.net/lp and /lp-es (200 expected).
//   2. Submits a synthetic test lead to /.netlify/functions/send-quote
//      with name "[HEALTH] LP Probe" so it's filterable in the CRM.
//   3. Verifies the response is 200 + {success:true}.
//   4. Pings Telegram on any failure (and once a day on full success — set
//      MONITOR_PING_ON_OK=1 env var to enable success pings).
//
// Env required:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID — optional, only used for alerts.

const SITE = 'https://toromovers.net';
const URLS = ['/lp', '/lp-es'];
const QUOTE_FN = `${SITE}/.netlify/functions/send-quote`;

async function alertTelegram(text) {
  const tk = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!tk || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${tk}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
  } catch (_) {}
}

async function checkPage(path) {
  const url = `${SITE}${path}`;
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow' });
    return { url, ok: r.ok, status: r.status };
  } catch (e) {
    return { url, ok: false, error: e.message };
  }
}

async function probeQuote(page) {
  const ts = new Date().toISOString();
  const payload = {
    name: '[HEALTH] LP Probe',
    email: 'health-monitor@toromovers.net',
    phone: '+15555550100',
    movers: 2,
    hours: 2,
    truck: false,
    truckFee: 0,
    labor: 300,
    total: 300,
    packing: 'none',
    bedrooms: '1',
    page,
    health_check: true,
    ts,
  };
  try {
    const r = await fetch(QUOTE_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-health-check': '1' },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    return { page, ok: r.ok && data && data.success === true, status: r.status, data };
  } catch (e) {
    return { page, ok: false, error: e.message };
  }
}

exports.handler = async () => {
  const results = { time: new Date().toISOString(), pages: [], probes: [] };

  // 1. Page checks
  for (const path of URLS) results.pages.push(await checkPage(path));

  // 2. Synthetic quote probes (only run for /lp — /lp-es uses same backend).
  results.probes.push(await probeQuote('/lp'));

  const failed = [
    ...results.pages.filter(p => !p.ok),
    ...results.probes.filter(p => !p.ok),
  ];

  if (failed.length) {
    const lines = ['🚨 *Toro LP health check FAILED*', ''];
    for (const f of failed) {
      lines.push(`• \`${f.url || f.page}\` → status ${f.status || 'n/a'}${f.error ? ' err=' + f.error : ''}`);
    }
    lines.push('', `Time: ${results.time}`);
    await alertTelegram(lines.join('\n'));
  } else if (process.env.MONITOR_PING_ON_OK === '1') {
    await alertTelegram(
      `✅ *Toro LP health* — all checks passed at ${results.time}`
    );
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: failed.length === 0, results }, null, 2),
  };
};
