import React, { useMemo, useRef, useState } from 'react';
import { chartHeightFor, useChartWidth } from './useChartWidth';
import { claimStartAge, optimalTradeoffNote, strategyCardPills } from './planVerdict';
import { CORP_TAX_PCT } from './ControlDock';
import {
  evaluateSensitivityBand,
  formatKRW,
  type OptimizationMasterPlan,
  type StrategySummaryCard,
} from '../engine';

/**
 * 배분 곡선 점 탭 처리: 마우스는 클릭 즉시 적용(기존 동작).
 * 터치는 값을 보려는 탭만으로 비율이 바뀌고 r* 자동 최적이 꺼지지 않도록, 첫 탭은 툴팁만 열고(arm) 같은 점을 다시 탭하면 적용.
 */
export const resolveCurveTap = (pointerType: string, armedIdx: number | null, idx: number): 'arm' | 'apply' =>
  pointerType === 'touch' && armedIdx !== idx ? 'arm' : 'apply';

export interface Lens1AllocationTrackProps {
  plan: OptimizationMasterPlan;
  onSelectPersonalRatio?: (ratio: number) => void;
  defaultShowSensitivityBand?: boolean;
  /** 인쇄 레이아웃: 차트 폭을 780 고정 viewBox로 유지 (실측 폭 미사용). */
  isPrintMode?: boolean;
}

