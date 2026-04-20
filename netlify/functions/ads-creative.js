// Password-gated ad-creative inspector + patcher.
//
// GET ?ad_id=...                 → current creative (copy, link, CTA)
// POST { ad_id, link, body?, title?, description? }
//   → duplicates the creative with patched link/body/title/description
//     (Meta creatives are immutable; the ad is repointed to the new one)

const META_TOKEN = process.env.META_ACCESS_TOKEN;

async function graphGet(path, fields){
  const url = `https://graph.facebook.com/v19.0/${path}?fields=${fields}&access_token=${META_TOKEN}`;
  const r = await fetch(url);
  return r.json();
}

async function graphPost(path, body){
  const r = await fetch(`https://graph.facebook.com/v19.0/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: typeof body === 'string' ? body : new URLSearchParams({ ...body, access_token: META_TOKEN }).toString(),
  });
  return r.json();
}

exports.handler = async (event) => {
  const pw = event.headers['x-crm-password'] || event.queryStringParameters?.pw || '';
  if (pw !== process.env.CRM_PASSWORD) return { statusCode: 401, body: 'unauthorized' };
  if (!META_TOKEN) return { statusCode: 500, body: 'META_ACCESS_TOKEN not set' };

  if (event.httpMethod === 'GET') {
    const adId = event.queryStringParameters?.ad_id;
    if (!adId) return { statusCode: 400, body: 'ad_id required' };

    const ad = await graphGet(adId, 'id,name,status,account_id,creative{id,name,title,body,link_url,thumbnail_url,object_story_id,object_story_spec,asset_feed_spec,call_to_action_type,effective_object_story_id}');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ad, null, 2),
    };
  }

  if (event.httpMethod === 'POST') {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch(e) { return { statusCode: 400, body: 'bad json' }; }
    const { ad_id, link, body: newBody, title, description } = body;
    if (!ad_id || !link) return { statusCode: 400, body: 'ad_id + link required' };

    // 1) Fetch the ad's current creative
    const ad = await graphGet(ad_id, 'account_id,creative{id,name,object_story_spec,asset_feed_spec,title,body,link_url,call_to_action_type}');
    if (!ad.creative) return { statusCode: 500, body: JSON.stringify({ error: 'no creative on ad', ad }) };
    const accountId = ad.account_id && ad.account_id.startsWith('act_') ? ad.account_id : `act_${ad.account_id}`;
    const oss = ad.creative.object_story_spec;
    const afs = ad.creative.asset_feed_spec;

    // 2) Build the new creative spec — prefer patching asset_feed_spec (dynamic creative)
    //    or object_story_spec (single-image/video). Only asset_feed_spec.link_urls
    //    and body/title arrays are safely patchable; object_story_spec.link_data.link.
    let newCreativeBody = { name: (ad.creative.name || 'creative') + ' · patched ' + new Date().toISOString().slice(0,10) };
    if (afs) {
      const patched = JSON.parse(JSON.stringify(afs));
      if (Array.isArray(patched.link_urls) && patched.link_urls.length) {
        patched.link_urls = patched.link_urls.map(u => ({ ...u, website_url: link }));
      }
      if (newBody && Array.isArray(patched.bodies) && patched.bodies.length) {
        patched.bodies = patched.bodies.map(b => ({ ...b, text: newBody }));
      }
      if (title && Array.isArray(patched.titles) && patched.titles.length) {
        patched.titles = patched.titles.map(t => ({ ...t, text: title }));
      }
      if (description && Array.isArray(patched.descriptions) && patched.descriptions.length) {
        patched.descriptions = patched.descriptions.map(d => ({ ...d, text: description }));
      }
      newCreativeBody.asset_feed_spec = JSON.stringify(patched);
      if (oss) newCreativeBody.object_story_spec = JSON.stringify(oss);
    } else if (oss) {
      const patched = JSON.parse(JSON.stringify(oss));
      if (patched.link_data) {
        patched.link_data.link = link;
        if (newBody) patched.link_data.message = newBody;
        if (title) patched.link_data.name = title;
        if (description) patched.link_data.description = description;
        if (patched.link_data.call_to_action?.value) {
          patched.link_data.call_to_action.value.link = link;
        }
      }
      if (patched.video_data) {
        if (patched.video_data.call_to_action?.value) {
          patched.video_data.call_to_action.value.link = link;
        }
        if (newBody) patched.video_data.message = newBody;
        if (title) patched.video_data.title = title;
      }
      newCreativeBody.object_story_spec = JSON.stringify(patched);
    } else {
      return { statusCode: 500, body: JSON.stringify({ error: 'creative has neither asset_feed_spec nor object_story_spec', creative: ad.creative }) };
    }

    // 3) Create a new adcreative on the account
    const createRes = await graphPost(`${accountId}/adcreatives`, newCreativeBody);
    if (createRes.error || !createRes.id) {
      return { statusCode: 500, body: JSON.stringify({ step: 'create_creative', response: createRes, attemptedBody: newCreativeBody }) };
    }

    // 4) Repoint the ad at the new creative
    const updateRes = await graphPost(ad_id, { creative: JSON.stringify({ creative_id: createRes.id }) });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: !updateRes.error,
        new_creative_id: createRes.id,
        update: updateRes,
        old_creative_id: ad.creative.id,
      }, null, 2),
    };
  }

  return { statusCode: 405, body: 'GET or POST' };
};
