# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack & commands

Static HTML site deployed to Netlify (`toromovers.net`) with Node 20 serverless functions. There is **no build step** — `[build]` runs `echo`. Edits to `*.html` and `assets/` are served directly.

- Local dev: `netlify dev` (proxies functions + static at `localhost:8888`)
- Function deps: `npm install` (root `package.json` — `@netlify/blobs`, `@supabase/supabase-js`, `stripe`, `resend`, `pdfkit`)
- Deploy: push to `main` → Netlify auto-deploys prod. Branch pushes get a deploy preview URL — that is the standard review gate (see `feedback_workflow.md` in user memory).
- No test suite. `npm test` is a stub.
- Supabase migrations (`db/*.sql`) are **applied by hand** through Supabase Dashboard → SQL Editor. They are idempotent (`if not exists` / `on conflict`).

## Architecture

### Two CRMs coexist — know which one you're editing

- **v1 (legacy, still wired up):** Netlify Blobs key/value store via `netlify/functions/_lib/leads.js`. UI at `/crm.html`. Used by `notify-callback.js`, `crm.js`, the Telegram action buttons in `telegram-callback.js`, and SMS/email sends. **All public form submissions still flow through v1.**
- **v2 (current direction):** Supabase Postgres. Schema in `db/001_init.sql` … `db/021_*.sql`. Helpers in `_lib/supabase-admin.js`, `_lib/crm-leads.js`. UI at `crm-v2.html`, served at `/crm` via a forced rewrite in `netlify.toml`.
- **Bridge:** `send-quote.js` (v1) calls `crm-leads.js` non-blocking so each public-form submission also writes a v2 customer + lead row. v1 writes are untouched. Don't remove the bridge without a plan to migrate the other v1 entry points.

### Password-gated endpoints share one secret

`CRM_PASSWORD` (env var) gates `crm`, `ads-audit`, `ads-campaign`, `ads-creative`, `ads-pause`, `resend-confirmation`. Pass via `x-crm-password` header or `?pw=` query. Same password everywhere — rotating it requires updating localStorage in any active CRM browser session.

### Functions layout

- `netlify/functions/*.js` — HTTP endpoints (booking, quote, CRM ops, Stripe webhook, Telegram callbacks, ads write API, etc.)
- `netlify/functions/_lib/` — shared modules; do not expose as endpoints. `sms.js` (OpenPhone/Quo), `emails.js` (Resend), `leads.js` (v1 Blobs), `crm-leads.js` (v1→v2 bridge), `supabase-admin.js`, `stripe-client.js`, `quote-flow.js`, `quote-template.js`, `rate-limit.js`, `crew.js`, `crm-notifications.js`, `crm-stripe.js`.
- **Scheduled functions** (cron in `netlify.toml`, not in code): `daily-report` (Meta ads → Telegram, 3×/day), `morning-briefing` (6am ET), `follow-up-reminder` (8am ET), `move-reminders` (every 30min — was 15min, see comment in `netlify.toml`), `vyn-bot-daily`.
- OpenPhone API still responds at `api.openphone.com` despite the Quo rebrand. SMS is wrapped in `_lib/sms.js`; called from `stripe-webhook.js` and `move-reminders.js` (not from `notify-callback.js`).

### City landing pages

~30 `<city>-movers.html` files share an identical structure (header, JSON-LD `MovingCompany` schema, hero, sticky CTA, footer) — only the city name and SEO copy differ. When editing the shared shell, change all of them. The phone number alone lives in **4 formats** (`(xxx) xxx-xxxx`, `+1-xxx-xxx-xxxx`, `+1xxxxxxxxxx`, `xxxxxxxxxx`) — search every format if changing it.

### Routing & SEO (`netlify.toml`)

- `.html`-stripping 301 makes pretty URLs canonical. `/crm` rewrites (200, `force=true`) to `/crm-v2.html` — without `force` the on-disk `crm.html` would win.
- Strategy docs in repo root (`ads-google.md`, `ads-meta.md`, `analytics-dashboard.md`, `brand-identity.md`, `personas.md`) and `proposals/*` are force-404'd. They stay in git for internal reference but must not be served. If you add another internal doc, add a matching 404 redirect.
- Many `/pages/cities/*.html` 301s exist for legacy Shopify URLs (Google Search Console export 2026-04-09). When a new city LP ships, add the matching `/pages/cities/<slug>.html` → `/<slug>` redirect so backlinks resolve in one hop.
- CSP allows `unsafe-inline` because `quote.html`, `lp.html`, `index.html` ship large inline `<style>`/`<script>` blocks. After CSP changes, manually load `/quote`, submit a lead, run a Stripe checkout, watch console.
- CRM paths (`/crm`, `/crm-v2.html`, `/crm-assets/*`) and `/message` carry `X-Robots-Tag: noindex`.

### Storage facts that aren't grep-able

- Netlify Blobs site ID is hard-coded in `_lib/leads.js` (`5d1b562a-...`) as a fallback when `NETLIFY_SITE_ID` env isn't set.
- Supabase service role key (`SUPABASE_SERVICE_ROLE_KEY`) is server-only — never reference it from `assets/js/` or any `*.html`.
- Meta Ads account: `act_971361825561389`. OpenPhone toll-free: `(888) 985-9070`, ID `PNV8SJRU6F`.

## House rules

- **Never push `main` without explicit approval.** Use a branch, push it, share the Netlify deploy preview URL, wait for the user to confirm. Production writes (Stripe, Meta ads, sending SMS/emails) need the same confirmation.
- **Don't run `netlify env:list --plain`** — it dumps every secret into the transcript. Use the masked default or `netlify env:get KEY`.
- Don't add a build step or framework. The site's value is that it's plain HTML and a non-developer can edit a city page directly.
- Schema.org JSON-LD is duplicated across every city LP. Update one, update all — there is no shared template at build time.
