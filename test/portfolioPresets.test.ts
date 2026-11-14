import {
  PORTFOLIO_PRESETS,
  SHELTERED_PORTFOLIO_PRESETS,
  addHoldingKeepingTotal,
  applyPresetToHoldings,
  holdingFromCatalogRow,
  rebalanceHoldingsToTotal,
  scalePresetToTotal,
  type EtfCatalogRow,
} from '../src/engine/portfolioPresets';
import {
  DEFAULT_SIMULATION_INPUTS,
  PRESET_SCENARIOS,
  STARTER_ETF_HOLDINGS,
  STARTER_SHELTERED_ETF_HOLDINGS,
} from '../src/engine/presets';
import {
  calculateCurrentShelteredTotal,
  evaluateHoldingsList,
  evaluatePortfolio,
  evaluateShelteredPortfolio,
} from '../src/engine/pensionAndEtf';

let n = 0;
function check(cond: boolean, msg: string): void {
  n += 1;
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// 1. Preset catalogue shape: 4 general presets + 5 sheltered KRX presets, weights sum to 100, unique tickers
check(PORTFOLIO_PRESETS.length === 4, '4 presets defined');
check(
  new Set(PORTFOLIO_PRESETS.map((p) => p.id)).size === 4,
  'preset ids unique',
);
for (const p of PORTFOLIO_PRESETS) {
  check(sum(p.legs.map((l) => l.weight)) === 100, `${p.id} weights sum to 100`);
  check(new Set(p.legs.map((l) => l.ticker)).size === p.legs.length, `${p.id} tickers unique`);
  check(p.legs.every((l) => l.weight > 0), `${p.id} all weights positive`);
  check(p.label.length > 0 && p.description.length > 0, `${p.id} has label/description`);
}
check(!PORTFOLIO_PRESETS.some((p) => p.legs.some((l) => l.ticker === '448290')), '448290 excluded');

check(SHELTERED_PORTFOLIO_PRESETS.length === 5, '5 sheltered KRX presets defined');
check(
  new Set(SHELTERED_PORTFOLIO_PRESETS.map((p) => p.id)).size === 5,
  'sheltered preset ids unique',
);
const shelteredTickers = new Set(SHELTERED_PORTFOLIO_PRESETS.flatMap((p) => p.legs.map((l) => l.ticker)));
for (const reqTicker of ['360750', '133690', '458730', '069500', '292150', '273130']) {
  check(shelteredTickers.has(reqTicker), `sheltered presets must include KRX ticker ${reqTicker}`);
}
for (const p of SHELTERED_PORTFOLIO_PRESETS) {
  check(sum(p.legs.map((l) => l.weight)) === 100, `${p.id} weights sum to 100`);
  check(new Set(p.legs.map((l) => l.ticker)).size === p.legs.length, `${p.id} tickers unique`);
  check(p.legs.every((l) => l.weight > 0), `${p.id} all weights positive`);
  check(p.label.length > 0 && p.description.length > 0, `${p.id} has label/description`);
}

// 2. scalePresetToTotal: Σ amount == total exactly (floor + residual to last leg)
const dg = PORTFOLIO_PRESETS.find((p) => p.id === 'dividend_growth')!;
for (const total of [1_000_000_000, 333_333_333, 1, 7]) {
  const legs = scalePresetToTotal(dg, total);
  check(sum(legs.map((l) => l.amount)) === total, `Σ amount == ${total}`);
  check(legs.every((l) => Number.isInteger(l.amount) && l.amount >= 0), `integer non-negative amounts for ${total}`);
}
check(scalePresetToTotal(dg, 0).length === 0, 'total 0 → []');
check(scalePresetToTotal(dg, -5).length === 0, 'negative total → []');
check(
  scalePresetToTotal(dg, 1_000_000_000)[0].amount === 400_000_000,
  'VOO 40% of 10억 = 4억',
);

// 3. holdingFromCatalogRow: productType from DB, fallback by market; cycle validated
const schdRow: EtfCatalogRow = {
  ticker: 'SCHD', name: 'Schwab U.S. Dividend Equity ETF', market: 'US', category: 'DIVIDEND',
  expenseRatio: 0.06, actualExpenseRatio: 0.06, dividendYield: 3.6, dividendCycle: 'Quarterly',
  expectedGrowthRate: 6.4, productType: 'overseas_direct', aumKrw: 1, eligibleIsa: false,
  eligiblePension: false, underlyingIndex: 'Dow Jones US Dividend', issuer: 'Charles Schwab', isEstimated: false,
};
const h1 = holdingFromCatalogRow(schdRow, 123);
check(h1.amount === 123 && h1.productType === 'overseas_direct' && h1.dividendCycle === 'Quarterly', 'SCHD row → holding');
const weirdRow: EtfCatalogRow = { ...schdRow, ticker: '360750', market: 'KRX', productType: 'bogus' as never, dividendCycle: 'Weird' };
const h2 = holdingFromCatalogRow(weirdRow, 1);
check(h2.productType === 'domestic_listed' && h2.dividendCycle === 'Quarterly', 'invalid productType/cycle fall back (KRX → domestic_listed, Quarterly)');
const noneRow: EtfCatalogRow = { ...schdRow, ticker: 'GLD', dividendCycle: 'None', dividendYield: 0, productType: 'other' };
check(holdingFromCatalogRow(noneRow, 1).dividendCycle === 'None', "'None' cycle preserved");

// 4. applyPresetToHoldings: catalog rows resolved by ticker, Σ == total, missing tickers renormalised
const rows: EtfCatalogRow[] = [
  { ...schdRow, ticker: 'VOO', name: 'Vanguard S&P 500', category: 'US_INDEX', dividendYield: 1.4, expectedGrowthRate: 8.5 },
  schdRow,
  { ...schdRow, ticker: '360750', name: 'TIGER 미국S&P500', market: 'KRX', category: 'US_INDEX', productType: 'domestic_listed' },
  { ...schdRow, ticker: 'JEPI', name: 'JPM Equity Premium Income', category: 'COVERED_CALL', productType: 'covered_call', dividendCycle: 'Monthly' },
];
const applied = applyPresetToHoldings(dg, 1_000_000_000, rows);
check(applied.missing.length === 0, 'all dividend_growth tickers resolved');
check(applied.holdings.length === 4 && sum(applied.holdings.map((h) => h.amount)) === 1_000_000_000, 'Σ holdings == 10억');
check(applied.holdings.map((h) => h.ticker).join(',') === 'VOO,SCHD,360750,JEPI', 'preset order preserved');
check(applied.holdings.every((h) => typeof h.ratio === 'number' && h.ratio! > 0), 'ratio populated');
const partial = applyPresetToHoldings(dg, 1_000_000_000, rows.slice(0, 2));
check(partial.missing.join(',') === '360750,JEPI', 'missing tickers reported');
check(sum(partial.holdings.map((h) => h.amount)) === 1_000_000_000, 'renormalised Σ == total when legs missing');
check(partial.holdings[0].amount === Math.floor((40 / 70) * 1_000_000_000), 'VOO renormalised to 40/70');
check(applyPresetToHoldings(dg, 1_000_000_000, []).holdings.length === 0, 'no catalog rows → no holdings');

// 5. rebalanceHoldingsToTotal (비례 맞춤) and addHoldingKeepingTotal (Q12: total ÷ (N+1), total invariant)
const base = applied.holdings;
const re = rebalanceHoldingsToTotal(base, 777_777_777);
check(sum(re.map((h) => h.amount)) === 777_777_777, 'rebalance Σ == new total');
check(Math.abs(re[0].amount / 777_777_777 - 0.4) < 1e-6, 'rebalance keeps proportions');
check(rebalanceHoldingsToTotal(base, 0).every((h) => h.amount === 0), 'rebalance to 0 zeroes amounts');
const zeroBase = base.map((h) => ({ ...h, amount: 0 }));
const reZero = rebalanceHoldingsToTotal(zeroBase, 400);
check(sum(reZero.map((h) => h.amount)) === 400, 'rebalance from all-zero splits equally and sums exactly');
const gld = holdingFromCatalogRow(noneRow, 0);
const added = addHoldingKeepingTotal(base, gld);
check(sum(added.map((h) => h.amount)) === 1_000_000_000, 'add keeps total invariant');
check(added[added.length - 1].ticker === 'GLD' && added[added.length - 1].amount === 200_000_000, 'new holding gets total ÷ (N+1)');
check(added[0].amount === 320_000_000, 'existing scaled by N/(N+1) (4억 → 3.2억)');
check(addHoldingKeepingTotal(base, { ...gld, ticker: 'VOO' }).length === base.length, 'duplicate ticker ignored');
check(addHoldingKeepingTotal([], gld)[0].amount === 0, 'adding to empty list keeps 0 total');
check(base[0].amount === 400_000_000, 'inputs not mutated');

// 6. Starter holdings: DB taxonomy categories, no reference sharing across presets/default inputs
const dbCats = new Set(['US_INDEX', 'KR_INDEX', 'DIVIDEND', 'COVERED_CALL', 'BOND', 'COMMODITY', 'OTHER', 'TECH', 'GROWTH', 'VALUE', 'SECTOR', 'GLOBAL_INDEX', 'DEVELOPED', 'EMERGING', 'REAL_ESTATE', 'CASH_EQUIV']);
check(STARTER_ETF_HOLDINGS.every((h) => dbCats.has(h.category)), 'STARTER categories use DB taxonomy');
check(STARTER_SHELTERED_ETF_HOLDINGS.every((h) => dbCats.has(h.category) && h.market === 'KRX'), 'STARTER_SHELTERED_ETF_HOLDINGS are all KRX with DB categories');
check(DEFAULT_SIMULATION_INPUTS.asset.holdings !== STARTER_ETF_HOLDINGS, 'DEFAULT inputs do not alias STARTER array');
check(DEFAULT_SIMULATION_INPUTS.asset.holdings![0] !== STARTER_ETF_HOLDINGS[0], 'DEFAULT holdings are deep copies');
check(DEFAULT_SIMULATION_INPUTS.accounts.shelteredHoldings !== STARTER_SHELTERED_ETF_HOLDINGS, 'DEFAULT shelteredHoldings do not alias STARTER_SHELTERED array');
check(DEFAULT_SIMULATION_INPUTS.accounts.shelteredHoldings![0] !== STARTER_SHELTERED_ETF_HOLDINGS[0], 'DEFAULT shelteredHoldings are deep copies');
for (const sc of PRESET_SCENARIOS) {
  const hs = sc.inputs.asset.holdings;
  if (hs) check(hs !== STARTER_ETF_HOLDINGS && hs !== DEFAULT_SIMULATION_INPUTS.asset.holdings, `${sc.id} holdings not aliased`);
  const shs = sc.inputs.accounts.shelteredHoldings;
  if (shs) check(shs !== STARTER_SHELTERED_ETF_HOLDINGS && shs !== DEFAULT_SIMULATION_INPUTS.accounts.shelteredHoldings, `${sc.id} shelteredHoldings not aliased`);
}

// 7. Engine consumption sanity: detailed evaluation of an applied preset yields plausible blended rates
const ev = evaluatePortfolio({ ...DEFAULT_SIMULATION_INPUTS.asset, inputMode: 'detailed', holdings: applied.holdings, totalInvestment: 1_000_000_000 });
check(ev.effectiveDividendYield > 0 && ev.effectiveGrowthRate > 0 && ev.overseasDirectRatio === 80, 'evaluatePortfolio: 80% overseas direct (VOO+SCHD+JEPI)');

const shTotal = calculateCurrentShelteredTotal(DEFAULT_SIMULATION_INPUTS.accounts, true);
check(shTotal === 290_000_000, 'default couple sheltered total == 2.9억');
const shEv = evaluateShelteredPortfolio(
  { ...DEFAULT_SIMULATION_INPUTS.accounts, shelteredInputMode: 'detailed', shelteredHoldings: STARTER_SHELTERED_ETF_HOLDINGS },
  ev,
);
check(shEv.effectiveTotalReturn > 0 && shEv.overseasDirectRatio === 0, 'evaluateShelteredPortfolio: KRX holdings yield 0% overseasDirectRatio');
check(evaluateHoldingsList([]) === null, 'evaluateHoldingsList([]) returns null');

console.log(`✅ PASS: portfolioPresets.test.ts (${n} assertions passed)`);
