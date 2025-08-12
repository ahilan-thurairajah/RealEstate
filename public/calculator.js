const $ = (sel) => document.querySelector(sel);
const fmt = (n) => Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Toronto time date-diff (exclusive of closing day)
function daysBetweenTodayToronto(dateStr) {
  if (!dateStr) return '';
  const tz = 'America/Toronto';
  const today = new Date();
  const todayYMD = formatYMD(today, tz);
  const closeYMD = dateStr; // already yyyy-mm-dd
  const d1 = new Date(`${todayYMD}T00:00:00-04:00`); // offset approx; for exact, we normalize by UTC millis below
  const d2 = new Date(`${closeYMD}T00:00:00-04:00`);
  const ms = d2.getTime() - d1.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function formatYMD(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date)
    .reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Persistence helpers
const storeKey = (id) => `hp_calc_${id}`;
function saveField(id) {
  const el = $('#' + id);
  if (!el) return;
  localStorage.setItem(storeKey(id), el.value);
}
function loadField(id) {
  const el = $('#' + id);
  if (!el) return;
  const v = localStorage.getItem(storeKey(id));
  if (v !== null) el.value = v;
}

// Canadian minimum down payment
function minDownPayment(price) {
  if (price >= 1000000) return price * 0.20;
  if (price <= 500000) return price * 0.05;
  // 5% of first 500k + 10% of remainder
  return 500000 * 0.05 + (price - 500000) * 0.10;
}

// CMHC premium rate table by LTV (approx, common rates)
function cmhcRate(ltv) {
  if (ltv > 0.95) return null; // not allowed
  if (ltv > 0.90) return 0.040; // 5% - 9.99% down
  if (ltv > 0.85) return 0.031; // 10% - 14.99%
  if (ltv > 0.80) return 0.028; // 15% - 19.99%
  return 0; // no CMHC ≥ 20% down or price > 1M
}

function linkDownPayment(purchasePrice) {
  const pctEl = $('#downPct');
  const amtEl = $('#downAmt');
  const pct = Number(pctEl.value || 0);
  let amount = Number(amtEl.value || 0);
  if (document.activeElement === pctEl) {
    amount = (pct / 100) * purchasePrice;
    amtEl.value = Math.max(0, Math.round(amount));
  } else if (document.activeElement === amtEl) {
    const newPct = purchasePrice > 0 ? (amount / purchasePrice) * 100 : 0;
    pctEl.value = (Math.max(0, newPct)).toFixed(2);
  } else {
    // initialize amount from pct
    amtEl.value = Math.max(0, Math.round((pct / 100) * purchasePrice));
  }
}

function canadianMonthlyPayment(principal, aprPercent, years) {
  const n = Math.max(1, Math.round(years * 12));
  const apr = Math.max(0, aprPercent) / 100;
  const r = Math.pow(1 + apr / 2, 2 / 12) - 1; // effective monthly rate
  if (r === 0) return principal / n;
  return principal * (r / (1 - Math.pow(1 + r, -n)));
}

function showValidationMessages(messages) {
  const box = $('#validationMessages');
  if (!messages.length) {
    box.classList.add('d-none');
    box.textContent = '';
  } else {
    box.classList.remove('d-none');
    box.innerHTML = messages.map(m => `• ${m}`).join('<br/>');
  }
}

async function recalc() {
  const purchasePrice = Number($('#purchasePrice').value || 0);
  const deposit = Number($('#deposit').value || 0);
  const inspectionFee = Number($('#inspectionFee').value || 0);
  const legalFees = Number($('#legalFees').value || 0);
  const annualPropertyTax = Number($('#annualPropertyTax').value || 0);
  const monthlyMaintenance = Number($('#monthlyMaintenance').value || 0);
  const monthlyUtilities = Number($('#monthlyUtilities').value || 0);
  const monthlyRental = Number($('#monthlyRental').value || 0);
  const closingDate = $('#closingDate').value;
  const firstTimeBuyer = $('#firstTimeBuyer').value === 'yes';
  const isNonResident = $('#nonResident').value === 'yes';
  const isToronto = $('#isToronto')?.value === 'yes';
  const provinceSel = ($('#province')?.value || 'ON').toUpperCase();
  const provMap = { ON: 'ON', ONTARIO: 'ON', QC: 'QC', QUEBEC: 'QC', SK: 'SK', SASKATCHEWAN: 'SK', OTHER: 'OTHER' };
  const provinceCode = provMap[provinceSel] || 'OTHER';
  const propertyType = $('#propertyType').value;
  const dwellingType = $('#dwellingType').value;
  const apr = Number($('#apr').value || 0);
  const amortYears = Number($('#amortYears').value || 25);
  const cmhcHandling = $('#cmhcHandling')?.value || 'finance';

  // Days to close in Toronto time
  $('#daysToClose').value = daysBetweenTodayToronto(closingDate);

  // Link down payment controls
  linkDownPayment(purchasePrice);
  const downAmt = Number($('#downAmt').value || 0);
  const downPct = purchasePrice ? (downAmt / purchasePrice) * 100 : 0;

  // Validation
  const messages = [];
  if (!(purchasePrice > 0)) messages.push('Purchase price must be greater than 0.');
  if (deposit < 0) messages.push('Deposit cannot be negative.');
  if (deposit > purchasePrice) messages.push('Deposit cannot exceed purchase price.');
  if (downAmt < 0 || downAmt > purchasePrice) messages.push('Down payment must be between 0 and purchase price.');
  if (apr < 0 || apr > 25) messages.push('APR must be between 0% and 25%.');
  if (amortYears < 5 || amortYears > 30) messages.push('Amortization must be between 5 and 30 years.');

  const minDown = minDownPayment(purchasePrice);
  const belowMinDown = downAmt < minDown;
  if (purchasePrice > 0 && belowMinDown) {
    messages.push(`Down payment below Canadian minimum ${fmt(minDown)} for this price.`);
  }
  showValidationMessages(messages);

  // LTT from internal API
  const lttResp = await fetch('/api/tax/land-transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ purchasePrice, firstTimeBuyer, isNonResident, propertyType, dwellingType, isToronto })
  }).then(r => r.json()).catch(() => ({ total: 0 }));
  const landTransferTax = Number(lttResp.total || 0);
  $('#landTransferTax').textContent = fmt(landTransferTax);
  const breakdown = `Provincial: ${fmt(lttResp.provincial || 0)} (rebate -${fmt(lttResp.provincialRebateApplied||0)}) | Municipal: ${fmt(lttResp.municipal || 0)} (rebate -${fmt(lttResp.municipalRebateApplied||0)})${(lttResp.nrst||0)>0?` | NRST: ${fmt(lttResp.nrst)}`:''}`;
  $('#lttBreakdown').textContent = breakdown;

  // CMHC applicability
  let cmhcPremium = 0;
  let cmhcPST = 0;
  if (purchasePrice > 0 && purchasePrice <= 1000000 && downPct < 20 && !belowMinDown) {
    const baseMortgage = Math.max(0, purchasePrice - downAmt);
    const ltv = baseMortgage / purchasePrice; // 0..1
    const rate = cmhcRate(ltv);
    if (rate !== null && rate > 0) cmhcPremium = baseMortgage * rate;
    const cmhcResp = await fetch('/api/tax/cmhc-pst', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purchasePrice, downPayment: downAmt, province: provinceCode })
    }).then(r => r.json()).catch(() => ({ pst: 0 }));
    const serverPst = Number(cmhcResp.pst);
    if (Number.isFinite(serverPst) && serverPst > 0) {
      cmhcPST = serverPst;
    } else {
      const pstRatesLocal = { ON: 0.08, QC: 0.09, SK: 0.06 };
      const localRate = pstRatesLocal[provinceCode] || 0;
      cmhcPST = Math.round(((cmhcPremium || 0) * localRate + Number.EPSILON) * 100) / 100;
    }
  }
  // Handling: finance vs upfront
  let financedPremium = 0;
  let premiumAtClosing = 0;
  if (cmhcPremium > 0) {
    if (cmhcHandling === 'finance') financedPremium = cmhcPremium;
    else premiumAtClosing = cmhcPremium;
  }
  $('#cmhcFinanced').textContent = fmt(financedPremium);
  $('#cmhcAtClosing').textContent = fmt(premiumAtClosing);
    $('#cmhcTax').textContent = fmt(cmhcPST);
    const cmhcTaxRow = document.getElementById('cmhcTaxRow');
    if (cmhcTaxRow) cmhcTaxRow.style.display = cmhcPST > 0 ? '' : 'none';

  // Mortgage principal and payment
  const baseMortgage = Math.max(0, purchasePrice - downAmt);
  const mortgagePrincipal = baseMortgage + financedPremium;
  const monthlyPayment = canadianMonthlyPayment(mortgagePrincipal, apr, amortYears);
  $('#monthlyMortgage').textContent = fmt(monthlyPayment);

  // Balance of down payment (for cash on hand). Clamp to 0
  const balanceDown = Math.max(0, downAmt - deposit);
  $('#balanceDown').textContent = fmt(balanceDown);

  // Cash on hand = Deposit + Inspection + Legal + LTT + NRST (already inside lttResp.total) + CMHC PST + premium at closing + balanceDown
  const totalCash = deposit + inspectionFee + legalFees + landTransferTax + cmhcPST + premiumAtClosing + balanceDown;
  $('#totalCash').textContent = fmt(totalCash);

  // Monthly property tax
  const monthlyPropertyTax = annualPropertyTax / 12;
  $('#monthlyPropertyTax').textContent = fmt(monthlyPropertyTax);

  // Total monthly = mortgage payment + monthly property tax + maintenance + utilities + rental
  const totalMonthly = monthlyPayment + monthlyPropertyTax + monthlyMaintenance + monthlyUtilities + monthlyRental;
  $('#totalMonthly').textContent = fmt(totalMonthly);

  // persist key fields
  ['address','closingDate','isToronto','purchasePrice','deposit','downPct','downAmt','inspectionFee','legalFees','annualPropertyTax','apr','amortYears','cmhcHandling','firstTimeBuyer','nonResident','propertyType','dwellingType','monthlyMaintenance','monthlyUtilities','monthlyRental']
    .forEach(saveField);
}

