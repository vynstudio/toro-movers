// Escalating move-day reminders to the ops Telegram chat.
//
// Runs every 15 minutes via netlify.toml schedule.
//
// For every lead with status === 'booked' and a future move_date + move_time:
//   T-3h       → first reminder
//   T-2:30, T-2:00, T-1:30, T-1:00  → every 30 min
//   T-0:45, T-0:30, T-0:15, T-0:00  → every 15 min in the final hour
//
// Idempotent: each lead tracks reminders_sent[] so a retry (or a cold start
// within the same 15-min window) never double-fires a slot. If the function
// misses a window (e.g. deploy gap), it catches up to the CURRENT slot and
// marks earlier slots as skipped — better to send the right "30 min away"
// message than a stale "3 hours away" one.

const { getStore } = require('@netlify/blobs');
const { listLeads } = require('./_lib/leads');
const { sendSms } = require('./_lib/sms');

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

const SLOTS_ASC = [
  { key: 'T-0',    mins: 0,   label: 'NOW',        urgent: true },
  { key: 'T-0:15', mins: 15,  label: '15 MIN',     urgent: true },
  { key: 'T-0:30', mins: 30,  label: '30 MIN',     urgent: true },
  { key: 'T-0:45', mins: 45,  label: '45 MIN',     urgent: true },
  { key: 'T-1:00', mins: 60,  label: '1 HOUR',     urgent: true },
  { key: 'T-1:30', mins: 90,  label: '1.5 HOURS',  urgent: false },
  { key: 'T-2:00', mins: 120, label: '2 HOURS',    urgent: false },
  { key: 'T-2:30', mins: 150, label: '2.5 HOURS',  urgent: false },
  { key: 'T-3:00', mins: 180, label: '3 HOURS',    urgent: false },
];

// Same Blobs store config as _lib/leads.js so direct writes land in the right bucket
function leadStore(){
  const siteID = process.env.NETLIFY_SITE_ID || '5d1b562a-d00c-4a66-8dd3-5b083eb11ce9';
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (token) return getStore({ name: 'leads', siteID, token, consistency: 'strong' });
  return getStore({ name: 'leads', consistency: 'strong' });
}

// Parse a free-text move_time into 24h "HH:MM".
// Accepts: "10:00", "10:00 AM", "10am", "10 AM", "2:30pm", "14:30", "10:30am"
function parseMoveTime(raw){
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, '');
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3];
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// Represent "now in ET" as a Date whose UTC getters return ET components.
// Comparing two such "naive ET" dates yields the real ET time difference
// without DST math bugs.
function nowNaiveET(){
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const p = {};
  parts.forEach(x => { p[x.type] = x.value; });
  return new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
}

function moveNaiveET(move_date, timeHHMM){
  return new Date(`${move_date}T${timeHHMM}:00Z`);
}

