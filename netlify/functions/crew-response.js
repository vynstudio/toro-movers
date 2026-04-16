// Handles crew Accept/Deny responses from the job assignment email.
// No auth — links are unique per lead+crew combo.
// Updates lead timeline + notifies admin via Telegram.

const { getStore } = require('@netlify/blobs');
const { Resend } = require('resend');
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
    return { statusCode: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: '<h2>Invalid link.</h2>' };
  }

  const lead = await getLead(leadId);
  const roster = await listCrew();
  const crew = roster.find(c => c.id === crewId);
  const crewName = crew ? crew.name : crewId;
  const clientName = lead ? lead.name : '(unknown)';

  if (response === 'accept') {
    if (lead) await addNote(leadId, `${crewName} ACCEPTED the job`, 'crew-response');
    await sendTG(`✅ *${crewName}* ACCEPTED the job for *${clientName}*\n📅 ${lead?.move_date || ''} ${lead?.move_time || ''}\n\nOpen: https://toromovers.net/crm#lead/${leadId}`);

    // Send confirmation email + calendar link to crew
    if (crew?.email && lead && process.env.RESEND_API_KEY) {
      try { await sendCrewConfirmation(crew, lead); } catch(e) { console.error('crew confirm email failed:', e); }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: `
        <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
          body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0fdf4}
          .card{background:#fff;border-radius:16px;padding:40px;text-align:center;max-width:400px;box-shadow:0 4px 20px rgba(0,0,0,.1)}
          h1{color:#16a34a;margin:0 0 12px}
          p{color:#3a3a3a;font-size:15px;line-height:1.6}
          .cal-btn{display:inline-block;background:#C8102E;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px;margin:6px}
        </style></head><body>
          <div class="card">
            <h1>✅ Job Accepted!</h1>
            <p>Thanks ${crewName}! The team has been notified. Check your email for full details + calendar invite.</p>
            ${lead ? '<p style="margin-top:16px"><a class="cal-btn" href="' + buildGoogleCalUrl(lead) + '" target="_blank">📅 Add to Google Calendar</a></p><p><a class="cal-btn" style="background:#333" href="' + buildIcsUrl(lead) + '">📅 Add to Apple Calendar</a></p>' : ''}
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
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: `
        <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
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

function parseDate(lead) {
  if (!lead.move_date) return null;
  const d = new Date(lead.move_date);
  return isNaN(d.getTime()) ? null : d;
}

function fmtGcalDate(d, timeStr) {
  const pad = n => String(n).padStart(2, '0');
  let h = 9, m = 0;
  if (timeStr) {
    const match = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM|am|pm)?/);
    if (match) {
      h = parseInt(match[1], 10);
      m = parseInt(match[2] || '0', 10);
      const ap = (match[3] || '').toUpperCase();
      if (ap === 'PM' && h < 12) h += 12;
      if (ap === 'AM' && h === 12) h = 0;
    }
  }
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(h)}${pad(m)}00`;
}

function buildGoogleCalUrl(lead) {
  const d = parseDate(lead);
  if (!d) return '#';
  const est = lead.estimate || {};
  const hrs = est.hours || 2;
  const start = fmtGcalDate(d, lead.move_time);
  const endD = new Date(d);
  const startH = lead.move_time ? parseInt(fmtGcalDate(d, lead.move_time).slice(9,11)) : 9;
  endD.setHours(startH + Math.ceil(hrs), 0, 0, 0);
  const end = fmtGcalDate(endD, `${endD.getHours()}:00`);
  const title = encodeURIComponent(`Toro Movers — ${lead.name}`);
  const loc = encodeURIComponent(lead.pickup_address || '');
  const details = encodeURIComponent(`Client: ${lead.name}\nPickup: ${lead.pickup_address || 'TBD'}\nDropoff: ${lead.dropoff_address || 'TBD'}\nMovers: ${est.movers || 2}\nHours: ${hrs}\nType: ${est.truck ? 'Truck + Labor' : 'Labor Only'}`);
  return `https://calendar.google.com/calendar/event?action=TEMPLATE&text=${title}&dates=${start}/${end}&location=${loc}&details=${details}`;
}

