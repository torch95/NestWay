import type { EtfHolding, EtfProductType } from './types';

/**
 * Recommended ETF portfolio presets ("추천 포트폴리오 빠른 적용").
 *
 * Presets carry only tickers and target weights; price/yield/expense metadata is
 * resolved at runtime from the read-only ETF catalog (`GET /api/etf/list?tickers=`)
 * so figures never drift from the database.
 */
export type PortfolioPresetId =
  | 'dividend_growth'
  | 'all_weather'
  | 'monthly_income'
  | 'kr_tax_advantaged'
  | 'kr_all_in_one_6'
  | 'kr_us_dividend_bond'
  | 'kr_us_growth_focus'
  | 'kr_korea_us_balanced'
  | 'kr_kospi_dividend_safe';

export interface PortfolioPresetLeg {
  ticker: string;
  /** Target weight in percent; legs of a preset sum to 100. */
  weight: number;
}

export interface PortfolioPreset {
  id: PortfolioPresetId;
  label: string;
  description: string;
  legs: PortfolioPresetLeg[];
}

/** Catalog row returned by `/api/etf/list` (camelCase projection of `etf_master`). */
export interface EtfCatalogRow {
  ticker: string;
  name: string;
  market: 'KRX' | 'US';
  category: string;
  expenseRatio: number;
  actualExpenseRatio: number;
  dividendYield: number;
  dividendCycle: string;
  expectedGrowthRate: number;
  productType: string;
  aumKrw: number;
  eligibleIsa: boolean;
  eligiblePension: boolean;
  underlyingIndex: string;
  issuer: string;
  /** Collector placeholder (growth 4.5 / yield 2.0) — figures are estimates, not observed. */
  isEstimated: boolean;
}

export const PORTFOLIO_PRESETS: PortfolioPreset[] = [
  {
    id: 'dividend_growth',
    label: '배당성장 코어',
    description: 'S&P500 성장 코어에 배당성장(SCHD)·국내상장 S&P500·커버드콜 소량을 섞은 균형형',
    legs: [
      { ticker: 'VOO', weight: 40 },
      { ticker: 'SCHD', weight: 30 },
      { ticker: '360750', weight: 20 },
      { ticker: 'JEPI', weight: 10 },
    ],
  },
  {
    id: 'all_weather',
    label: '올웨더 방어',
    description: '주식·장기채·금을 분산해 하락장 방어력을 높인 자산배분형',
    legs: [
      { ticker: 'VOO', weight: 40 },
      { ticker: 'TLT', weight: 30 },
      { ticker: 'GLD', weight: 15 },
      { ticker: 'SCHD', weight: 15 },
    ],
  },
  {
    id: 'monthly_income',
    label: '월배당 현금흐름',
    description: '커버드콜(JEPI·JEPQ) 중심으로 월 현금흐름을 극대화하는 인컴형',
    legs: [
      { ticker: 'JEPI', weight: 35 },
      { ticker: 'JEPQ', weight: 35 },
      { ticker: 'SCHD', weight: 30 },
    ],
  },
  {
    id: 'kr_tax_advantaged',
    label: '국내상장 절세',
    description: 'ISA·연금계좌 편입 가능한 국내상장 미국지수·배당 ETF로 과세이연을 노리는 절세형',
    legs: [
      { ticker: '360750', weight: 50 },
      { ticker: '446720', weight: 50 },
    ],
  },
];

/**
 * Dedicated KRX-only recommended presets for Tax-Advantaged & Pension accounts (ISA · 연금저축 · IRP),
 * constructed from the 6 core domestic-listed ETFs:
 * - 360750: TIGER 미국S&P500 (국내 상장 S&P500)
 * - 133690: TIGER 미국나스닥100 (국내 상장 나스닥 100)
 * - 458730: TIGER 미국배당다우존스 (국내 상장 미국배당다우존스)
 * - 069500: KODEX 200 (코스피200)
 * - 292150: TIGER 코리아TOP10 (코스피 TOP10)
 * - 273130: KODEX 종합채권(AA-이상)액티브 (국내채권)
 */
