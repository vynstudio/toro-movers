// Password-gated bulk pause/resume for Meta ads. Internal Vyn Studio tool.
// POST { ids: ["123","456"], status: "PAUSED" | "ACTIVE" }
// curl -H "x-crm-password: $PW" -H 'Content-Type: application/json' \
//   -d '{"ids":["..."],"status":"PAUSED"}' .../ads-pause

const META_TOKEN = process.env.META_ACCESS_TOKEN;

exports.handler = async (event) => {
  const pw = event.headers['x-crm-password'] || event.queryStringParameters?.pw || '';
  if (pw !== process.env.CRM_PASSWORD) return { statusCode: 401, body: 'unauthorized' };
  if (!META_TOKEN) return { statusCode: 500, body: 'META_ACCESS_TOKEN not set' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) { return { statusCode: 400, body: 'bad json' }; }
  const ids = Array.isArray(body.ids) ? body.ids : [];
  const status = (body.status || 'PAUSED').toUpperCase();
  if (!['PAUSED','ACTIVE'].includes(status)) return { statusCode: 400, body: 'status must be PAUSED or ACTIVE' };
  if (!ids.length) return { statusCode: 400, body: 'ids required' };

  const results = [];
  for (const id of ids) {
    try {
      const r = await fetch(`https://graph.facebook.com/v19.0/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `status=${status}&access_token=${encodeURIComponent(META_TOKEN)}`,
      });
      const j = await r.json();
      results.push({ id, ok: r.ok && j.success !== false, response: j });
    } catch(e) {
      results.push({ id, ok: false, error: String(e && e.message || e) });
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, count: ids.length, results }, null, 2),
  };
};
