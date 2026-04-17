// Jobber OAuth 2.0 callback.
//
// Registered callback URL in the Jobber app:
//   https://toromovers.net/.netlify/functions/jobber-oauth-callback
//
// One-time use: after you click "Authorize" from the Jobber app page,
// Jobber redirects the browser here with ?code=<AUTHORIZATION_CODE>.
// This function exchanges that short-lived code for a long-lived
// refresh_token + access_token and displays the refresh token on the
// response page so you can paste it into Netlify env vars as
// JOBBER_REFRESH_TOKEN.
//
// Env vars required:
//   JOBBER_CLIENT_ID      — from developer.getjobber.com app page
//   JOBBER_CLIENT_SECRET  — from developer.getjobber.com app page
//
// After refresh token is stored, this endpoint remains deployed (the
// registered callback URL must match), but is effectively dormant.

const CLIENT_ID = process.env.JOBBER_CLIENT_ID;
const CLIENT_SECRET = process.env.JOBBER_CLIENT_SECRET;
const TOKEN_URL = 'https://api.getjobber.com/api/oauth/token';
const REDIRECT_URI = 'https://toromovers.net/.netlify/functions/jobber-oauth-callback';

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const htmlPage = (title, body) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#1C1C1E;color:#fff;min-height:100vh;padding:40px 24px;line-height:1.6}main{max-width:720px;margin:0 auto}h1{font-size:1.6rem;margin-bottom:20px}code{display:block;background:#0f0f10;border:1px solid #3a3a3d;padding:14px;border-radius:10px;font-family:ui-monospace,Menlo,monospace;font-size:13px;word-break:break-all;color:#C8102E;margin:10px 0 24px}ol{padding-left:20px}li{margin-bottom:12px}.ok{color:#22c55e}.err{color:#ef4444;background:#2a0f10;padding:16px;border-radius:10px;border-left:3px solid #ef4444}</style></head><body><main>${body}</main></body></html>`;

exports.handler = async (event) => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: htmlPage(
        'Jobber callback misconfigured',
        `<h1>Jobber OAuth callback — not configured</h1><p class="err">Missing <code>JOBBER_CLIENT_ID</code> or <code>JOBBER_CLIENT_SECRET</code> env vars. Set them in Netlify → Site settings → Environment variables, then redeploy.</p>`
      ),
    };
  }

  const code = (event.queryStringParameters || {}).code;
  const error = (event.queryStringParameters || {}).error;

  if (error) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: htmlPage(
        'Jobber authorization denied',
        `<h1>Authorization denied</h1><p class="err">Jobber returned <code>${escapeHtml(error)}</code>. Try the authorize flow again from developer.getjobber.com.</p>`
      ),
    };
  }

  if (!code) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: htmlPage(
        'Jobber callback — waiting for code',
        `<h1>No authorization code</h1><p>This endpoint is reached after you click <strong>Authorize</strong> from the Jobber developer app page. Expected URL pattern:</p><code>${escapeHtml(REDIRECT_URI)}?code=...</code><p>Hit this page via the Jobber authorize flow, not directly.</p>`
      ),
    };
  }

  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
      }).toString(),
    });
    const data = await res.json();

    if (!res.ok) {
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'text/html' },
        body: htmlPage(
          'Jobber token exchange failed',
          `<h1>Token exchange failed</h1><p class="err">Status ${res.status}</p><code>${escapeHtml(JSON.stringify(data, null, 2))}</code>`
        ),
      };
    }

    const refresh = data.refresh_token || '(not returned)';
    const access = data.access_token || '(not returned)';
    const expiresIn = data.expires_in || 0;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: htmlPage(
        'Jobber OAuth complete',
        `<h1 class="ok">Authorization successful</h1>
<p>Copy the <strong>refresh token</strong> below and save it in Netlify → Site settings → Environment variables as <code>JOBBER_REFRESH_TOKEN</code>, then redeploy.</p>
<p><strong>Refresh token (keep secret):</strong></p>
<code>${escapeHtml(refresh)}</code>
<p>Access token (expires in ${expiresIn}s — not needed to save, the integration will refresh on demand):</p>
<code>${escapeHtml(access)}</code>
<ol>
  <li>Copy the refresh token above.</li>
  <li>Netlify → Site settings → Environment variables → Add <code>JOBBER_REFRESH_TOKEN</code>.</li>
  <li>Trigger a redeploy so Netlify functions pick up the new env var.</li>
  <li>Tell Claude — it will then wire <code>send-quote.js</code> to push new leads into Jobber.</li>
</ol>`
      ),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'text/html' },
      body: htmlPage(
        'Jobber callback error',
        `<h1>Network error during token exchange</h1><p class="err">${escapeHtml(String(err))}</p>`
      ),
    };
  }
};
