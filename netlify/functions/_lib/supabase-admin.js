// Shared Supabase helpers for CRM v2 Netlify Functions.
//
// Env vars required:
//   SUPABASE_URL                — https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   — service_role JWT (server-only, bypasses RLS)
//
// Never expose the service role key to the browser.

const { createClient } = require('@supabase/supabase-js');

let adminCache = null;

function getAdminClient() {
  if (adminCache) return adminCache;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  adminCache = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return adminCache;
}

// Verify a Supabase session JWT from an `Authorization: Bearer <jwt>` header.
// Returns { user, profile } where `profile` is the row from public.users.
// Throws on missing/invalid/inactive.
async function verifyUserJWT(authHeader) {
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing bearer token');
  }
  const jwt = authHeader.slice('Bearer '.length).trim();
  if (!jwt) throw new Error('Empty bearer token');

  const admin = getAdminClient();
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) throw new Error('Invalid session');

  const { data: profile, error: profErr } = await admin
    .from('users')
    .select('id, email, role, active, is_owner')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profErr) throw new Error('Role lookup failed: ' + profErr.message);
  if (!profile) throw new Error('No profile row for user');
  if (profile.active === false) throw new Error('User inactive');

  return { user: data.user, profile };
}

module.exports = { getAdminClient, verifyUserJWT };
