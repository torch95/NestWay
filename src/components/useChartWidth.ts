import { useEffect, useRef, useState } from 'react';

/** 인쇄·측정 불가 시 사용하는 기존 고정 viewBox 폭 (PDF 레이아웃 기준). */
export const CHART_FALLBACK_WIDTH = 780;
/** 모바일 최소 플롯 폭 — 이보다 좁으면 .svg-chart-wrap 가로 스크롤. */
export const CHART_MIN_WIDTH = 560;

/**
 * SVG 차트 래퍼의 실측 폭을 viewBox 폭으로 돌려준다 (1 SVG unit = 1 CSS px → 글자 크기 고정).
 * frozen(인쇄 모드)이거나 측정값이 0/없으면 780 폴백.
 */
export function useChartWidth<T extends HTMLElement = HTMLDivElement>(frozen = false) {
  const ref = useRef<T>(null);
  const [measured, setMeasured] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (frozen || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setMeasured(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [frozen]);

  const width = frozen || measured <= 0 ? CHART_FALLBACK_WIDTH : Math.max(CHART_MIN_WIDTH, measured);
  return [ref, width] as const;
}

/** 폭에 비례하되 기존 높이(인쇄 기준) 이상, 상한 이하로 유지. */
export const chartHeightFor = (width: number, baseH: number, maxH = 360) =>
  Math.round(Math.min(maxH, Math.max(baseH, width * 0.3)));
