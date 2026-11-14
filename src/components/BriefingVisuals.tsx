import React from 'react';
import { formatKRW, type CanonicalYearRow } from '../engine';

/**
 * 브리핑 슬라이드 전용 경량 시각 요소 (새 금융 계산 없음 — 원장·카드 값만 그림).
 * 외부 차트 라이브러리 없이 HTML 막대 + 단일 SVG 경로로 구성해 반응형·다크모드(CSS 변수)를 그대로 따른다.
 */

/** 원장 연도별 세후 가처분 순자산 미니 곡선 + 핵심 시점 라벨 */
export const NetWorthSparkline: React.FC<{
  rows: CanonicalYearRow[];
  isReal: boolean;
  markAges: number[];
}> = ({ rows, isReal, markAges }) => {
  if (rows.length < 2) return null;
  const vals = rows.map((r) => Math.max(0, Math.round(r.endDisposableNetWorth * (isReal ? r.discountFactor : 1))));
  const max = Math.max(1, ...vals);
  const W = 1000;
  const H = 120;
  const x = (i: number) => (i / (rows.length - 1)) * W;
  const y = (v: number) => H - 6 - (v / max) * (H - 18);
  const line = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const marks = markAges
    .map((age) => rows.findIndex((r) => r.ageSelf === age))
    .filter((i, k, arr) => i >= 0 && arr.indexOf(i) === k);
  return (
    <figure className="bv-spark" aria-label="100세까지 세후 순자산 흐름">
      <svg className="bv-spark-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={`${line} L${W},${H} L0,${H} Z`} className="bv-spark-area" />
        <path d={line} className="bv-spark-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="bv-spark-marks num">
        {marks.map((i) => (
          <span key={i} style={{ left: `${(i / (rows.length - 1)) * 100}%` }} className="bv-spark-mark">
            <i aria-hidden="true" />
            <b>{rows[i].ageSelf}세</b>
            {formatKRW(vals[i])}
          </span>
        ))}
      </div>
    </figure>
  );
};

export interface BarItem {
  key: string;
  label: React.ReactNode;
  value: number;
  valueLabel: string;
  color?: string;
  highlight?: boolean;
  extra?: React.ReactNode;
}

/** 항목 비교용 가로 막대 목록 (최댓값 대비 길이) */
export const HBarList: React.FC<{ items: BarItem[]; ariaLabel: string }> = ({ items, ariaLabel }) => {
  const max = Math.max(1, ...items.map((it) => it.value));
  return (
    <div className="bv-hbars" role="list" aria-label={ariaLabel}>
      {items.map((it) => (
        <div key={it.key} role="listitem" className={`bv-hbar-row ${it.highlight ? 'bv-hbar-row-hl' : ''}`}>
          <div className="bv-hbar-label">{it.label}</div>
          <div className="bv-hbar-track">
            <div
              className="bv-hbar-fill"
              style={{ width: `${Math.max(2, (it.value / max) * 100)}%`, background: it.color }}
            />
          </div>
          <strong className="bv-hbar-value num">{it.valueLabel}</strong>
          <div className="bv-hbar-extra">{it.extra}</div>
        </div>
      ))}
    </div>
  );
};

export interface StackSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** 100% 누적 막대 + 범례(이름·금액·비중) */
export const StackedBar: React.FC<{ segments: StackSegment[]; ariaLabel: string; tall?: boolean }> = ({
  segments,
  ariaLabel,
  tall = false,
}) => {
  const total = segments.reduce((s, g) => s + Math.max(0, g.value), 0);
  const pct = (v: number) => (total > 0 ? Math.round((Math.max(0, v) / total) * 1000) / 10 : 0);
  return (
    <div className="bv-stack">
      <div className={`bv-stack-bar ${tall ? 'bv-stack-bar-tall' : ''}`} role="img" aria-label={ariaLabel}>
        {segments.map((g) =>
          g.value > 0 ? (
            <div
              key={g.key}
              className="bv-stack-seg"
              style={{ width: `${Math.max(2, pct(g.value))}%`, background: g.color }}
              title={`${g.label}: ${formatKRW(g.value)} (${pct(g.value)}%)`}
            />
          ) : null
        )}
      </div>
      <ul className="bv-legend num">
        {segments.map((g) => (
          <li key={g.key} className={g.value > 0 ? '' : 'bv-legend-zero'}>
            <i style={{ background: g.color }} aria-hidden="true" />
            <span>{g.label}</span>
            <strong>{formatKRW(g.value)}</strong>
            <em>{pct(g.value)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** 1 → 2 → 3 순서 흐름도 */
export const FlowSteps: React.FC<{ steps: { key: string; title: string; value: string }[] }> = ({ steps }) => (
  <ol className="bv-flow">
    {steps.map((s, i) => (
      <li key={s.key} className="bv-flow-step">
        <span className="bv-flow-num">{i + 1}</span>
        <div>
          <strong>{s.title}</strong>
          <span className="num">{s.value}</span>
        </div>
      </li>
    ))}
  </ol>
);

/** 행별 100% 누적 막대 (예: 나이별 인출 재원 구성) + 공통 범례 */
export const StackedRows: React.FC<{
  ariaLabel: string;
  legend: { key: string; label: string; color: string }[];
  rows: { key: string; label: string; values: Record<string, number> }[];
}> = ({ ariaLabel, legend, rows }) => (
  <div className="bv-srows" role="list" aria-label={ariaLabel}>
    {rows.map((r) => {
      const total = legend.reduce((s, l) => s + Math.max(0, r.values[l.key] ?? 0), 0);
      return (
        <div key={r.key} role="listitem" className="bv-srow">
          <span className="bv-srow-label num">{r.label}</span>
          <div className="bv-stack-bar">
            {total > 0 &&
              legend.map((l) => {
                const v = Math.max(0, r.values[l.key] ?? 0);
                const p = (v / total) * 100;
                return v > 0 ? (
                  <div
                    key={l.key}
                    className="bv-stack-seg"
                    style={{ width: `${p}%`, background: l.color }}
                    title={`${r.label} ${l.label}: ${formatKRW(v)} (${Math.round(p)}%)`}
                  />
                ) : null;
              })}
          </div>
        </div>
      );
    })}
    <ul className="bv-srow-legend">
      {legend.map((l) => (
        <li key={l.key}>
          <i style={{ background: l.color }} aria-hidden="true" />
          {l.label}
        </li>
      ))}
    </ul>
  </div>
);
