# Toronto Home Purchase Tools

A small website with a home page and a Buyer Calculator for estimating Total Cash On Hand and Total Monthly Expense for Toronto buyers.

The site is served by a small Node/Express server (static + internal calculation APIs) and can optionally proxy to the Canadian Mortgage App (CMA) APIs when credentials are supplied.

## Features
- Home page describing the purpose.
- Buyer Calculator with accessibility-friendly dynamic calculations and auto-save of inputs.
- Calculations & Logic:
  - Days to close (Toronto time) from today to selected closing date.
  - Minimum Canadian down payment rules (5% / 10% ladder and 20% ≥ $1M) with validation messages.
  - Land Transfer Tax: Ontario provincial + optional Toronto municipal + NRST + first-time buyer rebates (net and detailed breakdown table).
  - CMHC premium & PST (ON/QC/SK) with option to finance premium or pay upfront (all-or-nothing financing).
  - Total Cash On Hand section (Down Payment Amount, Deposit (negative), Land Transfer Tax, CMHC PST, CMHC Premium paid at closing, Inspection Fee, Legal Fees) with running total.
  - Total Mortgage Amount section: Purchase Price − Down Payment Amount + CMHC Premium (financed).
  - Total Monthly Expense section: Mortgage payment (Canadian semi-annual compounding), Monthly Property Tax, Home Insurance, Maintenance/POTL, Utilities, Rental fees.
  - Mortgage payment auto-updates with market APR fetch (5y fixed) unless user overrides.
  - LocalStorage persistence for all key inputs.
- Internal APIs:
  - /api/tax/land-transfer (Ontario/Toronto brackets, rebates, NRST)
  - /api/tax/cmhc-pst (premium rate ladder + PST)
  - /api/rates/5y-fixed (Bank of Canada fallback)
- Optional CMA proxy scaffolding for future integration.

## Local run

```powershell
# from workspace root
cd c:\GIT\github\HomePurchase\code\hp-site
npm install
npm run start
# then open http://localhost:5173 in your browser
# health check: http://localhost:5173/api/health
```

### Add a realistic photographic hero image
1. Place a high-quality licensed photo (e.g. sunrise Toronto skyline) at `public/img/hero-src/hero-source.jpg` (recommended 3200×1600 or larger, landscape).
2. (First time only) Install the optional local dependency:

  ```powershell
  npm i -D sharp
  ```

3. Run the processing script (harmless no-op in production if sharp absent):

  ```powershell
  npm run build:hero
  ```

  This creates responsive variants in `public/img/hero/`:
  - `hero-toronto-640.webp|jpg`
  - `hero-toronto-1024.webp|jpg`
  - `hero-toronto-1600.webp|jpg`
  - `hero-toronto-placeholder.webp` (tiny blurred placeholder)

4. Commit the generated files (WebP + JPEG). The home page `<picture>` will automatically use them.
5. Keep proper attribution & licensing notes (add a comment in README if required by the license).

If no real photo is supplied the site falls back to a gradient placeholder.

## Configure CMA API (later)
- Update `server.mjs` to call CMA endpoints documented at https://developers.canadianmortgageapp.com/ using your API key.
- Replace the placeholder responses with real amounts and ensure inputs match CMA requirements (province=ON, municipality=Toronto where applicable).
 - Copy `.env.example` to `.env` and set CMA_* variables. Set `CMA_ENABLED=true` to activate the proxy.

## Notes
- This is not financial or legal advice. Always verify with lender, lawyer, and municipality.
- Styling uses Bootstrap via CDN.
- Internal LTT API path: POST /api/tax/land-transfer { purchasePrice, firstTimeBuyer, isNonResident, propertyType, dwellingType, isToronto } → breakdown & totals.

## Release Notes

### v1.0 (2025-08-13)
Initial structured release with:
- Reorganized calculator summary into three sections: Total Cash On Hand, Total Mortgage Amount, Total Monthly Expense.
- Added Monthly Home Insurance input and inclusion in monthly total.
- Added explicit Purchase Price, Down Payment (negative), and CMHC Premium (financed) breakdown for mortgage amount.
- Display of negative Deposit within cash section and negative Down Payment in mortgage section for clarity of subtraction steps.
- Detailed Land Transfer Tax breakdown (provincial, municipal, rebates) and NRST handling.
- All-or-nothing CMHC premium financing logic with PST visibility (hidden when zero).
- Market APR auto-fill with manual override detection.
- Accessibility: aria-live updates, keyboard-friendly popovers, semantic tables, details/summary for breakdown.
- LocalStorage persistence across sessions.

Previous incremental commits incorporated into this release include net LTT labeling, insurance line items, and revised cash & monthly formulas.
