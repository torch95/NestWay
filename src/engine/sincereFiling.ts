import { formatKRW } from './presets';
import type { CanonicalYearRow, SincereFilingSummary } from './types';

/**
 * 성실신고확인대상 소규모법인(법인세법 §60의2①1, 시행령 §42②) 소득 요건 중
 * "(부동산임대수입 + 이자 + 배당) ÷ 매출액 ≥ 50%" 판정 — 정보 제공용(세무대리인 확인 필수).
 * 앱의 법인 모델은 부동산임대·타 영업매출이 없으므로 수동소득 = 배당(분배금)만 사용한다.
 */
export const SINCERE_FILING_PASSIVE_SHARE_THRESHOLD = 0.5;

export interface SincereFilingYearAssessment {
  passiveIncome: number;
  revenue: number;
  passiveShare: number;
  likely: boolean;
  /** 해당 연도 50% 미만으로 낮추기 위해 추가로 필요한 매매차익(원). 투자업 미등록이면 매매차익이 매출이 아니므로 null */
  minSaleGainToAvoid: number | null;
}

/**
 * @param investmentBusinessRegistered 투자업(기타 금융업)을 영위해 매매차익을 매출(영업수익)로 계상하는지.
 *   false면 매매차익은 영업외수익으로 매출에서 빠진다.
 */
export function assessSincereFiling(
  passiveIncome: number,
  saleGain: number,
  investmentBusinessRegistered = true
): SincereFilingYearAssessment {
  const passive = Math.max(0, passiveIncome);
  const gain = investmentBusinessRegistered ? Math.max(0, saleGain) : 0;
  const revenue = passive + gain;
  const passiveShare = revenue > 0 ? passive / revenue : 0;
  const likely = passive > 0 && passiveShare >= SINCERE_FILING_PASSIVE_SHARE_THRESHOLD;
  const minSaleGainToAvoid = !investmentBusinessRegistered && likely ? null : likely ? passive - gain + 1 : 0;
  return { passiveIncome: passive, revenue, passiveShare, likely, minSaleGainToAvoid };
}

/** 원장 전 연도 요약 (투자업 등록·매매차익 매출 계상 전제) */
export function summarizeSincereFiling(rows: CanonicalYearRow[], isApproximate: boolean): SincereFilingSummary {
  let corpYears = 0;
  let likelyYears = 0;
  let firstLikelyAgeSelf: number | null = null;
  let maxAdditionalSaleGain = 0;
  let maxAdditionalSaleGainAgeSelf: number | null = null;
  for (const r of rows) {
    if (r.corpDividendIncome <= 0 && r.corpRealizedSaleGain <= 0) continue;
    corpYears++;
    const a = assessSincereFiling(r.corpDividendIncome, r.corpRealizedSaleGain);
    if (!a.likely) continue;
    likelyYears++;
    if (firstLikelyAgeSelf === null) firstLikelyAgeSelf = r.ageSelf;
    const need = a.minSaleGainToAvoid ?? 0;
    if (need > maxAdditionalSaleGain) {
      maxAdditionalSaleGain = need;
      maxAdditionalSaleGainAgeSelf = r.ageSelf;
    }
  }
  return {
    corpYears,
    likelyYears,
    firstLikelyAgeSelf,
    maxAdditionalSaleGain,
    maxAdditionalSaleGainAgeSelf,
    isApproximate,
  };
}

/** 결과 화면·체크리스트용 한 줄 상태 (법인 수익 연도가 없으면 null) */
export function sincereFilingStatusLine(s: SincereFilingSummary): string | null {
  if (s.corpYears <= 0) return null;
  const approx = s.isApproximate ? ' · 매년 평가 인식 모드라 근사치' : '';
  const head = `배당 우세 ${s.likelyYears}/${s.corpYears}년`;
  if (s.likelyYears === 0) return `${head} — 현 계획은 매년 요건 미충족(투자업 등록·매매차익 매출 계상 전제)${approx}`;
  if (s.likelyYears === s.corpYears)
    return `${head} — 현 포트폴리오로는 회피 어려움(22% 가정 유지 또는 지수형 비중 확대 검토)${approx}`;
  const at = s.maxAdditionalSaleGainAgeSelf !== null ? `(${s.maxAdditionalSaleGainAgeSelf}세)` : '';
  return `${head} · 연말 추가 매매차익 최대 ${formatKRW(s.maxAdditionalSaleGain)}${at}${approx}`;
}
