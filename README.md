# Garage Door PPC Assistant

Google Ads CSV analysis tool focused on Garage Door lead generation accounts.

The app accepts multiple Google Ads report CSVs, normalizes and validates each file, runs a rules engine, and returns a structured report with:

- Summary
- Waste
- Opportunities
- Control Risks
- Measurement Risks
- Top Actions
- Local analysis history (browser localStorage)

## What The App Does

- Upload one or more Google Ads CSV exports by report slot.
- Parse and normalize column names into a canonical internal schema.
- Validate required and preferred fields per report type.
- Run decision-oriented rules to produce actionable findings.
- Show a report in the UI and store recent analyses locally.

## Required And Optional Report Types

You can upload any subset, but analysis quality improves with coverage.

- `Campaign` (strongly recommended for account-level totals)
- `Ad Group`
- `Search Terms`
- `Keywords`
- `Ads` (optional, currently used for measurement coverage context)
- `Devices` (optional, used for opportunity signals)
- `Location` (optional, used for opportunity signals)

## Expected CSV Flow

1. Frontend upload cards collect files by fixed slot key (`campaign`, `adGroup`, `searchTerm`, `keyword`, `ad`, `device`, `location`).
2. Frontend posts `multipart/form-data` to `POST /analyze`.
3. Backend routes each file to the matching parser.
4. Parser pipeline:
	 - CSV parse
	 - Field normalization (canonical schema)
	 - Validation
5. Rules engine runs across normalized datasets.
6. Report builder assembles final sections and summary metrics.
7. Frontend renders report and writes history locally.

## Canonical Data Truth Rules

To prevent double counting across overlapping report levels:

- Account totals use one source only, in priority order:
	- `campaigns`
	- `adGroups`
	- `keywords`
	- `searchTerms`
	- `ads`
	- `devices`
	- `locations`
- Wasted-spend percentage uses one non-overlapping source only (prefers search terms/keywords for waste diagnostics).
- Best performer uses one source only (prefers granular entities first).

This avoids inflating spend or conversions by summing campaign + ad group + keyword totals together.

## Analysis Architecture (High Level)

- `src/parser/`
	- `csvParser.js`: CSV parsing
	- `normalizer.js`: canonical field mapping + typed metrics
	- `validator.js`: required/preferred field checks
	- `reportRouter.js`: report-type routing and mismatch warnings

- `src/analysis/`
	- `rulesEngine.js`: orchestrates all rule groups and deduplicates findings
	- `dataSources.js`: canonical source selection for totals/waste/best-performer
	- `reportBuilder.js`: assembles report payload
	- `rules/`: waste, opportunities, control risks, measurement risks

- `src/ui/`
	- `uploader.js`: upload state and per-file status
	- `reportRenderer.js`: section rendering
	- `historyPanel.js`: history interactions

- `src/storage/history.js`
	- localStorage persistence (latest 10 reports)

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

This starts:

- Vite frontend: `http://localhost:5173`
- Express backend: `http://localhost:3001`

### Build

```bash
npm run build
```

### Production-Style Server Start

```bash
npm run start
```

Notes:

- `server.js` serves static `dist` only when it exists.
- In development, frontend is served by Vite and API calls are proxied to Express.

## Important Assumptions And Limitations

- Input files are standard Google Ads CSV exports.
- Validation blocks a report when required columns are missing.
- Optional datasets (`ads`, `devices`, `location`) enhance diagnostics but are not mandatory.
- Findings are heuristic rules, not ML predictions.
- History is local to the current browser/device (no shared backend storage).

## Internal Consistency Notes

- Single active frontend entry: `index.html` -> `src/main.js`.
- Canonical metric naming uses `conversionRate` (no legacy variant usage).
- Findings are deduplicated by category + signal + normalized subject/action.
