import { runCanonicalLedger } from './ledgerKernel';
import { type SimulationInputs } from './types';

export interface SensitivityYearBandPoint {
  ageSelf: number;
  minus2PctNetWorth: number;
  baseNetWorth: number;
  plus2PctNetWorth: number;
  p10NetWorth: number;
  p50NetWorth: number;
  p90NetWorth: number;
}

export interface MonteCarloAssumptions {
  /** 연도별 독립(i.i.d.) 정규분포 수익률 충격 — 매년 다른 수익률로 순서위험(sequence-of-returns risk) 반영 */
  model: 'iid_normal_annual';
  /** 연 수익률 표준편차(%p) */
  annualVolatilityPct: number;
  /** 변동성 끌림 보정 +σ²/2(%p): 표본 중앙값이 결정론 기준 경로와 정합하도록 산술 평균을 상향 */
  driftCorrectionPct: number;
  sampleCount: number;
  /** z / −z 대칭 경로 쌍(분산 감소) */
  antithetic: boolean;
}

export interface SensitivityBandSummary {
  personalRatio: number;
  bandPoints: SensitivityYearBandPoint[];
  minus2FinalNetWorth: number;
  baseFinalNetWorth: number;
  plus2FinalNetWorth: number;
  minus2DepletionAge: number | null;
  baseDepletionAge: number | null;
  plus2DepletionAge: number | null;
  survivalProbabilityPercent: number;
  p10FinalNetWorth: number;
  p50FinalNetWorth: number;
  p90FinalNetWorth: number;
  mcAssumptions: MonteCarloAssumptions;
}

/** 몬테카를로 연 수익률 표준편차(%p) — 주식형 비중이 높은 은퇴 포트폴리오의 통상적 연 변동성 가정 */
export const MC_ANNUAL_VOLATILITY_PCT = 12;
const MC_DEFAULT_SAMPLE_COUNT = 100;

/** Deterministic PRNG (mulberry32) for zero-dependency reproducible simulation */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 연도별 i.i.d. 정규 수익률 충격 경로(%p): σ·z_t + σ²/2 (Box-Muller, |z| ≤ 4 절단)
 */
export function generateAnnualReturnPath(
  rand: () => number,
  years: number,
  annualVolatilityPct: number
): number[] {
  const sigma = annualVolatilityPct / 100;
  const driftPct = ((sigma * sigma) / 2) * 100;
  const path: number[] = [];
  for (let t = 0; t < years; t++) {
    const u1 = Math.max(1e-12, rand());
    const u2 = rand();
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    path.push(Math.max(-4, Math.min(4, z)) * annualVolatilityPct + driftPct);
  }
  return path;
}

export function shiftInputsReturn(inputs: SimulationInputs, deltaPct: number): SimulationInputs {
  return {
    ...inputs,
    asset: { ...inputs.asset, returnShiftPct: (inputs.asset.returnShiftPct ?? 0) + deltaPct },
  };
}

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[Math.min(sorted.length - 1, base + 1)];
  return Math.round(sorted[base] + rest * (next - sorted[base]));
}

/** 같은 입력 객체·비율·표본 수에 대한 재계산 방지 (여러 화면이 동일 밴드를 동시에 요청) */
const bandCache = new WeakMap<SimulationInputs, Map<string, SensitivityBandSummary>>();

/**
 * Evaluates deterministic ±2.0%p return sensitivity band and seeded Monte Carlo
 * (annual i.i.d. normal return paths, σ = MC_ANNUAL_VOLATILITY_PCT, antithetic pairs)
 * P10 / P50 / P90 survival dispersion on top of the 1-Won canonical ledger.
 */
