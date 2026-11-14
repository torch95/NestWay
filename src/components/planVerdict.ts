import {
  SIMULATION_BASE_YEAR,
  formatKRW,
  getPensionClaimStartAge,
  getPensionTimingMultiplier,
  runCanonicalLedger,
  type AllocationRecommendation,
  type PensionClaimTiming,
  type CanonicalYearRow,
  type MonteCarloAssumptions,
  type OptimizationMasterPlan,
  type SimulationInputs,
} from '../engine';

/**
 * 표시 전용 판정·환산 헬퍼 (새 금융 로직 없음 — 엔진 산출값만 매핑).
 * - 판정: 고갈 연령 / ALL_DEPLETE / 미충족 지출(엔진) + MC 생존확률(엔진) + 월 여유분(엔진)
 * - 임계(B4, eval-ux·eval-engine 공동 권고 #39): 안전 ≥80% & 월 여유분 ≥100만 / 주의 60~79% 또는 여유분 <100만 /
 *   위험 = 결정론 고갈·ALL_DEPLETE·미충족 지출 또는 생존확률 <60%. Plan B 박스는 shouldShowPlanB 하나로 같은 기준을 쓴다.
 */
export type VerdictLevel = 'safe' | 'caution' | 'risk';

export const VERDICT_SURVIVAL_MIN_PCT = 80;
export const VERDICT_SURVIVAL_RISK_PCT = 60;
export const VERDICT_BUFFER_MIN_WON = 1_000_000;
/** 판정 임계(안전 80% · 위험 60%) ±5%p — 100표본 표본오차 안이라 판정이 바뀔 수 있는 경계 구간 */
export const VERDICT_BORDERLINE_RANGE = [75, 84] as const;
export const VERDICT_RISK_BORDERLINE_RANGE = [55, 64] as const;

/** Plan B(하방 보강) 권고 노출 조건 = '안전' 미달 조건. 히어로 판정과 항상 같은 기준. */
export const shouldShowPlanB = (survivalProbabilityPercent: number, monthlyBuffer: number) =>
  survivalProbabilityPercent < VERDICT_SURVIVAL_MIN_PCT || monthlyBuffer < VERDICT_BUFFER_MIN_WON;

const inRange = (pct: number, r: readonly [number, number]) => pct >= r[0] && pct <= r[1];
export const isBorderlineSurvival = (pct: number) =>
  inRange(pct, VERDICT_BORDERLINE_RANGE) || inRange(pct, VERDICT_RISK_BORDERLINE_RANGE);

/** 생존확률 가정 설명(툴팁·캡션) — 엔진 mcAssumptions에서 읽는다. */
export function survivalAssumptionText(mc: MonteCarloAssumptions | undefined, pct: number): string {
  const base = mc
    ? `몬테카를로 ${mc.sampleCount}개 경로 · 연 수익률 변동성 σ ${mc.annualVolatilityPct}%p(연도별 독립 정규분포, 변동성 보정 +${mc.driftCorrectionPct}%p) · 표본오차 약 ±5%p`
    : '몬테카를로 표본 기반 · 표본오차 약 ±5%p';
  if (inRange(pct, VERDICT_BORDERLINE_RANGE)) {
    return `${base} · 경계값: 안전 기준(${VERDICT_SURVIVAL_MIN_PCT}%)과의 차이가 표본오차 안입니다`;
  }
  if (inRange(pct, VERDICT_RISK_BORDERLINE_RANGE)) {
    return `${base} · 경계값: 위험 기준(${VERDICT_SURVIVAL_RISK_PCT}%)과의 차이가 표본오차 안입니다`;
  }
  return base;
}

export interface PlanVerdict {
  level: VerdictLevel;
  badge: string;
  headline: string;
}

/** B6: 국민연금 개시연령은 엔진(출생연도별 법정연령 ±5)에서 읽는다 — UI 하드코딩 60/65/70 금지. */
export const claimStartAge = (timing: PensionClaimTiming, currentAge: number) =>
  getPensionClaimStartAge(timing, SIMULATION_BASE_YEAR - currentAge);
const TIMING_WORD: Record<PensionClaimTiming, string> = { early: '조기', normal: '정상', deferred: '연기' };
/** 예: '64세 정상수령' / withPct → '64세 정상수령 (100%)' */
export const claimTimingLabel = (timing: PensionClaimTiming, currentAge: number, withPct = false) =>
  `${claimStartAge(timing, currentAge)}세 ${TIMING_WORD[timing]}수령${
    withPct ? ` (${Math.round(getPensionTimingMultiplier(timing) * 100)}%)` : ''
  }`;

