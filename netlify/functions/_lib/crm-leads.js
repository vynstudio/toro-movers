// Bridge: public-site quote form → CRM v2 Supabase tables.
//
// Called from the v1 `send-quote.js` handler (non-blocking) so every landing-
// page quote submission also creates a customer + lead row in the CRM pipeline.
// The v1 Netlify-Blobs write + Resend quote email + v1 Telegram alert are
// untouched — this is an additive bridge only.
//
// Duplicate prevention: customer dedup by email (case-insensitive). If no
// email on the submission, creates a new customer row every time (rare case;
// most forms require email).

const { getAdminClient } = require('./supabase-admin');

// Map public-form string to CRM v2 lead_size enum.
function mapSize(bedrooms) {
  if (!bedrooms) return null;
  const b = String(bedrooms).toLowerCase().trim();
  if (b.includes('studio')) return 'studio';
  if (b.includes('few') || b === 'items' || b === 'boxes' || b.includes('box')) return 'few_items';
  if (b.startsWith('1')) return '1br';
  if (b.startsWith('2')) return '2br';
  if (b.startsWith('3')) return '3br';
  if (b.startsWith('4') || b.includes('+') || b.includes('5')) return '4br_plus';
  return null;
}

// Map public-form stairs string to CRM v2 lead_stairs enum.
function mapStairs(s) {
  if (!s) return 'none';
  const v = String(s).toLowerCase().trim();
  if (v.includes('elevator') || v.includes('elev')) return 'elevator';
  if (v === '' || v.includes('none') || v === 'ground' || v === 'first') return 'none';
  if (v === '2nd' || v.startsWith('1') || v.includes('1 flight')) return '1_flight';
  if (v === '3rd' || v.startsWith('2') || v.startsWith('3') || v.includes('2+')) return '2_plus';
  return 'none';
}

// Infer language from the landing-page path.
function langFromPage(pagePath) {
  const p = String(pagePath || '').toLowerCase();
  if (p.includes('/mudanza') || p.includes('-es') || p.includes('quote-es')) return 'es';
  return 'en';
}

async function upsertCrmLeadFromPublic(payload) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, reason: 'supabase not configured' };
  }

  const admin = getAdminClient();
  const fullName = String(payload.name || '').trim() || 'Unknown';
  const email = String(payload.email || '').trim().toLowerCase() || null;
  const phone = String(payload.phone || '').trim();
  if (!phone) return { ok: false, reason: 'phone required' };

  const pagePath = payload.page || '';
  const language = langFromPage(pagePath);

  // 1. Find-or-create customer. Dedup by email first, else by phone.
  let customer = null;
  if (email) {
    const { data } = await admin.from('customers').select('*').eq('email', email).maybeSingle();
    if (data) customer = data;
  }
  if (!customer && phone) {
    const { data } = await admin.from('customers').select('*').eq('phone', phone).maybeSingle();
    if (data) customer = data;
  }
  if (!customer) {
    const { data, error } = await admin.from('customers').insert({
      full_name: fullName,
      email,
      phone,
      language_preference: language,
      source: pagePath || 'website',
    }).select().single();
    if (error) return { ok: false, reason: 'customer insert failed: ' + error.message };
    customer = data;
  }

  // 2. Build lead row from the v1 payload shape.
  const est = payload.estimate || {};
  const notesParts = [];
  if (payload.zip_from || payload.zip_to) notesParts.push(`ZIP: ${payload.zip_from || '?'} → ${payload.zip_to || '?'}`);
  if (payload.specials) notesParts.push(`Specials: ${payload.specials}`);
  if (payload.packing && payload.packing !== 'none') notesParts.push(`Packing: ${payload.packing}`);
  if (est.movers && est.hours) notesParts.push(`Est: ${est.movers} movers × ${est.hours}h${est.truck ? ' + truck' : ''}`);

  const leadRow = {
    customer_id: customer.id,
    stage: 'new',
    origin_address: payload.zip_from || null,
    destination_address: payload.zip_to || null,
    move_date: payload.move_date || null,
    size: mapSize(payload.bedrooms),
    stairs: mapStairs(payload.stairs),
    source: payload.utm_source || pagePath || 'website',
    source_url_path: pagePath || null,
    notes: notesParts.join(' · ') || null,
    estimated_value: Number(est.total || 0),
  };

  const { data: lead, error: leadErr } = await admin.from('leads').insert(leadRow).select().single();
  if (leadErr) return { ok: false, reason: 'lead insert failed: ' + leadErr.message };

  return { ok: true, customer_id: customer.id, lead_id: lead.id, language };
}

module.exports = { upsertCrmLeadFromPublic };
