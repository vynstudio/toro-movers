// Pre-move prep form submissions → @Toromoversbot Telegram.
//
// POST from /prep (static page). Body = { job, lang, submittedAt, data }.
// Formats a structured alert, sends via Telegram Bot API directly
// (same token as toro-bot-send.js).

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// Keep label maps in sync with prep.html question order.
// Only the answer keys (the values a user can pick) need labels here —
// the questions themselves come through as the raw user submission.
const LABEL = {
  size: {
    studio:'Studio', '1br':'1 bedroom', '2br':'2 bedroom',
    '3br':'3 bedroom', '4br':'4+ bedroom / house',
  },
  stairs: {
    none:'Ground floor', '1':'1 flight', '2plus':'2+ flights', elevator:'Elevator',
  },
  parking: {
    close:'Close to door', tight:'Tight but workable',
    far:'Long walk from parking', unsure:'Not sure',
  },
  heavy: {
    piano:'Piano', safe:'Safe', pool:'Pool table', treadmill:'Treadmill/gym',
    appliances:'Large appliances', art:'Art/mirrors', none:'None',
  },
  disassembly: {
    bed:'Bed frames', desk:'Desks', crib:'Cribs',
    wardrobe:'Wardrobes/IKEA', tv:'TV mounts', none:'Nothing',
  },
  pets: { no:'No pets', secured:'Yes, secured', free:'Yes, loose' },
  packed: {
    yes:'Fully packed', most:'Mostly', some:'Half-packed', no:'Not packed',
  },
  checklist: {
    walkways:'Walkways clear', fridge:'Fridge emptied',
    washer:'Washer disconnected', pets:'Pets secured',
    valuables:'Valuables with client', boxes:'Boxes labeled',
    payment:'Payment ready',
  },
};

const lookup = (map, v) => map[v] || v;
const list = (map, arr) =>
  Array.isArray(arr) && arr.length ? arr.map(v => lookup(map, v)).join(', ') : '—';
const line = (label, val) => `*${label}:* ${val || '—'}`;

// Telegram Markdown needs _, *, [, ], (, ), ~, `, >, #, +, -, =, |, {, }, ., ! escaped in MarkdownV2 —
// but we're using classic Markdown (parse_mode=Markdown), which only treats
// *, _, `, [ as special. Safer to just strip those from user-controlled strings.
const safe = (s) =>
  String(s == null ? '' : s).replace(/[*_`[\]]/g, '').trim();

function flagsFrom(d) {
  const flags = [];
  if (d.packed === 'no')                     flags.push('⚠️ Not packed — may need packing help');
  if (d.pets === 'free')                     flags.push('🐾 Loose pets on site');
  if (d.stairs_pickup === '2plus')           flags.push('🪜 2+ flights at pickup');
  if (d.stairs_dropoff === '2plus')          flags.push('🪜 2+ flights at destination');
  if (d.parking === 'far')                   flags.push('🚚 Long walk from parking');
  if ((d.heavy || []).some(h => h !== 'none')) flags.push('💪 Heavy/specialty items');
  const checks = (d.checklist || []).length;
  if (checks < 4)                            flags.push(`📋 Only ${checks}/7 checklist done`);
  return flags;
}

function buildMessage(payload) {
  const { job, lang, submittedAt, data: d = {} } = payload;
  const when = submittedAt ? new Date(submittedAt) : new Date();
  const whenET = when.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

  const lines = [];
  lines.push(`🧳 *Pre-move prep received* _(${lang || 'en'})_`);
  if (job) lines.push(`Job: \`${safe(job)}\``);
  lines.push(`Submitted: ${whenET} ET`);
  lines.push('');
  lines.push(`*${safe(d.name) || '(no name)'}*  ${safe(d.phone) || ''}`);
  lines.push('');
  lines.push(line('Pickup', safe(d.pickup)));
  lines.push(line('Drop-off', safe(d.dropoff)));
  lines.push(line('Size', lookup(LABEL.size, d.size)));
  lines.push(line('Stairs (pickup)', lookup(LABEL.stairs, d.stairs_pickup)));
  lines.push(line('Stairs (drop-off)', lookup(LABEL.stairs, d.stairs_dropoff)));
  lines.push(line('Parking', lookup(LABEL.parking, d.parking)));
  if (safe(d.access)) lines.push(line('Access codes', safe(d.access)));
  lines.push('');
  lines.push(line('Heavy items', list(LABEL.heavy, d.heavy)));
  lines.push(line('Disassembly', list(LABEL.disassembly, d.disassembly)));
  if (safe(d.fragile)) lines.push(line('Fragile / care', safe(d.fragile)));
  lines.push(line('Pets', lookup(LABEL.pets, d.pets)));
  lines.push(line('Packing', lookup(LABEL.packed, d.packed)));
  lines.push(line('Checklist', list(LABEL.checklist, d.checklist)));
  if (safe(d.notes)) {
    lines.push('');
    lines.push(`*Notes:* ${safe(d.notes)}`);
  }

  const flags = flagsFrom(d);
  if (flags.length) {
    lines.push('');
    lines.push('*Crew heads-up:*');
    flags.forEach(f => lines.push(`• ${f}`));
  }

  return lines.join('\n');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });
  if (!TOKEN || !CHAT_ID) return json(500, { error: 'telegram not configured' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid JSON' }); }

  const text = buildMessage(payload);

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      }
    );
    const tgData = await res.json();
    if (!res.ok || tgData.ok === false) {
      return json(502, { error: 'telegram upstream failed', detail: tgData });
    }
    return json(200, { ok: true });
  } catch (err) {
    return json(502, { error: 'telegram request failed', detail: String(err) });
  }
};