/** U-1: 활성 비율(auto=권고, 수동=사용자)의 전략 카드 — 엔진 plan.activeCard가 단일 정본 (구버전 스냅샷은 기존 규칙으로 폴백). */
export const pickActiveCard = (plan: OptimizationMasterPlan) => {
  if (plan.activeCard) return plan.activeCard;
  const { activeLedger, cards, inputs } = plan;
  const isOptimalActive = inputs.hybrid.useAutoOptimalRatio ?? true;
  return isOptimalActive
    ? cards.hybrid
    : activeLedger.personalRatio === 100
      ? cards.personal
      : activeLedger.personalRatio === 0
        ? cards.corporate
        : cards.hybrid;
};

export function classifyPlanVerdict(args: {
  allocationStatus: OptimizationMasterPlan['allocationStatus'];
  depletionAgeSelf: number | null;
  totalUnmetSpendingNeed: number;
  survivalProbabilityPercent: number;
  monthlyBuffer: number;
}): PlanVerdict {
  const { allocationStatus, depletionAgeSelf, totalUnmetSpendingNeed, survivalProbabilityPercent, monthlyBuffer } =
    args;
  if (allocationStatus === 'ALL_DEPLETE' || depletionAgeSelf !== null || totalUnmetSpendingNeed > 0) {
    return {
      level: 'risk',
      badge: '위험',
      headline:
        depletionAgeSelf !== null
          ? `${depletionAgeSelf}세에 금융자산이 고갈됩니다`
          : '목표 생활비를 100세까지 충당하지 못합니다',
    };
  }
  if (survivalProbabilityPercent < VERDICT_SURVIVAL_RISK_PCT) {
    return { level: 'risk', badge: '위험', headline: '시장 변동 시 고갈 위험이 큽니다' };
  }
  if (shouldShowPlanB(survivalProbabilityPercent, monthlyBuffer)) {
    return {
      level: 'caution',
      badge: '주의',
      headline: '100세까지 유지되지만 하방 여유가 얇습니다',
    };
  }
  return { level: 'safe', badge: '안전', headline: '100세까지 자산이 유지됩니다' };
}

/** 실질 모드에서 D-Day(은퇴 당일) 명목 금액을 해당 연차 원장 discountFactor로 현재가치 환산해 병기. */
export function formatDdayAmount(
  amount: number,
  rows: CanonicalYearRow[],
  retirementAgeSelf: number,
  isReal: boolean,
): string {
  if (!isReal) return formatKRW(amount);
  const df = rows.find((r) => r.ageSelf === retirementAgeSelf)?.discountFactor ?? 1;
  return `${formatKRW(Math.round(amount * df))} (현재가치 · ${retirementAgeSelf}세 시점 명목 ${formatKRW(amount)})`;
}

/**
 * B8: 전략 카드 배지 — 권고 = 수학적 최적이면 기존 'OPTIMAL r*' 1개(권고 카드),
 * 다르면 hybrid 카드에 '수학적 최적 r*', 권고 카드에 '권고'.
 */
export function strategyCardPills(
  strategyType: string,
  winner: string,
  recommendation: Pick<AllocationRecommendation, 'isMathematicalOptimum'>,
): string[] {
  if (recommendation.isMathematicalOptimum) return strategyType === winner ? ['OPTIMAL r*'] : [];
  const pills: string[] = [];
  if (strategyType === 'hybrid') pills.push('수학적 최적 r*');
  if (strategyType === winner) pills.push('권고');
  return pills;
}

/** 'OPTIMAL r*' 배지의 최적 기준 + 다른 전략이 더 높은 지속가능 월생활비를 주는 경우의 트레이드오프 1줄. */
export function optimalTradeoffNote(
  cards: { strategyType: string; strategyName: string; sustainableMonthlyLivingExpense: number }[],
  bestType: string,
  recommendation?: Pick<AllocationRecommendation, 'isMathematicalOptimum' | 'personalRatio' | 'corporateRatio'>,
): string {
  // B8: 실행 권고가 수학적 최적 r*와 다르면(실익 임계 미달) 기준과 권고를 함께 밝힌다
  if (recommendation && !recommendation.isMathematicalOptimum) {
    return `최적 기준: 100세 세후 순자산 최대(수학적 최적 r*) · 실행 권고는 개인 ${recommendation.personalRatio}% : 법인 ${recommendation.corporateRatio}% (법인 실익이 작거나 가정 변화에 취약 — 권고 사유 참고)`;
  }
  const best = cards.find((c) => c.strategyType === bestType);
  if (!best) return '';
  const rival = cards
    .filter((c) => c.strategyType !== bestType)
    .sort((a, b) => b.sustainableMonthlyLivingExpense - a.sustainableMonthlyLivingExpense)[0];
  const base = '최적 기준: 100세 세후 순자산 최대';
  if (!rival || rival.sustainableMonthlyLivingExpense <= best.sustainableMonthlyLivingExpense) return base;
  const diff = rival.sustainableMonthlyLivingExpense - best.sustainableMonthlyLivingExpense;
  return `${base} · 단, 지속가능 월생활비는 ${rival.strategyName}가 월 ${formatKRW(diff)} 더 높습니다 (생활비 극대화가 목표라면 함께 비교하세요)`;
}

