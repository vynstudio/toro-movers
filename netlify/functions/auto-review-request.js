// Auto-fire review requests the morning after a move.
//
// Runs daily at 14:00 UTC (10:00 ET EDT / 11:00 ET EST). For every lead
// whose move_date is at least 1 calendar day in the past (ET) and that
// hasn't already been review-requested, send the review email + SMS and
// stamp `review_requested_at` on the lead so it never double-fires.
//
// Eligibility:
//   - status in ['booked', 'done']  (catches both manual-Done and untouched bookings)
//   - move_date present and >= 1 day ago in ET
//   - lead.review_requested_at is empty
//   - has an email OR a phone (at least one channel)
//
// Idempotent on `review_requested_at`. If both sends fail, the field is NOT
// set, so the next day's run retries. If at least one channel succeeds, the
// stamp is set and we move on.

const { getStore } = require('@netlify/blobs');
const { listLeads } = require('./_lib/leads');
const { sendReviewRequest, sendReviewSMS } = require('./telegram-callback');

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

function leadStore(){
  const siteID = process.env.NETLIFY_SITE_ID || '5d1b562a-d00c-4a66-8dd3-5b083eb11ce9';
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (token) return getStore({ name: 'leads', siteID, token, consistency: 'strong' });
  return getStore({ name: 'leads', consistency: 'strong' });
}

// Today's date in ET as YYYY-MM-DD. Comparing string YYYY-MM-DD against
// move_date works because both are in the same lexicographic format.
function todayET(){
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const p = {}; parts.forEach(x => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day}`;
}

async function tg(text){
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
    });
  } catch (e) { console.error('TG send failed:', e.message); }
}

exports.handler = async () => {
  const today = todayET();
  const index = await listLeads();
  const s = leadStore();

  const eligible = index.filter(entry => {
    if (!['booked', 'done'].includes(entry.status)) return false;
    if (!entry.move_date) return false;
    // move_date must be strictly before today (i.e. at least 1 day ago in ET)
    if (entry.move_date >= today) return false;
    return true;
  });

  const results = { fired: [], skipped: [], failed: [] };

  for (const entry of eligible) {
    const raw = await s.get(entry.id);
    if (!raw) { results.skipped.push({ id: entry.id, reason: 'missing_blob' }); continue; }
    const lead = JSON.parse(raw);

    if (lead.review_requested_at) {
      results.skipped.push({ id: lead.id, reason: 'already_requested' });
      continue;
    }
    if (!lead.email && !lead.phone) {
      results.skipped.push({ id: lead.id, reason: 'no_contact' });
      continue;
    }

    let emailOk = false, smsOk = false, errs = [];

    if (lead.email && process.env.RESEND_API_KEY) {
      try {
        const r = await sendReviewRequest(lead);
        emailOk = !!(r && (r.immediate || r.ids));
        if (!emailOk) errs.push('email: ' + JSON.stringify(r));
      } catch (e) {
        errs.push('email: ' + e.message);
      }
    }

    if (lead.phone) {
      try {
        const r = await sendReviewSMS(lead);
        smsOk = !!(r && r.ok);
        if (!smsOk) errs.push('sms: ' + (r?.reason || r?.error || 'failed'));
      } catch (e) {
        errs.push('sms: ' + e.message);
      }
    }

    if (emailOk || smsOk) {
      const now = new Date().toISOString();
      lead.review_requested_at = now;
      lead.review_request_channels = { email: emailOk, sms: smsOk };
      lead.timeline = lead.timeline || [];
      lead.timeline.push({
        at: now,
        type: 'review_requested',
        text: `Auto review request fired (email: ${emailOk ? 'ok' : 'no'}, sms: ${smsOk ? 'ok' : 'no'})`,
      });
      lead.updatedAt = now;
      await s.set(lead.id, JSON.stringify(lead));
      results.fired.push({ id: lead.id, name: lead.name, move_date: lead.move_date, email: emailOk, sms: smsOk });
    } else {
      results.failed.push({ id: lead.id, name: lead.name, errs });
    }
  }

  // Daily summary to ops Telegram (only if anything happened)
  if (results.fired.length || results.failed.length) {
    const lines = [`⭐ *Daily review request sweep*`, ''];
    if (results.fired.length) {
      lines.push(`✅ Fired: ${results.fired.length}`);
      for (const f of results.fired.slice(0, 10)) {
        const ch = [f.email && '📧', f.sms && '📱'].filter(Boolean).join('');
        lines.push(`  · ${f.name || '(no name)'} — ${f.move_date} ${ch}`);
      }
      if (results.fired.length > 10) lines.push(`  · …and ${results.fired.length - 10} more`);
    }
    if (results.failed.length) {
      lines.push('', `⚠️ Failed: ${results.failed.length}`);
      for (const f of results.failed.slice(0, 5)) {
        lines.push(`  · ${f.name || '(no name)'} — ${f.errs.join('; ')}`);
      }
    }
    await tg(lines.join('\n'));
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ran_at: new Date().toISOString(),
      today_et: today,
      eligible_count: eligible.length,
      ...results,
    }, null, 2),
  };
};
