# Toro Movers · HubSpot Nurture Sequence

**Audience**: Leads who submitted the calculator / hero quick-form / bottom booking form but did NOT complete a Stripe deposit within 24 hours.

**Goal**: Convert warm leads who stalled. Move them from "got a quote" to "paid a deposit."

**Cadence**: Day 1 (within 24h), Day 3, Day 7.

---

## Email 1 — Day 1 (within 24h of lead submission)

### Subject lines (A/B)
- A: "Your Toro Movers quote — let's lock it in"
- B: "{{contact.firstname}}, here's your moving quote (and next step)"

### Preview text
"Transparent pricing, same-day booking, $50–$125 refundable deposit."

### Body (HTML — paste into HubSpot's rich-text editor)

```html
<p>Hi {{contact.firstname|default:"there"}},</p>

<p>Thanks for requesting a quote from Toro Movers. Your estimate is locked in
at the rate we quoted — no surprise fees, no fuel surcharges, no stairs charges.</p>

<p><strong>To hold your date</strong>, we take a small refundable deposit:</p>

<ul>
  <li>$50 for loading-only jobs</li>
  <li>$125 for moves that include our truck</li>
</ul>

<p>The balance is paid after the job by card, Cash App, or Zelle.</p>

<p style="margin: 24px 0;">
  <a href="https://toromovers.net/#packages"
     style="display: inline-block; padding: 14px 28px; background: #C8102E; color: #fff;
            border-radius: 999px; font-weight: 700; text-decoration: none;">
    Reserve my date →
  </a>
</p>

<p><strong>Why customers choose us:</strong></p>
<ul>
  <li>Insured in Florida</li>
  <li>$75 per mover per hour — the number you see is the number you pay</li>
  <li>Family-owned, same crew every time (no call centers, no day labor)</li>
  <li>Top-rated on Google</li>
</ul>

<p>Questions? Reply to this email or call us at <a href="tel:6896002720">(689) 600-2720</a>.</p>

<p>— The Toro Movers family</p>
```

### Send rule
Trigger: 24 hours after lead created AND lead.status = "new" or "contacted" (no booking).

---

## Email 2 — Day 3

### Subject lines (A/B)
- A: "Still moving? Here's what families ask us most"
- B: "Common questions before booking a move"

### Preview text
"Answers to the questions most customers have before locking in their date."

### Body

```html
<p>Hi {{contact.firstname|default:"there"}},</p>

<p>A few days ago you asked us for a moving quote. Most people in your shoes have
one of these questions before they pull the trigger — here are honest answers
from the family that actually does the work:</p>

<table cellpadding="0" cellspacing="0" style="width: 100%; margin: 16px 0;">
  <tr>
    <td style="padding: 16px; background: #fafafa; border-left: 3px solid #C8102E; border-radius: 8px; margin-bottom: 12px;">
      <strong style="display: block; margin-bottom: 4px;">What if the move takes longer than estimated?</strong>
      <span>$75 per mover per hour after the 2-hour minimum. No rebooking. No surprise fees.</span>
    </td>
  </tr>
</table>

<table cellpadding="0" cellspacing="0" style="width: 100%; margin: 12px 0;">
  <tr>
    <td style="padding: 16px; background: #fafafa; border-left: 3px solid #C8102E; border-radius: 8px;">
      <strong style="display: block; margin-bottom: 4px;">What if you damage something?</strong>
      <span>We're fully insured. Crews wrap everything before lifting. Claims resolved directly.</span>
    </td>
  </tr>
</table>

<table cellpadding="0" cellspacing="0" style="width: 100%; margin: 12px 0;">
  <tr>
    <td style="padding: 16px; background: #fafafa; border-left: 3px solid #C8102E; border-radius: 8px;">
      <strong style="display: block; margin-bottom: 4px;">Can I cancel or reschedule?</strong>
      <span>Yes — deposit is refundable with 24-hour notice. No penalty for legitimate changes.</span>
    </td>
  </tr>
</table>

<table cellpadding="0" cellspacing="0" style="width: 100%; margin: 12px 0;">
  <tr>
    <td style="padding: 16px; background: #fafafa; border-left: 3px solid #C8102E; border-radius: 8px;">
      <strong style="display: block; margin-bottom: 4px;">Are there stairs/elevator fees?</strong>
      <span>Never. Same hourly rate regardless of floor or access.</span>
    </td>
  </tr>
</table>

<p style="margin: 24px 0;">
  <a href="https://toromovers.net/#packages"
     style="display: inline-block; padding: 14px 28px; background: #C8102E; color: #fff;
            border-radius: 999px; font-weight: 700; text-decoration: none;">
    Reserve my date →
  </a>
</p>

<p>Or call us directly at <a href="tel:6896002720">(689) 600-2720</a>.</p>

<p>— The Toro Movers family</p>
```

