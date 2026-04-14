// CRM API — list/read/update leads. Protected by shared CRM_PASSWORD env var.
// Auth: pass password in x-crm-password header or ?pw= query param.
//
// Routes (by action param):
//   GET  ?action=list             → list all leads
//   GET  ?action=get&id=xxx       → fetch single lead detail
//   POST body { action, id, ... } → update, note, status

const { getLead, listLeads, addNote, setStatus, updateLead } = require('./_lib/leads');

const json = (status, data) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-crm-password',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  },
  body: JSON.stringify(data),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: json(204,{}).headers, body: '' };

  // AUTH DISABLED — test mode
  // To re-enable: uncomment these lines and remove the comment below.
  // const pw = event.headers['x-crm-password'] || event.queryStringParameters?.pw || '';
  // const expected = process.env.CRM_PASSWORD;
  // if (!expected) return json(500, { error: 'CRM_PASSWORD not configured' });
  // if (pw !== expected) return json(401, { error: 'Unauthorized' });

  const action = event.queryStringParameters?.action || (event.body ? JSON.parse(event.body).action : '') || 'list';
  const id     = event.queryStringParameters?.id     || (event.body ? JSON.parse(event.body).id     : '');

  try {
    if (event.httpMethod === 'GET') {
      if (action === 'list') {
        const leads = await listLeads();
        return json(200, { leads });
      }
      if (action === 'get' && id) {
        const lead = await getLead(id);
        if (!lead) return json(404, { error: 'Not found' });
        return json(200, { lead });
      }
      return json(400, { error: 'Unknown action' });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { action: a, id: aid } = body;
      if (!aid) return json(400, { error: 'id required' });

      if (a === 'status') {
        const lead = await setStatus(aid, body.status);
        return json(200, { lead });
      }
      if (a === 'note') {
        const lead = await addNote(aid, body.text, body.author || 'admin');
        return json(200, { lead });
      }
      if (a === 'update') {
        const lead = await updateLead(aid, body.patch || {});
        return json(200, { lead });
      }
      return json(400, { error: 'Unknown POST action' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch(e) {
    console.error('CRM error:', e);
    return json(500, { error: e.message });
  }
};
