# Meta Ads Campaign Brief — Toro Movers

A ready-to-implement Meta Ads (Facebook + Instagram) campaign structure built around the 5 personas in `personas.md`. Designed for Meta Ads Manager, optimized for the existing pixel + CAPI tracking already shipping in production.

**Pixel ID:** `1637703184084307`
**CAPI:** Active via `/.netlify/functions/capi` (server-side dedupe by `event_id`)
**Conversion event:** `Lead` (form submission) — already firing on every booking
**Account ID:** `971361825561389`

---

## Account-level setup (do these once before launching campaigns)

### 1. Connect the Pixel to the Ad Account
Already done at the pixel level. Confirm in **Events Manager → Data Sources → Pixel `1637703184084307` → Settings → Data Sources** that the ad account is listed.

### 2. Set up Custom Conversions
In **Events Manager → Custom Conversions → Create**, build these:

| Custom Conversion | Source Event | Optimization |
|---|---|---|
| **TM-Lead-Form** | `Lead` (any URL contains `/thanks`) | Optimize for purchase value, value=1, currency USD |
| **TM-Contact-Phone** | `Contact` (custom_data.contact_method = "phone") | Optimize for events |
| **TM-View-Pricing** | `ViewContent` (custom_data.content_name = "packages") | Optimize for events |

### 3. Create Custom Audiences
**Audiences → Create Audience → Custom Audience:**

- **TM-Site-Visitors-30d** — Anyone who visited toromovers.net in the last 30 days
- **TM-Site-Visitors-90d** — Same, 90 days (for retargeting)
- **TM-Form-Starters** — Visited `/orlando-movers` OR any city page but did NOT visit `/thanks` (abandoners)
- **TM-Lead-Submitters** — Visited `/thanks` (excluded from cold campaigns to avoid wasting spend)

### 4. Create Lookalike Audiences (after 50+ form submits)
- **LAL 1% TM-Lead-Submitters** — Florida only
- **LAL 1-3% TM-Lead-Submitters** — Florida only

Don't create lookalikes until you have at least 50 conversions, ideally 100+. Until then, use cold targeting based on persona demographics.

---

## Campaign structure overview

