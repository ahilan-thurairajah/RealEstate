const $ = (sel) => document.querySelector(sel);
const fmt = (n) => Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf = new Intl.NumberFormat('en-CA');

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

/**
 * Calculates the monthly mortgage payment for a Canadian mortgage.
 * Canadian mortgages are compounded semi-annually, so the APR must be
 * converted to an effective monthly rate.
 * @param {number} principal The total mortgage amount.
 * @param {number} aprPercent The annual percentage rate.
 * @param {number} years The amortization period in years.
 * @returns {number} The calculated monthly payment.
 */
function canadianMonthlyPayment(principal, aprPercent, years) {
  const n = Math.max(1, Math.round(years * 12)); // Total number of payments
  const apr = Math.max(0, aprPercent) / 100;
  // Convert semi-annual compound rate to an effective monthly rate
  const r = Math.pow(1 + apr / 2, 2 / 12) - 1;
  if (r === 0) return principal / n;
  // Standard loan payment formula
  return principal * (r / (1 - Math.pow(1 + r, -n)));
}

function showValidationMessages(messages, errors = []) {
  const box = $('#validationMessages');
  const allMessages = [...messages, ...errors.map(e => `Error: ${e}`)];
  if (!allMessages.length) {
    box.classList.add('d-none');
    box.textContent = '';
  } else {
    box.classList.remove('d-none');
    box.innerHTML = allMessages.map(m => `• ${m}`).join('<br/>');
  }
}

function getFormInputs() {
  const provMap = { ON: 'ON', ONTARIO: 'ON', QC: 'QC', QUEBEC: 'QC', SK: 'SK', SASKATCHEWAN: 'SK', OTHER: 'OTHER' };
  const provinceSel = ($('#province')?.value || 'ON').toUpperCase();
  const provinceCode = provMap[provinceSel] || 'OTHER';

  return {
    purchasePrice: Number($('#purchasePrice').value || 0),
    deposit: Number($('#deposit').value || 0),
    inspectionFee: Number($('#inspectionFee').value || 0),
    legalFees: Number($('#legalFees').value || 0),
    annualPropertyTax: Number($('#annualPropertyTax').value || 0),
    monthlyMaintenance: Number($('#monthlyMaintenance').value || 0),
    monthlyUtilities: Number($('#monthlyUtilities').value || 0),
    monthlyRental: Number($('#monthlyRental').value || 0),
    monthlyHomeInsurance: Number($('#monthlyHomeInsurance').value || 0),
    closingDate: $('#closingDate').value,
    firstTimeBuyer: $('#firstTimeBuyer').value === 'yes',
    isNonResident: $('#nonResident').value === 'yes',
    isToronto: $('#isToronto')?.value === 'yes',
    provinceCode,
    propertyType: $('#propertyType').value,
    dwellingType: $('#dwellingType').value,
    apr: Number($('#apr').value || 0),
    amortYears: Number($('#amortYears').value || 25),
    cmhcHandling: $('#cmhcHandling')?.value || 'finance',
    downAmt: Number($('#downAmt').value || 0),
  };
}

function validateInputs(inputs) {
  const { purchasePrice, deposit, downAmt, apr, amortYears } = inputs;
  const messages = [];
  if (!(purchasePrice > 0)) messages.push('Purchase price must be greater than 0.');
  if (deposit < 0) messages.push('Deposit cannot be negative.');
  if (deposit > purchasePrice) messages.push('Deposit cannot exceed purchase price.');
  if (downAmt < 0 || downAmt > purchasePrice) messages.push('Down payment must be between 0 and purchase price.');
  if (apr < 0 || apr > 25) messages.push('APR must be between 0% and 25%.');
  if (amortYears < 5 || amortYears > 30) messages.push('Amortization must be between 5 and 30 years.');

  const minDown = minDownPayment(purchasePrice);
  if (purchasePrice > 0 && downAmt < minDown) {
    messages.push(`Down payment below Canadian minimum ${fmt(minDown)} for this price.`);
  }
  return messages;
}