function esc(s){
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/_/g, '\\_').replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[').replace(/`/g, '\\`');
}

function fmtMoney(n){
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return '$' + v.toLocaleString();
}

function fmtDate(move_date){
  try {
    const d = new Date(move_date + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  } catch (_) { return move_date; }
}

function buildMessage(lead, slot){
  const total    = lead.estimate?.total || 0;
  const deposit  = lead.deposit || (lead.depositPaid ? (lead.estimate?.truck ? 125 : 50) : 0);
  const balance  = Math.max(0, total - deposit);
  const hasTruck = !!(lead.estimate && lead.estimate.truck);
  const movers   = lead.estimate?.movers || '?';
  const hours    = lead.estimate?.hours || '?';
  const from     = lead.pickup_address || (lead.zip_from ? `ZIP ${lead.zip_from}` : '?');
  const to       = lead.dropoff_address || (lead.zip_to ? `ZIP ${lead.zip_to}` : '?');
  const crew     = (lead.crew_assigned && lead.crew_assigned.length) ? lead.crew_assigned.join(', ') : '⚠️ not assigned';
  const truck    = lead.truck_assigned || (hasTruck ? '⚠️ not assigned' : 'n/a');
  const prefix   = slot.urgent ? '🚨' : '🚚';

  const lines = [
    `${prefix} *MOVE IN ${slot.label}*`,
    '',
    `*${esc(lead.name || '(no name)')}*`,
    `📅 ${fmtDate(lead.move_date)} · ${esc(lead.move_time || '')}`,
    `📍 ${esc(String(from).split(',').slice(0, 2).join(','))} → ${esc(String(to).split(',').slice(0, 2).join(','))}`,
    `👥 ${movers} movers · ${hours}h${hasTruck ? ' · 🚚 truck' : ''}`,
    `💰 ${fmtMoney(total)} total · ${fmtMoney(deposit)} deposit · *${fmtMoney(balance)} balance due*`,
  ];
  if (lead.phone)      lines.push(`📞 Customer: ${esc(lead.phone)}`);
  lines.push(`👷 Crew: ${esc(crew)}${truck !== 'n/a' ? ` · ${esc(truck)}` : ''}`);
  return lines.join('\n');
}

async function sendTG(text){
  if (!TG_TOKEN || !TG_CHAT) return { ok: false, reason: 'missing env' };
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TG_CHAT,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
  return { ok: res.ok, status: res.status };
}

exports.handler = async () => {
  if (!TG_TOKEN || !TG_CHAT) {
    return { statusCode: 500, body: 'missing telegram env' };
  }

  const index = await listLeads();
  const now = nowNaiveET();
  const s = leadStore();
  const actions = [];
  const crewAlerts = [];

  // ═══ Pass 1 — CREW NOT ASSIGNED early-warning (fires once, T-48h → T-3h) ═══
  // Catches booked moves where crew_assigned is empty. George Roig's move
  // 2026-04-19 exposed the gap: the only alert for "not assigned" was at T-3h,
  // too late to scramble. Now we alert up to 48h ahead, once per lead.
  for (const entry of index) {
    if (entry.status !== 'booked') continue;
    if (!entry.move_date) continue;

    const timeHHMM = parseMoveTime(entry.move_time) || '09:00';
    const moveAt = moveNaiveET(entry.move_date, timeHHMM);
    const diffMin = (moveAt - now) / 60000;

    // Early-warning window: between T-48h and T-3h
    if (diffMin > 48 * 60 || diffMin < 180) continue;

    const raw = await s.get(entry.id);
    if (!raw) continue;
    const lead = JSON.parse(raw);

    // Already assigned, or alert already fired? skip
    const hasAssigned = Array.isArray(lead.crew_assigned) && lead.crew_assigned.length > 0;
    if (hasAssigned) continue;
    if (lead.assigned_alert_sent) continue;

    const hours = Math.round(diffMin / 60);
    const alert =
      `🚨 <b>CREW NOT ASSIGNED</b>\n` +
      `<b>${esc(lead.name || 'Lead')}</b> · ${esc(lead.move_date)} · ${esc(timeHHMM)}\n` +
      `T-${hours}h · ${esc(lead.movers || '?')} movers` +
      (lead.truck ? ' + 🚚' : '') + `\n` +
      `<a href="https://toromovers.net/crm#lead/${lead.id}">Open in CRM →</a>`;

    const r = await sendTG(alert);
    if (r.ok) {
      lead.assigned_alert_sent = true;
      lead.updatedAt = new Date().toISOString();
      await s.set(lead.id, JSON.stringify(lead));
      crewAlerts.push({ id: lead.id, name: lead.name, hours });
    } else {
      crewAlerts.push({ id: lead.id, name: lead.name, hours, error: r });
    }
  }

  // ═══ Pass 2 — regular T-3h → T-0 reminders ═══
  for (const entry of index) {
    if (entry.status !== 'booked') continue;
    if (!entry.move_date) continue;

    const timeHHMM = parseMoveTime(entry.move_time);
    if (!timeHHMM) continue;

    const moveAt = moveNaiveET(entry.move_date, timeHHMM);
    const diffMin = (moveAt - now) / 60000;

    // Out of range — either >3h away, or >30min past the move (window closed)
    if (diffMin > 180) continue;
    if (diffMin < -30) continue;

    // Pick the current slot (smallest mins where diffMin <= slot.mins)
    let current = null;
    for (const slot of SLOTS_ASC) {
      if (diffMin <= slot.mins) { current = slot; break; }
    }
    if (!current) continue;

    // Load full lead to read+write reminders_sent (not in updateLead ALLOWED list)
    const raw = await s.get(entry.id);
    if (!raw) continue;
    const lead = JSON.parse(raw);
    const sent = Array.isArray(lead.reminders_sent) ? lead.reminders_sent.slice() : [];

    if (sent.includes(current.key)) continue;

    // Fire the current slot
    const msg = buildMessage(lead, current);
    const send = await sendTG(msg);
    if (!send.ok) {
      actions.push({ id: lead.id, slot: current.key, sent: false, error: send });
      continue;
    }
    sent.push(current.key);

    // Mark any earlier (further-from-move) unfired slots as skipped so they
    // don't fire late on the next tick
    for (const slot of SLOTS_ASC) {
      if (slot.mins > current.mins && !sent.includes(slot.key)) sent.push(slot.key);
    }

    lead.reminders_sent = sent;
    lead.updatedAt = new Date().toISOString();
    await s.set(lead.id, JSON.stringify(lead));

    actions.push({ id: lead.id, name: lead.name, slot: current.key, sent: true });

    // Customer SMS — only at T-3h (heads-up) and T-0:30 (imminent arrival).
    // No-op until Twilio env vars are set.
    if ((current.key === 'T-3:00' || current.key === 'T-0:30') && lead.phone) {
      const sms = current.key === 'T-3:00'
        ? `Toro Movers — your crew is on schedule for ${lead.move_date} at ${timeHHMM}. We'll call if anything changes. Reply to this text with questions.`
        : `Toro Movers — your crew will arrive in ~30 min. Call (321) 758-0094 if you need us.`;
      const r = await sendSms(lead.phone, sms);
      actions.push({ id: lead.id, sms_slot: current.key, sms_ok: r.ok, sms_reason: r.reason || null });
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ran_at: new Date().toISOString(),
      reminders: { count: actions.length, actions },
      crew_alerts: { count: crewAlerts.length, alerts: crewAlerts },
    }, null, 2),
  };
};
