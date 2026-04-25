# Google Ads Campaign Brief — Toro Movers

A ready-to-implement Google Ads campaign structure built around the 5 personas in `personas.md`. Designed for Google Ads, optimized for the existing GA4 + conversion tracking already shipping in production.

**GA4 Property:** `502571172`
**GA4 Measurement ID:** `G-1L9NR2HTRT`
**Stream:** Web (toromovers.net)

---

## Account-level setup (do these once before launching)

### 1. Link Google Ads to GA4
**Google Ads → Tools → Linked accounts → Google Analytics (GA4)** → Link the toromovers.net property. This pulls GA4 conversions and audiences into Google Ads.

### 2. Mark `Lead` as a Conversion in GA4
**GA4 → Admin → Events → toggle "Lead" as a Key event (formerly Conversion)** so it imports cleanly into Google Ads. Repeat for `Contact` and `ViewContent` if you want secondary conversions.

### 3. Import GA4 conversions into Google Ads
**Google Ads → Tools → Conversions → Create from GA4** → import:
- `Lead` (primary — bid optimization)
- `Contact` (secondary — observation)
- `ViewContent` (secondary — observation)

### 4. Set up Conversion Value rules
**Conversions → Conversion Value rules** → Set Lead value to:
- $40 average per lead (industry benchmark for moving — adjust after 30 days of data)
- Or use dynamic value if your booking system passes deal size back

### 5. Create Audiences in GA4 → import to Google Ads
**GA4 → Admin → Audiences:**
- **TM-City-Page-Visitors** — Users who viewed any `/orlando-movers`, `/kissimmee-movers`, etc.
- **TM-Form-Abandoners** — Users who reached `/orlando-movers` but did NOT trigger `Lead` event
- **TM-Lead-Submitters** — Users who triggered `Lead`
- **TM-High-Intent** — Users who triggered `ViewContent` AND scrolled to `#book` section

These will appear in Google Ads as observation/targeting audiences within ~24 hours.

---

## Campaign structure overview

**5 Search campaigns + 1 Performance Max campaign**, each tied to one persona. Search is the primary channel (high intent), PMax is for the long tail across YouTube, Display, Discover, and Maps.

| # | Campaign Type | Persona | Daily Budget | Match Type |
|---|---|---|---|---|
| 1 | Search | DIY Danielle | $30-50 | Exact + Phrase |
| 2 | Search | Relocation Rachel | $40-70 | Exact + Phrase |
| 3 | Search | Family Frank | $50-100 | Exact + Phrase |
| 4 | Search | Downsizing Dolores | $40-80 | Phrase + Broad (with negatives) |
| 5 | Search | Vacation-Rental Vanessa | $30-60 | Exact + Phrase |
| 6 | Performance Max | All personas (lookalike retargeting) | $50-100 | n/a |

**Bidding strategy:** Start every campaign on **Maximize Conversions** for 2 weeks to gather data. After 30 conversions per campaign, switch to **Target CPA** at the rate that worked.

---

## Campaign 1 — DIY Danielle (Search)

### Settings
- **Campaign type:** Search
- **Networks:** Google Search Network only (no Search Partners, no Display)
- **Locations:** Orlando, FL — 25 mile radius around 32801
- **Languages:** English
- **Bidding:** Maximize Conversions → switch to Target CPA $30 after 30 conversions
- **Schedule:** All day, all week (movers get queries on weekends and evenings)

### Ad Groups

#### Ad Group 1: Labor-Only Keywords
**Keywords (exact match):**
- `[labor only movers orlando]`
- `[loading help orlando]`
- `[movers to load uhaul]`
- `[load my truck orlando]`
- `[muscle for hire orlando]`

**Keywords (phrase match):**
- `"labor only movers orlando"`
- `"loading help"`
- `"orlando moving help"`
- `"load uhaul"`

**Negatives (campaign-level):**
- `free`, `volunteer`, `craigslist`, `gumtree`, `task rabbit`, `taskrabbit`

#### Ad Group 2: Cheap Movers Keywords
**Keywords (phrase match):**
- `"cheap movers orlando"`
- `"affordable movers orlando"`
- `"budget movers orlando"`
- `"$75 movers orlando"`

**Negatives:**
- `free`, `volunteer`

### Ad Copy (Responsive Search Ad — write 15 headlines, 4 descriptions)

**Headlines (15 — Google rotates):**
1. $300 — 2 Movers, 2 Hours
2. Loading Help Orlando — $75/Hr
3. We Load Your U-Haul Fast
4. Strong, Insured Movers Orlando
5. Family-Owned Moving Help
6. Same-Week Loading Help
7. No Hidden Fees — Ever
8. Licensed & Insured Florida
9. 4.9★ Google Reviews
10. Free Quote in 60 Seconds
11. Real Prices on the Page
12. (689) 600-2720
13. Honest Hourly Pricing
14. 2-Mover Crew, $75/hour
15. Reserve Your Move Today