/**
 * C3 Plan B 단일 레버: 다른 입력과 개인:법인 비율은 그대로 두고 하나만 바꿨을 때 해소되는 최소 변경량.
 * 해소 기준 = 결정론 원장에서 '목표 생활비 + 100만 원'으로도 100세까지 고갈·미충족 없음 (= 월 여유분 ≥ 100만, 판정 임계와 동일).
 * 몬테카를로 생존확률은 탐색에 쓰지 않는다(후보당 원장 1회 ≈ 0.3ms vs MC ≈ 60ms) — UI에 '생존확률 판정은 별도'를 명시.
 */
export const PLAN_B_MAX_DELAY_YEARS = 10;
export const PLAN_B_MAX_EXTRA_SAVINGS = 15_000_000;
const PLAN_B_MIN_LIVING = 1_000_000;

export function meetsPlanBTarget(inputs: SimulationInputs, personalRatio: number): boolean {
  const sim = runCanonicalLedger(
    {
      ...inputs,
      cashflow: {
        ...inputs.cashflow,
        targetNetMonthlyLivingExpense: inputs.cashflow.targetNetMonthlyLivingExpense + VERDICT_BUFFER_MIN_WON,
      },
    },
    personalRatio,
  );
  // 지속가능 한계생활비 솔버(solveSustainableMonthlyLiving)와 같은 허용오차(미충족 1만 원 이하)
  return sim.depletionAgeSelf === null && sim.totalUnmetSpendingNeed <= 10_000;
}

/** step 배수(1~max) 중 목표를 충족하는 최소값. 0은 미충족 전제(호출 전 확인), max에서도 미충족이면 null. */
const minPassing = (max: number, step: number, passes: (v: number) => boolean): number | null => {
  let hiK = Math.floor(max / step);
  if (hiK <= 0 || !passes(hiK * step)) return null;
  let loK = 0;
  while (hiK - loK > 1) {
    const midK = Math.floor((loK + hiK) / 2);
    if (passes(midK * step)) hiK = midK;
    else loK = midK;
  }
  return hiK * step;
};

export interface PlanBLevers {
  /** 결정론 기준은 이미 충족 — '주의'는 시장 변동(생존확률) 때문 */
  deterministicMet: boolean;
  /** 은퇴 후 월 생활비 감액(현재가치, 1만 원 단위). null = 생활비 조정만으로 해소 불가 */
  livingCut: number | null;
  /** 본인 은퇴 연기 연수. null = 10년 연장으로도 해소 불가 */
  retireDelayYears: number | null;
  /** 은퇴 전 저축 레버 표시 여부 (이미 은퇴 시점이면 false) */
  savingsApplicable: boolean;
  /** 은퇴 전 월 추가 저축(10만 원 단위). null = 월 1,500만 원 추가로도 해소 불가 */
  extraMonthlySavings: number | null;
}

export function computePlanBLevers(inputs: SimulationInputs, personalRatio: number): PlanBLevers {
  const savingsApplicable = inputs.pension.currentAgeSelf < inputs.transition.targetRetirementAgeSelf;
  if (meetsPlanBTarget(inputs, personalRatio)) {
    return { deterministicMet: true, livingCut: 0, retireDelayYears: 0, savingsApplicable, extraMonthlySavings: 0 };
  }
  const target = inputs.cashflow.targetNetMonthlyLivingExpense;
  const livingCut = minPassing(Math.max(0, target - PLAN_B_MIN_LIVING), 10_000, (cut) =>
    meetsPlanBTarget({ ...inputs, cashflow: { ...inputs.cashflow, targetNetMonthlyLivingExpense: target - cut } }, personalRatio),
  );

  let retireDelayYears: number | null = null;
  for (let n = 1; n <= PLAN_B_MAX_DELAY_YEARS; n++) {
    const delayed = {
      ...inputs,
      transition: { ...inputs.transition, targetRetirementAgeSelf: inputs.transition.targetRetirementAgeSelf + n },
    };
    if (meetsPlanBTarget(delayed, personalRatio)) {
      retireDelayYears = n;
      break;
    }
  }

  const baseSavings = inputs.transition.preRetirementMonthlySavings;
  const extraMonthlySavings = savingsApplicable
    ? minPassing(PLAN_B_MAX_EXTRA_SAVINGS, 100_000, (extra) =>
        meetsPlanBTarget(
          { ...inputs, transition: { ...inputs.transition, preRetirementMonthlySavings: baseSavings + extra } },
          personalRatio,
        ),
      )
    : null;

  return { deterministicMet: false, livingCut, retireDelayYears, savingsApplicable, extraMonthlySavings };
}
