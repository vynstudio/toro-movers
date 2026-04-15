// Shared lead storage (Netlify Blobs) + Telegram notification helper.
// Used by notify-callback.js and the /crm endpoints.

const { getStore } = require('@netlify/blobs');

function store(){
  // Prefer explicit config when a Netlify PAT is provided (most reliable).
  // Falls back to auto-config which works on standard Netlify Functions v2.
  const siteID = process.env.NETLIFY_SITE_ID || '5d1b562a-d00c-4a66-8dd3-5b083eb11ce9';
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (token) {
    return getStore({ name: 'leads', siteID, token, consistency: 'strong' });
  }
  return getStore({ name: 'leads', consistency: 'strong' });
}

function leadId(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}

async function createLead(payload){
  const s = store();
  const id = leadId();
  const now = new Date().toISOString();
  const isPartial = !!payload.partial;
  const isAbandon = !!payload.abandon;

  const lead = {
    id,
    status: isAbandon ? 'abandoned' : (isPartial ? 'partial' : 'new'),
    createdAt: now,
    updatedAt: now,
    first_name: payload.first_name || '',
    last_name:  payload.last_name  || '',
    name:       payload.name || ((payload.first_name || '') + ' ' + (payload.last_name || '')).trim(),
    phone:      payload.phone || '',
    email:      payload.email || '',
    zip_from:   payload.zip_from || '',
    zip_to:     payload.zip_to   || '',
    furniture_size:  payload.furniture_size  || '',
    floor:           payload.floor           || '',
    stairs_elevator: payload.stairs_elevator || '',
    code_access:     payload.code_access     || '',
    boxes_count:     payload.boxes_count     || '',
    tv_count:        payload.tv_count        || '',
    assembly:        payload.assembly || '',
    wrapping:        payload.wrapping || '',
    move_date:       payload.move_date || '',
    move_time:       payload.move_time || '',
    pickup_address:  payload.pickup_address  || '',
    dropoff_address: payload.dropoff_address || '',
    crew_assigned:   Array.isArray(payload.crew_assigned) ? payload.crew_assigned : [],
    truck_assigned:  payload.truck_assigned || '',
    page:            payload.page || '',
    utm_source:   payload.utm_source   || '',
    utm_medium:   payload.utm_medium   || '',
    utm_campaign: payload.utm_campaign || '',
    utm_content:  payload.utm_content  || '',
    utm_term:     payload.utm_term     || '',
    fbclid:       payload.fbclid || '',
    gclid:        payload.gclid  || '',
    estimate:     payload.estimate || null,   // { hours, total, movers }
    notes:        [],
    timeline:     [{ at: now, type: 'created', text: `Lead ${lead_type_label(isPartial, isAbandon)} via ${payload.page || 'web'}` }],
    depositPaid:  false,
    stripeSessionId: '',
  };

  await s.set(id, JSON.stringify(lead));
  // Also append to an index so list queries are cheap
  await appendToIndex(s, id, lead);
  return lead;
}

function lead_type_label(isPartial, isAbandon){
  if (isAbandon) return 'abandoned mid-form';
  if (isPartial) return 'partially filled';
  return 'fully submitted';
}

async function appendToIndex(s, id, lead){
  // Simple index = JSON array of lightweight lead summaries, sorted newest first
  let idx = [];
  try {
    const raw = await s.get('_index');
    if (raw) idx = JSON.parse(raw);
  } catch(e) { idx = []; }
  idx.unshift({
    id: lead.id,
    status: lead.status,
    createdAt: lead.createdAt,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    zip_from: lead.zip_from,
    zip_to: lead.zip_to,
    pickup_address: lead.pickup_address || '',
    dropoff_address: lead.dropoff_address || '',
    furniture_size: lead.furniture_size,
    move_date: lead.move_date,
    move_time: lead.move_time || '',
    crew_assigned: lead.crew_assigned || [],
    truck_assigned: lead.truck_assigned || '',
    utm_content: lead.utm_content,
    utm_source: lead.utm_source,
    estimate_total: lead.estimate?.total || 0,
    depositPaid: lead.depositPaid,
  });
  // Keep most recent 500
  if (idx.length > 500) idx = idx.slice(0, 500);
  await s.set('_index', JSON.stringify(idx));
}

async function updateLead(id, patch){
  const s = store();
  const raw = await s.get(id);
  if (!raw) return null;
  const lead = JSON.parse(raw);
  const now = new Date().toISOString();
  Object.assign(lead, patch, { updatedAt: now });
  if (patch.timelineEntry) {
    lead.timeline.push({ at: now, type: patch.timelineEntry.type, text: patch.timelineEntry.text });
    delete lead.timelineEntry;
  }
  await s.set(id, JSON.stringify(lead));
  await rebuildIndexEntry(s, lead);
  return lead;
}

async function rebuildIndexEntry(s, lead){
  let idx = [];
  try { const raw = await s.get('_index'); if (raw) idx = JSON.parse(raw); } catch(e){}
  const existing = idx.findIndex(i => i.id === lead.id);
  const summary = {
    id: lead.id,
    status: lead.status,
    createdAt: lead.createdAt,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    zip_from: lead.zip_from,
    zip_to: lead.zip_to,
    pickup_address: lead.pickup_address || '',
    dropoff_address: lead.dropoff_address || '',
    furniture_size: lead.furniture_size,
    move_date: lead.move_date,
    move_time: lead.move_time || '',
    crew_assigned: lead.crew_assigned || [],
    truck_assigned: lead.truck_assigned || '',
    utm_content: lead.utm_content,
    utm_source: lead.utm_source,
    estimate_total: lead.estimate?.total || 0,
    depositPaid: lead.depositPaid,
  };
  if (existing >= 0) idx[existing] = summary;
  else idx.unshift(summary);
  await s.set('_index', JSON.stringify(idx));
}