function buildIcsUrl(lead) {
  const d = parseDate(lead);
  if (!d) return '#';
  const est = lead.estimate || {};
  const hrs = est.hours || 2;
  const start = fmtGcalDate(d, lead.move_time);
  const startH = lead.move_time ? parseInt(start.slice(9,11)) : 9;
  const endD = new Date(d); endD.setHours(startH + Math.ceil(hrs), 0, 0, 0);
  const end = fmtGcalDate(endD, `${endD.getHours()}:00`);
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
    `DTSTART:${start}`, `DTEND:${end}`,
    `SUMMARY:Toro Movers — ${lead.name}`,
    `LOCATION:${(lead.pickup_address || '').replace(/,/g, '\\,')}`,
    `DESCRIPTION:Client: ${lead.name}\\nPickup: ${lead.pickup_address || 'TBD'}\\nDropoff: ${lead.dropoff_address || 'TBD'}\\nMovers: ${est.movers || 2}\\nType: ${est.truck ? 'Truck' : 'Labor'}`,
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\n');
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
}

async function sendCrewConfirmation(crew, lead) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'hello@toromovers.net';
  const est = lead.estimate || {};
  const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const pickup = lead.pickup_address || 'TBD';
  const dropoff = lead.dropoff_address || 'TBD';
  const pickupLink = pickup !== 'TBD' ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pickup)}" style="color:#2563eb">${esc(pickup)} 📍</a>` : 'TBD';
  const dropoffLink = dropoff !== 'TBD' ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dropoff)}" style="color:#2563eb">${esc(dropoff)} 📍</a>` : 'TBD';
  const gcalUrl = buildGoogleCalUrl(lead);

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
      <div style="background:#C8102E;color:#fff;padding:22px 24px;border-radius:12px 12px 0 0;text-align:center">
        <div style="font-weight:900;font-size:22px">TORO <span style="opacity:.85">MOVERS</span></div>
        <div style="margin-top:6px;font-size:14px;opacity:.9">Job Confirmed ✅</div>
      </div>
      <div style="background:#fff;padding:28px 24px;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 12px 12px">
        <h2 style="margin:0 0 14px;font-size:20px">${esc(crew.name)}, you're locked in!</h2>
        <p style="margin:0 0 18px;color:#3a3a3a;font-size:15px">Here are the confirmed job details:</p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 20px;border:1px solid #e5e5e5;border-radius:10px;overflow:hidden">
          <tr><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;width:35%">Client</td><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;font-weight:700">${esc(lead.name)}</td></tr>
          <tr><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px">Date</td><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;font-weight:600">${esc(lead.move_date || 'TBD')}${lead.move_time ? ' at ' + esc(lead.move_time) : ''}</td></tr>
          <tr><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px">Type</td><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;font-weight:600">${est.truck ? 'Move with Truck' : 'Labor Only'}</td></tr>
          <tr><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px">Movers</td><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;font-weight:600">${est.movers || 2}</td></tr>
          <tr><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px">Hours (est.)</td><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;font-weight:600">${est.hours || 2}</td></tr>
          <tr><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px">Pickup</td><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0">${pickupLink}</td></tr>
          <tr><td style="padding:10px 14px;color:#6b7280;font-size:13px">Dropoff</td><td style="padding:10px 14px">${dropoffLink}</td></tr>
        </table>
        <div style="text-align:center;margin:20px 0">
          <a href="${gcalUrl}" target="_blank" style="display:inline-block;background:#C8102E;color:#fff;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:800;font-size:14px">📅 Add to Calendar</a>
        </div>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;font-size:13px;color:#15803d">
          <strong>Reminder:</strong> Be at the pickup location 10 min early. Customer info stays private — do not share outside the team.
        </div>
        <hr style="margin:24px 0 16px;border:none;border-top:1px solid #e5e5e5">
        <div style="font-size:12px;color:#9ca3af">Toro Movers · Orlando, FL · Crew scheduling only</div>
      </div>
    </div>
  `;

  await resend.emails.send({
    from: `Toro Movers <${fromEmail}>`,
    to: [crew.email],
    replyTo: fromEmail,
    subject: `Confirmed: ${lead.name} — ${lead.move_date || 'TBD'}${lead.move_time ? ' ' + lead.move_time : ''}`,
    html,
  });
}
