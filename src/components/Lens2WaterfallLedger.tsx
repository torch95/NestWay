import React, { useState } from 'react';
import { chartHeightFor, useChartWidth } from './useChartWidth';
import { CORP_TAX_PCT, ISA_SEPARATE_TAX_PCT } from './ControlDock';
import { formatDdayAmount } from './planVerdict';
import {
  formatKRW,
  getNationalPensionRateTotal,
  type CanonicalYearRow,
  type OptimizationMasterPlan,
} from '../engine';

export interface Lens2WaterfallLedgerProps {
  plan: OptimizationMasterPlan;
  sectionMode?: 'all' | 'charts' | 'table';
  hideBlueprintCard?: boolean;
  /** 인쇄 레이아웃: 차트 폭을 780 고정 viewBox로 유지 (실측 폭 미사용). */
  isPrintMode?: boolean;
}

const BASKET_COLORS = {
  irp: '#0ea5e9',
  isa: '#10b981',
  personalPension: '#14b8a6',
  taxable: '#f59e0b',
  corporate: '#8b5cf6',
};

// 워터폴 빨간 막대: 조달 막대(①~⑦)에 이미 포함된 개인세·건보·추납을 뺀 '계좌 밖 비용'
// (법인세·4대보험·유지비 + D-Day 일시퇴직세 + 일반계좌 직차감 추납). 막대 총높이 = 생활비 + 총유출 − 미충당.
// ponytail: 연금·급여 잉여 연도(재투자)와 인출 과다 반올림 연도는 하한(법인 비용)으로 근사 — 정확히 하려면 커널에 조달분 필드 추가
export const outsideCost = (r: CanonicalYearRow): number =>
  Math.max(
    r.corpCorporateTax + r.corpPayrollTaxAndInsurance + r.corpMaintenanceAndFixedCost,
    r.requiredLivingOutflow +
      r.totalTaxHealthAndFees -
      r.unmetSpendingNeed -
      (r.stage1PublicAndHousingPension +
        r.stage2CorpNetSalary +
        r.stage3IrpWithdrawal +
        r.stage4IsaWithdrawal +
        r.stage5PersonalPensionWithdrawal +
        r.stage6OverseasTaxableWithdrawal +
        r.stage7DomesticTaxableWithdrawal +
        r.stage8CorpFallbackDividend)
  );