function updateDisplay(results) {
  const {
    landTransferTax, lttResp, nrstVal, cmhcPST, cmhcFinanced, cmhcAtClosing,
    totalMortgageAmount, monthlyMortgage, totalCash, totalMonthly, inputs
  } = results;
  const {
    purchasePrice, deposit, inspectionFee, legalFees, annualPropertyTax, downAmt,
    monthlyMaintenance, monthlyUtilities, monthlyRental, monthlyHomeInsurance
  } = inputs;

  const set = (id, v) => { const el = $('#' + id); if (el) el.textContent = fmt(v); };

  // LTT section
  set('landTransferTax', landTransferTax);
  const provBefore = Number(lttResp.provincialBeforeRebate || 0);
  const provRebate = Number(lttResp.provincialRebateApplied || 0);
  const provAfter = Number(lttResp.provincial || 0);
  const munBefore = Number(lttResp.municipalBeforeRebate || 0);
  const munRebate = Number(lttResp.municipalRebateApplied || 0);
  const munAfter = Number(lttResp.municipal || 0);
  const sumBefore = provBefore + munBefore;
  const sumRebate = provRebate + munRebate;
  const sumAfter = provAfter + munAfter + nrstVal;
  set('lttProvTax', provBefore);
  set('lttMunTax', munBefore);
  set('lttSumTax', sumBefore);
  const nrstRow = $('#lttNrstRow');
  if (nrstRow) {
    nrstRow.classList.toggle('d-none', nrstVal <= 0);
    if (nrstVal > 0) set('lttNrstAmount', nrstVal);
  }
  set('lttProvRebate', provRebate);
  set('lttMunRebate', munRebate);
  set('lttSumRebate', sumRebate);
  set('lttProvTotal', provAfter);
  set('lttMunTotal', munAfter);
  set('lttSumTotal', sumAfter);

  // CMHC section
  set('cmhcFinanced', cmhcFinanced);
  set('cmhcAtClosing', cmhcAtClosing);
  set('cmhcTax', cmhcPST);
  const cmhcTaxRow = $('#cmhcTaxRow');
  if (cmhcTaxRow) cmhcTaxRow.style.display = cmhcPST > 0 ? '' : 'none';

  // Summary sections
  set('totalCash', totalCash);
  set('cashDownPaymentAmount', downAmt);
  $('#cashDeposit').textContent = deposit ? ('-' + fmt(deposit).replace(/^-/, '')) : fmt(0);
  set('inspectionFeeDisplay', inspectionFee);
  set('legalFeesDisplay', legalFees);

  set('totalMortgageAmount', totalMortgageAmount);
  set('purchasePriceDisplay', purchasePrice);
  $('#downPaymentAmountDisplay').textContent = downAmt ? ('-' + fmt(downAmt).replace(/^-/, '')) : fmt(0);

  set('totalMonthly', totalMonthly);
  set('monthlyMortgage', monthlyMortgage);
  set('monthlyPropertyTax', annualPropertyTax / 12);
  set('monthlyHomeInsuranceDisplay', monthlyHomeInsurance);
  set('monthlyMaintenanceDisplay', monthlyMaintenance);
  set('monthlyUtilitiesDisplay', monthlyUtilities);
  set('monthlyRentalDisplay', monthlyRental);
}


