// CRM v2 — create a new team user.
// POST /.netlify/functions/create-user
//   Headers: Authorization: Bearer <admin JWT>
//   Body:    { email, full_name?, role?, password? }
// Response: 200 { user, temp_password? }
//
// Admin-only. Creates an auth.users entry via Supabase admin API, then writes
// the matching public.users profile row with the requested role. Owners
// (is_owner=true) can never be created here — use a direct SQL update for
// ownership transfer, and owner protection RLS blocks admins from mutating
// the owner row regardless.
//
// If password is omitted a random 12-char password is generated and returned
// once in the response so the admin can share it with the new team member.
// Email confirmation is marked as confirmed so the user can log in
// immediately; they should change the password on first sign-in.

const crypto = require('crypto');
const { getAdminClient, verifyUserJWT } = require('./_lib/supabase-admin');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function respond(s, b) {
  return { statusCode: s, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(b) };
}

function generatePassword() {
  // 12 chars, base36 — readable, no ambiguous chars. One-time temp only.
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let profile;
  try {
    ({ profile } = await verifyUserJWT(event.headers.authorization || event.headers.Authorization));
  } catch (e) {
    return respond(401, { error: e.message || 'Unauthorized' });
  }
  // Owner-only. Being an admin is not enough — only the is_owner=true account
  // (Diler) can create team logins. Prevents any compromised admin session
  // (or a co-admin) from provisioning new accounts.
  if (!profile.is_owner) return respond(403, { error: 'Owner only' });

  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON' }); }
  const email = String(payload.email || '').trim().toLowerCase();
  const fullName = String(payload.full_name || '').trim() || email.split('@')[0];
  const role = String(payload.role || 'admin').toLowerCase();
  const passwordIn = String(payload.password || '').trim();

  if (!email) return respond(400, { error: 'email required' });
  if (!['admin', 'dispatch', 'sales'].includes(role)) {
    return respond(400, { error: 'role must be admin, dispatch, or sales' });
  }
  const tempPassword = passwordIn || generatePassword();
  if (tempPassword.length < 8) return respond(400, { error: 'password must be at least 8 chars' });

  const admin = getAdminClient();

  // Short-circuit if someone with this email already exists — Supabase auth
  // itself rejects duplicate emails, but checking first lets us 409 cleanly.
  const { data: existing } = await admin
    .from('users').select('id, email, role, active').eq('email', email).maybeSingle();
  if (existing) {
    return respond(409, { error: 'A user with this email already exists', existing });
  }

  // Create the auth user. email_confirm:true lets them log in right away.
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName, created_by: profile.email },
  });
  if (authErr || !created?.user) {
    return respond(500, { error: 'Auth create failed: ' + (authErr?.message || 'unknown') });
  }

  // A DB trigger on auth.users auto-inserts a public.users row with role=
  // 'sales'. Upsert by id to overwrite with the requested role and ensure
  // is_owner stays false regardless of what the requester passed in.
  const { error: profErr } = await admin.from('users').upsert({
    id: created.user.id,
    email,
    full_name: fullName,
    role,
    active: true,
    is_owner: false,
  }, { onConflict: 'id' });
  if (profErr) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return respond(500, { error: 'Profile upsert failed: ' + profErr.message });
  }

  await admin.from('activity_log').insert({
    entity_type: 'user',
    entity_id: created.user.id,
    actor_id: profile.id,
    event_type: 'user_created',
    payload: { email, role, full_name: fullName },
  });

  return respond(200, {
    user: { id: created.user.id, email, full_name: fullName, role },
    temp_password: passwordIn ? null : tempPassword,
  });
};