export const Lens2WaterfallLedger: React.FC<Lens2WaterfallLedgerProps> = ({
  plan,
  sectionMode = 'all',
  hideBlueprintCard = false,
  isPrintMode = false,
}) => {
  const { activeLedger, inputs } = plan;
  const { blueprint, rows } = activeLedger;

  const [exactWon, setExactWon] = useState(false);
  const [retiredOnly, setRetiredOnly] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number>(rows.length - 1);
  const [activeChartHover, setActiveChartHover] = useState<'stack' | 'flow' | null>(null);
  const [mutedStackKeys, setMutedStackKeys] = useState<string[]>([]);
  const [mutedFlowKeys, setMutedFlowKeys] = useState<string[]>([]);
  // 두 차트는 같은 폭의 카드에 세로로 쌓이므로 첫 래퍼 실측값을 공유
  const [chartWrapRef, chartW] = useChartWidth(isPrintMode);

  const toggleStackKey = (key: string) => {
    setMutedStackKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };
  const toggleFlowKey = (key: string) => {
    setMutedFlowKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const isReal = inputs.transition.viewMode === 'real';
  const fmt = (v: number) => formatKRW(v, exactWon);
  const scale = (v: number, row: CanonicalYearRow) => Math.round(v * row.discountFactor);

  const formatAxisKRW = (v: number): string => {
    const abs = Math.abs(Math.round(v));
    if (abs === 0) return '0원';
    if (abs >= 100_000_000) {
      const eok = v / 100_000_000;
      return Number.isInteger(Number(eok.toFixed(1)))
        ? `${Math.round(eok)}억`
        : `${eok.toFixed(1)}억`;
    }
    return `${Math.round(v / 10_000).toLocaleString()}만`;
  };

  // 1. D-Day 5대 바스켓 비중 계산
  const bTotal = Math.max(
    1,
    blueprint.allocIrp +
      blueprint.allocIsa +
      blueprint.allocPersonalPension +
      blueprint.allocTaxable +
      blueprint.allocCorporate
  );
  const bSegments = [
    {
      key: 'irp',
      label: 'IRP 퇴직연금',
      color: BASKET_COLORS.irp,
      amount: blueprint.allocIrp,
      pct: Number(((blueprint.allocIrp / bTotal) * 100).toFixed(1)),
      taxNote: '퇴직소득세 30~40% 감면 · 건보료 0원',
    },
    {
      key: 'isa',
      label: '부부 ISA (30년 연장)',
      color: BASKET_COLORS.isa,
      amount: blueprint.allocIsa,
      pct: Number(((blueprint.allocIsa / bTotal) * 100).toFixed(1)),
      taxNote: `비과세 후 ${ISA_SEPARATE_TAX_PCT}% 분리과세 · 건보료 0원`,
    },
    {
      key: 'personalPension',
      label: '개인연금저축',
      color: BASKET_COLORS.personalPension,
      amount: blueprint.allocPersonalPension,
      pct: Number(((blueprint.allocPersonalPension / bTotal) * 100).toFixed(1)),
      taxNote: '연 1,500만/인 3.3~5.5% · Min-Tax',
    },
    {
      key: 'taxable',
      label: '일반 과세계좌',
      color: BASKET_COLORS.taxable,
      amount: blueprint.allocTaxable,
      pct: Number(((blueprint.allocTaxable / bTotal) * 100).toFixed(1)),
      taxNote: '해외직투 연 250만 공제 + 22% 분류과세',
    },
    {
      key: 'corporate',
      label: '가족법인 (가수금 출자)',
      color: BASKET_COLORS.corporate,
      amount: blueprint.allocCorporate,
      pct: Number(((blueprint.allocCorporate / bTotal) * 100).toFixed(1)),
      taxNote: `출자원금 ${formatKRW(blueprint.corporatePaidInCapital)} 비과세 회수`,
    },
  ];

  // 2. 5대 바스켓 적층 막대 SVG & 8단계 인출 워터폴 SVG 데이터 (범례 선택 항목 기준 동적 Y축 스케일링)
  const chartH = chartHeightFor(chartW, 236);
  const padL = 104;
  const padR = 32;
  const padT = 24;
  const padB = 32;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  let maxStackVal = 20_000_000;
  let maxCashflowVal = 4_000_000;
  for (const r of rows) {
    const visibleStackSum =
      (!mutedStackKeys.includes('irp') ? scale(r.endIrp, r) : 0) +
      (!mutedStackKeys.includes('isa') ? scale(r.endIsa, r) : 0) +
      (!mutedStackKeys.includes('personalPension') ? scale(r.endPersonalPension, r) : 0) +
      (!mutedStackKeys.includes('taxable') ? scale(r.endTaxable, r) : 0) +
      (!mutedStackKeys.includes('corporate') ? scale(r.endCorpLiquidationNetValue, r) : 0);
    maxStackVal = Math.max(maxStackVal, visibleStackSum);

    const visibleFlowSum =
      (!mutedFlowKeys.includes('s1') ? scale(r.stage1PublicAndHousingPension, r) : 0) +
      (!mutedFlowKeys.includes('s2') ? scale(r.stage2CorpNetSalary, r) : 0) +
      (!mutedFlowKeys.includes('s4') ? scale(r.stage4IsaWithdrawal, r) : 0) +
      (!mutedFlowKeys.includes('s5') ? scale(r.stage5PersonalPensionWithdrawal, r) : 0) +
      (!mutedFlowKeys.includes('s3') ? scale(r.stage3IrpWithdrawal, r) : 0) +
      (!mutedFlowKeys.includes('s8') ? scale(r.stage8CorpFallbackDividend, r) : 0) +
      (!mutedFlowKeys.includes('s67')
        ? scale(r.stage6OverseasTaxableWithdrawal + r.stage7DomesticTaxableWithdrawal, r)
        : 0) +
      (!mutedFlowKeys.includes('tax') ? scale(outsideCost(r), r) : 0);
    maxCashflowVal = Math.max(maxCashflowVal, visibleFlowSum);
  }
  const stackStep = maxStackVal >= 400_000_000 ? 200_000_000 : 20_000_000;
  const flowStep = maxCashflowVal >= 40_000_000 ? 20_000_000 : 4_000_000;
  maxStackVal = Math.ceil((maxStackVal * 1.05) / stackStep) * stackStep;
  maxCashflowVal = Math.ceil((maxCashflowVal * 1.08) / flowStep) * flowStep;

  const barStep = plotW / Math.max(1, rows.length);
  const barWidth = Math.max(3.2, barStep * 0.66);

  const safeHoverIdx = Math.min(rows.length - 1, Math.max(0, hoverIdx));
  const activeRow = rows[safeHoverIdx] ?? rows[0];
  const filteredRows = retiredOnly ? rows.filter((r) => !r.isEmployed) : rows;

  // D3: 스크롤 영역 상단(고정 헤더 아래) 여유가 팝오버 높이보다 작으면 아래로 열어 잘림 방지
  const orientLedgerPopover = (e: React.SyntheticEvent<HTMLTableRowElement>) => {
    const tr = e.currentTarget;
    const scroller = tr.closest('.ledger-table-scroll');
    if (!scroller) return;
    const headH = scroller.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    const room = tr.getBoundingClientRect().top - scroller.getBoundingClientRect().top - headH;
    tr.dataset.popDown = room < 200 ? '1' : '';
  };

  const handleExportCsv = () => {
    const headers = [
      '연차',
      '본인연령',
      '배우자연령',
      '생애구간',
      '기초장부총액(원)',
      '연간투자수익(원)',
      '외부현금유입(원)',
      '목표지출액(원)',
      '1단계_공적주택연금(원)',
      '2단계_법인임원실수령(원)',
      '3단계_연금저축인출(원)',
      '4단계_IRP인출(원)',
      '5단계_ISA인출(원)',
      '6_7단계_일반계좌인출(원)',
      '8단계_법인원금배당인출(원)',
      '개인세금(원)',
      '개인주택보유세(원)',
      '개인건보료(원)',
      '법인세_4대보험_기장료(원)',
      '기말_IRP(원)',
      '기말_ISA(원)',
      '기말_연금저축(원)',
      '기말_일반계좌(원)',
      '기말_법인장부(원)',
      '기말_세후가처분순자산(원)',
      '회계보존오차(원)',
    ];
    const csvLines = [
      headers.join(','),
      ...rows.map((r) =>
        [
          r.yearIndex,
          r.ageSelf,
          r.ageSpouse,
          `"${r.stageLabel}"`,
          ...[
            r.startBookTotal,
            r.grossInvestmentReturn,
            r.totalExternalInflow,
            r.requiredLivingOutflow,
            r.stage1PublicAndHousingPension,
            r.stage2CorpNetSalary,
            r.stage5PersonalPensionWithdrawal,
            r.stage3IrpWithdrawal,
            r.stage4IsaWithdrawal,
            r.stage6OverseasTaxableWithdrawal + r.stage7DomesticTaxableWithdrawal,
            r.stage8CorpFallbackDividend,
            r.personalIncomeAndDivTax,
            r.personalPropertyTax ?? 0,
            r.personalHealthInsurance,
          ].map((v) => scale(v, r)),
          ...[
            r.corpCorporateTax + r.corpPayrollTaxAndInsurance + r.corpMaintenanceAndFixedCost,
            r.endIrp,
            r.endIsa,
            r.endPersonalPension,
            r.endTaxable,
            r.endCorp,
            r.endDisposableNetWorth,
          ].map((v) => scale(v, r)),
          r.accountingResidual,
        ].join(',')
      ),
    ];
    const blob = new Blob(['\uFEFF' + csvLines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `retire_canonical_ledger_${activeLedger.personalRatio}_${activeLedger.corporateRatio}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportMasterPlanCsv = () => {
    const viewLabel = isReal ? '실질가치(현재구매력)' : '명목가치(미래액면가)';
    const scaleDdayFor = (sim: typeof activeLedger, nominalVal: number) => {
      if (!isReal) return Math.round(nominalVal);
      const dRow = sim.rows.find((row) => row.ageSelf === sim.blueprint.retirementAgeSelf);
      return Math.round(nominalVal * (dRow ? dRow.discountFactor : 1));
    };
    const lines: string[] = [
      `# NestWay 통합 은퇴 자산·세무·건보 마스터플랜 리포트 (${viewLabel})`,
      '',
      '[섹션 1: 전략별 100세 생애 핵심 성과 비교]',
      '전략구분,개인비중(%),법인비중(%),D-Day운용자본(원),100세세후가처분순자산(원),생애누적총세금(원),생애누적총건보료(원),자산고갈연령',
      ...[
        { name: '현재선택전략', sim: plan.activeLedger },
        { name: '최적하이브리드(r*)', sim: plan.optimalHybrid },
        { name: '개인100%단독', sim: plan.personal100 },
        { name: '법인100%전환', sim: plan.corporate100 },
      ].map((item) =>
        [
          `"${item.name}"`,
          item.sim.personalRatio,
          item.sim.corporateRatio,
          scaleDdayFor(item.sim, item.sim.blueprint.totalCapitalAtRetirement),
          item.sim.finalDisposableNetWorth,
          item.sim.totalLifetimeTaxPaid,
          item.sim.totalLifetimeHealthInsPaid,
          item.sim.depletionAgeSelf ?? '미고갈(100세+)',
        ].join(',')
      ),
      '',
      '[섹션 2: 은퇴 D-Day 5대 바스켓 자본 재배치 청사진]',
      '바스켓구분,배정금액(원),비중(%),핵심절세및건보특성',
      ...bSegments.map((seg) =>
        [`"${seg.label}"`, scaleDdayFor(activeLedger, seg.amount), seg.pct, `"${seg.taxNote}"`].join(',')
      ),
      '',
      '[섹션 3: 국민연금 수령시기(조기/정상/연기) 손익분기 및 100세 순자산 비교]',
      '수령방식,개시연령(세),초기월수령액(원),100세누적수령액(원),정상수령대비누적교차연령(세),100세가처분순자산(원)',
      ...[
        plan.pensionComparison.early,
        plan.pensionComparison.normal,
        plan.pensionComparison.deferred,
      ].map((p) =>
        [
          `"${p.label}"`,
          p.claimAgeSelf,
          p.monthlyPayoutInitial,
          p.cumulativePayoutTo100,
          p.crossoverAgeVsNormal ?? '-',
          p.finalDisposableNetWorth,
        ].join(',')
      ),
      '',
      '[섹션 4: 51개년 1원 무결성 연차별 현금흐름 원장]',
      [
        '연차',
        '본인연령',
        '배우자연령',
        '생애구간',
        '기초장부총액(원)',
        '연간투자수익(원)',
        '외부현금유입(원)',
        '목표지출액(원)',
        '1단계_공적주택연금(원)',
        '2단계_법인임원실수령(원)',
        '3단계_연금저축인출(원)',
        '4단계_IRP인출(원)',
        '5단계_ISA인출(원)',
        '6_7단계_일반계좌인출(원)',
        '8단계_법인원금배당인출(원)',
        '개인세금(원)',
        '개인주택보유세(원)',
        '개인건보료(원)',
        '피부양자소득여유한도(원)',
        '법인세_4대보험_기장료(원)',
        '기말_세후가처분순자산(원)',
        '회계보존오차(원)',
      ].join(','),
      ...rows.map((r) =>
        [
          r.yearIndex,
          r.ageSelf,
          r.ageSpouse,
          `"${r.stageLabel}"`,
          ...[
            r.startBookTotal,
            r.grossInvestmentReturn,
            r.totalExternalInflow,
            r.requiredLivingOutflow,
            r.stage1PublicAndHousingPension,
            r.stage2CorpNetSalary,
            r.stage5PersonalPensionWithdrawal,
            r.stage3IrpWithdrawal,
            r.stage4IsaWithdrawal,
            r.stage6OverseasTaxableWithdrawal + r.stage7DomesticTaxableWithdrawal,
            r.stage8CorpFallbackDividend,
            r.personalIncomeAndDivTax,
            r.personalPropertyTax ?? 0,
            r.personalHealthInsurance,
          ].map((v) => scale(v, r)),
          ...[
            r.dependentIncomeHeadroom ?? 0,
            r.corpCorporateTax + r.corpPayrollTaxAndInsurance + r.corpMaintenanceAndFixedCost,
            r.endDisposableNetWorth,
          ].map((v) => scale(v, r)),
          r.accountingResidual,
        ].join(',')
      ),
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `retire_masterplan_${activeLedger.personalRatio}_${activeLedger.corporateRatio}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="lens-panel" aria-label="렌즈 2: 5대 계좌 청사진 및 8단계 인출 원장">
      {sectionMode !== 'table' && (
        <>
          {/* 1. 은퇴 D-Day 5대 바스켓 자본 재배치 청사진 */}
          {!hideBlueprintCard && (
            <section className="canvas-card">
              <div className="canvas-card-header">
                <div>
                  <span className="canvas-kicker">D-DAY 5-BASKET CAPITAL BLUEPRINT</span>
                  <h2 className="canvas-title">
                    은퇴 D-Day ({blueprint.retirementAgeSelf}세) 5대 계좌 최적 재배치 청사진
                  </h2>
                </div>
                <span className="canvas-subtitle num">
                  D-Day 총 운용자본{' '}
                  <strong>{formatDdayAmount(blueprint.totalCapitalAtRetirement, rows, blueprint.retirementAgeSelf, isReal)}</strong>{' '}
                  ·{' '}
                  {blueprint.isaStrategySummary}
                </span>
              </div>

              <div className="blueprint-stack-bar" role="img" aria-label="은퇴 시점 5대 바스켓 자본 비중">
                {bSegments.map((seg) =>
                  seg.pct > 0 ? (
                    <div
                      key={seg.key}
                      className="blueprint-segment"
                      style={{ width: `${Math.max(3, seg.pct)}%`, background: seg.color }}
                      title={`${seg.label}: ${formatKRW(seg.amount)} (${seg.pct}%)`}
                    />
                  ) : null
                )}
              </div>

              <div className="blueprint-legend-grid">
                {bSegments.map((seg) => (
                  <div key={seg.key} className="blueprint-item-card">
                    <div className="blueprint-item-top">
                      <span className="legend-dot" style={{ background: seg.color }} />
                      <strong>{seg.label}</strong>
                      <span className="blueprint-pct num">{seg.pct}%</span>
                    </div>
                    <div className="blueprint-item-val num">{fmt(seg.amount)}</div>
                    <div className="blueprint-item-note">{seg.taxNote}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 2. 생애 5대 바스켓 적층 자산 구성 추이 SVG */}
          <section className="canvas-card">
            <div className="canvas-card-header">
              <div>
                <span className="canvas-kicker">5-BASKET STACKED ASSET COMPOSITION</span>
                <h2 className="canvas-title">
                  연령별 5대 바스켓 세후 가처분 자산 구성 추이 ({isReal ? '실질' : '명목'})
                </h2>
              </div>
              {activeRow && (
                <div className="chart-readout-pill num">
                  <strong>{activeRow.ageSelf}세 ({activeRow.stageLabel})</strong> · 세후 가처분{' '}
                  <strong>{fmt(scale(activeRow.endDisposableNetWorth, activeRow))}</strong> (IRP{' '}
                  {formatKRW(scale(activeRow.endIrp, activeRow))} · ISA{' '}
                  {formatKRW(scale(activeRow.endIsa, activeRow))} · 연금저축{' '}
                  {formatKRW(scale(activeRow.endPersonalPension, activeRow))} · 일반{' '}
                  {formatKRW(scale(activeRow.endTaxable, activeRow))} · 법인청산{' '}
                  {formatKRW(scale(activeRow.endCorpLiquidationNetValue, activeRow))})
                </div>
              )}
            </div>

            <div className="chart-legend-row">
              {[
                { key: 'irp', label: 'IRP 퇴직연금', color: BASKET_COLORS.irp },
                { key: 'isa', label: '중개형 ISA', color: BASKET_COLORS.isa },
                {
                  key: 'personalPension',
                  label: '개인연금저축',
                  color: BASKET_COLORS.personalPension,
                },
                { key: 'taxable', label: '일반 과세계좌', color: BASKET_COLORS.taxable },
                {
                  key: 'corporate',
                  label: '가족법인 (청산 순가치)',
                  color: BASKET_COLORS.corporate,
                },
              ].map((item) => {
                const isMuted = mutedStackKeys.includes(item.key);
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`legend-item legend-item-btn ${isMuted ? 'legend-item-muted' : ''}`}
                    onClick={() => toggleStackKey(item.key)}
                    aria-pressed={!isMuted}
                    title="클릭하여 항목 표시/숨김 전환 (Y축 자동 스케일링)"
                  >
                    <i className="legend-dot" style={{ background: item.color }} />
                    {item.label}
                  </button>
                );
              })}
              {mutedStackKeys.length > 0 && (
                <button
                  type="button"
                  className="legend-reset-btn"
                  onClick={() => setMutedStackKeys([])}
                >
                  전체 표시
                </button>
              )}
            </div>

            <div className="svg-chart-wrap" ref={chartWrapRef}>
              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="interactive-svg"
                role="img"
                aria-label="연령별 5대 계좌 적층 잔액 차트"
                onMouseLeave={() => setActiveChartHover(null)}
              >
                {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
                  const v = maxStackVal * t;
                  const y = padT + plotH - t * plotH;
                  return (
                    <g key={idx}>
                      <line
                        x1={padL}
                        y1={y}
                        x2={chartW - padR}
                        y2={y}
                        stroke="var(--border-subtle)"
                        strokeOpacity={0.75}
                      />
                      <text
                        x={padL - 10}
                        y={y + 4}
                        textAnchor="end"
                        className="svg-axis-label num"
                      >
                        {formatAxisKRW(v)}
                      </text>
                    </g>
                  );
                })}

                {/* 선택 연차 하이라이트 밴드 */}
                <rect
                  className="svg-active-col-band"
                  x={padL + safeHoverIdx * barStep - 2}
                  y={padT}
                  width={barWidth + 4}
                  height={plotH}
                  rx={5}
                  fill="var(--accent-primary)"
                  fillOpacity={0.1}
                />

                {rows.map((r, i) => {
                  const x = padL + i * barStep;
                  const parts = [
                    {
                      v: mutedStackKeys.includes('irp') ? 0 : scale(r.endIrp, r),
                      c: BASKET_COLORS.irp,
                    },
                    {
                      v: mutedStackKeys.includes('isa') ? 0 : scale(r.endIsa, r),
                      c: BASKET_COLORS.isa,
                    },
                    {
                      v: mutedStackKeys.includes('personalPension')
                        ? 0
                        : scale(r.endPersonalPension, r),
                      c: BASKET_COLORS.personalPension,
                    },
                    {
                      v: mutedStackKeys.includes('taxable') ? 0 : scale(r.endTaxable, r),
                      c: BASKET_COLORS.taxable,
                    },
                    {
                      v: mutedStackKeys.includes('corporate')
                        ? 0
                        : scale(r.endCorpLiquidationNetValue, r),
                      c: BASKET_COLORS.corporate,
                    },
                  ];
                  let cumY = padT + plotH;
                  const isCurrent = safeHoverIdx === i;
                  return (
                    <g
                      key={r.ageSelf}
                      className="svg-point-group"
                      onMouseEnter={() => {
                        setHoverIdx(i);
                        setActiveChartHover('stack');
                      }}
                    >
                      <rect
                        x={x - (barStep - barWidth) / 2}
                        y={padT}
                        width={barStep}
                        height={plotH}
                        fill="transparent"
                      />
                      {parts.map((p, pIdx) => {
                        const rawH = Math.max(0, (p.v / maxStackVal) * plotH);
                        const h = rawH > 1.4 ? rawH - 0.8 : rawH;
                        cumY -= rawH;
                        return h > 0.25 ? (
                          <rect
                            key={pIdx}
                            x={x}
                            y={cumY}
                            width={barWidth}
                            height={h}
                            rx={2.5}
                            fill={p.c}
                            opacity={isCurrent ? 1 : 0.76}
                          />
                        ) : null;
                      })}
                      {r.ageSelf % 10 === 0 && (
                        <text
                          x={x + barWidth / 2}
                          y={chartH - 9}
                          textAnchor="middle"
                          className="svg-axis-label num"
                        >
                          {r.ageSelf}세
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* 커서 추종 플로팅 5대 바스켓 요약 카드 */}
                {activeChartHover === 'stack' &&
                  activeRow &&
                  (() => {
                    const cx = padL + safeHoverIdx * barStep;
                    const boxW = 232;
                    const boxH = 66;
                    const boxX =
                      cx + boxW + 24 > chartW - padR
                        ? Math.max(padL + 6, cx - boxW - 10)
                        : cx + 16;
                    const boxY = padT + 6;
                    return (
                      <g
                        className="svg-floating-tooltip num"
                        transform={`translate(${boxX}, ${boxY})`}
                        pointerEvents="none"
                      >
                        <rect
                          width={boxW}
                          height={boxH}
                          rx={8}
                          fill="var(--bg-elevated)"
                          stroke="var(--border-strong)"
                          strokeWidth={1.2}
                        />
                        <text x={11} y={18} className="svg-tooltip-title">
                          {activeRow.ageSelf}세 총 세후 가처분:{' '}
                          {formatKRW(scale(activeRow.endDisposableNetWorth, activeRow))}
                        </text>
                        <text x={11} y={37} className="svg-tooltip-value">
                          ■ 법인 {formatAxisKRW(scale(activeRow.endCorpLiquidationNetValue, activeRow))} ·
                          일반 {formatAxisKRW(scale(activeRow.endTaxable, activeRow))}
                        </text>
                        <text x={11} y={54} className="svg-tooltip-sub">
                          IRP {formatAxisKRW(scale(activeRow.endIrp, activeRow))} · ISA{' '}
                          {formatAxisKRW(scale(activeRow.endIsa, activeRow))} · 연금{' '}
                          {formatAxisKRW(scale(activeRow.endPersonalPension, activeRow))}
                        </text>
                      </g>
                    );
                  })()}
              </svg>
            </div>
          </section>

          {/* 3. 8단계 절세 인출 워터폴 & 연간 세금·건보·유지비 차트 */}
          <section className="canvas-card">
            <div className="canvas-card-header">
              <div>
                <span className="canvas-kicker">8-STAGE DECUMULATION WATERFALL & TAX · HEALTH · FEES</span>
                <h2 className="canvas-title">
                  연령별 8단계 현금흐름 조달 원천 및 세금·건보·유지비 추이 ({isReal ? '실질·현재가치' : '명목'})
                </h2>
              </div>
              {activeRow && (
                <div className="chart-readout-pill num">
                  <strong>{activeRow.ageSelf}세</strong> · 목표지출{' '}
                  {formatKRW(scale(activeRow.requiredLivingOutflow, activeRow))} · 공적/주택연금{' '}
                  {formatKRW(scale(activeRow.stage1PublicAndHousingPension, activeRow))} · 임원급여{' '}
                  {formatKRW(scale(activeRow.stage2CorpNetSalary, activeRow))} · 절세계좌(ISA/연금/IRP){' '}
                  {formatKRW(
                    scale(
                      activeRow.stage4IsaWithdrawal +
                        activeRow.stage5PersonalPensionWithdrawal +
                        activeRow.stage3IrpWithdrawal,
                      activeRow
                    )
                  )}{' '}
                  · 세금·건보·유지비{activeRow.additionalPensionContribution > 0 ? ' (국민연금 추납 납입액 포함)' : ''}{' '}
                  <span className="text-danger">
                    {formatKRW(scale(activeRow.totalTaxHealthAndFees, activeRow))}
                  </span>
                </div>
              )}
            </div>

            <div className="chart-legend-row">
              {[
                { key: 's1', label: '① 국민/주택연금', color: '#3b82f6' },
                { key: 's2', label: '② 법인 임원급여', color: '#4f46e5' },
                { key: 's5', label: '③ 연금저축·IRP (55세+ 개인연금)', color: BASKET_COLORS.personalPension },
                { key: 's3', label: '③ 연금저축·IRP (55세+ IRP)', color: BASKET_COLORS.irp },
                { key: 's4', label: '④ 중개형 ISA (비과세 가교·보충)', color: BASKET_COLORS.isa },
                { key: 's8', label: '⑤ 법인 출자원금/배당', color: '#9333ea' },
                { key: 's67', label: '⑥ 일반계좌 인출', color: BASKET_COLORS.taxable },
                { key: 'tax', label: '법인세·4대보험·유지비 등 (계좌 밖 비용)', color: '#ef4444' },
              ].map((item) => {
                const isMuted = mutedFlowKeys.includes(item.key);
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`legend-item legend-item-btn ${isMuted ? 'legend-item-muted' : ''}`}
                    onClick={() => toggleFlowKey(item.key)}
                    aria-pressed={!isMuted}
                    title="클릭하여 항목 표시/숨김 전환 (Y축 자동 스케일링)"
                  >
                    <i className="legend-dot" style={{ background: item.color }} />
                    {item.label}
                  </button>
                );
              })}
              {mutedFlowKeys.length > 0 && (
                <button
                  type="button"
                  className="legend-reset-btn"
                  onClick={() => setMutedFlowKeys([])}
                >
                  전체 표시
                </button>
              )}
            </div>

            <div className="svg-chart-wrap">
              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="interactive-svg"
                role="img"
                aria-label="연령별 8단계 인출 원천 및 세금 건보료 차트"
                onMouseLeave={() => setActiveChartHover(null)}
              >
                {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
                  const v = maxCashflowVal * t;
                  const y = padT + plotH - t * plotH;
                  return (
                    <g key={idx}>
                      <line
                        x1={padL}
                        y1={y}
                        x2={chartW - padR}
                        y2={y}
                        stroke="var(--border-subtle)"
                        strokeOpacity={0.75}
                      />
                      <text
                        x={padL - 10}
                        y={y + 4}
                        textAnchor="end"
                        className="svg-axis-label num"
                      >
                        {formatAxisKRW(v)}
                      </text>
                    </g>
                  );
                })}

                {/* 선택 연차 하이라이트 밴드 */}
                <rect
                  className="svg-active-col-band"
                  x={padL + safeHoverIdx * barStep - 2}
                  y={padT}
                  width={barWidth + 4}
                  height={plotH}
                  rx={5}
                  fill="var(--accent-primary)"
                  fillOpacity={0.1}
                />

                {rows.map((r, i) => {
                  const x = padL + i * barStep;
                  const flowParts = [
                    {
                      v: mutedFlowKeys.includes('s1')
                        ? 0
                        : scale(r.stage1PublicAndHousingPension, r),
                      c: '#3b82f6',
                    },
                    {
                      v: mutedFlowKeys.includes('s2') ? 0 : scale(r.stage2CorpNetSalary, r),
                      c: '#4f46e5',
                    },
                    {
                      v: mutedFlowKeys.includes('s4') ? 0 : scale(r.stage4IsaWithdrawal, r),
                      c: BASKET_COLORS.isa,
                    },
                    {
                      v: mutedFlowKeys.includes('s5')
                        ? 0
                        : scale(r.stage5PersonalPensionWithdrawal, r),
                      c: BASKET_COLORS.personalPension,
                    },
                    {
                      v: mutedFlowKeys.includes('s3') ? 0 : scale(r.stage3IrpWithdrawal, r),
                      c: BASKET_COLORS.irp,
                    },
                    {
                      v: mutedFlowKeys.includes('s8')
                        ? 0
                        : scale(r.stage8CorpFallbackDividend, r),
                      c: '#9333ea',
                    },
                    {
                      v: mutedFlowKeys.includes('s67')
                        ? 0
                        : scale(
                            r.stage6OverseasTaxableWithdrawal + r.stage7DomesticTaxableWithdrawal,
                            r
                          ),
                      c: BASKET_COLORS.taxable,
                    },
                    {
                      v: mutedFlowKeys.includes('tax') ? 0 : scale(outsideCost(r), r),
                      c: '#ef4444',
                    },
                  ];
                  let cumY = padT + plotH;
                  const isCurrent = safeHoverIdx === i;
                  return (
                    <g
                      key={r.ageSelf}
                      className="svg-point-group"
                      onMouseEnter={() => {
                        setHoverIdx(i);
                        setActiveChartHover('flow');
                      }}
                    >
                      <rect
                        x={x - (barStep - barWidth) / 2}
                        y={padT}
                        width={barStep}
                        height={plotH}
                        fill="transparent"
                      />
                      {flowParts.map((p, pIdx) => {
                        const rawH = Math.max(0, (p.v / maxCashflowVal) * plotH);
                        const h = rawH > 1.4 ? rawH - 0.8 : rawH;
                        cumY -= rawH;
                        return h > 0.25 ? (
                          <rect
                            key={pIdx}
                            x={x}
                            y={cumY}
                            width={barWidth}
                            height={h}
                            rx={2.5}
                            fill={p.c}
                            opacity={isCurrent ? 1 : 0.78}
                          />
                        ) : null;
                      })}
                      {r.ageSelf % 10 === 0 && (
                        <text
                          x={x + barWidth / 2}
                          y={chartH - 9}
                          textAnchor="middle"
                          className="svg-axis-label num"
                        >
                          {r.ageSelf}세
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* 커서 추종 플로팅 현금흐름 전 항목 요약 카드 */}
                {activeChartHover === 'flow' &&
                  activeRow &&
                  (() => {
                    const cx = padL + safeHoverIdx * barStep;
                    const activeSources: string[] = [];
                    if (activeRow.stage1PublicAndHousingPension > 0) {
                      activeSources.push(
                        `공적/주택연금 ${formatAxisKRW(scale(activeRow.stage1PublicAndHousingPension, activeRow))}`
                      );
                    }
                    if (activeRow.stage2CorpNetSalary > 0) {
                      activeSources.push(
                        `법인급여 ${formatAxisKRW(scale(activeRow.stage2CorpNetSalary, activeRow))}`
                      );
                    }
                    if (activeRow.stage4IsaWithdrawal > 0) {
                      activeSources.push(
                        `ISA ${formatAxisKRW(scale(activeRow.stage4IsaWithdrawal, activeRow))}`
                      );
                    }
                    if (activeRow.stage5PersonalPensionWithdrawal > 0) {
                      activeSources.push(
                        `연금저축 ${formatAxisKRW(scale(activeRow.stage5PersonalPensionWithdrawal, activeRow))}`
                      );
                    }
                    if (activeRow.stage3IrpWithdrawal > 0) {
                      activeSources.push(
                        `IRP ${formatAxisKRW(scale(activeRow.stage3IrpWithdrawal, activeRow))}`
                      );
                    }
                    if (activeRow.stage8CorpFallbackDividend > 0) {
                      activeSources.push(
                        `법인가수금/배당 ${formatAxisKRW(scale(activeRow.stage8CorpFallbackDividend, activeRow))}`
                      );
                    }
                    const taxableW =
                      activeRow.stage6OverseasTaxableWithdrawal +
                      activeRow.stage7DomesticTaxableWithdrawal;
                    if (taxableW > 0) {
                      activeSources.push(
                        `${activeRow.isEmployed && activeRow.lumpSumEventOutflow === 0 ? '배당세 원천징수' : '일반계좌'} ${formatAxisKRW(scale(taxableW, activeRow))}`
                      );
                    }
                    const line1 =
                      activeSources.slice(0, 3).join(' · ') || '재직 적립기 (계좌 인출 없음)';
                    const line2 = activeSources.slice(3).join(' · ');
                    const boxW = 340;
                    const boxH = line2 ? 84 : 68;
                    // 340px 상자를 왼쪽으로 뒤집을 때 padL에서 자르면 커서 막대를 덮으므로 Y축 라벨 영역까지 허용
                    const boxX =
                      cx + boxW + 24 > chartW - padR
                        ? Math.max(6, cx - boxW - 10)
                        : cx + 16;
                    const boxY = padT + 4;
                    return (
                      <g
                        className="svg-floating-tooltip num"
                        transform={`translate(${boxX}, ${boxY})`}
                        pointerEvents="none"
                      >
                        <rect
                          width={boxW}
                          height={boxH}
                          rx={8}
                          fill="var(--bg-elevated)"
                          stroke="var(--border-strong)"
                          strokeWidth={1.2}
                        />
                        <text x={11} y={18} className="svg-tooltip-title">
                          {activeRow.ageSelf}세 목표지출:{' '}
                          {formatKRW(scale(activeRow.requiredLivingOutflow, activeRow))}
                        </text>
                        <text x={11} y={36} className="svg-tooltip-value">
                          {line1}
                        </text>
                        {line2 ? (
                          <>
                            <text x={11} y={53} className="svg-tooltip-value">
                              {line2}
                            </text>
                            <text x={11} y={71} className="svg-tooltip-sub">
                              세금·건보·유지비 {formatKRW(scale(activeRow.totalTaxHealthAndFees, activeRow))} (세금{' '}
                              {formatAxisKRW(
                                scale(
                                  activeRow.personalIncomeAndDivTax + activeRow.corpCorporateTax,
                                  activeRow
                                )
                              )}{' '}
                              · 건보/4대보험{' '}
                              {formatAxisKRW(
                                scale(
                                  activeRow.personalHealthInsurance +
                                    activeRow.corpPayrollTaxAndInsurance,
                                  activeRow
                                )
                              )}
                              )
                            </text>
                          </>
                        ) : (
                          <text x={11} y={54} className="svg-tooltip-sub">
                            세금·건보·유지비 {formatKRW(scale(activeRow.totalTaxHealthAndFees, activeRow))} (세금{' '}
                            {formatAxisKRW(
                              scale(
                                activeRow.personalIncomeAndDivTax + activeRow.corpCorporateTax,
                                activeRow
                              )
                            )}{' '}
                            · 건보/4대보험{' '}
                            {formatAxisKRW(
                              scale(
                                activeRow.personalHealthInsurance +
                                  activeRow.corpPayrollTaxAndInsurance,
                                activeRow
                              )
                            )}
                            )
                          </text>
                        )}
                      </g>
                    );
                  })()}
              </svg>
            </div>
          </section>
        </>
      )}

      {/* 4. 51개년 1원 무결성 원장 테이블 */}
      {sectionMode !== 'charts' && (
        <section className="canvas-card canvas-card-ledger">
          <div className="canvas-card-header">
            <div>
              <span className="canvas-kicker">CANONICAL 1-WON ACCOUNTING LEDGER</span>
              <h2 className="canvas-title">
                100세 생애 연차별 5대 바스켓 원장 ({isReal ? '실질·현재가치' : '명목'} · 최대 회계보존 오차:{' '}
                {activeLedger.maxAccountingResidualAbs}원
                <span className="screen-only-hint"> · 항목에 마우스를 올리면 산출 근거 표시</span>)
              </h2>
            </div>

            <div className="ledger-toolbar">
              <label className="dock-checkbox-inline">
                <input
                  type="checkbox"
                  checked={retiredOnly}
                  onChange={(e) => setRetiredOnly(e.target.checked)}
                />
                <span>은퇴 후 구간만 보기</span>
              </label>

              <label className="dock-checkbox-inline">
                <input
                  type="checkbox"
                  checked={exactWon}
                  onChange={(e) => setExactWon(e.target.checked)}
                />
                <span>1원 정밀 단위 표시</span>
              </label>

              <button type="button" className="btn-secondary" onClick={handleExportCsv}>
                CSV 내보내기
              </button>
              <button type="button" className="btn-secondary" onClick={handleExportMasterPlanCsv}>
                통합 마스터플랜 CSV
              </button>
            </div>
          </div>

          <p className="ledger-table-footnote" style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted)' }}>
            ※ <strong>세금·건보·유지비</strong> 열은 그해 생활비로 쓰지 못하고 빠져나간 새는 비용의 합계입니다 (개인세·법인세·건보료·4대보험·법인 유지비, <strong>국민연금 추납 납입액 포함</strong> — 추납은 세금이 아니라 연금 납입액). 세금 항목은 개인 소득·연금·양도세와 법인 운용수익에 대한 <strong>법인세({inputs.corporate.taxType === 'transparent' ? `${CORP_TAX_PCT.transparent}%` : `${CORP_TAX_PCT.normalLow}~${CORP_TAX_PCT.normalHigh}%`})</strong>를 합산 표시합니다. (예: <code>법인세 112만</code>은 가수금 비과세 반제 시 개인세금 0원 + 법인 내부 운용수익 법인세)
          </p>

          <div className="ledger-table-scroll">
            <table className="ledger-table num">
              <thead>
                <tr>
                  <th>연령 (본인/배우자)</th>
                  <th>구간</th>
                  <th>기초 장부총액</th>
                  <th>투자수익</th>
                  <th>외부유입 (연금·저축·퇴직)</th>
                  <th>목표생활비 지출</th>
                  <th>인출원천 (IRP/ISA/연금/일반/법인)</th>
                  <th>세금·건보·유지비</th>
                  <th>기말 5대 계좌 장부잔액 (IRP / ISA / 연금 / 일반 / 법인)</th>
                  <th>기말 세후 가처분 순자산 (청산세 차감)</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r, rowIdx) => {
                  const taxableWithdraw =
                    r.stage6OverseasTaxableWithdrawal + r.stage7DomesticTaxableWithdrawal;
                  // 재직 중(목돈 지출 없음) 일반계좌 인출 = 분배금에서 낸 배당세 정산분뿐 (생활비 인출 아님)
                  const isDivTaxOnly = r.isEmployed && r.lumpSumEventOutflow === 0;
                  const withdrawSum =
                    r.stage2CorpNetSalary +
                    r.stage3IrpWithdrawal +
                    r.stage4IsaWithdrawal +
                    r.stage5PersonalPensionWithdrawal +
                    taxableWithdraw +
                    r.stage8CorpFallbackDividend;

                  // 외부유입 인라인 분해 (실질가치 모드에서 은퇴 당일 퇴직금은 명목 원금을 병기해 D-Day 브릿지와 수치 혼선 제거)
                  const inflowParts: string[] = [];
                  if (r.savingsAndSeveranceInflow > 0) {
                    const isDday = r.ageSelf === inputs.transition.targetRetirementAgeSelf;
                    const scaledInflow = formatAxisKRW(scale(r.savingsAndSeveranceInflow, r));
                    const nominalSuffix =
                      isDday && isReal && r.discountFactor < 0.999
                        ? ` (명목 ${formatAxisKRW(r.savingsAndSeveranceInflow)})`
                        : '';
                    inflowParts.push(`${isDday ? '퇴직금' : '저축'} ${scaledInflow}${nominalSuffix}`);
                  }
                  if (r.publicPensionInflow > 0) {
                    inflowParts.push(`국민연금 ${formatAxisKRW(scale(r.publicPensionInflow, r))}`);
                  }
                  if (r.housingPensionInflow > 0) {
                    inflowParts.push(`주택연금 ${formatAxisKRW(scale(r.housingPensionInflow, r))}`);
                  }
                  if (r.realEstateCashInflow > 0) {
                    inflowParts.push(`부동산 ${formatAxisKRW(scale(r.realEstateCashInflow, r))}`);
                  }
                  if (r.lumpSumEventInflow > 0) {
                    inflowParts.push(
                      `일시유입(${r.lumpSumInflowLabels.join(', ') || '이벤트'}) ${formatAxisKRW(scale(r.lumpSumEventInflow, r))}`
                    );
                  }

                  // 인출원천 인라인 분해
                  const withdrawParts: string[] = [];
                  if (r.stage2CorpNetSalary > 0) {
                    withdrawParts.push(`급여 ${formatAxisKRW(scale(r.stage2CorpNetSalary, r))}`);
                  }
                  if (r.stage4IsaWithdrawal > 0) {
                    withdrawParts.push(`ISA ${formatAxisKRW(scale(r.stage4IsaWithdrawal, r))}`);
                  }
                  if (r.stage5PersonalPensionWithdrawal > 0) {
                    withdrawParts.push(
                      `연금저축 ${formatAxisKRW(scale(r.stage5PersonalPensionWithdrawal, r))}`
                    );
                  }
                  if (r.stage3IrpWithdrawal > 0) {
                    withdrawParts.push(`IRP ${formatAxisKRW(scale(r.stage3IrpWithdrawal, r))}`);
                  }
                  if (r.stage8CorpFallbackDividend > 0) {
                    withdrawParts.push(
                      `법인가수금/배당 ${formatAxisKRW(scale(r.stage8CorpFallbackDividend, r))}`
                    );
                  }
                  if (taxableWithdraw > 0) {
                    withdrawParts.push(
                      `${isDivTaxOnly ? '배당세 원천징수' : '일반'} ${formatAxisKRW(scale(taxableWithdraw, r))}`
                    );
                  }

                  // 세금·건보·유지비 인라인 분해
                  const totalTaxes =
                    r.personalIncomeAndDivTax + r.corpCorporateTax + r.personalPropertyTax;
                  const totalHealthAndPayroll =
                    r.personalHealthInsurance + r.corpPayrollTaxAndInsurance;
                  const frictionParts: string[] = [];
                  if (totalTaxes > 0) {
                    if (r.corpCorporateTax > 0 && r.personalIncomeAndDivTax > 0) {
                      const propTaxStr =
                        r.personalPropertyTax > 0
                          ? `·보유세 ${formatAxisKRW(scale(r.personalPropertyTax, r))}`
                          : '';
                      frictionParts.push(
                        `세금(법인포함) ${formatAxisKRW(scale(totalTaxes, r))} (개인 ${formatAxisKRW(scale(r.personalIncomeAndDivTax, r))}·법인 ${formatAxisKRW(scale(r.corpCorporateTax, r))}${propTaxStr})`
                      );
                    } else if (r.corpCorporateTax > 0) {
                      frictionParts.push(`법인세 ${formatAxisKRW(scale(totalTaxes, r))}`);
                    } else {
                      frictionParts.push(`개인세금 ${formatAxisKRW(scale(totalTaxes, r))}`);
                    }
                  }
                  if (totalHealthAndPayroll > 0) {
                    frictionParts.push(`건보/4대 ${formatAxisKRW(scale(totalHealthAndPayroll, r))}`);
                  }
                  if (r.corpMaintenanceAndFixedCost > 0) {
                    frictionParts.push(
                      `유지비 ${formatAxisKRW(scale(r.corpMaintenanceAndFixedCost, r))}`
                    );
                  }
                  if (r.additionalPensionContribution > 0) {
                    frictionParts.push(
                      `연금추납 ${formatAxisKRW(scale(r.additionalPensionContribution, r))}`
                    );
                  }

                  return (
                    <tr
                      key={r.ageSelf}
                      className={`${
                        r.ageSelf === inputs.transition.targetRetirementAgeSelf
                          ? 'ledger-row-dday'
                          : ''
                      } ${rowIdx < 3 ? 'ledger-row-top-popover' : ''}`.trim()}
                      onMouseEnter={orientLedgerPopover}
                      onFocus={orientLedgerPopover}
                    >
                      <td>
                        <strong>{r.ageSelf}세</strong> / {r.ageSpouse}세
                      </td>
                      <td>{r.stageLabel}</td>
                      <td>{fmt(scale(r.startBookTotal, r))}</td>
                      <td className="text-positive">+{fmt(scale(r.grossInvestmentReturn, r))}</td>
                      <td className="ledger-has-popover" tabIndex={0}>
                        <div>+{fmt(scale(r.totalExternalInflow, r))}</div>
                        {inflowParts.length > 0 && (
                          <div className="ledger-cell-breakdown">{inflowParts.join(' · ')}</div>
                        )}
                        <div className="ledger-why-popover" role="tooltip">
                          <strong>
                            {r.ageSelf}세 외부유입 산출 근거 (총 +{fmt(scale(r.totalExternalInflow, r))})
                          </strong>
                          <p>
                            계좌 밖에서 새로 들어온 돈입니다. 계좌 안에서 불어난 돈은 투자수익 열에 따로
                            집계됩니다.
                          </p>
                          <ul>
                            {r.savingsAndSeveranceInflow > 0 &&
                              (r.isEmployed ? (
                                <li>
                                  재직 중 저축: <strong>{fmt(scale(r.savingsAndSeveranceInflow, r))}</strong>{' '}
                                  (월 저축액 × 12 → ISA·연금저축 한도 우선, 나머지는 개인:법인 비율로 적립)
                                </li>
                              ) : (
                                <li>
                                  D-Day 퇴직금(세전):{' '}
                                  <strong>{fmt(scale(r.savingsAndSeveranceInflow, r))}</strong>{' '}
                                  {inputs.transition.severanceTransferToIrp
                                    ? '(IRP로 이전 → 퇴직소득세 과세이연)'
                                    : '(일시수령 → 퇴직소득세 원천징수분은 세금·건보·유지비 열에 계상)'}
                                </li>
                              ))}
                            {r.publicPensionInflow > 0 && (
                              <li>
                                국민연금: <strong>{fmt(scale(r.publicPensionInflow, r))}</strong>
                              </li>
                            )}
                            {r.housingPensionInflow > 0 && (
                              <li>
                                주택연금: <strong>{fmt(scale(r.housingPensionInflow, r))}</strong>
                              </li>
                            )}
                            {r.realEstateCashInflow > 0 && (
                              <li>
                                부동산 다운사이징 차액: <strong>{fmt(scale(r.realEstateCashInflow, r))}</strong>
                              </li>
                            )}
                            {r.lumpSumEventInflow > 0 && (
                              <li>
                                목돈 이벤트({r.lumpSumInflowLabels.join(', ') || '이벤트'}):{' '}
                                <strong>{fmt(scale(r.lumpSumEventInflow, r))}</strong>
                              </li>
                            )}
                            {r.totalExternalInflow === 0 && <li>이 해에는 외부에서 들어온 돈이 없습니다.</li>}
                          </ul>
                        </div>
                      </td>
                      <td>
                        <div>-{fmt(scale(r.requiredLivingOutflow, r))}</div>
                        {r.lumpSumEventOutflow > 0 && (
                          <div className="ledger-cell-breakdown">
                            일시지출({r.lumpSumOutflowLabels.join(', ') || '이벤트'}){' '}
                            {formatAxisKRW(scale(r.lumpSumEventOutflow, r))} 포함
                          </div>
                        )}
                      </td>
                      <td className="ledger-has-popover" tabIndex={0}>
                        <div>{fmt(scale(withdrawSum, r))}</div>
                        <div className="ledger-cell-breakdown">
                          {withdrawParts.length > 0
                            ? withdrawParts.join(' · ')
                            : r.isEmployed
                              ? '재직중 (인출 없음)'
                              : '공적연금으로 충당'}
                        </div>
                        <div className="ledger-why-popover" role="tooltip">
                          <strong>
                            {r.ageSelf}세 인출원천 산출 근거 (총 {fmt(scale(withdrawSum, r))})
                          </strong>
                          <p>
                            목표지출 {fmt(scale(r.requiredLivingOutflow, r))} 중 외부유입 공적/주택연금(
                            {fmt(scale(r.stage1PublicAndHousingPension, r))}) 차감 후 부족분을 8단계 절세
                            우선순위로 조달합니다.
                          </p>
                          <ul>
                            {r.isEmployed && (
                              <li>
                                재직 적립기: 근로소득으로 생활비를 충당하므로 생활비 인출 0원
                                {isDivTaxOnly && taxableWithdraw > 0
                                  ? ' (일반계좌 분배금에서 배당소득세만 원천징수)'
                                  : ''}
                              </li>
                            )}
                            {r.stage2CorpNetSalary > 0 && (
                              <li>
                                ② 법인 임원급여: <strong>{fmt(scale(r.stage2CorpNetSalary, r))}</strong>{' '}
                                (직장건보 자격 유지로 지역건보료 방어)
                              </li>
                            )}
                            {r.stage5PersonalPensionWithdrawal > 0 && (
                              <li>
                                ③ 개인연금저축:{' '}
                                <strong>{fmt(scale(r.stage5PersonalPensionWithdrawal, r))}</strong>{' '}
                                (연금개시 연령 이후 인당 연 1,500만 저율 분리과세 한도 내 인출)
                              </li>
                            )}
                            {r.stage3IrpWithdrawal > 0 && (
                              <li>
                                ③ 퇴직연금 IRP:{' '}
                                <strong>{fmt(scale(r.stage3IrpWithdrawal, r))}</strong> (이연퇴직소득 원금
                                감면세율 우선 적용 및 저율 한도 내 인출)
                              </li>
                            )}
                            {r.stage4IsaWithdrawal > 0 && (
                              <li>
                                ④ 중개형 ISA: <strong>{fmt(scale(r.stage4IsaWithdrawal, r))}</strong>{' '}
                                (비과세·{ISA_SEPARATE_TAX_PCT}% 분리과세, 건보료 과표 제외 1순위 인출)
                              </li>
                            )}
                            {r.stage8CorpFallbackDividend > 0 && (
                              <li>
                                ⑤ 법인 가수금/배당:{' '}
                                <strong>{fmt(scale(r.stage8CorpFallbackDividend, r))}</strong> (출자원금
                                세금·건보 0원 비과세 선회수 후 잔여분 배당)
                              </li>
                            )}
                            {taxableWithdraw > 0 && (
                              <li>
                                {isDivTaxOnly ? '⑥ 배당세 원천징수' : '⑥ 일반계좌 인출'}:{' '}
                                <strong>{fmt(scale(taxableWithdraw, r))}</strong>{' '}
                                {isDivTaxOnly
                                  ? '(일반계좌 ETF 분배금에서 낸 배당소득세 — 세금·건보·유지비 열의 개인세와 같은 돈)'
                                  : '(해외직투 연 250만 양도세 기본공제 우선 활용)'}
                              </li>
                            )}
                          </ul>
                        </div>
                      </td>
                      <td className="text-danger ledger-has-popover" tabIndex={0}>
                        <div>-{fmt(scale(r.totalTaxHealthAndFees, r))}</div>
                        {frictionParts.length > 0 && (
                          <div className="ledger-cell-breakdown">{frictionParts.join(' · ')}</div>
                        )}
                        <div className="ledger-why-popover" role="tooltip">
                          <strong>
                            {r.ageSelf}세 세금·건보·유지비 산출 근거 (총 -
                            {fmt(scale(r.totalTaxHealthAndFees, r))})
                          </strong>
                          <ul>
                            <li>
                              개인 소득·배당·연금세 합계:{' '}
                              <strong>{fmt(scale(r.personalIncomeAndDivTax, r))}</strong>
                              {r.personalPropertyTax > 0 && (
                                <> · 주택보유세(재산·종부): <strong>{fmt(scale(r.personalPropertyTax, r))}</strong></>
                              )}
                              <div className="ledger-cell-breakdown">
                                · 공적연금·배당세: {fmt(scale(r.taxPublicAndDiv, r))} · 사적연금·IRP세:{' '}
                                {fmt(scale(r.taxPrivatePensionAndIrp, r))}
                                <br />· 해외주식 양도세({inputs.pension.hasSpouse ? '부부 500만' : '250만'}{' '}
                                공제): {fmt(scale(r.taxOverseasCapGains, r))} · ISA·일시퇴직세:{' '}
                                {fmt(scale(r.taxIsaAndSeveranceLump, r))}
                                {r.personalPropertyTax > 0 && (
                                  <> · 주택보유세(재산·종부): {fmt(scale(r.personalPropertyTax, r))}</>
                                )}
                              </div>
                            </li>
                            <li>
                              개인 지역건보료:{' '}
                              <strong>{fmt(scale(r.personalHealthInsurance, r))}</strong> (
                              {r.personalHealthInsurance === 0
                                ? r.isEmployed
                                  ? '재직 직장가입자 — 지역건보 0원'
                                  : '법인 임원 직장가입 방어로 지역건보 0원'
                                : `공시가·공적연금(50%)·금융소득 기준 부과 · 피부양자 요건 ${
                                    r.isHealthDependentEligible ? '충족' : '초과(탈락)'
                                  }`}
                              )
                            </li>
                            <li>
                              세법·건보 절벽 여유 한도: 피부양자 소득 여유{' '}
                              <strong>{fmt(scale(r.dependentIncomeHeadroom ?? 0, r))}</strong> · 사적연금
                              저율한도 여유{' '}
                              <strong>
                                {fmt(
                                  scale(
                                    Math.max(
                                      0,
                                      (inputs.pension.hasSpouse ? 30_000_000 : 15_000_000) -
                                        r.stage5PersonalPensionWithdrawal
                                    ),
                                    r
                                  )
                                )}
                              </strong>
                            </li>
                            {r.additionalPensionContribution > 0 && (
                              <li>
                                국민연금 추납 일시납 원금:{' '}
                                <strong>{fmt(scale(r.additionalPensionContribution, r))}</strong> (은퇴 전환 시점 일반과세계좌 차감)
                              </li>
                            )}
                            <li>
                              법인세 (운용수익 과세):{' '}
                              <strong>{fmt(scale(r.corpCorporateTax, r))}</strong> (법인 투자수익에서 급여·기장료 손금산입 후 과세)
                            </li>
                            <li>
                              법인 임원 4대보험·근로소득세:{' '}
                              <strong>{fmt(scale(r.corpPayrollTaxAndInsurance, r))}</strong> (
                              {r.ageSelf >= 60
                                ? '만 60세 이상 국민연금 면제 — 직장건보·고용보험만 부과'
                                : `임원 급여분 직장건보·국민연금 ${(getNationalPensionRateTotal(r.yearIndex - 1) * 100).toFixed(1)}%·고용보험`}
                              )
                            </li>
                            <li>
                              법인 세무기장·유지비:{' '}
                              <strong>{fmt(scale(r.corpMaintenanceAndFixedCost, r))}</strong> (연간 법인 기장·결산 고정비)
                            </li>
                          </ul>
                        </div>
                      </td>
                      <td className="ledger-baskets-cell">
                        {formatKRW(scale(r.endIrp, r))} / {formatKRW(scale(r.endIsa, r))} /{' '}
                        {formatKRW(scale(r.endPersonalPension, r))} /{' '}
                        {formatKRW(scale(r.endTaxable, r))} / {formatKRW(scale(r.endCorp, r))}
                      </td>
                      <td>
                        <strong>{fmt(scale(r.endDisposableNetWorth, r))}</strong>
                        {r.endBookTotal > r.endDisposableNetWorth && (
                          <div className="ledger-cell-breakdown">
                            장부 {formatAxisKRW(scale(r.endBookTotal, r))} − 청산세{' '}
                            {formatAxisKRW(scale(r.endBookTotal - r.endDisposableNetWorth, r))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};
