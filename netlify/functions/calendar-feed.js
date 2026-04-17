// ICS calendar feed — subscribable URL for Google Calendar, Apple Calendar, etc.
// Returns all booked/confirmed jobs as an ICS file.
//
// Usage: subscribe in Google Calendar → "Other calendars" → "From URL" →
//   https://toromovers.net/.netlify/functions/calendar-feed?key=SECRET
//
// Auth: simple shared key via ?key= param (not the CRM password — this is
// a read-only feed URL stored in calendar apps, so use a separate secret).
// Set CALENDAR_FEED_KEY in Netlify env vars.

const { getStore } = require('@netlify/blobs'); // scanner hint — Netlify needs this to inject Blobs runtime
const { listLeads } = require('./_lib/leads');

exports.handler = async (event) => {
  const key = event.queryStringParameters?.key || '';
  const expected = process.env.CALENDAR_FEED_KEY || process.env.CRM_PASSWORD;
  if (!expected || key !== expected) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const leads = await listLeads();
  const booked = leads.filter(l =>
    l.move_date && (l.status === 'booked' || l.status === 'done' || l.status === 'contacted' || l.status === 'quoted')
  );

  const pad = n => String(n).padStart(2, '0');

  function parseDate(dateStr) {
    if (!dateStr) return null;
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
    const d = iso ? new Date(dateStr + 'T00:00:00') : new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  function parseTime(timeStr) {
    if (!timeStr) return { h: 9, m: 0 };
    const match = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM|am|pm)?/);
    if (!match) return { h: 9, m: 0 };
    let h = parseInt(match[1], 10);
    const m = parseInt(match[2] || '0', 10);
    const ap = (match[3] || '').toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return { h, m };
  }

  function fmtDt(d, h, m) {
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(h)}${pad(m)}00`;
  }

  function escIcs(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  const events = [];

  for (const l of booked) {
    const d = parseDate(l.move_date);
    if (!d) continue;

    const t = parseTime(l.move_time);
    const hours = l.estimate_hours || 2;
    const endH = t.h + Math.ceil(hours);
    const endM = t.m;

    const pickup = l.pickup_address || l.zip_from || '';
    const dropoff = l.dropoff_address || l.zip_to || '';
    const route = pickup && dropoff ? `${pickup} → ${dropoff}` : pickup || dropoff || '';
    const crew = (l.crew_assigned || []).join(', ');
    const status = l.status.toUpperCase();
    const total = l.estimate_total ? `$${l.estimate_total}` : '';

    const summary = `${escIcs(l.name || 'Job')} [${status}]`;
    const description = [
      `Client: ${l.name || '(no name)'}`,
      pickup ? `Pickup: ${pickup}` : '',
      dropoff ? `Dropoff: ${dropoff}` : '',
      crew ? `Crew: ${crew}` : '',
      total ? `Estimate: ${total}` : '',
      `Status: ${l.status}`,
      '',
      `CRM: https://toromovers.net/crm#lead/${l.id}`,
    ].filter(Boolean).join('\\n');

    events.push([
      'BEGIN:VEVENT',
      `UID:${l.id}@toromovers.net`,
      `DTSTART:${fmtDt(d, t.h, t.m)}`,
      `DTEND:${fmtDt(d, endH, endM)}`,
      `SUMMARY:${summary}`,
      `LOCATION:${escIcs(pickup)}`,
      `DESCRIPTION:${description}`,
      `STATUS:${l.status === 'done' ? 'COMPLETED' : 'CONFIRMED'}`,
      'END:VEVENT',
    ].join('\r\n'));
  }

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Toro Movers//CRM Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Toro Movers — Jobs',
    'X-WR-TIMEZONE:America/New_York',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="toro-movers.ics"',
      'Cache-Control': 'no-cache, max-age=0',
      'Access-Control-Allow-Origin': '*',
    },
    body: ics,
  };
};
