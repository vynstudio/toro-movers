# Analytics Dashboard Setup — Toro Movers

A step-by-step guide to building a **Looker Studio dashboard** that tracks the marketing funnel for Toro Movers, integrating GA4, Google Ads, Meta Ads (via Windsor.ai), and Google Search Console into a single view.

**Time to set up:** 30-60 minutes
**Recurring cost:** $0 (Looker Studio is free; Windsor.ai connector for Meta is paid but already in Vyn Studio's workspace)

---

## What this dashboard answers

Once built, you'll be able to answer these questions in one place:

1. **How many leads did we get this week, and from where?** (by source/medium)
2. **Which city pages convert best?** (sessions vs. lead form submissions per page)
3. **Which persona campaigns are performing?** (cost per lead by campaign)
4. **What's the cost-per-lead trend over time?**
5. **Which Google search queries drive the most impressions but no clicks?** (GSC opportunity finder)
6. **Are paid leads cheaper than organic, or vice versa?**

---

## Prerequisites (do these first)

### 1. GA4 is collecting data
Already done. `G-1L9NR2HTRT` is firing on every page. Verify in **GA4 → Reports → Realtime** that you see your own pageview when you visit the site.

### 2. GA4 conversions are marked as Key Events
**GA4 → Admin → Events** → toggle `Lead`, `Contact`, `ViewContent` as **Key Events** (Google's new name for conversions).

These are already firing from `assets/js/tracking.js`. You just need to mark them as Key Events in the GA4 admin so they show up in reporting and Google Ads.

### 3. Google Search Console linked to GA4
**GA4 → Admin → Search Console links → Link**. Pick the toromovers.net property.

This unlocks GSC data inside GA4 and makes it available in Looker Studio without a separate connector.

### 4. Google Ads linked to GA4 (when ready)
Once you launch Google Ads campaigns: **GA4 → Admin → Google Ads links → Link**. Conversion data flows back automatically.

### 5. Windsor.ai connector for Meta Ads
The Vyn Studio workspace already has Windsor.ai access (per the user profile memory). You'll connect Meta Ads via Windsor.ai and pipe the data into Looker Studio.

If not already connected:
1. Go to `https://onboard.windsor.ai?datasource=facebook`
2. Log in to the Vyn Studio workspace (`hellovynstudioonline`)
3. Authorize Toro Movers' Meta ad account (`971361825561389`)
4. Confirm in Windsor.ai dashboard that the connector is "Active"

---

## Step 1 — Open Looker Studio

1. Go to **lookerstudio.google.com**
2. Sign in with the Google account that owns the GA4 property (the one that manages `502571172`)
3. Click **+ Create → Report** in the top-left

---

## Step 2 — Connect data sources

You'll add **4 data sources** to this report. Looker Studio lets you blend them later.

### Data Source 1: GA4

1. In the data picker, search for **Google Analytics**
2. Select the **Toro Movers** account → property `502571172` → web stream
3. Click **Add**

### Data Source 2: Google Search Console

1. **Add data → Search Console**
2. Select `https://toromovers.net/`
3. Choose the **Site Impression** table (not URL Impression — Site is faster and gives totals)
4. Click **Add**

### Data Source 3: Google Ads (after launch)

1. **Add data → Google Ads**
2. Authorize → select your manager account → choose the Toro Movers ad account
3. Click **Add**

### Data Source 4: Meta Ads via Windsor.ai

1. **Add data → search "Windsor"** → select **Windsor.ai Facebook Ads** connector
2. Authorize with the `hellovynstudioonline` account
3. Select the Toro Movers Meta ad account (`971361825561389`)
4. Click **Add**

---

## Step 3 — Build the dashboard pages

The dashboard has **5 pages** (tabs), one per question category. Build them in order — each one takes 5-10 min.

---

### Page 1: Overview (the "morning glance" page)

**Purpose:** A 30-second snapshot of how the marketing is performing today.

**Layout:** 4 scorecards across the top, 2 charts below.

**Scorecards:**
1. **Total Leads (last 7d)** — GA4 → metric: `Conversions`, filter: `Event name = Lead`
2. **Lead Conversion Rate (last 7d)** — GA4 → calculated field: `Conversions / Sessions * 100`
3. **Cost per Lead (last 7d)** — Blended: (Google Ads Cost + Meta Ads Cost) / Total Leads
4. **Total Marketing Spend (last 7d)** — Blended: Google Ads Cost + Meta Ads Cost

**Charts:**
- **Time series:** Daily leads over the last 30 days, broken down by source/medium
- **Bar chart:** Top 10 landing pages by conversion count

**Date range control:** Add a date picker at the top-right so you can switch between Today / 7 days / 30 days / Custom.

---

### Page 2: City Page Performance

**Purpose:** Which of the 20 city pages are converting? Where should you invest more content effort?

**Filter:** Page path contains `-movers` (this filters down to just the city landing pages)

**Tables:**
1. **City page leaderboard** — Columns:
   - Page path
   - Sessions
   - Conversions (Lead)
   - Conversion rate (Conversions / Sessions)
   - Average engagement time
2. Sort by Conversions descending

**Insights to look for:**
- Which city page has the highest conversion rate? Double down on its content style.
- Which has the lowest? Either improve content or pause ads pointing to it.
- Which has high traffic but low conversions? Landing page issue, not traffic issue.

---

### Page 3: Persona Campaign Performance

**Purpose:** Which of the 5 persona campaigns are profitable?

**Data:** Blend Google Ads + Meta Ads via campaign name pattern matching (`tm-*-danielle`, `tm-*-rachel`, etc.)

**Tables:**
1. **Cross-channel campaign performance** — Columns:
   - Persona (calculated from campaign name)
   - Channel (Google / Meta)
   - Spend
   - Impressions
   - Clicks
   - Leads
   - CPL (Cost Per Lead)
   - CTR
2. Sort by CPL ascending (cheapest leads first)

**Insights to look for:**
- Which persona has the lowest CPL? Scale that one up.
- Which persona has high spend but few leads? Pause and rebuild creative.
- Which channel works better for which persona? (Often Google for high-intent like Danielle, Meta for browsers like Frank.)

---

### Page 4: Search Console Opportunities

**Purpose:** What organic search queries are getting impressions but few clicks? Each one is a SEO opportunity.

**Data:** Google Search Console (Site Impression table)

**Charts:**
1. **Top 50 queries by impressions** — Columns:
   - Query
   - Impressions
   - Clicks
   - Average position
   - CTR
2. Sort by Impressions descending
3. Filter: Impressions > 50, Position > 5 (queries you rank for but not on page 1)

**Insights to look for:**
- Queries with high impressions and low CTR → improve title/meta for that page
- Queries you rank #5-15 for → 1-2 internal links can push them up
- Queries you rank for but don't have a dedicated page → opportunity for new content

---

### Page 5: Funnel Health

**Purpose:** Is the funnel actually working end-to-end?

**Funnel chart:**
1. **Step 1 — Sessions** (any traffic)
2. **Step 2 — ViewContent** (scrolled to packages section)
3. **Step 3 — Form Started** (any form interaction — requires GA4 enhanced measurement event)
4. **Step 4 — Lead** (form submitted)
5. **Step 5 — Phone Call** (Contact event with method=phone)

**Drop-off table:** For each step, show % drop from previous step.

**Insights to look for:**
- Big drop at Step 1→2: People aren't engaging. Hero or above-the-fold issue.
- Big drop at Step 2→3: People interested but form too scary. Form length issue.
- Big drop at Step 3→4: People starting form but not finishing. Form friction or trust issue.

---

## Step 4 — Set up alerts

### Email alerts for anomalies

Looker Studio doesn't have native alerts, but you can use **GA4 Insights** which run daily and email you anomalies:

**GA4 → Insights → Custom insights → Create new**

Suggested alerts:
1. **Lead conversion drop:** `Lead conversions today < 50% of 7-day average` → email
2. **Spike in 404s:** `404 page views today > 10` → email (catches broken links from ads)
3. **GA4 tag stops firing:** `Sessions today = 0` → email (catches deployment breakages)

---

## Step 5 — Share the dashboard

1. Click **Share** in the top-right of Looker Studio
2. Add the client email if they should see it (or keep private)
3. Set permission: **View** for the client, **Edit** for Vyn Studio team members
4. Copy the share link

**Tip:** Schedule the dashboard to auto-email a PDF snapshot weekly:
- **Schedule delivery → Weekly → Mondays 9am** → recipient: client + team
- Subject: "Toro Movers — Weekly Marketing Report"

---

## Bonus: Pre-built templates you can copy

If building from scratch feels heavy, these public Looker Studio templates are good starting points:

1. **Google's GA4 Default Template** — `lookerstudio.google.com → Templates → Acquisition Overview`
2. **Search Console Insights** — Built into GA4 once you link Search Console
3. **Windsor.ai's Free Templates** — `windsor.ai/templates` (search for "moving" or "local services")

Pick a template, copy it, then swap in your data sources.

---

## What "good" looks like after 30 days

If everything is working properly, after 30 days you should see:

| Metric | Healthy Range |
|---|---|
| Monthly leads | 30-100+ |
| Cost per lead (paid) | $30-80 |
| Organic traffic | 500-2000+ sessions/month |
| Top city page CVR | 4-8% |
| GSC impressions | 5,000-20,000+ |
| GSC clicks | 100-500+ |
| Average position (city pages) | 8-15 (improving over time) |

**Don't expect any of these on day 1.** Organic SEO takes 1-3 months to ripen. Paid ads start producing within days but need 1-2 weeks to optimize.

---

## What to do if something looks broken

### "Leads dropped to zero this week"
1. Check if the form is broken — submit a test booking yourself
2. Check Netlify Forms dashboard for spam blocking
3. Check tracking.js is loading on all pages (`curl https://toromovers.net/ | grep tracking.js`)
4. Check Meta Pixel Helper extension on the live site

### "Cost per lead jumped 3x this week"
1. Check Google Ads search terms report for irrelevant queries (add as negatives)
2. Check if a competitor started bidding on your terms (Auction Insights)
3. Check landing page didn't change in a way that hurt conversion rate

### "City page traffic is high but no conversions"
1. Check the form on that city page — is it loading?
2. Check the JS error console in Chrome DevTools
3. Check that the city page has the right `source-page` hidden field

### "GA4 reports look different from Google Ads reports"
This is normal — GA4 attributes by last non-direct click, Google Ads attributes by last paid click. Differences of 10-20% are expected. Differences of 50%+ usually mean a broken pixel or conversion event.

---

## Companion: Form lead routing (where do leads actually go?)

Right now the booking form (`/orlando-movers#book` and similar) submits to Netlify Forms. Leads land in:
1. **Netlify dashboard → Forms → booking** (always)
2. **Email notification to** `hello@toromovers.net` (if configured in Netlify Forms settings)

**Recommended next step:** Add a Zapier or Make.com webhook that:
1. Receives Netlify Forms webhook on new submission
2. Pushes lead to Google Sheet (for the dashboard data source)
3. Sends SMS to (321) 758-0094 for instant alerts
4. Optional: Adds lead to a CRM like HubSpot Free or GoHighLevel (we already use GHL for Soligo)

This is the natural next phase after analytics is set up.

---

*Last updated: 2026-04-09*
*Companion docs: `personas.md`, `ads-meta.md`, `ads-google.md`*
