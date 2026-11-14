import React from 'react';
import { formatKRW, type MonteCarloAssumptions, type OptimizationMasterPlan } from '../engine';
import {
  VERDICT_BUFFER_MIN_WON,
  VERDICT_SURVIVAL_MIN_PCT,
  VERDICT_SURVIVAL_RISK_PCT,
  classifyPlanVerdict,
  isBorderlineSurvival,
  pickActiveCard,
  survivalAssumptionText,
} from './planVerdict';
import { InfoPop } from './InfoPop';

export interface VerdictHeaderProps {
  plan: OptimizationMasterPlan;
}

/** U3 판정 히어로: '100세까지 안전한가?'에 대한 답(안전/주의/위험)을 행동 지침보다 먼저 보여준다. */
export const VerdictHero: React.FC<{
  plan: OptimizationMasterPlan;
  survivalProbabilityPercent: number;
  mcAssumptions?: MonteCarloAssumptions;
  /** 'popover': 브리핑 슬라이드 — 판정 기준·몬테카를로 가정을 ⓘ 팝업으로 / 'inline'(기본): PDF 리포트 등 펼침 */
  criteriaMode?: 'inline' | 'popover';
}> = ({ plan, survivalProbabilityPercent, mcAssumptions, criteriaMode = 'inline' }) => {
  const mcText = survivalAssumptionText(mcAssumptions, survivalProbabilityPercent);
  const { activeLedger, inputs } = plan;
  const activeCard = pickActiveCard(plan);
  const mcCaption = mcAssumptions
    ? `표본 ${mcAssumptions.sampleCount}개 · σ ${mcAssumptions.annualVolatilityPct}%p · 오차 ±5%p`
    : '표본오차 ±5%p';
  const criteriaText = `판정 기준 — 안전: 고갈 없음 · 생존확률 ${VERDICT_SURVIVAL_MIN_PCT}% 이상 · 월 여유분 ${formatKRW(VERDICT_BUFFER_MIN_WON)} 이상 / 주의: 생존확률 ${VERDICT_SURVIVAL_RISK_PCT}~${VERDICT_SURVIVAL_MIN_PCT - 1}% 또는 여유분 미달 / 위험: 100세 전 고갈·생활비 미충족 또는 생존확률 ${VERDICT_SURVIVAL_RISK_PCT}% 미만. ${mcText}`;
  const verdict = classifyPlanVerdict({
    allocationStatus: plan.allocationStatus,
    depletionAgeSelf: activeLedger.depletionAgeSelf,
    totalUnmetSpendingNeed: activeLedger.totalUnmetSpendingNeed,
    survivalProbabilityPercent,
    monthlyBuffer: activeCard.monthlyBuffer,
  });
  return (
    <section className={`verdict-hero verdict-hero-${verdict.level}`} aria-label="100세 안전성 종합 판정">
      <div className="verdict-hero-head">
        <span className="verdict-hero-badge">{verdict.badge}</span>
        <h2 className="verdict-hero-headline">{verdict.headline}</h2>
        {criteriaMode === 'popover' && (
          <InfoPop label="판정 기준" title="100세 안전성 판정 기준 · 몬테카를로 가정">
            <p>{mcCaption}</p>
            <p>{criteriaText}</p>
          </InfoPop>
        )}
      </div>
      <dl className="verdict-hero-metrics num">
        <div>
          <dt>100세 생존확률 (몬테카를로)</dt>
          <dd title={mcText}>
            {survivalProbabilityPercent}%
            {isBorderlineSurvival(survivalProbabilityPercent) && <small className="verdict-hero-borderline"> 경계값</small>}
          </dd>
          {criteriaMode === 'inline' && <span className="verdict-hero-mc">{mcCaption}</span>}
        </div>
        <div>
          <dt>지속가능 월생활비 / 목표</dt>
          <dd>
            월 {formatKRW(activeCard.sustainableMonthlyLivingExpense)}
            <small> / {formatKRW(inputs.cashflow.targetNetMonthlyLivingExpense)}</small>
          </dd>
        </div>
        <div>
          <dt>{activeLedger.depletionAgeSelf !== null ? '금융자산 고갈 시점' : '100세 세후 순자산'}</dt>
          <dd>
            {activeLedger.depletionAgeSelf !== null
              ? `${activeLedger.depletionAgeSelf}세`
              : formatKRW(activeLedger.finalDisposableNetWorth)}
          </dd>
        </div>
      </dl>
      {criteriaMode === 'inline' && <p className="verdict-hero-criteria">{criteriaText}</p>}
    </section>
  );
};