export const SHELTERED_PORTFOLIO_PRESETS: PortfolioPreset[] = [
  {
    id: 'kr_all_in_one_6',
    label: '6대 핵심자산 올인원',
    description:
      '국내상장 S&P500(25%)·나스닥100(15%)·미국배당다우존스(20%)·코스피200(10%)·코스피TOP10(10%)·국내채권(20%) 6종 황금배분',
    legs: [
      { ticker: '360750', weight: 25 },
      { ticker: '133690', weight: 15 },
      { ticker: '458730', weight: 20 },
      { ticker: '069500', weight: 10 },
      { ticker: '292150', weight: 10 },
      { ticker: '273130', weight: 20 },
    ],
  },
  {
    id: 'kr_us_dividend_bond',
    label: 'S&P500·미배당·국내채권 코어',
    description:
      'TIGER 미국S&P500(40%) + TIGER 미국배당다우존스(30%) + KODEX 종합채권(30%)으로 IRP 안전자산 30%까지 충족하는 대표 연금 조합',
    legs: [
      { ticker: '360750', weight: 40 },
      { ticker: '458730', weight: 30 },
      { ticker: '273130', weight: 30 },
    ],
  },
  {
    id: 'kr_us_growth_focus',
    label: 'S&P500·나스닥·미배당 성장형',
    description:
      'TIGER 미국S&P500(40%) + TIGER 미국나스닥100(35%) + TIGER 미국배당다우존스(25%)로 과세이연 복리를 극대화하는 ISA·연금저축 성장 조합',
    legs: [
      { ticker: '360750', weight: 40 },
      { ticker: '133690', weight: 35 },
      { ticker: '458730', weight: 25 },
    ],
  },
  {
    id: 'kr_korea_us_balanced',
    label: '한·미 지수 & 코스피TOP10 균형',
    description:
      '미국S&P500(30%) + 코스피200(25%) + 코리아TOP10(25%) + 국내채권(20%)으로 한·미 대표지수와 채권을 균형 배분한 포트폴리오',
    legs: [
      { ticker: '360750', weight: 30 },
      { ticker: '069500', weight: 25 },
      { ticker: '292150', weight: 25 },
      { ticker: '273130', weight: 20 },
    ],
  },
  {
    id: 'kr_kospi_dividend_safe',
    label: '코스피·TOP10·미배당·채권 안정형',
    description:
      '코스피200(25%) + 코리아TOP10(20%) + 미국배당다우존스(25%) + 국내채권(30%)으로 배당과 안정성을 높인 보수적 연금 포트폴리오',
    legs: [
      { ticker: '069500', weight: 25 },
      { ticker: '292150', weight: 20 },
      { ticker: '458730', weight: 25 },
      { ticker: '273130', weight: 30 },
    ],
  },
];

const VALID_PRODUCT_TYPES: ReadonlySet<string> = new Set<EtfProductType>([
  'overseas_direct',
  'domestic_listed',
  'covered_call',
  'other',
]);
const VALID_CYCLES: ReadonlySet<string> = new Set(['Monthly', 'Quarterly', 'Annual', 'None']);

/**
 * Splits `total` across weights so that Σ amounts === total exactly:
 * every leg is floored and the rounding residual goes to the last leg.
 */
function splitExactly(total: number, weights: number[]): number[] {
  const safeTotal = Math.max(0, Math.floor(total));
  const wSum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (safeTotal <= 0 || weights.length === 0) return weights.map(() => 0);
  const normalized = wSum > 0 ? weights.map((w) => Math.max(0, w) / wSum) : weights.map(() => 1 / weights.length);
  const amounts = normalized.map((w) => Math.floor(safeTotal * w));
  const residual = safeTotal - amounts.reduce((a, b) => a + b, 0);
  amounts[amounts.length - 1] += residual;
  return amounts;
}

export interface ScaledPresetLeg extends PortfolioPresetLeg {
  amount: number;
}

/** Scales a preset's percentage legs onto a KRW total; returns [] when total <= 0. */
export function scalePresetToTotal(preset: PortfolioPreset, total: number): ScaledPresetLeg[] {
  if (!(total > 0) || preset.legs.length === 0) return [];
  const amounts = splitExactly(total, preset.legs.map((l) => l.weight));
  return preset.legs.map((leg, i) => ({ ...leg, amount: amounts[i] }));
}

