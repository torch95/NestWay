import React, { useState } from 'react';
import {
  formatKRW,
  type CorporateExitStrategyOption,
  type OptimizationMasterPlan,
  type PensionClaimTiming,
  type SimulationInputs,
} from '../engine';
import { claimStartAge, pickActiveCard } from './planVerdict';

export interface Lens3StrategyMatrixProps {
  plan: OptimizationMasterPlan;
  snapshotA: OptimizationMasterPlan | null;
  onPinSnapshotA: () => void;
  onClearSnapshotA: () => void;
  onChangeInputs: (next: SimulationInputs) => void;
}

const CHECKLIST_STORAGE_KEY = 'retire_opt_checklist_v1';

export const Lens3StrategyMatrix: React.FC<Lens3StrategyMatrixProps> = ({
  plan,
  snapshotA,
  onPinSnapshotA,
  onClearSnapshotA,
  onChangeInputs,
}) => {
  const { inputs, corporateExit, pensionComparison, executiveComparison, actionChecklist } = plan;
  // B5: 현재 최적안이 법인 미설립(법인 0%)이면 출구 매트릭스는 '법인 100% 가정 참고치'로만 표시
  const isNoCorpPlan = plan.activeLedger.corporateRatio === 0;
  const normalClaimAge = claimStartAge('normal', inputs.pension.currentAgeSelf); // B6: 출생연도별 법정연령
  // B7: ROI 설명문 방향은 엔진 비교 결과(100세 순자산 연기 vs 정상)를 따른다 — 권고와 반대 설명 금지
  const deferredWins =
    pensionComparison.deferred.finalDisposableNetWorth > pensionComparison.normal.finalDisposableNetWorth;
  const crossoverAge = pensionComparison.deferred.crossoverAgeVsNormal ?? normalClaimAge + 14;
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(CHECKLIST_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore storage errors
    }
    return {};
  });

  const exitOptions: CorporateExitStrategyOption[] = [
    corporateExit.lumpSumGross,
    corporateExit.lumpSumCapitalExempt,
    corporateExit.phasedExit,
    corporateExit.familySuccession,
  ];

  const pensionOptions = [
    pensionComparison.early,
    pensionComparison.normal,
    pensionComparison.deferred,
  ];

  const execOptions = [executiveComparison.singleExec, executiveComparison.jointExec];

  const toggleCheck = (id: string) =>
    setCheckedItems((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });

  return (
    <div className="lens-panel" aria-label="렌즈 3: 법인 출구·연금·임원 전략 매트릭스 및 A/B 비교">
      {/* 1. 실시간 시나리오 A/B 스냅샷 비교기 */}
      <section className={`canvas-card ${!snapshotA ? 'ab-empty-card' : ''}`.trim()}>
        <div className="canvas-card-header">
          <div>
            <span className="canvas-kicker">SCENARIO A/B SNAPSHOT DIFFER</span>
            <h2 className="canvas-title">시나리오 A/B 실시간 민감도 비교 (What-If 분석)</h2>
          </div>
          <div className="ledger-toolbar">
            <button type="button" className="btn-primary-sm" onClick={onPinSnapshotA}>
              {snapshotA ? '현재 상태를 스냅샷 A로 갱신' : '현재 상태를 기준 스냅샷 A로 고정'}
            </button>
            {snapshotA && (
              <button type="button" className="btn-secondary" onClick={onClearSnapshotA}>
                스냅샷 해제
              </button>
            )}
          </div>
        </div>

        {!snapshotA ? (
          <div className="ab-empty-banner">
            우측 상단 <strong>[현재 상태를 기준 스냅샷 A로 고정]</strong> 버튼을 누른 뒤 상단 <strong>[입력 항목 수정하기 (위저드)]</strong> 또는 아래 전략 선택 카드에서 조건을 변경하면, 기준안(A) 대비 변경안(B)의 순자산·세금·한계생활비 증감(Δ)이 1원 단위로 즉시 비교됩니다.
          </div>
        ) : (
          <div className="ab-diff-grid num">
            <div className="ab-diff-card">
              <span className="metric-caption">최적 배분 (개인:법인)</span>
              <div className="ab-pair">
                <span>A: {snapshotA.activeLedger.personalRatio}:{snapshotA.activeLedger.corporateRatio}</span>
                <span>→</span>
                <strong>B: {plan.activeLedger.personalRatio}:{plan.activeLedger.corporateRatio}</strong>
              </div>
            </div>

            <div className="ab-diff-card">
              <span className="metric-caption">100세 세후 가처분 순자산 증감 (Δ)</span>
              {(() => {
                const delta =
                  plan.activeLedger.finalDisposableNetWorth -
                  snapshotA.activeLedger.finalDisposableNetWorth;
                return (
                  <>
                    <strong className={delta >= 0 ? 'text-positive' : 'text-danger'}>
                      {delta >= 0 ? '+' : ''}
                      {formatKRW(delta)}
                    </strong>
                    <span className="ab-sub">
                      A {formatKRW(snapshotA.activeLedger.finalDisposableNetWorth)} → B{' '}
                      {formatKRW(plan.activeLedger.finalDisposableNetWorth)}
                    </span>
                  </>
                );
              })()}
            </div>

            <div className="ab-diff-card">
              <span className="metric-caption">지속가능 한계 월생활비 증감 (Δ)</span>
              {(() => {
                const delta =
                  pickActiveCard(plan).sustainableMonthlyLivingExpense -
                  pickActiveCard(snapshotA).sustainableMonthlyLivingExpense;
                return (
                  <>
                    <strong className={delta >= 0 ? 'text-positive' : 'text-danger'}>
                      {delta >= 0 ? '+' : ''}
                      {formatKRW(delta)}/월
                    </strong>
                    <span className="ab-sub">
                      A 월 {formatKRW(pickActiveCard(snapshotA).sustainableMonthlyLivingExpense)} → B 월{' '}
                      {formatKRW(pickActiveCard(plan).sustainableMonthlyLivingExpense)}
                    </span>
                  </>
                );
              })()}
            </div>

            <div className="ab-diff-card">
              <span className="metric-caption">생애 총 세금·건보·유지비 증감 (Δ)</span>
              {(() => {
                const delta =
                  plan.activeLedger.totalLifetimeTaxAndHealthCost -
                  snapshotA.activeLedger.totalLifetimeTaxAndHealthCost;
                return (
                  <>
                    <strong className={delta <= 0 ? 'text-positive' : 'text-danger'}>
                      {delta > 0 ? '+' : ''}
                      {formatKRW(delta)}
                    </strong>
                    <span className="ab-sub">
                      A {formatKRW(snapshotA.activeLedger.totalLifetimeTaxAndHealthCost)} → B{' '}
                      {formatKRW(plan.activeLedger.totalLifetimeTaxAndHealthCost)}
                    </span>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </section>

      {/* 2. 가족법인 4대 출구(Exit) · 지분승계 세후 실수령 비교 */}
      <section className="canvas-card">
        <div className="canvas-card-header">
          <div>
            <span className="canvas-kicker">CORPORATE EXIT & SUCCESSION MATRIX</span>
            <h2 className="canvas-title">
              가족법인 4대 출구(청산 · 유상감자 분할배당 · 가족법인 지분승계) 세후 실수령 비교
            </h2>
          </div>
          <span className={`verdict-badge num ${isNoCorpPlan ? '' : 'verdict-badge-safe'}`}>
            {isNoCorpPlan ? '참고치 · ' : ''}단순청산 대비 최대 +{formatKRW(corporateExit.maxTaxSavedVsSimpleGross)} 보존
          </span>
        </div>

        {isNoCorpPlan && (
          <p className="reference-only-banner" role="note">
            현재 최적안은 법인 미설립(개인 100%)입니다 · 아래는 법인 100% 가정 참고치이며 실행 권고가 아닙니다.
          </p>
        )}

        <div className="exit-grid">
          {exitOptions.map((opt) => {
            const isRec = !isNoCorpPlan && opt.strategyType === corporateExit.recommendedExit;
            return (
              <div
                key={opt.strategyType}
                className={`strategy-score-card ${isRec ? 'strategy-score-card-winner' : ''}`}
              >
                <div className="strategy-score-header">
                  <span className="strategy-title">{opt.title}</span>
                  {isRec && <span className="winner-pill">BEST EXIT</span>}
                </div>

                <div className="strategy-main-metric num">
                  <span className="metric-caption">세후 실수령 순자산 (실효 세부담 {opt.effectiveExitTaxRatePercent}%)</span>
                  <strong>{formatKRW(opt.netPocketedValue)}</strong>
                </div>

                <dl className="strategy-detail-list num">
                  <div>
                    <dt>출자원금 비과세 환원</dt>
                    <dd className="text-positive">{formatKRW(opt.paidInCapitalExempt)}</dd>
                  </div>
                  <div>
                    <dt>과세대상 유보이익</dt>
                    <dd>{formatKRW(opt.taxableDistribution)}</dd>
                  </div>
                  <div>
                    <dt>청산 배당·증여세 + 건보료</dt>
                    <dd className="text-danger">
                      -{formatKRW(opt.exitTaxPaid + opt.extraHealthInsPaid)}
                    </dd>
                  </div>
                </dl>

                <p className="exit-card-desc">{opt.description}</p>
              </div>
            );
          })}
        </div>

        <p className="breakeven-verdict-text num" style={{ marginTop: 12 }}>
          <strong>⚖️ 세무 실사(국세청·건보공단) 리스크 및 세법 유의사항:</strong> ① 매출 없는 순수 금융투자 가족법인의 임원 급여·4대보험 손금산입 및 직장가입자 자격 유지를 위해서는 <strong>정관상 임원보수 지급규정, 주주총회 보수 한도 결의서, 월별 자산운용 리포트 등 실질 상근 경영 증빙</strong>이 필수입니다(미비 시 가공 인건비 상여 처분 및 직권 상실 위험). ② 금융투자 법인은 상증세법상 <strong>‘가업상속공제’ 및 ‘가업승계 증여세 과세특례’ 대상 업종에서 제외</strong>되며, 자녀 지분 법인에 부모가 거액의 무이자 가수금을 대여할 경우 <strong>상증세법 제45조의5(특정법인과의 거래를 통한 이익의 증여 의제)</strong>에 따른 증여세 과세 이슈가 발생할 수 있으므로 세무사 사전 검토가 필요합니다.
        </p>
      </section>

      {/* 2-B. 100세 청산(소득세) vs 100세 상속(상속세 10~50%) 세후 가치 진단 */}
      <section className="canvas-card">
        <div className="canvas-card-header">
          <div>
            <span className="canvas-kicker">100-YEAR TERMINAL VALUATION & ESTATE TAX DIAGNOSTIC</span>
            <h2 className="canvas-title">100세 청산(소득세) vs 100세 상속(상속세 10~50%) 세후 가치 진단</h2>
          </div>
          <div className="ledger-toolbar">
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                onChangeInputs({
                  ...inputs,
                  corporate: {
                    ...inputs.corporate,
                    terminalValuationMode:
                      (inputs.corporate.terminalValuationMode ?? 'liquidation') === 'liquidation'
                        ? 'inheritance'
                        : 'liquidation',
                  },
                })
              }
            >
              기준 전환:{' '}
              {(inputs.corporate.terminalValuationMode ?? 'liquidation') === 'liquidation'
                ? '현재: 100세 청산 가처분 ➔ 상속세 차감 기준으로 전환'
                : '현재: 100세 상속세 차감 ➔ 청산 가처분 기준으로 전환'}
            </button>
          </div>
        </div>

        <div className="estate-comparison-grid num">
          {[
            {
              title: '개인 100% 전략',
              metric: plan.estateDiagnostic.personal100Estate,
              isWinner: plan.activeLedger.personalRatio === 100,
            },
            {
              title: `현재 권고/선택 배분 (개인 ${plan.activeLedger.personalRatio}% : 법인 ${plan.activeLedger.corporateRatio}%)`,
              metric: plan.estateDiagnostic.activeEstate,
              isWinner: plan.activeLedger.personalRatio > 0 && plan.activeLedger.corporateRatio > 0,
            },
            {
              title: '가족법인 100% 전략',
              metric: plan.estateDiagnostic.corporate100Estate,
              isWinner: plan.activeLedger.corporateRatio === 100,
            },
          ].map((col) => (
            <div
              key={col.title}
              className={`strategy-score-card ${col.isWinner ? 'strategy-score-card-winner' : ''}`}
            >
              <div className="strategy-score-header">
                <span className="strategy-title">{col.title}</span>
                {col.isWinner && <span className="winner-pill">ACTIVE</span>}
              </div>

              <div className="strategy-main-metric">
                <span className="metric-caption">세후 순상속재산 (부동산 포함)</span>
                <strong>{formatKRW(col.metric.totalNetEstateAfterTax)}</strong>
              </div>

              <dl className="strategy-detail-list">
                <div>
                  <dt>상속재산 총액 (부동산 포함)</dt>
                  <dd>{formatKRW(col.metric.grossEstateValue)}</dd>
                </div>
                <div>
                  <dt>일괄공제</dt>
                  <dd className="text-positive">{formatKRW(col.metric.lumpSumAndSpouseDeduction)}</dd>
                </div>
                <div>
                  <dt>금융재산상속공제 (최대 2억 · 지배주주 비상장 가족법인 주식 제외)</dt>
                  <dd className="text-positive">
                    {formatKRW(col.metric.financialAssetDeduction)}
                  </dd>
                </div>
                <div>
                  <dt>예상 상속세 (상증세법 §26 10~50% 누진 · 신고세액공제 3%)</dt>
                  <dd className="text-danger">
                    -{formatKRW(col.metric.estimatedInheritanceTax)}
                  </dd>
                </div>
                <div>
                  <dt>순금융·법인 세후 상속가치</dt>
                  <dd>{formatKRW(col.metric.netAfterInheritanceValue)}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>

        {(plan.estateDiagnostic.spousalGiftCarryoverNote ||
          plan.estateDiagnostic.shareholderLoanSafeHarborNote) && (
          <div className="roi-callout-box num" style={{ marginTop: 14 }}>
            <div>
              <strong>💡 상속·증여세법 세무 가이드라인</strong>
              {plan.estateDiagnostic.spousalGiftCarryoverNote && (
                <p>• {plan.estateDiagnostic.spousalGiftCarryoverNote}</p>
              )}
              {plan.estateDiagnostic.shareholderLoanSafeHarborNote && (
                <p>• {plan.estateDiagnostic.shareholderLoanSafeHarborNote}</p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* 3. 국민연금 수령시기 3종 & 추납 ROI + 임원 1인 vs 2인 비교 */}
      <div className="matrix-2col-layout">
        <section className="canvas-card">
          <div className="canvas-card-header">
            <div>
              <span className="canvas-kicker">PUBLIC PENSION TIMING & ROI</span>
              <h2 className="canvas-title">국민연금 개시 시기(조기·정상·연기) 및 추납 ROI</h2>
            </div>
            <span className="canvas-subtitle">항목 클릭 시 시뮬레이션에 즉시 반영</span>
          </div>

          <div className="sub-option-stack">
            {pensionOptions.map((p) => {
              const isSelected = inputs.pension.claimTimingSelf === p.timing;
              const isRecommended = pensionComparison.recommendedTiming === p.timing;
              const applyTiming = () =>
                onChangeInputs({
                  ...inputs,
                  pension: {
                    ...inputs.pension,
                    claimTimingSelf: p.timing as PensionClaimTiming,
                    claimTimingSpouse: p.timing as PensionClaimTiming,
                  },
                });
              return (
                <div
                  key={p.timing}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  className={`sub-option-row ${isSelected ? 'sub-option-row-active' : ''}`}
                  onClick={applyTiming}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      applyTiming();
                    }
                  }}
                >
                  <div>
                    <div className="sub-option-title-line">
                      <strong>{p.label}</strong>
                      {isRecommended && <span className="winner-pill">최적</span>}
                      {isSelected && <span className="selected-pill">현재 선택</span>}
                    </div>
                    <span className="sub-option-meta num">
                      초기 월 {formatKRW(p.monthlyPayoutInitial)} · 100세 누적 연금{' '}
                      {formatKRW(p.cumulativePayoutTo100)}
                      {p.crossoverAgeVsNormal ? ` · 정상수령 누적교차 ${p.crossoverAgeVsNormal}세` : ''}
                    </span>
                  </div>
                  <div className="sub-option-right num">
                    <span className="metric-caption">100세 가계 가처분 순자산</span>
                    <strong>{formatKRW(p.finalDisposableNetWorth)}</strong>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="roi-callout-box num">
            <div>
              <strong>국민연금 임의계속·추납 60개월 ROI 및 연기연금 기회비용 진단</strong>
              <p>
                총 납입원금 {formatKRW(pensionComparison.additionalPensionTotalCost)} 투입 시 월 연금{' '}
                <strong className="text-positive">
                  +
                  {formatKRW(
                    pensionComparison.additionalPensionMonthlyIncreaseSelf +
                      pensionComparison.additionalPensionMonthlyIncreaseSpouse
                  )}
                  /월
                </strong>{' '}
                증액 (30년 수령 시 원금 대비 <strong>{pensionComparison.additionalPensionRoiMultiple}배</strong> 회수).
                <br />※{' '}
                {deferredWins ? (
                  <>
                    <strong>
                      연기수령(+36%)이 정상수령({normalClaimAge}세)보다 100세 순자산이{' '}
                      {formatKRW(pensionComparison.deferred.finalDisposableNetWorth - pensionComparison.normal.finalDisposableNetWorth)} 큰 이유:
                    </strong>{' '}
                    {normalClaimAge + 5}세부터 초기 월 {formatKRW(pensionComparison.deferred.monthlyPayoutInitial)}(정상{' '}
                    {formatKRW(pensionComparison.normal.monthlyPayoutInitial)})을 받아 {crossoverAge}세 이후 누적 수령액이 역전되고(100세
                    누적 {formatKRW(pensionComparison.deferred.cumulativePayoutTo100)} vs{' '}
                    {formatKRW(pensionComparison.normal.cumulativePayoutTo100)}), 종신 연금 비중이 커져 장수 리스크가 줄어듭니다.
                    대신 {normalClaimAge}~{normalClaimAge + 4}세(5년간) 공백기는{' '}
                    {isNoCorpPlan ? '절세계좌·개인 일반계좌' : '절세계좌·법인가수금'} 인출로 충당합니다.
                  </>
                ) : (
                  <>
                    <strong>왜 연기수령(+36%)보다 정상수령({normalClaimAge}세)의 100세 순자산이 더 클까?</strong> 연기수령은 연금 자체는 연 7.2%(단리)씩 늘어나 {crossoverAge}세에 누적 수령액이 교차하지만, {normalClaimAge}~{normalClaimAge + 4}세(5년간) 연금 공백기에 <strong>절세계좌·법인가수금 원금을 먼저 헐어 쓰면서 발생하는 35년 복리 투자수익 상실분 및 연금소득세·건보료로 새는 비용</strong>이 더 크기 때문입니다.
                  </>
                )}
              </p>
            </div>
          </div>
        </section>

        <section className="canvas-card">
          <div className="canvas-card-header">
            <div>
              <span className="canvas-kicker">CORPORATE GOVERNANCE STRUCTURE</span>
              <h2 className="canvas-title">가족법인 1인 단독 임원 vs 부부 2인 공동 임원 비교</h2>
            </div>
            <span className="canvas-subtitle">항목 클릭 시 시뮬레이션에 즉시 반영</span>
          </div>

          {isNoCorpPlan && (
            <p className="reference-only-banner" role="note">
              현재 최적안은 법인 미설립(개인 100%)입니다 · 아래 임원 구성은 법인 설립 가정 참고치입니다.
            </p>
          )}

          <div className="sub-option-stack">
            {execOptions.map((ex) => {
              const isSelected = inputs.corporate.executiveCount === ex.executiveCount;
              const isRec = !isNoCorpPlan && executiveComparison.recommendedCount === ex.executiveCount;
              const applyExec = () =>
                onChangeInputs({
                  ...inputs,
                  corporate: {
                    ...inputs.corporate,
                    executiveCount: ex.executiveCount,
                  },
                });
              return (
                <div
                  key={ex.executiveCount}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  className={`sub-option-row ${isSelected ? 'sub-option-row-active' : ''}`}
                  onClick={applyExec}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      applyExec();
                    }
                  }}
                >
                  <div>
                    <div className="sub-option-title-line">
                      <strong>{ex.label}</strong>
                      {isRec && <span className="winner-pill">권장</span>}
                      {isSelected && <span className="selected-pill">현재 선택</span>}
                    </div>
                    <span className="sub-option-meta num">
                      연 인건비 {formatKRW(ex.annualTotalPayrollCost)} (실수령{' '}
                      {formatKRW(ex.annualNetSalaryReceived)} · 4대보험/세금{' '}
                      {formatKRW(ex.annualTaxAnd4InsCost)})
                    </span>
                  </div>
                  <div className="sub-option-right num">
                    <span className="metric-caption">100세 가처분 순자산</span>
                    <strong>{formatKRW(ex.finalDisposableNetWorth)}</strong>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="roi-callout-box num">
            <div>
              <strong>직장가입자 전환 및 소득분산 우위 판정</strong>
              <p>
                {executiveComparison.recommendedCount === 2
                  ? '부부 2인 공동 임원으로 보수를 분산하면 근로소득공제 2배 적용 및 누진세율 구간 하향으로 세후 순자산이 유리합니다.'
                  : '1인 단독 대표 체제로 직장가입자 최소 보수월액만 설정하고 배우자를 피부양자로 등재할 때 4대보험 부담이 최소화됩니다.'}{' '}
                (100세 순자산 차이: <strong>{formatKRW(executiveComparison.netWorthAdvantage)}</strong>)
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* 4. 결정론적 생애 실행 로드맵 체크리스트 */}
      <section className="canvas-card">
        <div className="canvas-card-header">
          <div>
            <span className="canvas-kicker">DETERMINISTIC EXECUTION PLAYBOOK</span>
            <h2 className="canvas-title">생애 단계별 절세·건보 방어 실행 체크리스트</h2>
          </div>
          <span className="canvas-subtitle">현재 시뮬레이션 결과 기반 자동 생성</span>
        </div>

        <div className="checklist-grid">
          {actionChecklist.map((item) => {
            const done = Boolean(checkedItems[item.id]);
            return (
              <label
                key={item.id}
                className={`checklist-card ${done ? 'checklist-card-done' : ''}`}
              >
                <div className="checklist-top">
                  <div className="checklist-badge-group">
                    <input
                      type="checkbox"
                      checked={done}
                      onChange={() => toggleCheck(item.id)}
                    />
                    <span className="phase-tag">{item.phaseLabel}</span>
                    <span className="category-tag">{item.category}</span>
                  </div>
                  <span className="impact-tag num">{item.impactSummary}</span>
                </div>
                <h4 className="checklist-title">{item.title}</h4>
                <p className="checklist-desc">{item.description}</p>
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
};
