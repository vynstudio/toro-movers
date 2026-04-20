// Password-gated campaign/adset settings + CBO switch for Meta ads.
//
// GET ?campaign_id=...       → returns campaign + adsets current settings
// POST { campaign_id, daily_budget_usd } → sets campaign daily_budget,
//       which enables Advantage Campaign Budget (CBO). Adset-level budgets
//       are overridden once campaign budget is set.

const META_TOKEN = process.env.META_ACCESS_TOKEN;

exports.handler = async (event) => {
  const pw = event.headers['x-crm-password'] || event.queryStringParameters?.pw || '';
  if (pw !== process.env.CRM_PASSWORD) return { statusCode: 401, body: 'unauthorized' };
  if (!META_TOKEN) return { statusCode: 500, body: 'META_ACCESS_TOKEN not set' };

  if (event.httpMethod === 'GET') {
    const campaignId = event.queryStringParameters?.campaign_id;
    if (!campaignId) return { statusCode: 400, body: 'campaign_id required' };

    const campaignUrl = `https://graph.facebook.com/v19.0/${campaignId}?fields=id,name,status,effective_status,objective,buying_type,bid_strategy,daily_budget,lifetime_budget,budget_remaining&access_token=${META_TOKEN}`;
    const adsetsUrl = `https://graph.facebook.com/v19.0/${campaignId}/adsets?fields=id,name,status,effective_status,daily_budget,lifetime_budget,bid_strategy,optimization_goal,billing_event&limit=100&access_token=${META_TOKEN}`;

    const [campaignR, adsetsR] = await Promise.all([fetch(campaignUrl), fetch(adsetsUrl)]);
    const campaign = await campaignR.json();
    const adsets = await adsetsR.json();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign, adsets: adsets.data || adsets }, null, 2),
    };
  }

  if (event.httpMethod === 'POST') {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch(e) { return { statusCode: 400, body: 'bad json' }; }
    const { campaign_id, daily_budget_usd } = body;
    if (!campaign_id || !daily_budget_usd) return { statusCode: 400, body: 'campaign_id + daily_budget_usd required' };

    const cents = Math.round(parseFloat(daily_budget_usd) * 100);
    if (!cents || cents < 100) return { statusCode: 400, body: 'daily_budget_usd too low (min $1)' };

    // Setting campaign-level daily_budget enables Advantage Campaign Budget.
    // Meta requires lifetime_budget to be removed if transitioning from ABO
    // with lifetime budgets. Most ABO campaigns use adset daily budgets
    // though, so a plain daily_budget post works.
    const r = await fetch(`https://graph.facebook.com/v19.0/${campaign_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `daily_budget=${cents}&access_token=${encodeURIComponent(META_TOKEN)}`,
    });
    const j = await r.json();
    return {
      statusCode: r.ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: r.ok, daily_budget_cents: cents, daily_budget_usd, response: j }, null, 2),
    };
  }

  return { statusCode: 405, body: 'GET or POST' };
};
