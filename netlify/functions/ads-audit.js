// Password-gated Meta ads data endpoint. Returns raw insights JSON for
// the Toro Movers ad account at account, campaign, adset, and ad level
// over a configurable preset. Used by Vyn Studio's audit loop — not
// exposed to the public site.
//
// Usage: curl -H "x-crm-password: $PW" 'https://toromovers.net/.netlify/functions/ads-audit?preset=last_14d'

const META_TOKEN = process.env.META_ACCESS_TOKEN;
const ACT = 'act_971361825561389';

async function fetchInsights(datePreset, level){
  const fields = level === 'ad'
    ? 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions'
    : level === 'adset'
      ? 'adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions'
      : level === 'campaign'
        ? 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions'
        : 'spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions';
  const url = `https://graph.facebook.com/v19.0/${ACT}/insights?fields=${fields}&date_preset=${datePreset}&level=${level}&limit=200&access_token=${META_TOKEN}`;
  const r = await fetch(url);
  const j = await r.json();
  if (j.error) return { error: j.error };
  return j.data || [];
}

exports.handler = async (event) => {
  const pw = event.headers['x-crm-password'] || event.queryStringParameters?.pw || '';
  if (pw !== process.env.CRM_PASSWORD) return { statusCode: 401, body: 'unauthorized' };
  if (!META_TOKEN) return { statusCode: 500, body: 'META_ACCESS_TOKEN not set' };

  const preset = event.queryStringParameters?.preset || 'last_14d';
  const [account, campaigns, adsets, ads] = await Promise.all([
    fetchInsights(preset, 'account'),
    fetchInsights(preset, 'campaign'),
    fetchInsights(preset, 'adset'),
    fetchInsights(preset, 'ad'),
  ]);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset, account, campaigns, adsets, ads }, null, 2),
  };
};