export const Lens1AllocationTrack: React.FC<Lens1AllocationTrackProps> = ({
  plan,
  onSelectPersonalRatio,
  defaultShowSensitivityBand = false,
  isPrintMode = false,
}) => {
  const {
    inputs,
    cards,
    allocationCurve,
    personal100,
    corporate100,
    optimalHybrid,
    activeLedger,
    breakEven,
  } = plan;

  const [hoverYearIdx, setHoverYearIdx] = useState<number | null>(null);
  const [hoverCurveIdx, setHoverCurveIdx] = useState<number | null>(null);
  const [touchArmedIdx, setTouchArmedIdx] = useState<number | null>(null);
  const lastPointerTypeRef = useRef('mouse');
  const [showSensitivityBandState, setShowSensitivityBand] = useState<boolean>(defaultShowSensitivityBand);
  const showSensitivityBand = defaultShowSensitivityBand || showSensitivityBandState;
  const [mutedTrajKeys, setMutedTrajKeys] = useState<string[]>([]);
  const [curveWrapRef, curveW] = useChartWidth(isPrintMode);
  const [trajWrapRef, trajW] = useChartWidth(isPrintMode);

  const toggleTrajKey = (key: string) => {
    setMutedTrajKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };
  const showHybridTraj = !mutedTrajKeys.includes('hybrid');
  // U-1: 궤적 차트의 주 궤적 = activeLedger(auto=권고안, 수동=선택안). 수학적 r*는 배분 효율 곡선(차트 1)에 표시
  const isAutoRatio = inputs.hybrid.useAutoOptimalRatio ?? true;
  const activeTrajLabel = isAutoRatio
    ? activeLedger.personalRatio === optimalHybrid.personalRatio
      ? '최적 r* · 권고안'
      : '권고안'
    : '선택안';
  const showPersonalTraj = !mutedTrajKeys.includes('personal');
  const showCorpTraj = !mutedTrajKeys.includes('corporate');

  const sensitivityBand = useMemo(
    () =>
      showSensitivityBand
        ? evaluateSensitivityBand(inputs, activeLedger.personalRatio)
        : null,
    [showSensitivityBand, inputs, activeLedger.personalRatio]
  );

  const isReal = inputs.transition.viewMode === 'real';
  const retAge = inputs.transition.targetRetirementAgeSelf;
  const rowsCount = activeLedger.rows.length;

  // 1. 공통 모던 차트 헬퍼: 축약형 Y축 포맷터 & Catmull-Rom 스플라인 생성기
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

  const buildSmoothPath = (pts: [number, number][]): string => {
    if (pts.length === 0) return '';
    if (pts.length === 1) return `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    let d = `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
      const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
      const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  };

  // SVG 알약 라벨 폭 추정(11px bold 기준: 한글 ≈11.5px, 그 외 ≈7px, 좌우 여백 24px)
  const pillTextWidth = (t: string) => [...t].reduce((w, ch) => w + (/[가-힣]/.test(ch) ? 11.5 : 7), 24);

  // 1. 생애 세후 가처분 순자산 궤적 SVG 좌표 계산
  const trajH = chartHeightFor(trajW, 268);
  const padL = 104;
  const padR = 36;
  const padT = 30;
  const padB = 34;
  const plotW = trajW - padL - padR;
  const plotH = trajH - padT - padB;

  const getRowDisp = (simRows: typeof activeLedger.rows, idx: number) => {
    const r = simRows[idx];
    if (!r) return 0;
    return Math.round(r.endDisposableNetWorth * r.discountFactor);
  };

  let maxTrajVal = 100_000_000;
  for (let i = 0; i < rowsCount; i++) {
    maxTrajVal = Math.max(
      maxTrajVal,
      showPersonalTraj ? getRowDisp(personal100.rows, i) : 0,
      showCorpTraj ? getRowDisp(corporate100.rows, i) : 0,
      showHybridTraj ? getRowDisp(activeLedger.rows, i) : 0,
      sensitivityBand?.bandPoints[i]?.plus2PctNetWorth ?? 0,
      sensitivityBand?.bandPoints[i]?.p90NetWorth ?? 0
    );
  }
  // 4등분(0, 25%, 50%, 75%, 100%) 눈금이 깔끔한 억 단위로 떨어지도록 2억(또는 고액 시 4억) 배수로 올림
  const trajStepUnit = maxTrajVal >= 2_000_000_000 ? 400_000_000 : 200_000_000;
  maxTrajVal = Math.ceil((maxTrajVal * 1.06) / trajStepUnit) * trajStepUnit;

  const xForIdx = (idx: number) =>
    padL + (rowsCount <= 1 ? 0 : (idx / (rowsCount - 1)) * plotW);
  const yForVal = (v: number) =>
    padT + plotH - Math.min(1, Math.max(0, v / maxTrajVal)) * plotH;

  const buildTrajectorySmooth = (simRows: typeof activeLedger.rows) =>
    buildSmoothPath(simRows.map((_, i) => [xForIdx(i), yForVal(getRowDisp(simRows, i))]));

  const hybridTrajPath = buildTrajectorySmooth(activeLedger.rows);
  const hybridTrajArea =
    rowsCount > 1
      ? `${hybridTrajPath} L ${xForIdx(rowsCount - 1).toFixed(1)},${(padT + plotH).toFixed(1)} L ${xForIdx(0).toFixed(1)},${(padT + plotH).toFixed(1)} Z`
      : '';

  const sensitivityBandPolygon = useMemo(() => {
    if (!sensitivityBand || sensitivityBand.bandPoints.length < 2) return '';
    const upperPts = sensitivityBand.bandPoints.map(
      (pt, i) => `${xForIdx(i).toFixed(1)},${yForVal(pt.plus2PctNetWorth).toFixed(1)}`
    );
    const lowerPts = [...sensitivityBand.bandPoints]
      .reverse()
      .map((pt, revIdx) => {
        const i = sensitivityBand.bandPoints.length - 1 - revIdx;
        return `${xForIdx(i).toFixed(1)},${yForVal(pt.minus2PctNetWorth).toFixed(1)}`;
      });
    return `M ${upperPts.join(' L ')} L ${lowerPts.join(' L ')} Z`;
  }, [sensitivityBand, maxTrajVal, rowsCount, trajW, trajH]);

  const retIdx = Math.max(
    0,
    activeLedger.rows.findIndex((r) => r.ageSelf === retAge)
  );
  const pensionClaimAge = claimStartAge(inputs.pension.claimTimingSelf, inputs.pension.currentAgeSelf); // B6
  const pensionIdx = activeLedger.rows.findIndex((r) => r.ageSelf === pensionClaimAge);

  const activeHoverIdx =
    hoverYearIdx !== null ? Math.min(rowsCount - 1, Math.max(0, hoverYearIdx)) : rowsCount - 1;
  const hoverAge = activeLedger.rows[activeHoverIdx]?.ageSelf ?? 100;

  // 2. 0%~100% 배분 효율 곡선 SVG 좌표 계산 (데이터 편차 기반 적응형 Y축 스케일링으로 곡률 극대화)
  const curveH = chartHeightFor(curveW, 248);
  const cPlotW = curveW - padL - padR;
  const cPlotH = curveH - padT - padB;

  const curveVals = allocationCurve.map((pt) => pt.finalDisposableNetWorth);
  const minValRaw = curveVals.length > 0 ? Math.min(...curveVals) : 0;
  const maxValRaw = curveVals.length > 0 ? Math.max(...curveVals) : 100_000_000;
  const curveSpread = Math.max(50_000_000, maxValRaw - minValRaw);
  const minCurveVal = Math.max(
    0,
    Math.floor((minValRaw - curveSpread * 0.22) / 10_000_000) * 10_000_000
  );
  const maxCurveVal = Math.max(
    minCurveVal + 40_000_000,
    Math.ceil((maxValRaw + curveSpread * 0.28) / 10_000_000) * 10_000_000
  );

  const xForRatio = (pRatio: number) => padL + (pRatio / 100) * cPlotW;
  const yForCurveVal = (v: number) =>
    padT +
    cPlotH -
    Math.min(1, Math.max(0, (v - minCurveVal) / Math.max(1, maxCurveVal - minCurveVal))) * cPlotH;

  const curvePoints: [number, number][] = allocationCurve.map((pt) => [
    xForRatio(pt.personalRatio),
    yForCurveVal(pt.finalDisposableNetWorth),
  ]);
  const curvePath = buildSmoothPath(curvePoints);
  const curveAreaPath =
    curvePoints.length > 1
      ? `${curvePath} L ${curvePoints[curvePoints.length - 1][0].toFixed(1)},${(padT + cPlotH).toFixed(1)} L ${curvePoints[0][0].toFixed(1)},${(padT + cPlotH).toFixed(1)} Z`
      : '';

  const activeCurvePt =
    hoverCurveIdx !== null && allocationCurve[hoverCurveIdx]
      ? allocationCurve[hoverCurveIdx]
      : allocationCurve.find((pt) => pt.personalRatio === optimalHybrid.personalRatio) ??
        allocationCurve[0];

  const strategyCards: StrategySummaryCard[] = [cards.personal, cards.hybrid, cards.corporate];

  return (
    <div className="lens-panel" aria-label="렌즈 1: 자본 배분 효율 및 생애 순자산 궤적">
      {/* 1. 3대 전략 정면 대결 스코어보드 */}
      <section className="canvas-card">
        <div className="canvas-card-header">
          <div>
            <span className="canvas-kicker">TRI-MODAL STRATEGY COMPARISON</span>
            <h2 className="canvas-title">
              개인 100% vs 최적 하이브리드(r*) vs 법인 100% 정면 대결
            </h2>
          </div>
          <span className="canvas-subtitle">
            동일 포트폴리오 수익률 · 세후 청산 가처분 순자산 기준 ({isReal ? '실질 구매력' : '명목 화폐가치'})
          </span>
        </div>

        <div className="strategy-compare-grid">
          {strategyCards.map((c) => {
            const isBest = c.strategyType === plan.winner; // B8: 강조 = 실행 권고 카드
            const pills = strategyCardPills(c.strategyType, plan.winner, plan.recommendation);
            return (
              <div
                key={c.strategyType}
                className={`strategy-score-card ${isBest ? 'strategy-score-card-winner' : ''}`}
              >
                <div className="strategy-score-header">
                  <span className="strategy-title">{c.strategyName}</span>
                  {pills.map((label) => (
                    <span key={label} className="winner-pill">
                      {label}
                    </span>
                  ))}
                </div>

                <div className="strategy-main-metric num">
                  <span className="metric-caption">100세 세후 청산 가처분 순자산</span>
                  <strong>{formatKRW(c.finalDisposableNetWorth)}</strong>
                </div>

                <dl className="strategy-detail-list num">
                  <div>
                    <dt>지속가능 한계 월생활비</dt>
                    <dd>월 {formatKRW(c.sustainableMonthlyLivingExpense)}</dd>
                  </div>
                  <div>
                    <dt>생애 총 세금·건보·유지비</dt>
                    <dd>{formatKRW(c.totalLifetimeTaxAndHealthCost)}</dd>
                  </div>
                  <div>
                    <dt>단순보유 대비 절세·건보 방어</dt>
                    <dd className="text-positive">
                      +{formatKRW(Math.max(0, c.totalLifetimeTaxAndHealthSaved))}
                    </dd>
                  </div>
                  <div>
                    <dt>은퇴기 최저 순자산 방어선</dt>
                    <dd>
                      {formatKRW(c.minDisposableNetWorthDuringRetirement)} ({c.minAssetAgeSelf}세 ·{' '}
                      {c.preservationRatioPercent}%)
                    </dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
        <p className="optimal-criterion-note num">
          {optimalTradeoffNote(strategyCards, 'hybrid', plan.recommendation)}
        </p>
      </section>

      {/* 2. 0% ~ 100% 황금분할 배분 효율 곡선 (Allocation Efficiency Frontier) */}
      <section className="canvas-card">
        <div className="canvas-card-header">
          <div>
            <span className="canvas-kicker">GOLDEN-SECTION OPTIMIZATION FRONTIER</span>
            <h2 className="canvas-title">
              개인 : 법인 자본 배분 비율(0% ~ 100%)별 100세 세후 가처분 순자산 곡선
            </h2>
          </div>
          {activeCurvePt && (
            <div className="chart-readout-pill num">
              개인 {activeCurvePt.personalRatio}% : 법인 {activeCurvePt.corporateRatio}% ➔ 세후{' '}
              <strong>{formatKRW(activeCurvePt.finalDisposableNetWorth)}</strong> (생애 세금·건보·유지비{' '}
              {formatKRW(activeCurvePt.totalLifetimeTaxAndHealthCost)})
            </div>
          )}
        </div>

        <div className="svg-chart-wrap" ref={curveWrapRef}>
          <svg
            viewBox={`0 0 ${curveW} ${curveH}`}
            className="interactive-svg"
            role="img"
            aria-label="개인 대 법인 배분 비율에 따른 100세 세후 순자산 효율 곡선"
          >
            <defs>
              <linearGradient id="frontierAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity={0.26} />
                <stop offset="85%" stopColor="var(--accent-primary)" stopOpacity={0.03} />
                <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity={0.0} />
              </linearGradient>
              <filter id="frontierGlow" x="-15%" y="-15%" width="130%" height="130%">
                <feDropShadow
                  dx="0"
                  dy="2"
                  stdDeviation="3"
                  floodColor="var(--accent-primary)"
                  floodOpacity={0.28}
                />
              </filter>
            </defs>

            {/* 수평 보조선 (5단계 정밀 눈금) */}
            {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
              const v = minCurveVal + (maxCurveVal - minCurveVal) * t;
              const y = yForCurveVal(v);
              return (
                <g key={idx}>
                  <line
                    x1={padL}
                    y1={y}
                    x2={curveW - padR}
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

            {/* 소프트 그라데이션 영역 & Catmull-Rom 스플라인 효율 곡선 */}
            {curveAreaPath && <path d={curveAreaPath} fill="url(#frontierAreaGrad)" />}
            <path
              d={curvePath}
              fill="none"
              stroke="var(--accent-primary)"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#frontierGlow)"
            />

            {/* 최적점(r*) 수직선 및 알약형 마일스톤 배지 (B8: 권고 비율이 다르면 '권고' 마커 추가) */}
            {(() => {
              const rec = plan.recommendation;
              if (rec.isMathematicalOptimum || rec.personalRatio === optimalHybrid.personalRatio) return null;
              const recX = xForRatio(rec.personalRatio);
              const label = `✔ 권고 (개인 ${rec.personalRatio}% : 법인 ${rec.corporateRatio}%)`;
              const pillW = Math.max(150, pillTextWidth(label));
              const pillX = Math.max(padL, Math.min(curveW - padR - pillW, recX - pillW / 2));
              return (
                <g className="svg-milestone-pill">
                  <line
                    x1={recX}
                    y1={padT}
                    x2={recX}
                    y2={curveH - padB}
                    stroke="var(--status-positive)"
                    strokeWidth={1.5}
                    strokeDasharray="2 3"
                  />
                  <rect x={pillX} y={28} width={pillW} height={20} rx={10} fill="var(--status-positive)" />
                  <text x={pillX + pillW / 2} y={42} textAnchor="middle" fill="#ffffff" className="svg-pill-label num">
                    {label}
                  </text>
                </g>
              );
            })()}
            {/* U-1: 수동 선택 비율 핀 (권고·r*와 다를 때) */}
            {(() => {
              const sel = activeLedger.personalRatio;
              if (isAutoRatio || sel === optimalHybrid.personalRatio || sel === plan.recommendation.personalRatio) return null;
              const selX = xForRatio(sel);
              const label = `◆ 선택 (개인 ${sel}% : 법인 ${100 - sel}%)`;
              const pillW = Math.max(150, pillTextWidth(label));
              const pillX = Math.max(padL, Math.min(curveW - padR - pillW, selX - pillW / 2));
              return (
                <g className="svg-milestone-pill">
                  <line x1={selX} y1={padT} x2={selX} y2={curveH - padB} stroke="var(--text-secondary)" strokeWidth={1.5} strokeDasharray="1 3" />
                  <rect x={pillX} y={52} width={pillW} height={20} rx={10} fill="var(--text-secondary)" />
                  <text x={pillX + pillW / 2} y={66} textAnchor="middle" fill="#ffffff" className="svg-pill-label num">
                    {label}
                  </text>
                </g>
              );
            })()}
            {(() => {
              const optX = xForRatio(optimalHybrid.personalRatio);
              const optLabel = plan.recommendation.isMathematicalOptimum
                ? `★ 최적 r* · 권고 (개인 ${optimalHybrid.personalRatio}% : 법인 ${optimalHybrid.corporateRatio}%)`
                : `★ 수학적 최적 r* (개인 ${optimalHybrid.personalRatio}% : 법인 ${optimalHybrid.corporateRatio}%)`;
              const pillW = Math.max(198, pillTextWidth(optLabel));
              const pillX = Math.max(
                padL,
                Math.min(curveW - padR - pillW, optX - pillW / 2)
              );
              return (
                <g className="svg-milestone-pill">
                  <line
                    x1={optX}
                    y1={padT}
                    x2={optX}
                    y2={curveH - padB}
                    stroke="var(--accent-primary)"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    strokeOpacity={0.75}
                  />
                  <rect
                    x={pillX}
                    y={4}
                    width={pillW}
                    height={20}
                    rx={10}
                    fill="var(--accent-primary)"
                  />
                  <text
                    x={pillX + pillW / 2}
                    y={18}
                    textAnchor="middle"
                    fill="#ffffff"
                    className="svg-pill-label num"
                  >
                    {optLabel}
                  </text>
                </g>
              );
            })()}

            {/* 호버 크로스헤어 & 액티브 이중 헤일로 */}
            {activeCurvePt && (
              <g pointerEvents="none">
                <line
                  x1={xForRatio(activeCurvePt.personalRatio)}
                  y1={padT}
                  x2={xForRatio(activeCurvePt.personalRatio)}
                  y2={curveH - padB}
                  stroke="var(--accent-primary)"
                  strokeWidth={1.2}
                  strokeOpacity={0.4}
                />
                <circle
                  cx={xForRatio(activeCurvePt.personalRatio)}
                  cy={yForCurveVal(activeCurvePt.finalDisposableNetWorth)}
                  r={10}
                  fill="var(--accent-primary)"
                  fillOpacity={0.16}
                />
              </g>
            )}

            {/* 데이터 포인트 & 히트 영역 (클릭 시 해당 비율 적용) */}
            {allocationCurve.map((pt, idx) => {
              const cx = xForRatio(pt.personalRatio);
              const cy = yForCurveVal(pt.finalDisposableNetWorth);
              const isOpt = pt.personalRatio === optimalHybrid.personalRatio;
              const isHovered = activeCurvePt?.personalRatio === pt.personalRatio;
              return (
                <g
                  key={pt.personalRatio}
                  className="svg-point-group"
                  onMouseEnter={() => setHoverCurveIdx(idx)}
                  onMouseLeave={() => {
                    setHoverCurveIdx(null);
                    setTouchArmedIdx(null);
                  }}
                  onPointerDown={(e) => {
                    lastPointerTypeRef.current = e.pointerType;
                  }}
                  onClick={() => {
                    if (resolveCurveTap(lastPointerTypeRef.current, touchArmedIdx, idx) === 'arm') {
                      setTouchArmedIdx(idx);
                      setHoverCurveIdx(idx);
                      return;
                    }
                    setTouchArmedIdx(null);
                    onSelectPersonalRatio?.(pt.personalRatio);
                  }}
                >
                  <rect
                    x={cx - cPlotW / Math.max(12, allocationCurve.length * 1.5)}
                    y={padT}
                    width={(cPlotW / Math.max(12, allocationCurve.length * 1.5)) * 2}
                    height={cPlotH}
                    fill="transparent"
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isOpt || isHovered ? 5.2 : 3.2}
                    fill={isOpt || isHovered ? 'var(--accent-primary)' : 'var(--bg-surface)'}
                    stroke="var(--accent-primary)"
                    strokeWidth={isOpt || isHovered ? 2.4 : 1.6}
                  />
                  {pt.personalRatio % 20 === 0 && (
                    <text
                      x={cx}
                      y={curveH - 9}
                      textAnchor={pt.personalRatio === 100 && cPlotW >= 900 ? 'end' : 'middle'}
                      className="svg-axis-label num"
                    >
                      {cPlotW < 900
                        ? `개인 ${pt.personalRatio}%`
                        : `개인 ${pt.personalRatio}% : 법인 ${pt.corporateRatio}%`}
                    </text>
                  )}
                </g>
              );
            })}

            {/* 커서 추종 플로팅 툴팁 카드 */}
            {activeCurvePt &&
              hoverCurveIdx !== null &&
              (() => {
                const cx = xForRatio(activeCurvePt.personalRatio);
                const cy = yForCurveVal(activeCurvePt.finalDisposableNetWorth);
                const deltaVsP100 =
                  activeCurvePt.finalDisposableNetWorth - personal100.finalDisposableNetWorth;
                const boxW = 248;
                const boxH = 68;
                const boxX = Math.max(
                  padL + 6,
                  Math.min(curveW - padR - boxW - 6, cx + 14)
                );
                const boxY = Math.max(padT + 4, Math.min(curveH - padB - boxH - 4, cy - 22));
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
                      개인 {activeCurvePt.personalRatio}% : 법인 {activeCurvePt.corporateRatio}%{' '}
                      {touchArmedIdx === hoverCurveIdx ? '(다시 탭하면 적용)' : '(클릭 시 적용)'}
                    </text>
                    <text x={11} y={36} className="svg-tooltip-value">
                      100세 세후: {formatKRW(activeCurvePt.finalDisposableNetWorth)}
                    </text>
                    <text x={11} y={54} className="svg-tooltip-sub">
                      개인100% 대비 {deltaVsP100 >= 0 ? '+' : ''}
                      {formatAxisKRW(deltaVsP100)} · 세금·건보·유지비{' '}
                      {formatAxisKRW(activeCurvePt.totalLifetimeTaxAndHealthCost)}
                    </text>
                  </g>
                );
              })()}
          </svg>
        </div>
      </section>

      {/* 3. 생애 세후 가처분 순자산 3대 궤적 SVG */}
      <section className="canvas-card">
        <div className="canvas-card-header">
          <div>
            <span className="canvas-kicker">LIFECYCLE DISPOSABLE NET WORTH TRAJECTORY</span>
            <h2 className="canvas-title">
              {inputs.pension.currentAgeSelf}세 → 100세 생애 세후 가처분 순자산 궤적 비교
            </h2>
          </div>
          <div className="chart-readout-pill num">
            <strong>{hoverAge}세 시점</strong> · {activeTrajLabel}{' '}
            <span className="text-accent">
              {formatKRW(getRowDisp(activeLedger.rows, activeHoverIdx))}
            </span>{' '}
            · 개인100% {formatKRW(getRowDisp(personal100.rows, activeHoverIdx))} · 법인100%{' '}
            {formatKRW(getRowDisp(corporate100.rows, activeHoverIdx))}
          </div>
        </div>

        <div className="chart-legend-row">
          <button
            type="button"
            className={`legend-item legend-item-btn ${!showHybridTraj ? 'legend-item-muted' : ''}`}
            onClick={() => toggleTrajKey('hybrid')}
            title={`클릭하여 ${activeTrajLabel} 궤적 표시/숨기기`}
          >
            <i className="legend-dot" style={{ background: 'var(--accent-primary)' }} />
            {activeTrajLabel} (개인 {activeLedger.personalRatio}% : 법인 {activeLedger.corporateRatio}%)
          </button>
          <button
            type="button"
            className={`legend-item legend-item-btn ${!showPersonalTraj ? 'legend-item-muted' : ''}`}
            onClick={() => toggleTrajKey('personal')}
            title="클릭하여 개인 100% 궤적 표시/숨기기"
          >
            <i className="legend-dot" style={{ background: '#0ea5e9' }} />
            개인 100% (절세계좌+일반)
          </button>
          <button
            type="button"
            className={`legend-item legend-item-btn ${!showCorpTraj ? 'legend-item-muted' : ''}`}
            onClick={() => toggleTrajKey('corporate')}
            title="클릭하여 법인 100% 궤적 표시/숨기기"
          >
            <i className="legend-dot" style={{ background: '#8b5cf6' }} />
            법인 100% (가족법인 집중)
          </button>
          {mutedTrajKeys.length > 0 && (
            <button
              type="button"
              className="legend-reset-btn"
              onClick={() => setMutedTrajKeys([])}
            >
              전체 표시
            </button>
          )}
          <button
            type="button"
            className={`btn-secondary sensitivity-toggle-btn ${showSensitivityBand ? 'active' : ''}`}
            onClick={() => setShowSensitivityBand((prev) => !prev)}
          >
            📈 수익률 변동 밴드(±2%p · P10~P90) & 100세 생존확률{' '}
            {showSensitivityBand ? '숨기기' : '보기'}
          </button>
        </div>

        {sensitivityBand && (
          <div className="sensitivity-summary-strip num" aria-label="수익률 민감도 및 100세 생존확률 요약">
            <div className="sensitivity-metric-pill">
              <span>100세 자산 생존확률</span>
              <strong className="text-positive">{sensitivityBand.survivalProbabilityPercent}%</strong>
            </div>
            <div className="sensitivity-metric-pill">
              <span>비관 (-2.0%p)</span>
              <strong>
                {formatKRW(sensitivityBand.minus2FinalNetWorth)}
                {sensitivityBand.minus2DepletionAge
                  ? ` (${sensitivityBand.minus2DepletionAge}세 고갈)`
                  : ' (100세 유지)'}
              </strong>
            </div>
            <div className="sensitivity-metric-pill">
              <span>기본 (Base)</span>
              <strong className="text-accent">{formatKRW(sensitivityBand.baseFinalNetWorth)}</strong>
            </div>
            <div className="sensitivity-metric-pill">
              <span>낙관 (+2.0%p)</span>
              <strong className="text-positive">{formatKRW(sensitivityBand.plus2FinalNetWorth)}</strong>
            </div>
            <div className="sensitivity-metric-pill">
              <span>확률분포 (P10 / P50 / P90)</span>
              <strong>
                {formatAxisKRW(sensitivityBand.p10FinalNetWorth)} /{' '}
                {formatAxisKRW(sensitivityBand.p50FinalNetWorth)} /{' '}
                {formatAxisKRW(sensitivityBand.p90FinalNetWorth)}
              </strong>
            </div>
          </div>
        )}

        <div className="svg-chart-wrap" ref={trajWrapRef}>
          <svg
            viewBox={`0 0 ${trajW} ${trajH}`}
            className="interactive-svg"
            role="img"
            aria-label="100세까지의 3대 전략별 세후 가처분 순자산 추이 차트"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = ((e.clientX - rect.left) / rect.width) * trajW - padL;
              const idx = Math.round((relX / plotW) * (rowsCount - 1));
              if (idx >= 0 && idx < rowsCount) setHoverYearIdx(idx);
            }}
            onMouseLeave={() => setHoverYearIdx(null)}
          >
            <defs>
              <linearGradient id="trajHybridGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity={0.22} />
                <stop offset="85%" stopColor="var(--accent-primary)" stopOpacity={0.02} />
                <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity={0.0} />
              </linearGradient>
            </defs>

            {/* 재직 적립기 배경 음영 구간 */}
            {retIdx > 0 && (
              <rect
                className="pre-retire-zone"
                x={padL}
                y={padT}
                width={Math.max(0, xForIdx(retIdx) - padL)}
                height={plotH}
                fill="var(--accent-primary)"
                fillOpacity={0.05}
              />
            )}

            {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
              const val = maxTrajVal * t;
              const y = yForVal(val);
              return (
                <g key={i}>
                  <line
                    x1={padL}
                    y1={y}
                    x2={trajW - padR}
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
                    {formatAxisKRW(val)}
                  </text>
                </g>
              );
            })}

            {/* 은퇴 D-Day 수직 마일스톤 및 알약 배지 */}
            <g className="svg-milestone-pill">
              <line
                x1={xForIdx(retIdx)}
                y1={padT}
                x2={xForIdx(retIdx)}
                y2={trajH - padB}
                stroke="var(--accent-primary)"
                strokeWidth={1.4}
                strokeDasharray="4 3"
                strokeOpacity={0.65}
              />
              <rect
                x={Math.max(padL, Math.min(trajW - padR - 116, xForIdx(retIdx) - 12))}
                y={5}
                width={116}
                height={19}
                rx={9.5}
                fill="var(--accent-soft)"
                stroke="var(--accent-primary)"
                strokeOpacity={0.35}
              />
              <text
                x={Math.max(padL + 58, Math.min(trajW - padR - 58, xForIdx(retIdx) + 46))}
                y={18}
                textAnchor="middle"
                className="svg-milestone-label num"
              >
                은퇴 D-Day ({retAge}세)
              </text>
            </g>

            {/* 국민연금 개시 연령 마일스톤 수직선 */}
            {pensionIdx > 0 && pensionClaimAge !== retAge && (
              <g className="svg-milestone-pill">
                <line
                  x1={xForIdx(pensionIdx)}
                  y1={padT}
                  x2={xForIdx(pensionIdx)}
                  y2={trajH - padB}
                  stroke="#64748b"
                  strokeWidth={1.2}
                  strokeDasharray="3 3"
                  strokeOpacity={0.55}
                />
                <text
                  x={Math.min(trajW - padR - 46, xForIdx(pensionIdx) + 6)}
                  y={padT + 13}
                  textAnchor="start"
                  className="svg-axis-label num"
                >
                  연금개시 ({pensionClaimAge}세)
                </text>
              </g>
            )}

            {/* 수익률 변동 신뢰구간 음영 밴드 (±2.0%p) */}
            {sensitivityBandPolygon && (
              <path
                className="sensitivity-confidence-band"
                d={sensitivityBandPolygon}
                fill="var(--accent-primary)"
                fillOpacity={0.14}
                stroke="var(--accent-primary)"
                strokeOpacity={0.28}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}

            {/* 3대 궤적 스무스 패스 + 최적해 그라데이션 영역 (법인100% 점선을 실선 위에 렌더링하여 겹침 가림 방지) */}
            {showHybridTraj && hybridTrajArea && (
              <path d={hybridTrajArea} fill="url(#trajHybridGrad)" />
            )}
            {showHybridTraj && (
              <path
                d={hybridTrajPath}
                fill="none"
                stroke="var(--accent-primary)"
                strokeWidth={3.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {showPersonalTraj && (
              <path
                d={buildTrajectorySmooth(personal100.rows)}
                fill="none"
                stroke="#0ea5e9"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {showCorpTraj && (
              <path
                d={buildTrajectorySmooth(corporate100.rows)}
                fill="none"
                stroke="#8b5cf6"
                strokeWidth={2.2}
                strokeDasharray="5 3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* 10세 단위 마일스톤 데이터 포인트 도트 */}
            {activeLedger.rows.map((r, i) =>
              r.ageSelf % 10 === 0 || i === rowsCount - 1 ? (
                <g key={`dot-${r.ageSelf}`} pointerEvents="none">
                  {showHybridTraj && (
                    <circle
                      cx={xForIdx(i)}
                      cy={yForVal(getRowDisp(activeLedger.rows, i))}
                      r={3.2}
                      fill="var(--accent-primary)"
                      stroke="#ffffff"
                      strokeWidth={1.2}
                    />
                  )}
                  {showPersonalTraj && (
                    <circle
                      cx={xForIdx(i)}
                      cy={yForVal(getRowDisp(personal100.rows, i))}
                      r={2.4}
                      fill="#0ea5e9"
                    />
                  )}
                  {showCorpTraj && (
                    <circle
                      cx={xForIdx(i)}
                      cy={yForVal(getRowDisp(corporate100.rows, i))}
                      r={2.4}
                      fill="#8b5cf6"
                    />
                  )}
                </g>
              ) : null
            )}

            {/* 3개 전략 동시 교차점 호버 마커 */}
            <line
              x1={xForIdx(activeHoverIdx)}
              y1={padT}
              x2={xForIdx(activeHoverIdx)}
              y2={trajH - padB}
              stroke="var(--text-muted)"
              strokeWidth={1.2}
              strokeOpacity={0.4}
            />
            {showPersonalTraj && (
              <circle
                cx={xForIdx(activeHoverIdx)}
                cy={yForVal(getRowDisp(personal100.rows, activeHoverIdx))}
                r={4}
                fill="#0ea5e9"
                stroke="var(--bg-surface)"
                strokeWidth={1.5}
              />
            )}
            {showHybridTraj && (
              <>
                <circle
                  cx={xForIdx(activeHoverIdx)}
                  cy={yForVal(getRowDisp(activeLedger.rows, activeHoverIdx))}
                  r={9}
                  fill="var(--accent-primary)"
                  fillOpacity={0.18}
                />
                <circle
                  cx={xForIdx(activeHoverIdx)}
                  cy={yForVal(getRowDisp(activeLedger.rows, activeHoverIdx))}
                  r={5}
                  fill="var(--accent-primary)"
                  stroke="#ffffff"
                  strokeWidth={2}
                />
              </>
            )}
            {showCorpTraj && (
              <circle
                cx={xForIdx(activeHoverIdx)}
                cy={yForVal(getRowDisp(corporate100.rows, activeHoverIdx))}
                r={4}
                fill="#8b5cf6"
                stroke="var(--bg-surface)"
                strokeWidth={1.5}
              />
            )}

            {/* X축 연령 레이블 */}
            {activeLedger.rows.map((r, i) =>
              r.ageSelf % 10 === 0 || i === 0 || i === rowsCount - 1 ? (
                <text
                  key={r.ageSelf}
                  x={xForIdx(i)}
                  y={trajH - 9}
                  textAnchor="middle"
                  className="svg-axis-label num"
                >
                  {r.ageSelf}세
                </text>
              ) : null
            )}

            {/* 커서 추종 3대 전략 비교 & 5대 계좌 요약 플로팅 툴팁 카드 */}
            {hoverYearIdx !== null &&
              (() => {
                const cx = xForIdx(activeHoverIdx);
                const optRow = activeLedger.rows[activeHoverIdx];
                const df = optRow ? (isReal ? optRow.discountFactor : 1) : 1;
                const optDisp = getRowDisp(activeLedger.rows, activeHoverIdx);
                const p100Disp = getRowDisp(personal100.rows, activeHoverIdx);
                const c100Disp = getRowDisp(corporate100.rows, activeHoverIdx);
                const diffVsP100 = optDisp - p100Disp;
                const boxW = 264;
                const boxH = 82;
                const boxX =
                  cx + boxW + 24 > trajW - padR
                    ? Math.max(padL + 6, cx - boxW - 14)
                    : cx + 14;
                const boxY = padT + 8;
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
                      {hoverAge}세 세후 가처분 순자산 & 계좌 구성
                    </text>
                    <text x={11} y={36} className="svg-tooltip-value">
                      ● {activeTrajLabel}: {formatKRW(optDisp)} ({diffVsP100 >= 0 ? '+' : ''}
                      {formatAxisKRW(diffVsP100)} vs 개인)
                    </text>
                    <text x={11} y={53} className="svg-tooltip-sub">
                      개인100% {formatAxisKRW(p100Disp)} · 법인100% {formatAxisKRW(c100Disp)}
                    </text>
                    {optRow && (
                      <text x={11} y={70} className="svg-tooltip-sub">
                        IRP {formatAxisKRW(optRow.endIrp * df)} · ISA{' '}
                        {formatAxisKRW(optRow.endIsa * df)} · 연금{' '}
                        {formatAxisKRW(optRow.endPersonalPension * df)} · 법인{' '}
                        {formatAxisKRW(optRow.endCorpLiquidationNetValue * df)}
                      </text>
                    )}
                  </g>
                );
              })()}
          </svg>
        </div>
      </section>

      {/* 4. 가족법인 설립 손익분기(Break-Even) 진단 카드 */}
      <section className="canvas-card">
        <div className="canvas-card-header">
          <div>
            <span className="canvas-kicker">CORPORATE BREAK-EVEN DIAGNOSTIC</span>
            <h2 className="canvas-title">가족법인 설립 손익분기(Break-Even) 정밀 판정</h2>
          </div>
          <span
            className={`verdict-badge ${
              breakEven.isAboveBreakEven ? 'verdict-badge-safe' : 'verdict-badge-warn'
            }`}
          >
            {breakEven.isAboveBreakEven
              ? `법인 설립 손익분기 상회 (최적 법인 ${optimalHybrid.corporateRatio}% 권장)`
              : '개인 절세계좌 단독 권장'}
          </span>
        </div>

        <div className="breakeven-metrics-row num">
          <div className="breakeven-metric-box">
            <span className="metric-caption">연간 지역건보료 방어 실익</span>
            <strong className="text-positive">
              +{formatKRW(breakEven.annualRegionalHealthInsShield)}/년
            </strong>
          </div>
          <div className="breakeven-metric-box">
            <span className="metric-caption">연간 배당·양도·과세이연 절세 실익</span>
            <strong className="text-positive">+{formatKRW(breakEven.annualTaxShield)}/년</strong>
          </div>
          <div className="breakeven-metric-box">
            <span className="metric-caption">연간 법인 기장·4대보험 고정비</span>
            <strong className="text-danger">
              -{formatKRW(breakEven.annualCorporateFixedCost)}/년
            </strong>
          </div>
          <div className="breakeven-metric-box">
            <span className="metric-caption">연간 법인 순실익 (방어 - 고정비)</span>
            <strong className={breakEven.netAnnualAdvantage >= 0 ? 'text-positive' : 'text-danger'}>
              {breakEven.netAnnualAdvantage >= 0 ? '+' : ''}
              {formatKRW(breakEven.netAnnualAdvantage)}/년
            </strong>
          </div>
          <div className="breakeven-metric-box">
            <span className="metric-caption">법인 설립 최소 금융자산 임계점</span>
            <strong>{formatKRW(breakEven.breakEvenLiquidAssetThreshold)}</strong>
          </div>
        </div>

        <p className="breakeven-verdict-text">{breakEven.verdictSummary}</p>
        {inputs.corporate.taxType === 'transparent' && (
          <p className="breakeven-verdict-text">
            ※ 법인세 성실신고 {CORP_TAX_PCT.transparent}% 가정 — 요건을 벗어나면 2억 이하 {CORP_TAX_PCT.normalLow}% 적용 가능
            (결과 5 ⓘ &lsquo;성실신고 22% 피하는 법&rsquo;, 세무대리인 확인 필수)
          </p>
        )}
      </section>
    </div>
  );
};
