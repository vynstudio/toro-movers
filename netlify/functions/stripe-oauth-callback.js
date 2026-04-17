// Stripe Connect Standard OAuth callback.
//
// Registered redirect URI in the Vyn Studio Stripe platform's Connect
// OAuth settings:
//   https://toromovers.net/.netlify/functions/stripe-oauth-callback
//
// Flow: client (Oh My Grill, Stael, etc.) clicks a Connect OAuth URL
// that includes Vyn Studio's Platform Client ID. They approve in their
// own Stripe dashboard. Stripe redirects the browser here with
// ?code=<AUTHORIZATION_CODE>&state=<OPTIONAL>. This function exchanges
// the code for the connected account's acct_xxx id and displays it on
// the response page so we can wire it into the per-client code + env
// vars manually.
//
// Env vars required (on this Toro Netlify site):
//   STRIPE_PLATFORM_SECRET_KEY
//     — Vyn Studio platform live secret key (sk_live_...). Used to
//       authenticate the token-exchange call.
//
// After each client's OAuth completes, save their returned acct_xxx
// somewhere safe (e.g. the per-site Netlify env as
// OMG_CONNECTED_ACCOUNT_ID or STAEL_CONNECTED_ACCOUNT_ID).

const PLATFORM_SECRET = process.env.STRIPE_PLATFORM_SECRET_KEY;
const TOKEN_URL = 'https://connect.stripe.com/oauth/token';

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const htmlPage = (title, body) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0e27;color:#fff;min-height:100vh;padding:40px 24px;line-height:1.6}main{max-width:720px;margin:0 auto}h1{font-size:1.6rem;margin-bottom:20px;letter-spacing:-.01em}code{display:block;background:#060922;border:1px solid #2a3160;padding:14px;border-radius:10px;font-family:ui-monospace,Menlo,monospace;font-size:13px;word-break:break-all;color:#61dafb;margin:10px 0 24px}p{margin-bottom:14px;color:rgba(255,255,255,.82)}ol{padding-left:22px;color:rgba(255,255,255,.82)}li{margin-bottom:10px}.ok{color:#4ade80}.err{color:#f87171;background:#2a0e10;padding:16px;border-radius:10px;border-left:3px solid #f87171}strong{color:#fff}</style></head><body><main>${body}</main></body></html>`;

exports.handler = async (event) => {
  if (!PLATFORM_SECRET) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: htmlPage(
        'Stripe OAuth callback misconfigured',
        `<h1>Not configured</h1><p class="err">Missing <code>STRIPE_PLATFORM_SECRET_KEY</code> env var. Set Vyn Studio's live secret key (sk_live_...) in Netlify → Site settings → Environment variables and redeploy.</p>`
      ),
    };
  }

  const qs = event.queryStringParameters || {};
  const { code, error, error_description, state } = qs;

  if (error) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: htmlPage(
        'Stripe authorization denied',
        `<h1>Authorization denied</h1><p class="err">Stripe returned <strong>${escapeHtml(error)}</strong>${error_description ? ': ' + escapeHtml(error_description) : ''}. Start the flow again from the authorize link.</p>`
      ),
    };
  }

  if (!code) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: htmlPage(
        'Stripe callback — waiting for code',
        `<h1>No authorization code</h1><p>This endpoint is reached after clicking <strong>Approve</strong> on the Stripe Connect onboarding screen. If you landed here directly, start from the OAuth link instead.</p>`
      ),
    };
  }

  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_secret: PLATFORM_SECRET,
      }).toString(),
    });
    const data = await res.json();

    if (!res.ok) {
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'text/html' },
        body: htmlPage(
          'Token exchange failed',
          `<h1>Token exchange failed</h1><p class="err">Status ${res.status}</p><code>${escapeHtml(JSON.stringify(data, null, 2))}</code>`
        ),
      };
    }

    const connectedAccountId = data.stripe_user_id;
    const scope = data.scope || '';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: htmlPage(
        'Stripe Connect — connected',
        `<h1 class="ok">Connected successfully</h1>
<p>The client's existing Stripe account is now linked to Vyn Studio as a Standard connected account. Save the <strong>connected account ID</strong> below — this is what gets passed to <code>stripe_account</code> in charge calls.</p>
<p><strong>Connected account ID:</strong></p>
<code>${escapeHtml(connectedAccountId)}</code>
<p><strong>Scope:</strong> ${escapeHtml(scope)}</p>
${state ? `<p><strong>State param:</strong> ${escapeHtml(state)}</p>` : ''}
<ol>
  <li>Copy the <code>acct_xxx</code> above.</li>
  <li>Tell Claude which client this is (Oh My Grill? Stael?) so the right <code>create-payment-intent.js</code> gets wired to route charges to this account with the correct application-fee percentage.</li>
</ol>`
      ),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'text/html' },
      body: htmlPage(
        'Callback error',
        `<h1>Network error during token exchange</h1><p class="err">${escapeHtml(String(err))}</p>`
      ),
    };
  }
};