### Send rule
Trigger: 3 days after lead created AND lead.status != "booked" AND email_1_opened = true (optional filter: only send to engaged leads).

---

## Email 3 — Day 7 (final + referral hook)

### Subject lines (A/B)
- A: "$50 off — if you move with us (and tell a friend)"
- B: "Last note from Toro Movers — plus a $50 thank-you"

### Preview text
"A small thank-you for considering us, and something for sending a friend our way."

### Body

```html
<p>Hi {{contact.firstname|default:"there"}},</p>

<p>We won't keep bugging you — this is the last note from our side.</p>

<p>If you've already picked another mover: thanks for considering us. If you're
still comparing options, here's a small thank-you for giving Toro a look:</p>

<div style="background: #FFF1F3; border: 1px solid #ffd4da; border-radius: 12px; padding: 20px; margin: 20px 0; text-align: center;">
  <strong style="font-size: 18px; display: block; margin-bottom: 6px;">$50 off your move</strong>
  <span style="font-size: 14px; color: #3a3b40;">
    Book within 14 days and mention code
    <strong style="color: #C8102E;">RESERVED50</strong>
    when you call.
  </span>
</div>

<p>And if your move has already happened with someone else — we'd still love to
help a friend. <strong>Refer someone who books</strong> and we'll Venmo you $50
after their move completes. Just reply to this email with their name + phone
number and we'll take it from there.</p>

<p style="margin: 24px 0;">
  <a href="https://toromovers.net/#packages"
     style="display: inline-block; padding: 14px 28px; background: #C8102E; color: #fff;
            border-radius: 999px; font-weight: 700; text-decoration: none;">
    Reserve with code RESERVED50 →
  </a>
</p>

<p>Either way — thanks for considering us. We hope your move goes smoothly.</p>

<p>— The Toro Movers family<br>
<a href="tel:6896002720">(689) 600-2720</a> · <a href="mailto:hello@toromovers.net">hello@toromovers.net</a></p>
```

### Send rule
Trigger: 7 days after lead created AND lead.status != "booked" AND (email_2_opened = true OR email_1_clicked = true).
Do NOT send if contact has already booked (status = "booked" or "completed").

---

## HubSpot setup (quick-start)

### 1. Import leads
Leads currently live in Netlify Blobs (`_lib/leads.js`). Options:
- **Manual CSV export** — run `/.netlify/functions/crm?action=export&pw=CRM_PASSWORD` (if it exists; otherwise build a one-off export endpoint), import CSV to HubSpot.
- **Automated sync** — future Netlify function that posts new leads to HubSpot Contacts API. Requires `HUBSPOT_PRIVATE_APP_TOKEN` env var.

### 2. Contact properties to populate
Standard: `firstname`, `lastname`, `email`, `phone`
Custom: `move_date`, `move_size`, `move_service`, `move_when`, `neighborhood`, `source` (e.g. "city-lake-mary-hero")

### 3. Create the workflow
HubSpot → Automation → Workflows → Create → Contact-based.
Trigger: Contact property `lead_source` is any of your Toro source tags AND `lifecycle_stage` = Lead.
Add 3 email send actions with the delays (1d, 3d, 7d).
Add suppression branch: if `moving_booked` = true, exit workflow.

### 4. Brand setup (once)
HubSpot → Settings → Marketing → Email → Color + logo:
- Primary: `#C8102E` (Toro red)
- Logo: `https://toromovers.net/assets/img/toro-logo.svg`
- From name: "The Toro Movers family"
- From email: `hello@toromovers.net` (requires domain auth via SPF/DKIM records)

### 5. Track conversions
Add a HubSpot tracking pixel or use the `source=hubspot-email` URL tag on the "Reserve" CTA so you can attribute bookings back to the campaign.

---

## Copy notes
- Tone matches site: professional, transparent, family-owned.
- No review-count bragging (per your rule).
- Each email has ONE primary CTA (Reserve) + soft secondary (Call).
- Email 3 introduces urgency (RESERVED50 code, 14-day expiry) + a referral hook that doubles the value.
- All dollar amounts / service claims match site copy verbatim.