**5 campaigns, one per persona.** Each campaign objective: **Sales / Conversions** (Meta's new "Sales" objective replaces the older "Conversions" objective). Optimization event: **TM-Lead-Form**.

| # | Campaign Name | Persona | Daily Budget | Geographic Focus |
|---|---|---|---|---|
| 1 | TM-Cold-Danielle-LaborOnly | DIY Danielle | $30-50 | Orlando 25mi radius |
| 2 | TM-Cold-Rachel-1to2BR | Relocation Rachel | $40-70 | Seminole/N. Orange counties |
| 3 | TM-Cold-Frank-FamilyMove | Family Frank | $50-100 | Affluent suburbs (see below) |
| 4 | TM-Cold-Dolores-Downsizing | Downsizing Dolores | $40-80 | Senior community ZIPs + adult-child lookalikes |
| 5 | TM-Cold-Vanessa-VR | Vacation-Rental Vanessa | $30-60 | Out-of-state targeting (NE US, Toronto, UK) |

**Total daily spend (recommended start):** $190-360/day. Scale up the campaigns that show CPA below $40 first.

---

## Campaign 1 — DIY Danielle (Labor-Only)

### Audience
- **Location:** Orlando, FL — 25 mile radius (centered on 32801)
- **Age:** 24-34
- **Gender:** All
- **Languages:** English
- **Detailed targeting:**
  - Behaviors → Mobile device users → Owns iPhone OR Owns Samsung
  - Demographics → Education → Bachelor's degree or higher
  - Interests → Apartment, U-Haul, Moving (event), Renting
- **Exclusions:**
  - TM-Lead-Submitters
  - Anyone over 35 (cleaner targeting)

### Placements
- **Auto Placements off.** Use:
  - Facebook Feed
  - Instagram Feed
  - Instagram Stories
  - Facebook Marketplace (cheap inventory)

### Creative

**Ad Set 1 — Image: $300 hook**
- Headline: **"$300. Two movers. Two hours. We do the heavy lifting."**
- Primary text: *"You drive the U-Haul. We handle the couch, the boxes, and the hauling. $75 per mover, per hour. 2-hour minimum. Same-week scheduling in Orlando. Licensed and insured."*
- Description: "Get a free quote in 60 seconds."
- CTA: **Get Quote**
- Image: Crew loading boxes into a U-Haul, $300 price overlay

**Ad Set 2 — Video: 15-sec testimonial**
- Headline: **"$300 — exactly what they quoted."**
- Primary text: *"Real review from a real Orlando customer: 'Two guys, two hours, $300 — exactly what they quoted. Zero surprises.'"*
- CTA: **Get Quote**
- Video: 15-sec talking-head testimonial OR text-on-image with the review

**Landing page:** `https://toromovers.net/orlando-movers?utm_source=meta&utm_medium=cpc&utm_campaign=tm-cold-danielle&utm_content={{ad.id}}`

---

## Campaign 2 — Relocation Rachel (1-2BR with Truck)

### Audience
- **Location:** Lake Mary, Sanford, Winter Park, Oviedo, Winter Springs, Altamonte Springs (each as separate geo)
- **Age:** 28-38
- **Gender:** All
- **Detailed targeting:**
  - Life events → Recently moved, Newly engaged
  - Demographics → Relationship → In a relationship OR Engaged
  - Interests → Apartment, Renting, Real estate
  - Job titles → Nurse, Teacher, Account manager, Office manager
- **Exclusions:**
  - TM-Lead-Submitters
  - Anyone outside FL

### Placements
- Facebook Feed
- Instagram Feed (visual content works for this demo)
- Instagram Stories
- Facebook In-Stream Video

### Creative

**Ad Set 1 — Image: "We bring the truck"**
- Headline: **"$875. We bring the truck. Two movers, four hours, zero surprises."**
- Primary text: *"Moving from your apartment to your next place? We handle the whole thing — load, drive, unload. No U-Haul to deal with. No hidden fees. The price you book is the price you pay."*
- CTA: **Get Quote**
- Image: Toro Movers truck loaded with furniture, family in foreground

**Ad Set 2 — Video: process walkthrough**
- Headline: **"From pickup to drop-off, one fair rate."**
- Primary text: *"Family-owned movers in [city]. Same crew, same hourly rate, no surprise fees. Get a free quote in 60 seconds."*
- CTA: **Get Quote**
- Video: 30-sec timelapse of a real move (loading → driving → unloading)

**Landing pages (rotate by city):**
- `https://toromovers.net/lake-mary-movers?utm_source=meta&utm_medium=cpc&utm_campaign=tm-cold-rachel-lakemary`
- `https://toromovers.net/sanford-movers?utm_source=meta&utm_medium=cpc&utm_campaign=tm-cold-rachel-sanford`
- `https://toromovers.net/oviedo-movers?utm_source=meta&utm_medium=cpc&utm_campaign=tm-cold-rachel-oviedo`
- (one ad set per city, dynamically split)

---

## Campaign 3 — Family Frank (3BR + Packing)

### Audience
- **Location:** Maitland, Winter Park, Lake Mary, Heathrow, Windermere, Ocoee, Apopka, Winter Garden (each as separate geo)
- **Age:** 35-50
- **Gender:** All (skews male decision-maker but target both)
- **Detailed targeting:**
  - Demographics → Married, Parents (Children: 0-12 years, 13-18 years)
  - Demographics → Household income → Top 25% of ZIP codes
  - Life events → Recently moved (1 year), Just bought a home
  - Interests → Real estate, Single-family detached homes, School parents
  - Behaviors → Frequent travelers (proxy for higher income)
- **Exclusions:**
  - TM-Lead-Submitters

### Placements
- Facebook Feed (primary — this demo uses FB more than IG)
- Instagram Feed
- Facebook Right Column (cheap inventory)

### Creative

**Ad Set 1 — Image: family-business angle**
- Headline: **"Family-owned movers for family-sized moves."**
- Primary text: *"Moving the kids, the dog, the piano, and 12 boxes of school stuff? Our family-owned crew handles it all — packing, loading, driving, unloading. One fair hourly rate. No nickel-and-diming."*
- CTA: **Get Quote**
- Image: The team-family-portrait.jpg (the current hero photo)

**Ad Set 2 — Image: trust signals**
- Headline: **"Licensed. Insured. 4.9★. Family-owned in Central Florida."**
- Primary text: *"You've heard the horror stories about national moving chains. We're not them. Family-owned in Orlando. Same crew you book is the one who shows up. $75 per mover, per hour. Get a free quote."*
- CTA: **Get Quote**
- Image: Trust badges + 4.9★ rating + family photo collage

**Ad Set 3 — Video: real move walkthrough**
- 30-sec video showing a real 3-bedroom move from start to finish

**Landing pages (rotate by city):**
- Best landing pages: `/maitland-movers`, `/winter-park-movers`, `/lake-mary-movers`, `/windermere-movers`

---

## Campaign 4 — Downsizing Dolores (Seniors + Adult Children)

This campaign has **two ad sets targeting different audiences**: Dolores herself, AND her adult children who are often the actual decision-maker.

### Ad Set 4A — Targeting Dolores directly

- **Location:** The Villages (32162, 32163), Heathrow (32746), Winter Park (32789), Maitland (32751), Clermont (34711), Sanford (32771)
- **Age:** 60-78
- **Gender:** All (skews female)
- **Detailed targeting:**
  - Life events → Anniversary within 30 days, Friends of recently relocated
  - Demographics → Empty nesters
  - Interests → Retirement, Senior living, Real estate, Estate sales
  - Behaviors → Owns home

**Creative:**
- Headline: **"Patient, family-owned movers who treat your home of 40 years with respect."**
- Primary text: *"You've lived in this house for decades. Every piece of furniture has meaning. Our family-owned crew takes the time to wrap, label, and handle your belongings the way they deserve. Same fair hourly rate. No rush. Call us — we'll talk it through."*
- CTA: **Call Now** (use Call Now CTA, not Get Quote — this demo prefers phone)
- Image: Crew carefully wrapping a piece of furniture

### Ad Set 4B — Targeting Adult Children of Seniors

- **Location:** Florida (statewide)
- **Age:** 35-55
- **Detailed targeting:**
  - Demographics → Has aging parents
  - Behaviors → Caregivers
  - Interests → Senior care, Estate planning, Aging parents
  - Custom: People interested in "downsizing parent home Florida"

**Creative:**
- Headline: **"Help your parents move out of their long-held home — with respect."**
- Primary text: *"If your mom or dad is downsizing, you know it's not just a move — it's a chapter closing. Our family-owned crew takes the time most movers don't. Patient, careful, honest pricing. We handle the move so you can focus on the family."*
- CTA: **Get Quote**
- Image: Adult child + parent in a home setting

**Landing pages:**
- `/the-villages-movers` for Villages residents
- `/winter-park-movers` for Winter Park (the "We handle history with care" angle)
- `/clermont-movers` for active-adult communities
- `/lake-mary-movers` for Heathrow patio homes

---

## Campaign 5 — Vacation-Rental Vanessa (Out-of-State Investors)

### Audience
- **Location:** **Outside Florida** — Northeast US (NY, NJ, PA, MA, CT), Toronto, UK
- **Age:** 30-50
- **Detailed targeting:**
  - Interests → Vacation rentals, Airbnb, BiggerPockets, Real estate investing, Disney, Walt Disney World
  - Behaviors → Frequent international travelers, Small business owners
  - Custom: People who follow Airbnb, Vrbo, BiggerPockets pages
- **Exclusions:**
  - Florida residents (anyone in-state)
  - TM-Lead-Submitters

### Placements
- Facebook Feed
- Facebook Marketplace
- Audience Network (cheap inventory)

### Creative

**Ad Set 1 — Image: photos-sent angle**
- Headline: **"Reliable vacation home turnovers in the Disney corridor."**
- Primary text: *"You own a vacation rental in ChampionsGate, Solterra, or Reunion. We handle furniture turnovers, deliveries, and disposal — coordinated with your cleaning crew, photo proof sent to your phone. Done by check-in. $75 per mover, per hour."*
- CTA: **Learn More**
- Image: Crew loading furniture into a vacation home setting

**Ad Set 2 — Image: gated community angle**
- Headline: **"We know the gate codes. ChampionsGate, Solterra, Windsor Hills."**
- Primary text: *"Out of state and need furniture moved into your Disney-area vacation rental? We coordinate with your cleaning crew, handle gate access and COIs, and send photos before/during/after. Same-week scheduling."*
- CTA: **Get Quote**
- Image: Gated community entrance + truck

**Landing pages:**
- `https://toromovers.net/davenport-movers?utm_source=meta&utm_medium=cpc&utm_campaign=tm-cold-vanessa-davenport`
- `https://toromovers.net/kissimmee-movers?utm_source=meta&utm_medium=cpc&utm_campaign=tm-cold-vanessa-kissimmee`

---

## Retargeting campaigns (after cold campaigns are running)

Once cold campaigns have ~2 weeks of data and 50+ leads, add these:

### TM-Retargeting-Form-Abandoners
- **Audience:** TM-Site-Visitors-30d EXCLUDE TM-Lead-Submitters
- **Daily budget:** $20-40
- **Creative:** "Still moving? We're still here. Get a free quote in 60 seconds. $75 per mover, per hour."
- **Landing page:** `/orlando-movers#book` (deep link straight to the form)

### TM-Retargeting-Reviewers
- **Audience:** Engaged with previous Toro Movers ads but didn't click
- **Daily budget:** $15-25
- **Creative:** Social proof — review compilation video, "29 5-star reviews"

---

## Tracking & measurement

### UTM parameter convention
Every Meta ad URL should include:
```
?utm_source=meta&utm_medium=cpc&utm_campaign={campaign_name}&utm_content={ad_id}
```

### Form attribution
The booking form has a hidden `source-page` field that captures which landing page the lead came from. Combined with UTM parameters, you can attribute every lead to:
- **Source persona** (campaign name)
- **Source landing page** (form hidden field)
- **Source ad** (utm_content)

### KPIs to watch (in this order)
1. **CPA (Cost Per Lead)** — Target: under $40 for Danielle/Rachel, under $80 for Frank/Dolores, under $120 for Vanessa
2. **CTR** — Target: above 1.5% for Feed placements
3. **Landing page conversion rate** — Target: above 5% (form submits / page visits)
4. **CPC** — Target: under $2 for cold, under $1 for retargeting
5. **ROAS** (once you tie revenue back) — Target: 4x minimum

### Weekly review checklist
- [ ] Pause ads with CPA above target after 3 days at scale
- [ ] Scale up ads with CPA below target by 20% per day until performance breaks
- [ ] Refresh creative every 2-3 weeks (Meta ad fatigue)
- [ ] Add new ad sets when conversion volume justifies

---

## Budget recommendations

**Conservative start (first 2 weeks):**
- Total daily: $150
- Split: Frank $50, Rachel $40, Danielle $30, Dolores $20, Vanessa $10
- Rationale: Frank and Rachel have the broadest TAM and clearest intent. Vanessa is harder targeting, start small.

**Mid-month adjustment (after 2 weeks of data):**
- Scale winners by 30%
- Pause campaigns with CPA above 1.5x target
- Reallocate to top performer

**Steady state (after 1 month):**
- Total daily: $300-500
- Distribution based on actual CPA performance, not initial guesses

---

## Common mistakes to avoid

1. **Don't optimize for clicks or impressions** — always optimize for `Lead` conversion event. CAPI dedupe is already in place.
2. **Don't run a single campaign with all 5 personas mixed** — Meta's algorithm needs distinct audiences to learn.
3. **Don't change too many things at once** — change one variable per ad set per week.
4. **Don't kill ads too fast** — give each ad set 3-5 days minimum before judging.
5. **Don't forget to install the pixel events** — they're already installed at the page level via tracking.js. Verify with Meta Pixel Helper extension before launching.
6. **Don't run cold campaigns to TM-Lead-Submitters** — wastes budget on already-converted users.

---

*Last updated: 2026-04-09*
*Companion docs: `personas.md`, `ads-google.md`, `analytics-dashboard.md`*
