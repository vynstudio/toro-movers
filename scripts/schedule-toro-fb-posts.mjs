// Schedule 5 organic Facebook Page posts (one per day at 18:00 America/New_York)
// from the PNGs in ~/Desktop/TOROADS/.
//
// Usage:
//   META_TOKEN=<system_user_token> node scripts/schedule-toro-fb-posts.mjs
//
// Optional:
//   META_PAGE_ID=<page_id>          → skip auto-discovery
//   START_DATE=2026-04-28            → first post date (default = tomorrow ET)
//   DRY_RUN=1                        → print actions without calling Graph

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TOKEN = process.env.META_TOKEN;
if (!TOKEN) { console.error('META_TOKEN env var required'); process.exit(1); }

const FORCED_PAGE_ID = process.env.META_PAGE_ID || '';
const DRY = process.env.DRY_RUN === '1';
const TOROADS_DIR = path.join(os.homedir(), 'Desktop', 'TOROADS');
const GRAPH = 'https://graph.facebook.com/v19.0';

// Ordered list of the 5 PNGs (oldest first → so the first scheduled day uses the
// originally-selected hero image).
const FILES_ORDER = [
  '9f28b85c-2aec-4b2e-acc2-623a5fb3efd2.png',
  '94acb3b9-f620-4291-bec4-0f9037b2c008.png',
  '703ade04-2f0f-4853-8cb4-50f3601906e0.png',
  '04977fd8-ef9c-467b-b4f0-724f41d6d889.png',
  '95797376-75d7-49e0-9bab-24a4d27f8e35.png',
];

const CAPTIONS = [
  // Day 1
  `Moving day shouldn't feel like moving mountains. 💪

Toro Movers — family-owned, fully insured, and built for Central Florida.
$75/mover/hr · 2-hour minimum · No surprise fees.

📅 Book online: https://toromovers.net/book
📞 Or call us: (689) 600-2720`,
  // Day 2
  `The same crew that loads your living room is the one that puts your bed back together. 🛏️

That's the Toro difference — one team, start to finish. Local, long-distance, or storage moves.

📅 Book online: https://toromovers.net/book
📞 Or call us: (689) 600-2720`,
  // Day 3
  `Furniture wrapped. Floors protected. Boxes where you want them. 📦

Loading, unloading, packing, unpacking — Toro does it all at $75/mover/hour. Licensed and insured in Florida.

📅 Book online: https://toromovers.net/book
📞 Or call us: (689) 600-2720`,
  // Day 4
  `Two movers. Two-hour minimum. Zero hidden fees. ✅

Serving Orlando, Kissimmee, Sanford, Lake Mary, Apopka, Winter Park, Clermont, and all of Central Florida.

📅 Book online: https://toromovers.net/book
📞 Or call us: (689) 600-2720`,
  // Day 5
  `Weekend move coming up? Lock in your slot. 🐂

The whole Toro family is ready to help — fast, careful, and on time. Same-week availability across Central Florida.

📅 Book online: https://toromovers.net/book
📞 Or call us: (689) 600-2720`,
];

// ── time helpers ──────────────────────────────────────────────────────────
// 6:00 PM America/New_York. Late April–May = EDT (UTC-4). Hard-code -04:00
// for these specific dates; this avoids needing a tz library.
function unixForLocal6pm(yyyyMmDd) {
  // yyyyMmDd like "2026-04-28" → unix ts of 18:00 -04:00
  const iso = `${yyyyMmDd}T18:00:00-04:00`;
  return Math.floor(new Date(iso).getTime() / 1000);
}

function defaultStartDateET() {
  // Tomorrow in ET
  const now = new Date();
  // Convert to ET-ish via offset; good enough for picking "tomorrow"
  const etNow = new Date(now.getTime() - 4 * 3600 * 1000);
  etNow.setUTCDate(etNow.getUTCDate() + 1);
  return etNow.toISOString().slice(0, 10);
}

function nextDate(yyyyMmDd, n) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// ── Graph helpers ─────────────────────────────────────────────────────────
async function graphGet(p, params = {}) {
  const u = new URL(`${GRAPH}/${p}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('access_token', TOKEN);
  const r = await fetch(u);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`GET ${p} failed: ${JSON.stringify(j)}`);
  return j;
}

async function discoverPage() {
  if (FORCED_PAGE_ID) {
    const page = await graphGet(FORCED_PAGE_ID, { fields: 'id,name,access_token' });
    return page;
  }
  const accounts = await graphGet('me/accounts', { fields: 'id,name,access_token', limit: 100 });
  const pages = accounts.data || [];
  if (!pages.length) throw new Error('No pages on /me/accounts. Token needs pages_manage_posts + pages_read_engagement and the system user must be assigned to the Toro page in Business Settings.');
  // Prefer page name containing "toro"
  const toro = pages.find(p => /toro/i.test(p.name)) || pages[0];
  return toro;
}

async function uploadScheduledPhoto({ pageId, pageToken, filePath, caption, scheduledUnix }) {
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf], { type: 'image/png' });
  const fd = new FormData();
  fd.append('source', blob, path.basename(filePath));
  fd.append('caption', caption);
  fd.append('published', 'false');
  fd.append('scheduled_publish_time', String(scheduledUnix));
  fd.append('access_token', pageToken);
  const r = await fetch(`${GRAPH}/${pageId}/photos`, { method: 'POST', body: fd });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`Upload failed: ${JSON.stringify(j)}`);
  return j;
}

// ── main ──────────────────────────────────────────────────────────────────
(async () => {
  // Verify all files exist
  for (const f of FILES_ORDER) {
    const p = path.join(TOROADS_DIR, f);
    if (!fs.existsSync(p)) {
      console.error(`Missing file: ${p}`);
      process.exit(1);
    }
  }

  const start = process.env.START_DATE || defaultStartDateET();
  console.log(`Start date (ET): ${start}`);

  const page = await discoverPage();
  console.log(`Page: ${page.name} (${page.id})`);
  if (!page.access_token) throw new Error('Page has no access_token in response. Token may lack pages_show_list or page-level access.');

  const results = [];
  for (let i = 0; i < FILES_ORDER.length; i++) {
    const date = nextDate(start, i);
    const ts = unixForLocal6pm(date);
    const file = path.join(TOROADS_DIR, FILES_ORDER[i]);
    const caption = CAPTIONS[i];
    const niceTime = `${date} 18:00 ET`;

    if (DRY) {
      console.log(`\n[DRY] ${niceTime} (unix ${ts}) → ${FILES_ORDER[i]}`);
      console.log(caption);
      continue;
    }

    process.stdout.write(`\n→ Scheduling ${niceTime} · ${FILES_ORDER[i]} ... `);
    try {
      const res = await uploadScheduledPhoto({
        pageId: page.id,
        pageToken: page.access_token,
        filePath: file,
        caption,
        scheduledUnix: ts,
      });
      console.log(`OK (post_id=${res.post_id || res.id})`);
      results.push({ date: niceTime, file: FILES_ORDER[i], ...res });
    } catch (e) {
      console.log(`FAIL`);
      console.error(e.message);
      results.push({ date: niceTime, file: FILES_ORDER[i], error: e.message });
    }
  }

  console.log('\n--- summary ---');
  console.log(JSON.stringify(results, null, 2));
})();
