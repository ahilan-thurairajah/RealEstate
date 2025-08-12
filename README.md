# Toronto Home Purchase Tools

A small website with a home page and a Buyer Calculator for estimating Total Cash On Hand and Total Monthly Expense for Toronto buyers.

This initial version ships as a simple static site served by a tiny Node/Express server that can proxy to the Canadian Mortgage App (CMA) APIs once you add credentials.

## Features
- Home page describing the purpose.
- Buyer Calculator page with fields from the requirements.
- Calculations:
  - Days to close = difference between today and closing date.
  - Balance of 10% down payment = 10% of purchase price minus deposit (C11).
  - Total Cash On Hand = sum of deposit, inspection, legal, LTT, CMHC tax, and balance of 10% down (C12).
  - Monthly property taxes = annual / 12 (C17).
  - Total Monthly Expense = monthly mortgage + monthly property tax + maintenance + utilities + rental (C21).
- Placeholder API proxy endpoints for Land Transfer Tax and CMHC Mortgage Insurance Tax.
 - Internal Land Transfer Tax API implementing Ontario + Toronto marginal brackets, first-time buyer rebates, and NRST.

## Local run

```powershell
# from workspace root
cd c:\GIT\github\HomePurchase\code\hp-site
npm install
npm run start
# then open http://localhost:5173 in your browser
# health check: http://localhost:5173/api/health
```

## Configure CMA API (later)
- Update `server.mjs` to call CMA endpoints documented at https://developers.canadianmortgageapp.com/ using your API key.
- Replace the placeholder responses with real amounts and ensure inputs match CMA requirements (province=ON, municipality=Toronto where applicable).
 - Copy `.env.example` to `.env` and set CMA_* variables. Set `CMA_ENABLED=true` to activate the proxy.

## Notes
- This is not financial or legal advice. Always verify with lender, lawyer, and municipality.
- Styling uses Bootstrap via CDN for a professional look with minimal setup.
 - Internal LTT API path: POST /api/tax/land-transfer { purchasePrice, firstTimeBuyer, isNonResident, propertyType, dwellingType, isToronto }. Returns breakdown and total.