export const VerdictHeader: React.FC<VerdictHeaderProps> = ({ plan }) => {
  const { activeLedger, inputs, winnerTitle, winnerAdvantageOverRunnerUp } = plan;
  const isReal = inputs.transition.viewMode === 'real';
  const isOptimalActive = inputs.hybrid.useAutoOptimalRatio ?? true;
  const activeCard = pickActiveCard(plan);

  const isSustainable =
    activeLedger.depletionAgeSelf === null && activeLedger.totalUnmetSpendingNeed === 0;

  // U-1: 수동 비율이 개인 단독보다 불리하면 "+0원 우위"로 가리지 않고 열위 금액을 그대로 표기
  const diffVsPersonal100 =
    activeLedger.finalDisposableNetWorth - plan.personal100.finalDisposableNetWorth;
  const advOverCorporate100 = Math.max(
    0,
    activeLedger.finalDisposableNetWorth - plan.corporate100.finalDisposableNetWorth
  );
  const practicalThreshold = Math.max(
    10_000_000,
    Math.round(activeLedger.finalDisposableNetWorth * 0.005)
  );
  const isMicroPersonalSplit =
    activeLedger.personalRatio > 0 &&
    activeLedger.personalRatio <= 5 &&
    advOverCorporate100 < practicalThreshold;

  return (
    <section className="verdict-bar" aria-label="핵심 최적화 판정 요약 KPI">
      {/* KPI 1: 최적 배분 전략 판정 */}
      <article className="verdict-kpi verdict-kpi-primary">
        <div className="verdict-kpi-top">
          <span className="verdict-kpi-label">최적 자본 배분 황금비율 (r*)</span>
          <span className="verdict-badge verdict-badge-accent">
            {isOptimalActive ? '자동 최적해 추적' : `수동 ${activeLedger.personalRatio}:${activeLedger.corporateRatio}`}
          </span>
        </div>
        <div className="verdict-kpi-value num">{winnerTitle}</div>
        <div className="verdict-kpi-sub num">
          {!isSustainable ? (
            <>100세 전 고갈 — 배분별 순자산 우위 비교 불가 (생활비·은퇴 시점 조정 필요)</>
          ) : activeLedger.corporateRatio > 0 ? (
            <>
              개인 단독 운용(100%) 대비 세후{' '}
              {diffVsPersonal100 >= 0 ? (
                <>
                  <strong className="text-positive">+{formatKRW(diffVsPersonal100)}</strong> 우위
                </>
              ) : (
                <>
                  <strong className="text-danger">−{formatKRW(-diffVsPersonal100)}</strong> 열위
                </>
              )}
              {activeLedger.personalRatio > 0 && (
                <span>
                  {' '}
                  {isMicroPersonalSplit
                    ? `· 실무상 법인 100% 통합 권장 (차이 +${formatKRW(advOverCorporate100)})`
                    : `(법인 100% 대비 +${formatKRW(advOverCorporate100)})`}
                </span>
              )}
            </>
          ) : (
            <>
              법인 100% 운용 대비 세후{' '}
              <strong className="text-positive">
                +{formatKRW(Math.max(advOverCorporate100, winnerAdvantageOverRunnerUp))}
              </strong>{' '}
              우위
            </>
          )}
        </div>
      </article>

      {/* KPI 2: 100세 세후 청산 가처분 순자산 */}
      <article className="verdict-kpi">
        <div className="verdict-kpi-top">
          <span className="verdict-kpi-label">
            100세 세후 청산 가처분 순자산 ({isReal ? '실질' : '명목'})
          </span>
          {activeLedger.finalAssetMultiple > 0 && (
            <span className="verdict-badge num">원금 대비 {activeLedger.finalAssetMultiple}x</span>
          )}
        </div>
        <div className="verdict-kpi-value num">{formatKRW(activeLedger.finalDisposableNetWorth)}</div>
        <div className="verdict-kpi-sub num">
          장부 총자산 {formatKRW(activeLedger.finalBookNetWorth)} · 최저 보존율{' '}
          <strong>{activeLedger.preservationRatioPercent}%</strong> ({activeLedger.minAssetAgeSelf}세)
        </div>
      </article>

      {/* KPI 3: 100세 지속가능 한계 월생활비 */}
      <article className="verdict-kpi">
        <div className="verdict-kpi-top">
          <span className="verdict-kpi-label">100세 지속가능 한계 월생활비</span>
          <span
            className={`verdict-badge ${isSustainable ? 'verdict-badge-safe' : 'verdict-badge-warn'}`}
          >
            {isSustainable
              ? '100세 영구 보존'
              : activeLedger.depletionAgeSelf !== null
                ? `${activeLedger.depletionAgeSelf}세 고갈 주의`
                : '생활비 미충족'}
          </span>
        </div>
        <div className="verdict-kpi-value num">
          월 {formatKRW(activeCard.sustainableMonthlyLivingExpense)}
        </div>
        <div className="verdict-kpi-sub num">
          목표 월 {formatKRW(inputs.cashflow.targetNetMonthlyLivingExpense)} 대비{' '}
          {activeCard.monthlyBuffer >= 0 ? (
            <>
              <strong className="text-positive">+{formatKRW(activeCard.monthlyBuffer)}/월</strong> 여유
            </>
          ) : (
            <strong className="text-danger">월 {formatKRW(-activeCard.monthlyBuffer)} 부족</strong>
          )}
        </div>
      </article>

      {/* KPI 4: 생애 누적 세금·건보료 절감액 */}
      <article className="verdict-kpi" title={`연산 ${plan.computeTimeMs}ms`}>
        <div className="verdict-kpi-top">
          <span className="verdict-kpi-label">생애 누적 세금·건보료 방어 실익</span>
        </div>
        <div className="verdict-kpi-value num text-positive">
          {!isSustainable && activeLedger.totalLifetimeTaxAndHealthSaved <= 0
            ? '—'
            : `+${formatKRW(Math.max(0, activeLedger.totalLifetimeTaxAndHealthSaved))}`}
        </div>
        <div className="verdict-kpi-sub num">
          생애 총 납부 세금·건보료 {formatKRW(activeLedger.totalLifetimeTaxAndHealthCost)} (은퇴 30년 절감{' '}
          {formatKRW(Math.max(0, activeLedger.total30YearTaxAndHealthSaved))})
        </div>
      </article>
    </section>
  );
};
