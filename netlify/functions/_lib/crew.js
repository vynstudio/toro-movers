// Crew roster — stored in Netlify Blobs under key `_crew`.
// Minimal CRUD to manage field crew. Used by CRM UI for assignment dropdowns.

const { getStore } = require('@netlify/blobs');

function store(){
  const siteID = process.env.NETLIFY_SITE_ID || '5d1b562a-d00c-4a66-8dd3-5b083eb11ce9';
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (token) return getStore({ name: 'leads', siteID, token, consistency: 'strong' });
  return getStore({ name: 'leads', consistency: 'strong' });
}

// Seed roster if empty. Ralph is the field manager/operator (2026-04-15).
const DEFAULT_CREW = [
  { id: 'ralph', name: 'Ralph', role: 'Field Manager / Operator', active: true, color: '#C8102E' },
];

async function listCrew(){
  const s = store();
  try {
    const raw = await s.get('_crew');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch(e) { /* fall through to seed */ }
  await s.set('_crew', JSON.stringify(DEFAULT_CREW));
  return DEFAULT_CREW;
}

async function addCrew(member){
  const s = store();
  const roster = await listCrew();
  const id = member.id || member.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const existing = roster.findIndex(c => c.id === id);
  const entry = {
    id,
    name: member.name,
    role: member.role || 'Mover',
    email: member.email || '',
    active: member.active !== false,
    color: member.color || '#2563eb',
  };
  if (existing >= 0) roster[existing] = { ...roster[existing], ...entry };
  else roster.push(entry);
  await s.set('_crew', JSON.stringify(roster));
  return entry;
}

async function removeCrew(id){
  const s = store();
  const roster = await listCrew();
  const next = roster.filter(c => c.id !== id);
  await s.set('_crew', JSON.stringify(next));
  return { removed: roster.length - next.length };
}

module.exports = { listCrew, addCrew, removeCrew };