$('#recalc').addEventListener('click', recalc);

// Show dwelling type select only for Detached / Semi-Detached
function updateDwellingVisibility() {
  const prop = $('#propertyType').value;
  $('#dwellingTypeWrapper').style.display = (prop === 'Detached' || prop === 'Semi-Detached') ? '' : 'none';
}
$('#propertyType').addEventListener('change', () => { updateDwellingVisibility(); recalc(); });
$('#firstTimeBuyer').addEventListener('change', recalc);
$('#nonResident').addEventListener('change', recalc);
$('#dwellingType').addEventListener('change', recalc);
$('#isToronto')?.addEventListener('change', recalc);
  ['purchasePrice','deposit','inspectionFee','legalFees','annualPropertyTax','apr','amortYears','monthlyMaintenance','monthlyUtilities','monthlyRental','closingDate','downPct','downAmt','cmhcHandling','province']
  .forEach(id => {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener('input', () => {
      if (id === 'downPct' || id === 'downAmt') linkDownPayment(Number($('#purchasePrice').value||0));
      recalc();
    });
  });

// Initialize defaults + persistence
function initDefaults() {
  ['address','closingDate','isToronto','province','purchasePrice','deposit','downPct','downAmt','inspectionFee','legalFees','annualPropertyTax','apr','amortYears','cmhcHandling','firstTimeBuyer','nonResident','propertyType','dwellingType','monthlyMaintenance','monthlyUtilities','monthlyRental']
    .forEach(loadField);
    const cmhcTaxRow = document.getElementById('cmhcTaxRow');
    if (cmhcTaxRow) cmhcTaxRow.style.display = 'none'; // Initialize as hidden

  // If closing date empty, set to today+35 days
  if (!$('#closingDate').value) {
    const tz = 'America/Toronto';
    const now = new Date();
    const ymd = formatYMD(new Date(now.getTime() + 35*24*60*60*1000), tz);
    $('#closingDate').value = ymd;
  }
  if (!$('#downPct').value) $('#downPct').value = '20';
  // Sync downAmt from percent initially
  linkDownPayment(Number($('#purchasePrice').value || 0));
  updateDwellingVisibility();
}