/** Builds an engine `EtfHolding` from a catalog row; productType/cycle are validated with market fallbacks. */
export function holdingFromCatalogRow(row: EtfCatalogRow, amount: number, ratio?: number): EtfHolding {
  const productType: EtfProductType = VALID_PRODUCT_TYPES.has(row.productType)
    ? (row.productType as EtfProductType)
    : row.market === 'US'
      ? 'overseas_direct'
      : 'domestic_listed';
  const dividendCycle = (VALID_CYCLES.has(row.dividendCycle) ? row.dividendCycle : 'Quarterly') as EtfHolding['dividendCycle'];
  return {
    ticker: row.ticker,
    name: row.name,
    market: row.market,
    amount: Math.max(0, Math.floor(amount || 0)),
    ratio,
    category: row.category || 'OTHER',
    expenseRatio: Number(row.expenseRatio) || 0,
    actualExpenseRatio: Number(row.actualExpenseRatio) || Number(row.expenseRatio) || 0,
    dividendYield: Number(row.dividendYield) || 0,
    dividendCycle,
    expectedGrowthRate: Number(row.expectedGrowthRate) || 0,
    productType,
  };
}

function withRatios(holdings: EtfHolding[]): EtfHolding[] {
  const total = holdings.reduce((a, h) => a + Math.max(0, h.amount || 0), 0);
  return holdings.map((h) => ({
    ...h,
    ratio: total > 0 ? Math.round((Math.max(0, h.amount || 0) / total) * 1000) / 10 : 0,
  }));
}

export interface AppliedPreset {
  holdings: EtfHolding[];
  /** Preset tickers absent from the supplied catalog rows (weights were renormalised over the rest). */
  missing: string[];
}

/**
 * Resolves a preset against catalog rows and scales it onto `total`.
 * Missing tickers are reported and the remaining legs are renormalised so Σ amount === total.
 */
export function applyPresetToHoldings(
  preset: PortfolioPreset,
  total: number,
  rows: EtfCatalogRow[],
): AppliedPreset {
  const byTicker = new Map(rows.map((r) => [r.ticker.toUpperCase(), r]));
  const found = preset.legs.filter((l) => byTicker.has(l.ticker.toUpperCase()));
  const missing = preset.legs.filter((l) => !byTicker.has(l.ticker.toUpperCase())).map((l) => l.ticker);
  if (found.length === 0 || !(total > 0)) return { holdings: [], missing };
  const amounts = splitExactly(total, found.map((l) => l.weight));
  const holdings = found.map((leg, i) => holdingFromCatalogRow(byTicker.get(leg.ticker.toUpperCase())!, amounts[i]));
  return { holdings: withRatios(holdings), missing };
}

/** "비례 맞춤": rescales existing holdings proportionally so Σ amount === total (equal split when all are 0). */
export function rebalanceHoldingsToTotal(holdings: EtfHolding[], total: number): EtfHolding[] {
  if (holdings.length === 0) return [];
  const amounts = splitExactly(total, holdings.map((h) => Math.max(0, h.amount || 0)));
  return withRatios(holdings.map((h, i) => ({ ...h, amount: amounts[i] })));
}

/**
 * Adds a holding without changing the portfolio total: the newcomer receives total ÷ (N+1)
 * and existing positions shrink proportionally. Duplicate tickers are ignored.
 */
export function addHoldingKeepingTotal(holdings: EtfHolding[], next: EtfHolding): EtfHolding[] {
  if (holdings.some((h) => h.ticker === next.ticker)) return holdings;
  const total = holdings.reduce((a, h) => a + Math.max(0, h.amount || 0), 0);
  if (holdings.length === 0 || total <= 0) return withRatios([...holdings, { ...next, amount: 0 }]);
  const newcomer = Math.floor(total / (holdings.length + 1));
  const shrunk = rebalanceHoldingsToTotal(holdings, total - newcomer);
  return withRatios([...shrunk, { ...next, amount: newcomer }]);
}
