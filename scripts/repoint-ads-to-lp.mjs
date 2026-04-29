// One-off — repoint the 4 active Toro Meta ads to the polished /lp and /lp-es
// landing pages. Meta ad creatives are immutable, so for each ad we:
//   1. Pull the existing creative spec (asset_feed_spec preferred)
//   2. Build a patched copy with new link URL
//   3. Create a new adcreative on the account
//   4. PUT the new creative_id onto the ad (so it inherits the patched link)
//
// Usage:
//   META_TOKEN=<token> node scripts/repoint-ads-to-lp.mjs

const TOKEN = process.env.META_TOKEN;
if (!TOKEN) { console.error('META_TOKEN required'); process.exit(1); }

const ACT = 'act_971361825561389';
const GRAPH = 'https://graph.facebook.com/v19.0';

// English LP for English ads, Spanish LP for the Spanish winner
const TARGETS = [
  { ad_id: '120245617840490325', name: 'st1-heavy',     link: 'https://toromovers.net/lp?utm_source=meta&utm_medium=paid&utm_campaign=tm-orlando-moving&utm_content=st1-heavy' },
  { ad_id: '120245617845620325', name: 'st3-sofa',      link: 'https://toromovers.net/lp?utm_source=meta&utm_medium=paid&utm_campaign=tm-orlando-moving&utm_content=st3-sofa' },
  { ad_id: '120245617835500325', name: 'sq2-fragile',   link: 'https://toromovers.net/lp?utm_source=meta&utm_medium=paid&utm_campaign=tm-orlando-moving&utm_content=sq2-fragile' },
  { ad_id: '120245617916590325', name: 'es-sq1-mudanza', link: 'https://toromovers.net/lp-es?utm_source=meta&utm_medium=paid&utm_campaign=tm-orlando-mudanza&utm_content=es-sq1-mudanza' },
];

async function gget(path, fields) {
  const u = new URL(`${GRAPH}/${path}`);
  if (fields) u.searchParams.set('fields', fields);
  u.searchParams.set('access_token', TOKEN);
  const r = await fetch(u);
  const j = await r.json();
  if (j.error) throw new Error(`GET ${path}: ${JSON.stringify(j.error)}`);
  return j;
}

async function gpost(path, body) {
  const params = new URLSearchParams({ ...body, access_token: TOKEN });
  const r = await fetch(`${GRAPH}/${path}`, { method: 'POST', body: params });
  const j = await r.json();
  if (j.error) throw new Error(`POST ${path}: ${JSON.stringify(j.error)}`);
  return j;
}

async function repoint({ ad_id, name, link }) {
  process.stdout.write(`\n→ ${name} (${ad_id}) ... `);

  // 1) Pull current creative
  const ad = await gget(ad_id, 'creative{id,name,object_story_spec,asset_feed_spec,call_to_action_type,instagram_actor_id,product_set_id}');
  const cr = ad.creative;
  if (!cr) throw new Error('no creative');

  // 2) Build patched creative body
  const newName = `${cr.name || 'creative'} → /lp ${new Date().toISOString().slice(0,10)}`;
  const body = { name: newName };

  if (cr.asset_feed_spec) {
    const afs = JSON.parse(JSON.stringify(cr.asset_feed_spec));
    if (Array.isArray(afs.link_urls) && afs.link_urls.length) {
      afs.link_urls = afs.link_urls.map(u => ({ ...u, website_url: link }));
    } else {
      afs.link_urls = [{ website_url: link }];
    }
    body.asset_feed_spec = JSON.stringify(afs);
    if (cr.object_story_spec) {
      const oss = JSON.parse(JSON.stringify(cr.object_story_spec));
      if (oss.link_data) oss.link_data.link = link;
      if (oss.link_data?.call_to_action?.value) oss.link_data.call_to_action.value.link = link;
      body.object_story_spec = JSON.stringify(oss);
    }
  } else if (cr.object_story_spec) {
    const oss = JSON.parse(JSON.stringify(cr.object_story_spec));
    if (oss.link_data) {
      oss.link_data.link = link;
      if (oss.link_data.call_to_action?.value) oss.link_data.call_to_action.value.link = link;
    }
    if (oss.video_data?.call_to_action?.value) oss.video_data.call_to_action.value.link = link;
    body.object_story_spec = JSON.stringify(oss);
  } else {
    throw new Error('creative has no patchable spec');
  }

  // 3) Create new creative on the account
  const newCr = await gpost(`${ACT}/adcreatives`, body);
  console.log(`new creative ${newCr.id}`);

  // 4) Repoint the ad
  const upd = await gpost(ad_id, { creative: JSON.stringify({ creative_id: newCr.id }) });
  console.log(`   ↳ ad updated: ${JSON.stringify(upd)}`);

  return { ad_id, name, new_creative_id: newCr.id, link };
}

const out = [];
for (const t of TARGETS) {
  try { out.push(await repoint(t)); }
  catch (e) { console.error(`FAIL ${t.name}: ${e.message}`); out.push({ ad_id: t.ad_id, name: t.name, error: e.message }); }
}
console.log('\n--- summary ---');
console.log(JSON.stringify(out, null, 2));