export function evaluateSensitivityBand(
  inputs: SimulationInputs,
  personalRatio: number,
  sampleCount = MC_DEFAULT_SAMPLE_COUNT
): SensitivityBandSummary {
  const count = Math.max(10, Math.min(200, Math.round(sampleCount)));
  const cacheKey = `${personalRatio}:${count}`;
  const cached = bandCache.get(inputs)?.get(cacheKey);
  if (cached) return cached;

  const minus2Run = runCanonicalLedger(shiftInputsReturn(inputs, -2.0), personalRatio);
  const baseRun = runCanonicalLedger(inputs, personalRatio);
  const plus2Run = runCanonicalLedger(shiftInputsReturn(inputs, 2.0), personalRatio);

  const rand = mulberry32(0x20260405 ^ Math.round(personalRatio * 97));
  const sigmaPct = MC_ANNUAL_VOLATILITY_PCT;
  const driftPct = ((sigmaPct / 100) ** 2 / 2) * 100;
  const years = baseRun.rows.length;
  const sampleRuns = [];
  let survivedCount = 0;
  let path: number[] = [];

  for (let i = 0; i < count; i++) {
    // 짝수 표본: 새 경로(σ·z + σ²/2), 홀수 표본: 대칭 경로(−σ·z + σ²/2)
    path =
      i % 2 === 0
        ? generateAnnualReturnPath(rand, years, sigmaPct)
        : path.map((v) => 2 * driftPct - v);
    const run = runCanonicalLedger(
      { ...inputs, asset: { ...inputs.asset, returnPathPct: path } },
      personalRatio
    );
    if (run.depletionAgeSelf === null && run.finalDisposableNetWorth > 0) {
      survivedCount++;
    }
    sampleRuns.push(run);
  }

  const isReal = inputs.transition.viewMode === 'real';
  const rowCount = baseRun.rows.length;
  const bandPoints: SensitivityYearBandPoint[] = [];

  for (let rIdx = 0; rIdx < rowCount; rIdx++) {
    const bRow = baseRun.rows[rIdx];
    const mRow = minus2Run.rows[rIdx] ?? bRow;
    const pRow = plus2Run.rows[rIdx] ?? bRow;
    const scale = (val: number, factor: number) => (isReal ? Math.round(val * factor) : val);

    const yearSamples = sampleRuns
      .map((sr) => {
        const row = sr.rows[rIdx] ?? bRow;
        return scale(row.endDisposableNetWorth, row.discountFactor);
      })
      .sort((a, b) => a - b);

    bandPoints.push({
      ageSelf: bRow.ageSelf,
      minus2PctNetWorth: scale(mRow.endDisposableNetWorth, mRow.discountFactor),
      baseNetWorth: scale(bRow.endDisposableNetWorth, bRow.discountFactor),
      plus2PctNetWorth: scale(pRow.endDisposableNetWorth, pRow.discountFactor),
      p10NetWorth: quantileSorted(yearSamples, 0.1),
      p50NetWorth: quantileSorted(yearSamples, 0.5),
      p90NetWorth: quantileSorted(yearSamples, 0.9),
    });
  }

  const lastPoint = bandPoints[bandPoints.length - 1] ?? {
    ageSelf: 100,
    minus2PctNetWorth: minus2Run.finalDisposableNetWorth,
    baseNetWorth: baseRun.finalDisposableNetWorth,
    plus2PctNetWorth: plus2Run.finalDisposableNetWorth,
    p10NetWorth: minus2Run.finalDisposableNetWorth,
    p50NetWorth: baseRun.finalDisposableNetWorth,
    p90NetWorth: plus2Run.finalDisposableNetWorth,
  };

  const summary: SensitivityBandSummary = {
    personalRatio,
    bandPoints,
    minus2FinalNetWorth: minus2Run.finalDisposableNetWorth,
    baseFinalNetWorth: baseRun.finalDisposableNetWorth,
    plus2FinalNetWorth: plus2Run.finalDisposableNetWorth,
    minus2DepletionAge: minus2Run.depletionAgeSelf,
    baseDepletionAge: baseRun.depletionAgeSelf,
    plus2DepletionAge: plus2Run.depletionAgeSelf,
    survivalProbabilityPercent: Math.round((survivedCount / count) * 100),
    p10FinalNetWorth: lastPoint.p10NetWorth,
    p50FinalNetWorth: lastPoint.p50NetWorth,
    p90FinalNetWorth: lastPoint.p90NetWorth,
    mcAssumptions: {
      model: 'iid_normal_annual',
      annualVolatilityPct: sigmaPct,
      driftCorrectionPct: driftPct,
      sampleCount: count,
      antithetic: true,
    },
  };
  const perInputs = bandCache.get(inputs) ?? new Map<string, SensitivityBandSummary>();
  perInputs.set(cacheKey, summary);
  bandCache.set(inputs, perInputs);
  return summary;
}
