# Garage Door PPC Decision Assistant

Practical Google Ads decision-support tool for Garage Door lead-gen accounts.

You upload Google Ads CSV reports, and the assistant tells you:

- what to do now,
- what to review before acting,
- what not to change yet,
- what can be scaled later,
- and how confident the system is.

The product is designed for non-expert operators, not just PPC specialists.

## Who This Is For

- Owner-operators and managers running local Garage Door PPC campaigns.
- Teams that need safe, practical guidance from CSV exports.
- Users who want a decision order, not a flat findings list.

## What The Tool Does

1. Accepts up to 7 Google Ads CSV report types in fixed upload slots.
2. Normalizes and validates each report against a canonical schema.
3. Runs rule analysis for waste, opportunities, control risks, and measurement risks.
4. Builds a decision layer above findings with confidence and prerequisites.
5. Renders a decision-first report in this order:
   - Step 1: Verify tracking trust
   - Step 2: Stop waste now
   - Step 3: Tighten control
   - Step 4: Improve ads/relevance/quality
   - Step 5: Scale winners carefully

## The 7 Report Files (And Why They Matter)

The upload slots are fixed in the UI. Upload order does not matter.

- Campaign: totals, winner/loser campaigns, impression share, budget/rank constraints
- Ad Group: group-level waste and structure issues
- Search Terms: negative keyword opportunities and intent quality
- Keywords: match type control, quality score, CTR/CPC/CPA efficiency
- Ads: ad-level quality signals (copy/relevance hints)
- Devices: device-specific waste/winner signals
- Location: geo-specific waste/winner signals

### Most Important Files

If you can only upload a subset, prioritize:

1. Campaign
2. Search Terms
3. Keywords
4. Ad Group

Ads, Devices, and Location are still useful and improve confidence/detail.

## Upload Behavior

- Upload order: does not matter.
- Slot mapping: does matter (each file must go in the correct slot).
- If a file appears to be uploaded in the wrong slot, the app warns you.
- If required columns are missing for a given file, that file is blocked from analysis.

## Business Context (Recommended)

The UI includes a lightweight business settings form.
These settings are saved locally in your browser and used in decision logic.

Supported settings:

- target CPL
- service area
- excluded services
- preferred lead type
- average deal value
- whether tracking is trusted
- whether offline conversions are imported
- optional note for what counts as a good lead

If context is missing, some recommendations are marked review-first instead of immediate action.

How to use this form well:

1. Fill at least target CPL, service area, tracking trust, and offline conversion status.
2. Add excluded services so negative-keyword guidance can be more specific.
3. Add preferred lead type / good lead note so you remember conversion count is not lead quality.
4. Save the form before clicking Analyze.

## Confidence Levels

Every decision has one of:

- High confidence
- Medium confidence
- Low confidence

Confidence is based on:

- available data volume
- presence/absence of relevant report types
- tracking trust state
- direct evidence vs inferred conclusion
- missing business context
- safety of immediate execution

## Confirmed vs Likely vs Unknown

The report explicitly separates:

- Confirmed from CSV data
- Likely but inferred
- Unknown from CSV alone

Examples of unknown/partial without external systems:

- lead quality
- close rate quality
- call quality
- full landing page quality context
- CRM accuracy
- offline conversion completeness (unless confirmed)

## Safe Usage Flow For Non-Experts

When you run an analysis:

1. Start with Account Status and Step 1.
2. If tracking trust is untrusted, fix measurement first.
3. Apply Do This Now actions (highest safety/priority).
4. Handle Review Before Acting items with caution.
5. Respect Do Not Change Yet guardrails.
6. Only move to Scale Later once earlier blockers are resolved.

## Decision Buckets Explained

- Do This Now:
   Actions currently classified as safe_to_do_now.
   Usually small, high-impact, and low-regret changes.

- Review Before Acting:
   Actions classified as review_before_acting.
   You should verify intent, fit, or context before saving changes.

- Secondary Actions:
   Useful actions that are not urgent and not blocked.

- Do Not Change Yet:
   Actions blocked by weak evidence, tracking trust issues, or missing business context.

- Scale Later:
   Growth actions shown only after foundational issues are handled.

## What Is Usually Safe To Do Directly

- Add obvious negative keywords from clearly irrelevant search terms.
- Apply moderate bid reductions (not full exclusions) on repeatedly wasteful segments.
- Fix measurement setup issues when flagged.

## What Should Usually Be Reviewed First

- Broad keyword pauses when Search Terms evidence is incomplete.
- Location exclusions without confirmed service-area fit.
- Scaling moves when target CPL is missing or value tracking is incomplete.
- Any action with medium/low confidence or inferred evidence.

## Hard Guardrails

- Do not raise budgets yet when tracking trust is weak.
- Do not pause broad keywords before reviewing search terms.
- Do not exclude locations before confirming service-area fit.
- Do not treat conversion count alone as lead quality.
- Do not trust CPA conclusions fully when conversion trust is weak.

## Missing Files And Missing Context

- Missing reports do not always stop analysis, but they reduce confidence.
- Missing high-impact reports reduce reliability of strong recommendations.
- Missing business settings can block some actions from being immediate.

Both are shown clearly in the UI.

## Re-Run Cadence After Changes

- After urgent fixes (tracking/waste): re-run in 3-7 days.
- After ad copy tests: re-run in about 7 days.
- After bid or budget scaling tests: re-run in 5-7 days.
- If spend is high, run more frequently to reduce risk.

Always try to re-upload the same 7 report slots after changes so before/after comparison stays reliable.

## Local Development

### Prerequisites

- Node.js 18+

### Install

```bash
npm install
```

### Run (Frontend + Backend)

```bash
npm run dev
```

Starts:

- Frontend (Vite): http://localhost:5173
- Backend (Express): http://localhost:3001

### Build

```bash
npm run build
```

### Start Server (Production-style)

```bash
npm run start
```

## Key Assumptions And Limitations

- Input files are standard Google Ads CSV exports.
- Findings and decisions are rule-based guidance, not predictive models.
- Local history and business settings are browser-local only (no database).
- The app does not directly access CRM, call recordings, or revenue systems.
- Lead quality, close rate, and sales quality still require manual/CRM validation.

## Technical Notes

- One active frontend entry path: index.html -> src/main.js.
- Canonical normalized metric naming uses conversionRate.
- Totals/waste/best-performer use explicit non-overlapping source hierarchy to avoid double counting.
- Decision output includes structured action objects with priority, confidence, prerequisites, and safety flags.