async function recalc() {
  const inputs = getFormInputs();
  const { purchasePrice, downAmt, apr, amortYears, firstTimeBuyer, isNonResident, propertyType, dwellingType, isToronto, provinceCode, cmhcHandling, deposit, inspectionFee, legalFees, annualPropertyTax, monthlyMaintenance, monthlyUtilities, monthlyRental, monthlyHomeInsurance } = inputs;
  const apiErrors = [];

  // Days to close in Toronto time
  $('#daysToClose').value = daysBetweenTodayToronto(inputs.closingDate);

  // Link down payment controls
  linkDownPayment(purchasePrice);
  // Re-read downAmt as linkDownPayment may have changed it
  inputs.downAmt = Number($('#downAmt').value || 0);
  const downPct = purchasePrice ? (inputs.downAmt / purchasePrice) * 100 : 0;

  // Validation
  const validationMessages = validateInputs(inputs);
  const minDown = minDownPayment(purchasePrice);
  const belowMinDown = inputs.downAmt < minDown;

  // LTT from internal API
  const lttResp = await fetch('/api/tax/land-transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ purchasePrice, firstTimeBuyer, isNonResident, propertyType, dwellingType, isToronto })
  }).then(r => r.json()).catch(() => {
    apiErrors.push('Could not calculate Land Transfer Tax.');
    return { total: 0 };
  });
  const landTransferTax = Number(lttResp.total || 0);
  const nrstVal = Number(lttResp.nrst || 0);

  // CMHC applicability
  let cmhcPremium = 0;
  let cmhcPST = 0;
  if (purchasePrice > 0 && purchasePrice <= 1000000 && downPct < 20 && !belowMinDown) {
    const baseMortgage = Math.max(0, purchasePrice - inputs.downAmt);
    const ltv = baseMortgage / purchasePrice; // 0..1
    const rate = cmhcRate(ltv);
    if (rate !== null && rate > 0) cmhcPremium = baseMortgage * rate;

    const cmhcResp = await fetch('/api/tax/cmhc-pst', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purchasePrice, downPayment: inputs.downAmt, province: provinceCode })
    }).then(r => r.json()).catch(() => {
      apiErrors.push('Could not calculate CMHC PST.');
      return { pst: 0 };
    });

    const serverPst = Number(cmhcResp.pst);
    if (Number.isFinite(serverPst) && serverPst > 0) {
      cmhcPST = serverPst;
    } else {
      const pstRatesLocal = { ON: 0.08, QC: 0.09, SK: 0.06 };
      const localRate = pstRatesLocal[provinceCode] || 0;
      cmhcPST = Math.round(((cmhcPremium || 0) * localRate + Number.EPSILON) * 100) / 100;
    }
  }

  // Show validation and API error messages
  showValidationMessages(validationMessages, apiErrors);

  // Handling: finance vs upfront
  let cmhcFinanced = 0;
  let cmhcAtClosing = 0;
  if (cmhcPremium > 0) {
    if (cmhcHandling === 'finance') cmhcFinanced = cmhcPremium;
    else cmhcAtClosing = cmhcPremium;
  }

  // Mortgage principal and payment
  const baseMortgage = Math.max(0, purchasePrice - inputs.downAmt);
  const mortgagePrincipal = baseMortgage + cmhcFinanced;
  const monthlyMortgage = canadianMonthlyPayment(mortgagePrincipal, apr, amortYears);
  const totalMortgageAmount = mortgagePrincipal;

  // Cash on hand
  const totalCash = inputs.downAmt + inspectionFee + legalFees + landTransferTax + cmhcPST + cmhcAtClosing - deposit;

  // Monthly expenses
  const monthlyPropertyTax = annualPropertyTax / 12;
  const totalMonthly = monthlyMortgage + monthlyPropertyTax + monthlyMaintenance + monthlyUtilities + monthlyRental + monthlyHomeInsurance;

  // Update display with all calculated results
  updateDisplay({
    landTransferTax, lttResp, nrstVal, cmhcPST, cmhcFinanced, cmhcAtClosing,
    totalMortgageAmount, monthlyMortgage, totalCash, totalMonthly, inputs
  });

  // persist key fields
  ['address','closingDate','isToronto','purchasePrice','deposit','downPct','downAmt','inspectionFee','legalFees','annualPropertyTax','apr','amortYears','cmhcHandling','firstTimeBuyer','nonResident','propertyType','dwellingType','monthlyMaintenance','monthlyUtilities','monthlyRental','monthlyHomeInsurance']
    .forEach(saveField);
}