**Descriptions (4):**
1. Family-owned, licensed, and insured. We load your rented truck — you drive. $75 per mover, per hour. 2-hour minimum. Same-week scheduling.
2. Strong, insured movers in Orlando. No fuel fees, no stair fees, no surprises. The number you book is the number you pay.
3. 4.9★ Google rating from 29 real Orlando customers. Free quote in 60 seconds. Call (689) 600-2720.
4. We bring dollies, blankets, straps, and the muscle. You bring the truck. Same fair hourly rate every job.

**Final URL:** `https://toromovers.net/orlando-movers?utm_source=google&utm_medium=cpc&utm_campaign=tm-danielle&utm_content={creative}&utm_term={keyword}`

**Sitelink Extensions (use all 6 slots):**
- "See $75/Hour Pricing" → `/orlando-movers#calculator`
- "Read 29 Reviews" → `/orlando-movers#reviews`
- "Get a Free Quote" → `/orlando-movers#book`
- "How It Works" → `/orlando-movers#packages`
- "Service Areas" → `/orlando-movers#area`
- "FAQ" → `/orlando-movers#faq`

**Call Extensions:** `(689) 600-2720` — call-only on mobile
**Location Extensions:** Linked via Google Business Profile
**Callout Extensions:** "Licensed & Insured", "Family-Owned", "Same-Week Available", "No Hidden Fees", "Free Quotes"
**Structured Snippets:** Service catalog: Loading, Unloading, Furniture Wrapping, Same-Week Service

---

## Campaign 2 — Relocation Rachel (Search)

### Settings
- **Locations:** Lake Mary (32746), Sanford (32771), Winter Park (32789), Oviedo (32765), Winter Springs (32708), Altamonte Springs (32701) — each as separate location target with bid adjustments
- **Bidding:** Maximize Conversions → Target CPA $50

### Ad Groups

#### Ad Group 1: City + Movers Keywords
**Keywords (exact + phrase):**
- `[lake mary movers]`, `"lake mary movers"`
- `[sanford movers fl]`, `"sanford fl movers"`
- `[winter park movers]`, `"winter park movers"`
- `[oviedo movers]`, `"oviedo movers"`
- `[movers winter springs]`, `"movers winter springs fl"`
- `[altamonte springs movers]`, `"altamonte springs movers"`

#### Ad Group 2: Apartment Move Keywords
**Keywords (phrase):**
- `"1 bedroom movers"`
- `"2 bedroom movers orlando"`
- `"small move orlando"`
- `"apartment movers orlando"`

### Ad Copy

**Headlines:**
1. $875 — Truck Included
2. Honest Movers, No Surprises
3. We Bring the Truck
4. Family-Owned in [LOC]
5. 1-2 BR Move Specialists
6. Licensed & Insured FL
7. 4.9★ — 29 Reviews
8. Same-Week Scheduling
9. No Hidden Fees Ever
10. Lake Mary Movers
11. Free Quote — 60 Sec
12. (689) 600-2720

**Descriptions:**
1. Two movers, four hours, our truck — $875 flat. Loading, drive, unloading. No fuel fees, no surprises. Family-owned in Central Florida.
2. The number you book is the number you pay. Licensed and insured. 4.9★ from real Lake Mary, Sanford, and Winter Park customers.

**Landing pages (one per geo, dynamically swapped via Ad Customizers):**
- `https://toromovers.net/lake-mary-movers`
- `https://toromovers.net/sanford-movers`
- `https://toromovers.net/oviedo-movers`
- `https://toromovers.net/winter-park-movers`
- `https://toromovers.net/winter-springs-movers`
- `https://toromovers.net/altamonte-springs-movers`

---

## Campaign 3 — Family Frank (Search)

### Settings
- **Locations:** Maitland (32751), Winter Park (32789), Lake Mary (32746), Heathrow (32746), Windermere (34786), Ocoee (34761), Apopka (32703), Winter Garden (34787), Oviedo (32765)
- **Bidding:** Maximize Conversions → Target CPA $80
- **Audience:** Layer in GA4 imported audiences as **observation only** initially (TM-Family-Frank lookalike if available)

### Ad Groups

#### Ad Group 1: Full-Service Family Move Keywords
**Keywords (exact + phrase):**
- `[full service movers orlando]`
- `[movers and packers orlando]`
- `[professional movers winter park]`
- `[family movers central florida]`
- `[3 bedroom movers orlando]`
- `"best movers winter park"`
- `"licensed insured movers orlando"`
- `"professional moving company maitland"`

