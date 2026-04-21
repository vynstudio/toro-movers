// TORO MOVERS — crew-apply
// POST /.netlify/functions/crew-apply
//   Public endpoint (no JWT). Body is the form submission from
//   /work-with-us.html. Inserts a row into public.crew_applications,
//   fires a Telegram alert to ops, sends a confirmation email.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
//      RESEND_FROM_EMAIL (optional), TELEGRAM_* (optional).

const { Resend } = require('resend');
const { getAdminClient } = require('./_lib/supabase-admin');
const { notifyTelegramTeam } = require('./_lib/crm-notifications');

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'hello@toromovers.net';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function respond(s, b) {
  return { statusCode: s, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(b) };
}

function str(v) { return v == null ? null : String(v).trim() || null; }
function intOrNull(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }

function renderApplicantEmail(app) {
  const name = String(app.first_name || '').split(/\s+/)[0] || 'there';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Toro Movers</title></head>
<body style="margin:0;padding:0;background:#fff;color:#1C1C1E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;padding:32px 16px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden">
<tr><td style="background:#C8102E;padding:22px 28px;color:#fff"><div style="font-weight:800;font-size:22px">TORO MOVERS</div><div style="font-size:12px;color:#FFE8EC;margin-top:4px">Moving People Forward</div></td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 12px 0;font-size:15px">Hey ${name},</p>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.55">Thanks for applying to work with Toro Movers. We got your application and will review it within a few days.</p>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.55">If your profile fits, we'll send a background-check link from our vendor (Checkr or similar). You'll enter your SSN directly with them — we never touch it.</p>
<p style="margin:0;font-size:14px;color:#6B7280">Questions? Call or text <a href="tel:+13217580094" style="color:#C8102E;font-weight:700">(321) 758-0094</a>.</p>
</td></tr>
<tr><td style="background:#F9FAFB;padding:14px 28px;text-align:center;color:#6B7280;font-size:11px">TORO MOVERS · Orlando, FL · toromovers.net</td></tr>
</table></td></tr></table></body></html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  // Minimum required fields + explicit consent.
  const missing = [];
  for (const k of ['first_name', 'last_name', 'email', 'phone']) {
    if (!payload[k] || !String(payload[k]).trim()) missing.push(k);
  }
  if (missing.length) return respond(400, { error: `Missing: ${missing.join(', ')}` });
  if (payload.background_consent !== true) {
    return respond(400, { error: 'You must consent to the background check to apply.' });
  }

  // Structured references: 3 required, each with name + phone + relationship.
  const VALID_RELATIONSHIPS = new Set([
    'previous_manager_moving', 'previous_manager_other',
    'coworker', 'customer', 'other',
  ]);
  const refsIn = Array.isArray(payload.references_list) ? payload.references_list : [];
  const refs = refsIn
    .map(r => r && typeof r === 'object' ? {
      name: String(r.name || '').trim(),
      phone: String(r.phone || '').trim(),
      relationship: VALID_RELATIONSHIPS.has(r.relationship) ? r.relationship : null,
      company: r.company ? String(r.company).trim() : null,
    } : null)
    .filter(r => r && r.name && r.phone && r.relationship);
  if (refs.length < 3) {
    return respond(400, { error: 'Three complete references are required (name, phone, and relationship on each).' });
  }
  const workedForMovingCo = payload.worked_for_moving_co === true;
  if (workedForMovingCo && !refs.some(r => r.relationship === 'previous_manager_moving')) {
    return respond(400, { error: 'Since you worked at a moving company, one reference must be a previous manager from that company.' });
  }

  const zones = Array.isArray(payload.service_zones)
    ? payload.service_zones.filter(z => typeof z === 'string')
    : [];
  const VALID_SKILLS = new Set([
    'loading', 'unloading', 'driving', 'directing',
    'packing', 'unpacking', 'assembly_disassembly', 'organizing_truck',
  ]);
  const skills = Array.isArray(payload.skills)
    ? payload.skills.filter(s => typeof s === 'string' && VALID_SKILLS.has(s))
    : [];
  if (skills.length === 0) {
    return respond(400, { error: 'Pick at least one skill you are best at.' });
  }

  const row = {
    first_name: str(payload.first_name),
    last_name: str(payload.last_name),
    email: str(payload.email),
    phone: str(payload.phone),
    dob: str(payload.dob),
    address: str(payload.address),
    city: str(payload.city),
    state: str(payload.state),
    zip: str(payload.zip),
    company_name: str(payload.company_name),
    drivers_license_number: str(payload.drivers_license_number),
    dl_state: str(payload.dl_state),
    dl_expiration: str(payload.dl_expiration),
    years_experience: intOrNull(payload.years_experience),
    team_size: intOrNull(payload.team_size),
    bilingual: !!payload.bilingual,
    has_truck: !!payload.has_truck,
    truck_size: str(payload.truck_size),
    service_zones: zones,
    skills: skills,
    about: str(payload.about),
    references_text: str(payload.references_text),
    references_list: refs,
    worked_for_moving_co: workedForMovingCo,
    background_consent: true,
    consent_ip: event.headers['x-forwarded-for'] || event.headers['client-ip'] || null,
    consent_ua: event.headers['user-agent'] || null,
  };

  const admin = getAdminClient();
  const { data: app, error } = await admin
    .from('crew_applications').insert(row).select().single();
  if (error) {
    console.error('crew_applications insert failed:', error);
    return respond(500, { error: 'Sorry — could not save your application. Please try again or call (321) 758-0094.' });
  }

  // Team Telegram alert
  notifyTelegramTeam([
    '*New crew application*',
    '',
    `Name: *${row.first_name} ${row.last_name}*`,
    `Phone: \`${row.phone}\``,
    `Email: ${row.email}`,
    row.city || row.state ? `Based: ${[row.city, row.state].filter(Boolean).join(', ')}` : '',
    row.years_experience ? `Experience: ${row.years_experience} yrs` : '',
    row.team_size ? `Team size: ${row.team_size}` : '',
    row.has_truck ? `Truck: yes${row.truck_size ? ' (' + row.truck_size + ')' : ''}` : '',
    row.bilingual ? 'Bilingual: yes' : '',
    zones.length ? `Zones: ${zones.join(', ')}` : '',
    '',
    'Review in CRM → Crew applications',
  ]).catch(e => console.error('tg failed:', e.message));

  // Applicant confirmation email (non-blocking)
  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      resend.emails.send({
        from: `Toro Movers <${FROM_EMAIL}>`,
        to: [row.email],
        replyTo: FROM_EMAIL,
        subject: 'Toro Movers — application received',
        html: renderApplicantEmail(row),
      }).catch(e => console.error('applicant email failed:', e.message));
    } catch (e) { console.error('resend init failed:', e.message); }
  }

  return respond(200, { ok: true, application_id: app.id });
};