// Remove manual recalc; we use debounced auto-calc

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
$('#province')?.addEventListener('change', () => { enforceProvinceTorontoRule(); recalc(); });
  const debounce = (fn, ms = 300) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };
  const recalcDebounced = debounce(recalc, 300);
  ;['purchasePrice','deposit','inspectionFee','legalFees','annualPropertyTax','apr','amortYears','monthlyMaintenance','monthlyUtilities','monthlyRental','monthlyHomeInsurance','closingDate','downPct','downAmt','cmhcHandling','province']
    .forEach(id => {
      const el = $('#' + id);
      if (!el) return;
      const handler = () => {
        if (id === 'downPct' || id === 'downAmt') linkDownPayment(Number($('#purchasePrice').value||0));
        recalcDebounced();
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });

// Initialize defaults + persistence
function initDefaults() {
  ['address','closingDate','isToronto','province','purchasePrice','deposit','downPct','downAmt','inspectionFee','legalFees','annualPropertyTax','apr','amortYears','cmhcHandling','firstTimeBuyer','nonResident','propertyType','dwellingType','monthlyMaintenance','monthlyUtilities','monthlyRental','monthlyHomeInsurance']
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
  enforceProvinceTorontoRule();
}

// Disable Toronto selector if province != ON
function enforceProvinceTorontoRule() {
  const prov = ($('#province')?.value || 'ON').toUpperCase();
  const torSel = $('#isToronto');
  if (!torSel) return;
  if (prov !== 'ON') {
    torSel.value = 'no';
    torSel.setAttribute('disabled', 'disabled');
  } else {
    torSel.removeAttribute('disabled');
  }
}

initDefaults();
// Enable Bootstrap popovers (keyboard/tap friendly)
try {
  const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
  popoverTriggerList.forEach(el => new bootstrap.Popover(el));
} catch {}
// Market APR lookup
async function fetchMarketAprAndApply(force = false) {
  const btn = $('#btnUseMarketRate');
  const originalBtnText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Fetching...';

  try {
    const resp = await fetch('/api/rates/5y-fixed');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const aprInput = $('#apr');
    const aprHelp = $('#aprHelp');
    const aprPct = Number(json.aprPercent);
    const defaultApr = Number(aprInput.getAttribute('data-default-apr') || 0);
    const shouldAutofill = force || !aprInput.value || Number(aprInput.value) === defaultApr;

    if (shouldAutofill && Number.isFinite(aprPct) && aprPct > 0 && aprPct < 25) {
      aprInput.value = aprPct.toFixed(2);
      localStorage.setItem(storeKey('apr'), aprInput.value);
      if (aprHelp) aprHelp.textContent = `Using ${aprPct.toFixed(2)}% from ${json.source} (as of ${json.asOfISO}).`;
    } else if (aprHelp) {
      aprHelp.textContent = `Market: ${aprPct.toFixed(2)}% from ${json.source} (as of ${json.asOfISO}).`;
    }
  } catch (e) {
    showValidationMessages([], ['Could not retrieve market rate. Please enter one manually.']);
    const aprHelp = $('#aprHelp');
    if (aprHelp) aprHelp.textContent = 'Could not retrieve market rate; using entered value.';
  } finally {
    btn.disabled = false;
    btn.textContent = originalBtnText;
    recalc();
  }
}

$('#btnUseMarketRate')?.addEventListener('click', () => fetchMarketAprAndApply(true));
// Auto-fill APR once if empty or equal to default
(() => {
  const aprInput = $('#apr');
  const defaultApr = Number(aprInput.getAttribute('data-default-apr') || 0);
  if (!aprInput.value || Number(aprInput.value) === defaultApr) {
    fetchMarketAprAndApply(false);
  }
})();
recalc();
