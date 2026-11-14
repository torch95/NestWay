import React from 'react';
import type { SincereFilingSummary } from '../engine/types';
import { sincereFilingStatusLine } from '../engine/sincereFiling';
import { CORP_TAX_PCT } from './ControlDock';

/**
 * 성실신고확인대상 소규모법인(22%) 요건과 회피 원리·절차·함정 — 일반화된 정보 제공용.
 * 특정 법인·자본금·세무대리인·증권사 등 개별 사례 정보는 넣지 않는다 (test/uiParity 정적 가드).
 */
export const SINCERE_FILING_GUIDE = {
  requirements: [
    '지배주주와 특수관계인 지분 합계 50% 초과 (가족법인)',
    '상시근로자 5인 미만',
    '부동산임대업이 주된 사업(매출 1위)이거나, (부동산임대수입 + 이자 + 배당) ÷ 매출액 ≥ 50%',
  ],
  principle: [
    '주식·ETF 매매차익은 분자(임대+이자+배당)에 들어가지 않습니다.',
    '투자업을 목적사업으로 영위하면 매매차익을 매출(영업수익)로 계상할 수 있어 분모가 커집니다.',
    '투자업을 등록하지 않으면 매매차익은 영업외수익이라 매출에서 빠지고, 배당·이자만으로 50%를 넘기 쉽습니다.',
    'ETF 분배금은 배당이므로 분자와 분모에 모두 들어갑니다.',
  ],
  steps: [
    '정관·등기 사업목적에 기타 금융업 / 유가증권 투자업 추가 (목적변경 등기)',
    '사업자등록 업종에 기타 금융업(659902) 추가 정정',
    '법인 명의 증권계좌 개설 (해외 거래 시 LEI 필요 여부는 증권사에 확인)',
    '매년 11~12월 가결산: (임대+이자+배당)이 매출의 50% 미만인지 확인, 부족하면 지수형 ETF 일부 이익실현으로 매출 규모 조정',
  ],
  traps: [
    '배당형 위주 포트폴리오: 고배당·커버드콜 위주로 매도 없이 보유하면 업종을 등록해도 해당됩니다.',
    '총액/순액 계상 기준: 매매손익의 매출 인식 방식은 일관돼야 하므로 결산 전 세무대리인과 협의하세요.',
    '부동산임대 매출이 1위면 비율과 무관하게 해당됩니다.',
  ],
  disclaimer:
    '사업연도마다 판정하며 업종 추가만으로 자동 제외되지 않습니다. 거래 실질이 없는 형식적 매매는 실질과세 원칙에 따라 부인될 수 있으니 반드시 세무대리인과 확인하세요.',
} as const;

export const SincereFilingGuide: React.FC<{ summary?: SincereFilingSummary }> = ({ summary }) => {
  const status = summary ? sincereFilingStatusLine(summary) : null;
  return (
    <div className="sincere-filing-guide">
      <p>
        요건 3가지를 모두 충족하면 2억 이하 {CORP_TAX_PCT.normalLow}% 구간이 배제되고 처음부터{' '}
        {CORP_TAX_PCT.transparent}%가 적용됩니다 (2026년, 지방세 포함).
      </p>
      {status && (
        <p>
          <strong>이 계획 기준:</strong> {status}
        </p>
      )}
      <div className="sincere-filing-grid">
        <div className="sincere-filing-sec">
          <strong>① 요건</strong>
          <ol>
            {SINCERE_FILING_GUIDE.requirements.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </div>
        <div className="sincere-filing-sec">
          <strong>② 핵심 원리</strong>
          <ul>
            {SINCERE_FILING_GUIDE.principle.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <div className="sincere-filing-sec">
          <strong>③ 절차</strong>
          <ol>
            {SINCERE_FILING_GUIDE.steps.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </div>
        <div className="sincere-filing-sec">
          <strong>④ 함정</strong>
          <ul>
            {SINCERE_FILING_GUIDE.traps.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      </div>
      <p>※ {SINCERE_FILING_GUIDE.disclaimer}</p>
    </div>
  );
};