#### Ad Group 2: Packing Service Keywords
**Keywords (phrase):**
- `"packing services orlando"`
- `"movers and packers"`
- `"orlando packing service"`

### Ad Copy

**Headlines:**
1. Family-Owned Movers Orlando
2. Packing, Loading & Unloading
3. Trusted by Orlando Families
4. 4.9★ — 29 Real Reviews
5. Licensed & Insured Florida
6. Same Crew, Honest Price
7. Big Move? Same Hourly Rate
8. We Handle Pianos & Antiques
9. No Nickel-and-Diming
10. Free On-Site Quote Available
11. (689) 600-2720
12. Free Quote in 60 Seconds

**Descriptions:**
1. Family-owned movers handling family-sized moves. Packing, loading, driving, unloading — one fair hourly rate. No surprise fees on closing day.
2. Same crew you book is the one who shows up. Licensed and insured in Florida. We treat your family's stuff like our own.

**Landing pages:** `/maitland-movers`, `/winter-park-movers`, `/lake-mary-movers`, `/windermere-movers`

---

## Campaign 4 — Downsizing Dolores (Search)

### Settings
- **Locations:** The Villages (32162, 32163), Heathrow (32746), Winter Park (32789), Maitland (32751), Clermont (34711), Sanford (32771)
- **Bidding:** Maximize Conversions → Target CPA $80
- **Schedule:** Bid up 20% on weekday mornings 9am-1pm (when seniors search most)
- **Device adjustments:** Bid up 20% on tablet (this demo uses tablets a lot)

### Ad Groups

#### Ad Group 1: Senior Moving Keywords
**Keywords:**
- `[senior moving services orlando]`
- `[senior movers central florida]`
- `[downsizing movers orlando]`
- `"downsizing services florida"`
- `"senior friendly movers"`
- `"movers for elderly orlando"`

#### Ad Group 2: The Villages Keywords
**Keywords:**
- `[movers the villages florida]`
- `[the villages moving company]`
- `"the villages fl movers"`

#### Ad Group 3: Adult Children Keywords
**Keywords:**
- `[movers for elderly parent florida]`
- `"help parents move florida"`
- `"downsizing services for parents"`
- `"movers for senior parents orlando"`

### Ad Copy

**Headlines:**
1. Patient, Family-Owned Movers
2. Senior Moving — Done Right
3. Downsizing With Respect
4. The Villages Movers
5. Antiques Handled With Care
6. Same Crew, Same Rate, No Rush
7. Long-Distance Senior Moves
8. 4.9★ — Real Reviews
9. Licensed & Insured Florida
10. Call (689) 600-2720
11. Honest Pricing, No Surprises
12. Family-Owned Since Day One

**Descriptions:**
1. We treat your home of 40 years with the respect it deserves. Patient crews. Honest prices. Same family on every move. Call us — we'll talk it through.
2. Florida-licensed and fully insured. We've moved generations of family pieces without a scratch. No rush, no upsell, no surprises.

**Landing pages:** `/the-villages-movers`, `/winter-park-movers`, `/clermont-movers`, `/lake-mary-movers`, `/sanford-movers`

**Call Extension prominent — this demo prefers phone over forms.**

---

## Campaign 5 — Vacation-Rental Vanessa (Search)

### Settings
- **Locations:** **Outside Florida** — Northeast US, Toronto, UK + observation on FL (in case a property manager searches)
- **Bidding:** Maximize Conversions → Target CPA $120 (this is a high-value conversion — recurring revenue)
- **Schedule:** Bid up 25% on weekday business hours

### Ad Groups

#### Ad Group 1: Vacation Rental Keywords
**Keywords:**
- `[vacation rental movers davenport]`
- `[airbnb furniture movers orlando]`
- `[champions gate moving company]`
- `[short term rental movers florida]`
- `"vacation home turnover service"`
- `"solterra resort movers"`
- `"reunion resort movers"`

### Ad Copy

**Headlines:**
1. Vacation Home Turnovers FL
2. ChampionsGate Furniture Moves
3. Solterra Resort Turnover
4. Photos Sent to Your Phone
5. Disney Corridor Movers
6. We Coordinate With Your Cleaners
7. Out-of-State Owner? We've Got It
8. $75/Mover/Hour Honest Pricing
9. Gate Access Handled
10. Licensed & Insured Florida
11. Reunion Resort Specialists
12. Get Custom Turnover Quote