initDefaults();
// Market APR lookup
async function fetchMarketAprAndApply(force = false) {
  try {
    const resp = await fetch('/api/rates/5y-fixed');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    const aprInput = $('#apr');
    const aprHelp = $('#aprHelp');
    const aprPct = Number(json.aprPercent);
  const defaultApr = Number(aprInput.getAttribute('data-default-apr') || 0);
  const shouldAutofill = force || !aprInput.value || Number(aprInput.value) === defaultApr;
  if (shouldAutofill) {
      if (Number.isFinite(aprPct) && aprPct > 0 && aprPct < 25) {
        aprInput.value = aprPct.toFixed(2);
    localStorage.setItem(storeKey('apr'), aprInput.value);
        if (aprHelp) aprHelp.textContent = `Using ${aprPct.toFixed(2)}% from ${json.source} (as of ${json.asOfISO}).`;
      }
  } else if (aprHelp) {
      aprHelp.textContent = `Market: ${aprPct.toFixed(2)}% from ${json.source} (as of ${json.asOfISO}).`;
    }
  } catch (e) {
    const aprHelp = $('#aprHelp');
    if (aprHelp) aprHelp.textContent = 'Could not retrieve market rate; using entered value.';
  }
  recalc();
}

document.getElementById('btnUseMarketRate')?.addEventListener('click', () => fetchMarketAprAndApply(true));
// Auto-fill APR once if empty or equal to default
(() => {
  const aprInput = $('#apr');
  const defaultApr = Number(aprInput.getAttribute('data-default-apr') || 0);
  if (!aprInput.value || Number(aprInput.value) === defaultApr) {
    fetchMarketAprAndApply(false);
  }
})();
recalc();
