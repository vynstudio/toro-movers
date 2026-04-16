// Handles crew Accept/Deny responses from the job assignment email.
// No auth — links are unique per lead+crew combo.
// Updates lead timeline + notifies admin via Telegram.

const { getStore } = require('@netlify/blobs');
const { getLead, addNote } = require('./_lib/leads');
const { listCrew } = require('./_lib/crew');

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

async function sendTG(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
  }).catch(e => console.error('TG err:', e));
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const leadId = (q.leadId || '').trim();
  const crewId = (q.crewId || '').trim();
  const response = (q.response || '').trim().toLowerCase();

  if (!leadId || !crewId || !['accept', 'deny'].includes(response)) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: '<h2>Invalid link.</h2>' };
  }

  const lead = await getLead(leadId);
  const roster = await listCrew();
  const crew = roster.find(c => c.id === crewId);
  const crewName = crew ? crew.name : crewId;
  const clientName = lead ? lead.name : '(unknown)';

  if (response === 'accept') {
    if (lead) await addNote(leadId, `${crewName} ACCEPTED the job`, 'crew-response');
    await sendTG(`✅ *${crewName}* ACCEPTED the job for *${clientName}*\n📅 ${lead?.move_date || ''} ${lead?.move_time || ''}\n\nOpen: https://toromovers.net/crm#lead/${leadId}`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `
        <html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
          body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0fdf4}
          .card{background:#fff;border-radius:16px;padding:40px;text-align:center;max-width:400px;box-shadow:0 4px 20px rgba(0,0,0,.1)}
          h1{color:#16a34a;margin:0 0 12px}
          p{color:#3a3a3a;font-size:15px;line-height:1.6}
        </style></head><body>
          <div class="card">
            <h1>✅ Job Accepted!</h1>
            <p>Thanks ${crewName}! The team has been notified. We'll send you the final details before move day.</p>
            <p style="color:#6b7280;font-size:13px;margin-top:20px">— Toro Movers</p>
          </div>
        </body></html>
      `,
    };
  } else {
    if (lead) await addNote(leadId, `${crewName} DECLINED the job`, 'crew-response');
    await sendTG(`❌ *${crewName}* DECLINED the job for *${clientName}*\n📅 ${lead?.move_date || ''} ${lead?.move_time || ''}\n\n⚠️ Need to reassign crew!\nOpen: https://toromovers.net/crm#lead/${leadId}`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `
        <html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
          body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fef2f2}
          .card{background:#fff;border-radius:16px;padding:40px;text-align:center;max-width:400px;box-shadow:0 4px 20px rgba(0,0,0,.1)}
          h1{color:#ef4444;margin:0 0 12px}
          p{color:#3a3a3a;font-size:15px;line-height:1.6}
        </style></head><body>
          <div class="card">
            <h1>Got it — no worries!</h1>
            <p>Thanks for letting us know, ${crewName}. We'll assign another crew member.</p>
            <p style="color:#6b7280;font-size:13px;margin-top:20px">— Toro Movers</p>
          </div>
        </body></html>
      `,
    };
  }
};
