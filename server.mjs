import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables from .env if present
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('[server] Booting HomePurchase server...');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple health endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Placeholder endpoints for CMA API proxying (fill in with API key when available)
// CMA proxy configuration (disabled by default)
const CMA_ENABLED = String(process.env.CMA_ENABLED || 'false').toLowerCase() === 'true';
const CMA_BASE_URL = process.env.CMA_BASE_URL || '';
const CMA_AUTH_HEADER = process.env.CMA_AUTH_HEADER || 'x-api-key';
const CMA_API_KEY = process.env.CMA_API_KEY || '';
const CMA_TIMEOUT_MS = Number(process.env.CMA_TIMEOUT_MS || 8000);

async function proxyToCMA(pathname, payload, fallbackAmount = 0) {
  if (!CMA_ENABLED || !CMA_BASE_URL || !CMA_API_KEY) {
    return { amount: fallbackAmount, source: 'placeholder' };
  }
  const url = `${CMA_BASE_URL.replace(/\/$/, '')}/${pathname.replace(/^\//, '')}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CMA_TIMEOUT_MS);
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CMA_AUTH_HEADER]: CMA_API_KEY,
      },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`CMA HTTP ${resp.status}`);
    const data = await resp.json();
    const amount = Number(data?.amount ?? data?.total ?? 0);
    return { amount, source: 'cma' };
  } catch (err) {
    console.warn('CMA proxy error:', err?.message || err);
    return { amount: fallbackAmount, source: 'fallback' };
  }
}

app.post('/api/cma/land-transfer-tax', async (req, res) => {
  // Expecting payload fields like { purchasePrice, propertyType, province: 'ON', municipality: 'Toronto', firstTimeBuyer: false }
  const result = await proxyToCMA('land-transfer-tax', req.body, 0);
  res.json(result);
});

app.post('/api/cma/cmhc-insurance-tax', async (req, res) => {
  // Expecting payload fields like { purchasePrice, downPayment, province: 'ON' }
  const result = await proxyToCMA('cmhc-insurance-tax', req.body, 0);
  res.json(result);
});

// ---------- Internal CMHC Premium + PST ("CMHC Mortgage Insurance Tax") ----------
// Request: { purchasePrice, downPayment, province } province in: ON|QC|SK|OTHER
// Response: { ltv, premiumRate, premium, pstRate, pst }
app.post('/api/tax/cmhc-pst', (req, res) => {
  try {
  const { purchasePrice, downPayment, province = 'ON' } = req.body || {};
    const price = Number(purchasePrice || 0);
    const down = Number(downPayment || 0);
    if (!(price > 0)) return res.status(400).json({ error: 'purchasePrice must be > 0' });
    if (down < 0 || down > price) return res.status(400).json({ error: 'downPayment out of range' });

    const mortgage = Math.max(0, price - down);
    const ltv = price > 0 ? mortgage / price : 0;

    // Premium rates per requirements
    // Up to 65%: 0.60%; 65.01–75%: 1.70%; 75.01–80%: 2.40%; 80.01–85%: 2.80%; 85.01–90%: 3.10%; 90.01–95%: 4.00%
    let rate = 0;
    if (ltv <= 0.65) rate = 0.006;
    else if (ltv <= 0.75) rate = 0.017;
    else if (ltv <= 0.80) rate = 0.024;
    else if (ltv <= 0.85) rate = 0.028;
    else if (ltv <= 0.90) rate = 0.031;
    else if (ltv <= 0.95) rate = 0.040;
    else rate = NaN; // >95% LTV not supported

    const premium = Number.isFinite(rate) ? mortgage * rate : 0;

  const pstRates = { ON: 0.08, QC: 0.09, SK: 0.06 };
  // Normalize province to code (accept names or codes)
  const provRaw = String(province || 'ON').toUpperCase();
  const provMap = { ON: 'ON', ONTARIO: 'ON', QC: 'QC', QUEBEC: 'QC', SK: 'SK', SASKATCHEWAN: 'SK', OTHER: 'OTHER' };
  const pcode = provMap[provRaw] || 'OTHER';
    const pstRate = pstRates[pcode] || 0;
    const pst = premium * pstRate;

    res.json({
      ltv: Math.round(ltv * 10000) / 10000,
      premiumRate: Math.round((rate || 0) * 10000) / 100, // percent
      premium: round2(premium),
      pstRate: Math.round(pstRate * 10000) / 100, // percent
      pst: round2(pst)
    });
  } catch (err) {
    console.error('CMHC PST calculation failed', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------- Internal Land Transfer Tax Calculation API ----------
// Calculates Ontario Provincial LTT, Toronto Municipal LTT, First-Time Buyer rebates, and NRST.
// Request JSON body example:
// {
//   purchasePrice: 575000,
//   isToronto: true,
//   firstTimeBuyer: true,
//   isNonResident: false,
//   propertyType: 'Detached', // Detached | Semi-Detached | Town-house | Condominium
//   dwellingType: 'Single Family' // (only when propertyType Detached or Semi-Detached)
// }
app.post('/api/tax/land-transfer', (req, res) => {
  try {
    const {
      purchasePrice: rawPrice,
      isToronto = true,
      firstTimeBuyer = false,
      isNonResident = false,
      propertyType = 'Detached',
      dwellingType = 'Single Family'
    } = req.body || {};

    const purchasePrice = Number(rawPrice || 0);
    if (purchasePrice <= 0) {
      return res.status(400).json({ error: 'purchasePrice must be > 0' });
    }

    // Determine number of dwelling units for top bracket logic
    const dwellingUnitsMap = {
      'Single Family': 1,
      'Duplex': 2,
      'Tri-plex': 3,
      'Triplex': 3, // alternate spelling
      'Four-plex': 4,
      'Multiplex': 5
    };
    const dwellingUnits = dwellingUnitsMap[dwellingType] || 1;

    // Provincial brackets (Ontario)
    // If >2 units, the 2.5% top marginal (for one or two single-family residences) does not apply; cap at 2.0%.
    const provincialBrackets = [
      { upTo: 55000, rate: 0.005 },
      { upTo: 250000, rate: 0.01 },
      { upTo: 400000, rate: 0.015 },
      // Between 400k and 2M
      { upTo: 2000000, rate: 0.02 },
      // Over 2M if <=2 units
      ...(dwellingUnits <= 2 ? [{ upTo: Infinity, rate: 0.025 }] : [{ upTo: Infinity, rate: 0.02 }])
    ];

    // Toronto Municipal brackets (same base up to 2M, diverge afterwards per requirements for up to 2 units)
    const torontoBracketsBase = [
      { upTo: 55000, rate: 0.005 },
      { upTo: 250000, rate: 0.01 },
      { upTo: 400000, rate: 0.015 },
      { upTo: 2000000, rate: 0.02 }
    ];
    const torontoExtraBracketsOneTwoUnits = [
      { upTo: 3000000, rate: 0.025 },
      { upTo: 4000000, rate: 0.035 },
      { upTo: 5000000, rate: 0.045 },
      { upTo: 10000000, rate: 0.055 },
      { upTo: 20000000, rate: 0.065 },
      { upTo: Infinity, rate: 0.075 }
    ];
    // For >2 units we will conservatively apply only up to 2.0% as we lack authoritative multi-unit bracket data beyond requirement scope.
    const municipalBrackets = isToronto
      ? (dwellingUnits <= 2
          ? [...torontoBracketsBase, ...torontoExtraBracketsOneTwoUnits]
          : [...torontoBracketsBase, { upTo: Infinity, rate: 0.02 }])
      : [];

    function computeMarginalTax(price, brackets) {
      let remaining = price;
      let lastThreshold = 0;
      let total = 0;
      for (const b of brackets) {
        const span = Math.min(remaining, b.upTo - lastThreshold);
        if (span <= 0) continue;
        total += span * b.rate;
        remaining -= span;
        lastThreshold = b.upTo;
        if (remaining <= 0) break;
      }
      return total;
    }

    const provincialBeforeRebate = computeMarginalTax(purchasePrice, provincialBrackets);
    const municipalBeforeRebate = isToronto ? computeMarginalTax(purchasePrice, municipalBrackets) : 0;

    // First-time buyer rebates (if applicable)
    const provincialRebateCap = 4000; // Ontario
    const municipalRebateCap = 4475; // Toronto
    const provincialRebateApplied = firstTimeBuyer ? Math.min(provincialBeforeRebate, provincialRebateCap) : 0;
    const municipalRebateApplied = (firstTimeBuyer && isToronto) ? Math.min(municipalBeforeRebate, municipalRebateCap) : 0;

    const provincial = provincialBeforeRebate - provincialRebateApplied;
    const municipal = municipalBeforeRebate - municipalRebateApplied;

    // Non-Resident Speculation Tax (NRST) 25%
    const nrst = isNonResident ? purchasePrice * 0.25 : 0;

    const total = provincial + municipal + nrst;

    res.json({
      purchasePrice,
      dwellingUnits,
      provincialBeforeRebate: round2(provincialBeforeRebate),
      provincialRebateApplied: round2(provincialRebateApplied),
      provincial: round2(provincial),
      municipalBeforeRebate: round2(municipalBeforeRebate),
      municipalRebateApplied: round2(municipalRebateApplied),
      municipal: round2(municipal),
      nrst: round2(nrst),
      total: round2(total)
    });
  } catch (err) {
    console.error('LTT calculation failed', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// --------- Rates: 5-year fixed APR default ---------
async function resolveFiveYearFixedAPR() {
  const provider = String(process.env.RATES_PROVIDER || 'boc').toLowerCase();
  const fallback = Number(process.env.DEFAULT_5Y_FIXED_APR || 5.0);

  if (provider === 'boc') {
    try {
      const series = process.env.BOC_SERIES_ID || 'V122521';
      const url = `https://www.bankofcanada.ca/valet/observations/${encodeURIComponent(series)}/json?recent=1`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        const obs = data?.observations?.[0];
        if (obs) {
          const key = Object.keys(obs).find(k => k !== 'd');
          const val = Number(obs?.[key]?.v);
          if (Number.isFinite(val)) {
            return { aprPercent: val, source: 'Bank of Canada (Valet)', asOfISO: obs.d };
          }
        }
      }
    } catch (e) {
      console.warn('[rates] BoC fetch failed, using fallback:', e?.message || e);
    }
  }
  return { aprPercent: fallback, source: 'Fallback (.env DEFAULT_5Y_FIXED_APR)', asOfISO: new Date().toISOString().slice(0,10) };
}

app.get('/api/rates/5y-fixed', async (req, res) => {
  const result = await resolveFiveYearFixedAPR();
  res.json({ currency: 'CAD', ...result });
});

function startServer(port, attemptsLeft = 3) {
  const server = app.listen(port, () => {
    console.log(`HomePurchase site running at http://localhost:${port}`);
  });
  server.on('error', (err) => {
    console.error(`[server] Failed to listen on port ${port}:`, err.code || err.message);
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      const nextPort = Number(port) + 1;
      console.log(`[server] Trying next port ${nextPort}...`);
      startServer(nextPort, attemptsLeft - 1);
    } else {
      process.exit(1);
    }
  });
}

process.on('uncaughtException', (e) => console.error('[server] uncaughtException', e));
process.on('unhandledRejection', (e) => console.error('[server] unhandledRejection', e));

startServer(process.env.PORT || 5173);
