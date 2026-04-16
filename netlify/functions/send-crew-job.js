// Send job details to a crew member for acceptance.
// Auth: CRM_PASSWORD. Params: ?leadId=xxx&crewId=xxx
// Shares: job type, hours, date, full addresses, client name.
// Does NOT share: phone, email (privacy — crew only needs location info).

const { getStore } = require('@netlify/blobs');
const { Resend } = require('resend');
const { getLead, addNote } = require('./_lib/leads');
const { listCrew } = require('./_lib/crew');

const json = (status, data) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(data),
});

exports.handler = async (event) => {
  const pw = event.headers['x-crm-password'] || event.queryStringParameters?.pw || '';
  if (!process.env.CRM_PASSWORD || pw !== process.env.CRM_PASSWORD) return json(401, { error: 'Unauthorized' });

  const q = event.queryStringParameters || {};
  const leadId = (q.leadId || '').trim();
  const crewId = (q.crewId || '').trim();

  if (!leadId || !crewId) return json(400, { error: 'leadId and crewId required' });

  const lead = await getLead(leadId);
  if (!lead) return json(404, { error: 'Lead not found' });

  const roster = await listCrew();
  const crew = roster.find(c => c.id === crewId);
  if (!crew) return json(404, { error: 'Crew member not found' });
  if (!crew.email) return json(400, { error: crew.name + ' has no email on file. Add it in Crew settings.' });

  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'hello@toromovers.net';
  const adminBcc = process.env.ADMIN_BCC_EMAIL || 'dilerbizz@gmail.com';
  const est = lead.estimate || {};
  const baseUrl = 'https://toromovers.net/.netlify/functions/crew-response';
  const acceptUrl = `${baseUrl}?leadId=${leadId}&crewId=${crewId}&response=accept`;
  const denyUrl = `${baseUrl}?leadId=${leadId}&crewId=${crewId}&response=deny`;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const jobType = est.truck ? 'Move with Truck' : 'Labor Only';
  const moversNeeded = est.movers || 2;
  const hours = est.hours || '2';
  const moveDate = lead.move_date || 'TBD';
  const moveTime = lead.move_time || '';
  const pickup = lead.pickup_address || 'TBD';
  const dropoff = lead.dropoff_address || 'TBD';
  const clientName = lead.name || '(no name)';
  const pickupMaps = pickup !== 'TBD' ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pickup)}` : '';
  const dropoffMaps = dropoff !== 'TBD' ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dropoff)}` : '';

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
      <div style="background:#C8102E;color:#fff;padding:22px 24px;border-radius:12px 12px 0 0;text-align:center">
        <div style="font-weight:900;font-size:22px;letter-spacing:-.3px">TORO <span style="opacity:.85">MOVERS</span></div>
        <div style="margin-top:6px;font-size:14px;opacity:.9">New Job Assignment</div>
      </div>
      <div style="background:#fff;padding:28px 24px;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 12px 12px">
        <h2 style="margin:0 0 16px;font-size:20px">Hey ${esc(crew.name)} — new job for you!</h2>
        <p style="margin:0 0 18px;color:#3a3a3a;font-size:15px;line-height:1.6">Please review the details below and let us know if you can take this job.</p>

        <table style="width:100%;border-collapse:collapse;margin:0 0 20px;border:1px solid #e5e5e5;border-radius:10px;overflow:hidden">
          <tr>
            <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;width:40%">Client</td>
            <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;color:#1a1a1a;font-size:14px;font-weight:700">${esc(clientName)}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px">Job Type</td>
            <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;color:#1a1a1a;font-size:14px;font-weight:600">${esc(jobType)}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px">Movers Needed</td>
            <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;color:#1a1a1a;font-size:14px;font-weight:600">${moversNeeded}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px">Hours (est.)</td>
            <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;color:#1a1a1a;font-size:14px;font-weight:600">${esc(String(hours))}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px">Date</td>
            <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;color:#1a1a1a;font-size:14px;font-weight:600">${esc(moveDate)}${moveTime ? ' at ' + esc(moveTime) : ''}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px">Pickup</td>
            <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;color:#1a1a1a;font-size:14px">${pickupMaps ? '<a href="'+pickupMaps+'" style="color:#2563eb;text-decoration:none;font-weight:600">'+esc(pickup)+' 📍</a>' : esc(pickup)}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;color:#6b7280;font-size:13px">Dropoff</td>
            <td style="padding:12px 16px;color:#1a1a1a;font-size:14px">${dropoffMaps ? '<a href="'+dropoffMaps+'" style="color:#2563eb;text-decoration:none;font-weight:600">'+esc(dropoff)+' 📍</a>' : esc(dropoff)}</td>
          </tr>
        </table>

        <p style="margin:0 0 20px;color:#3a3a3a;font-size:14px;text-align:center">Can you take this job?</p>

        <div style="text-align:center;margin:0 0 24px">
          <a href="${acceptUrl}" style="display:inline-block;background:#16a34a;color:#fff;padding:14px 36px;border-radius:999px;text-decoration:none;font-weight:800;font-size:15px;margin-right:12px">✅ Accept Job</a>
          <a href="${denyUrl}" style="display:inline-block;background:#ef4444;color:#fff;padding:14px 36px;border-radius:999px;text-decoration:none;font-weight:800;font-size:15px">❌ Can't Do It</a>
        </div>

        <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:10px;padding:12px 14px;font-size:13px;color:#78350f">
          <strong>Note:</strong> Please respond ASAP so we can confirm with the customer. If you can't take it, we'll find another crew member.
        </div>

        <hr style="margin:24px 0 16px;border:none;border-top:1px solid #e5e5e5">
        <div style="font-size:12px;color:#9ca3af;line-height:1.6">
          <strong>Toro Movers</strong> · Orlando, FL<br>
          This email is for crew scheduling only. Do not share customer information.
        </div>
      </div>
    </div>
  `;

  try {
    const result = await resend.emails.send({
      from: `Toro Movers <${fromEmail}>`,
      to: [crew.email],
      bcc: adminBcc ? [adminBcc] : undefined,
      replyTo: fromEmail,
      subject: `New Job: ${esc(clientName)} — ${moveDate}${moveTime ? ' ' + moveTime : ''}`,
      html,
    });

    await addNote(leadId, `Job sent to ${crew.name} (${crew.email}) for review`, 'crm');
    return json(200, { ok: true, crewName: crew.name, to: crew.email, resendId: result?.data?.id });
  } catch(e) {
    console.error('send-crew-job failed:', e);
    return json(500, { error: e.message });
  }
};