**Descriptions:**
1. Out of state? We handle your Disney-corridor vacation rental turnover end to end. Photos sent before, during, after. Coordinated with your cleaning crew.
2. ChampionsGate, Solterra, Reunion, Windsor Hills. We know the gate codes, the COIs, the access workflows. Same-week scheduling. $75 per mover, per hour.

**Landing pages:** `/davenport-movers` (primary), `/kissimmee-movers` (secondary)

---

## Campaign 6 — Performance Max (cross-channel)

After Search campaigns are running for 2 weeks and producing 50+ conversions:

### Settings
- **Type:** Performance Max
- **Goal:** Lead generation
- **Budget:** $50-100/day to start
- **Locations:** Florida (statewide) + key out-of-state for Vanessa
- **Audience signals:** Use the imported GA4 audiences (TM-City-Page-Visitors, TM-Lead-Submitters as a seed)

### Asset Groups
Create one asset group per persona using the same headlines, descriptions, and creative from the Search campaigns.

**Why PMax matters:** It runs your ads across YouTube, Display, Discover, Gmail, Maps, and Search — finding conversions in inventory you'd never bid on manually. It's a great complement to the focused Search campaigns.

---

## Negative keywords (campaign-level for ALL campaigns)

Add these as a negative keyword list and apply to every campaign:

**Job seekers / DIY content:**
- `jobs`, `careers`, `hiring`, `salary`, `how much do movers make`, `mover job`

**Free / barter:**
- `free`, `volunteer`, `craigslist`, `taskrabbit`, `task rabbit`

**Storage-only / rental-only:**
- `pods`, `storage unit rental`, `truck rental`, `uhaul rental`, `budget truck`

**Wrong intent:**
- `mover refrigerator how to`, `move single item diy`, `furniture assembly only`

**Wrong location (if applicable):**
- `kentucky`, `kissimmee park`, `miami`, `tampa` (unless targeting long-distance)

---

## UTM parameter convention

Every Google Ads URL should include:
```
?utm_source=google&utm_medium=cpc&utm_campaign={campaign_name}&utm_content={creative}&utm_term={keyword}
```

Use Google Ads' auto-tagging (`gclid`) AND manual UTM parameters together. Auto-tagging gives you the best Google Ads → GA4 attribution; UTMs give you backup for any platform that doesn't read gclid.

---

## KPIs (in priority order)

| Metric | Target | Why |
|---|---|---|
| **CPA (Cost Per Lead)** | <$40 Danielle, <$60 Rachel, <$80 Frank, <$80 Dolores, <$120 Vanessa | Primary success metric |
| **Conversion Rate** | >5% (form submits / clicks) | Tells you if landing page is working |
| **CTR** | >5% on Exact match, >3% on Phrase | Tells you if ads are relevant |
| **Quality Score** | >7/10 average | Lowers CPC and improves ad rank |
| **Impression Share** | >40% on key terms | Tells you if budget can scale |
| **Wasted Spend** | <10% on irrelevant search terms | Tells you if negatives are working |

---

## Weekly review checklist

- [ ] Review **Search Terms report** — add irrelevant queries as negatives
- [ ] Pause keywords with CPA above 1.5x target
- [ ] Check **Quality Score** for any keyword below 5/10 — fix landing page or ad copy
- [ ] Review **Auction Insights** to see new competitors
- [ ] Review **Device performance** — adjust mobile/desktop bid modifiers
- [ ] Refresh ad copy if CTR dropped below baseline by 20%

---

## Common mistakes to avoid

1. **Don't run Broad Match without strict negatives** — wastes budget on irrelevant queries
2. **Don't optimize for Clicks** — always optimize for Conversions
3. **Don't disable Auto-Tagging** — needed for Google Ads → GA4 attribution
4. **Don't run Display Network with Search campaigns** — keep them separate
5. **Don't kill ads after 1-2 days** — give Google's algorithm 3-7 days to learn
6. **Don't forget to layer GA4 audiences** — even as observation only, they help the algorithm learn
7. **Don't use sitelinks that go to homepage** — always deep-link to relevant page sections

---

## Recommended starting budget

**Conservative start (first 2 weeks):**
- Total daily: $200
- Frank: $60, Rachel: $50, Danielle: $40, Dolores: $30, Vanessa: $20

**Mid-month (after 30+ conversions per campaign):**
- Switch from Maximize Conversions to Target CPA
- Scale up winners by 30%/week until performance breaks
- Add Performance Max campaign

**Steady state:**
- Total daily: $300-600
- Distribution based on actual CPA performance

---

*Last updated: 2026-04-09*
*Companion docs: `personas.md`, `ads-meta.md`, `analytics-dashboard.md`*