async function getLead(id){
  const s = store();
  const raw = await s.get(id);
  return raw ? JSON.parse(raw) : null;
}

async function listLeads(){
  const s = store();
  try {
    const raw = await s.get('_index');
    if (raw) return JSON.parse(raw);
  } catch(e){}
  return [];
}

async function addNote(id, text, author){
  const s = store();
  const raw = await s.get(id);
  if (!raw) return null;
  const lead = JSON.parse(raw);
  const now = new Date().toISOString();
  const note = { at: now, author: author || 'admin', text };
  lead.notes.push(note);
  lead.timeline.push({ at: now, type: 'note', text: `Note: ${text}` });
  lead.updatedAt = now;
  await s.set(id, JSON.stringify(lead));
  return lead;
}

async function setStatus(id, status){
  const s = store();
  const raw = await s.get(id);
  if (!raw) return null;
  const lead = JSON.parse(raw);
  const now = new Date().toISOString();
  const prev = lead.status;
  lead.status = status;
  lead.updatedAt = now;
  lead.timeline.push({ at: now, type: 'status', text: `Status: ${prev} → ${status}` });
  await s.set(id, JSON.stringify(lead));
  await rebuildIndexEntry(s, lead);
  return lead;
}

// ===== TELEGRAM NOTIFICATIONS =====
async function notifyTelegram(lead){
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { skipped: true };

  const est = lead.estimate;
  const isPartial = lead.status === 'partial';
  const isAbandon = lead.status === 'abandoned';

  const emoji = isAbandon ? '⚠️' : (isPartial ? '🟡' : '🟢');
  const tag   = isAbandon ? 'ABANDONED LEAD' : (isPartial ? 'EARLY LEAD (step 2)' : 'NEW QUOTE');

  // Format phone nicely for display
  const pretty = (() => {
    const d = String(lead.phone || '').replace(/\D/g, '');
    if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
    if (d.length === 11 && d.startsWith('1')) return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
    return lead.phone || '';
  })();

  const lines = [
    `${emoji} *${tag}*`,
    '',
    `👤 *${esc(lead.name || '(no name)')}*`,
    lead.phone ? `📱 \`${esc(pretty)}\`` : '',
    lead.email ? `✉️ ${esc(lead.email)}` : '',
    '',
    lead.zip_from && lead.zip_to ? `📍 ${esc(lead.zip_from)} → ${esc(lead.zip_to)}` : '',
    lead.furniture_size ? `🏠 ${esc(lead.furniture_size)}` : '',
    lead.floor ? `🏢 ${esc(lead.floor)}${lead.stairs_elevator ? ' · ' + esc(lead.stairs_elevator) : ''}` : (lead.stairs_elevator ? `🪜 ${esc(lead.stairs_elevator)}` : ''),
    lead.move_date ? `📅 ${esc(lead.move_date)}` : '',
    '',
    est ? `💰 *$${est.total}* (${est.movers} movers × ${est.hours}h)` : '',
    '',
    lead.utm_content ? `🎯 Ad: \`${esc(lead.utm_content)}\`` : '',
    lead.utm_source ? `📡 Source: ${esc(lead.utm_source)}` : '',
  ].filter(Boolean).join('\n');

  // Telegram inline buttons only accept web URLs or callback_data —
  // `tel:` / `mailto:` are rejected. Phone + email are in the message
  // body already (tap-to-call works on mobile Telegram there).
  // Tapping "🏁 Done" fires the review-request email flow automatically.
  const kb = [
    [
      { text: '✅ Contacted', callback_data: `contacted:${lead.id}` },
      { text: '💬 Quoted',    callback_data: `quoted:${lead.id}` },
    ],
    [
      { text: '🎉 Booked', callback_data: `booked:${lead.id}` },
      { text: '🏁 Done',   callback_data: `done:${lead.id}` },
    ],
    [
      { text: '❌ Lost', callback_data: `lost:${lead.id}` },
      { text: '📋 Open in CRM', url: `https://toromovers.net/crm#lead/${lead.id}` },
    ],
  ];

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: kb },
        disable_web_page_preview: true,
      }),
    });
    const j = await r.json();
    if (!j.ok) console.error('Telegram send failed:', j);
    return j;
  } catch(e){
    console.error('Telegram fetch error:', e.message);
    return { ok: false, error: e.message };
  }
}

function esc(s){
  return String(s == null ? '' : s)
    .replace(/\\/g,'\\\\')
    .replace(/_/g,'\\_')
    .replace(/\*/g,'\\*')
    .replace(/\[/g,'\\[')
    .replace(/`/g,'\\`');
}

async function deleteLead(id){
  const s = store();
  const raw = await s.get(id);
  if (!raw) return { deleted: false };
  await s.delete(id);
  // Remove from index
  let idx = [];
  try { const r = await s.get('_index'); if (r) idx = JSON.parse(r); } catch(e){}
  const next = idx.filter(i => i.id !== id);
  await s.set('_index', JSON.stringify(next));
  return { deleted: true, id };
}

module.exports = {
  createLead, updateLead, getLead, listLeads, addNote, setStatus, notifyTelegram, deleteLead,
};
