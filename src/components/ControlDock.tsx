import React, { useEffect, useState } from 'react';
import {
  CORPORATE_TAX_RATE_NORMAL_HIGH,
  CORPORATE_TAX_RATE_NORMAL_LOW,
  CORPORATE_TAX_RATE_TRANSPARENT,
  ISA_SEPARATE_TAX_RATE,
  formatKRW,
} from '../engine';

/** 법인세율 표기(지방세 포함 %) — 엔진 constants에서 읽어 UI 문구와 계산 세율이 어긋나지 않게 한다. */
const pct = (rate: number) => Number((rate * 100).toFixed(1));
export const CORP_TAX_PCT = {
  normalLow: pct(CORPORATE_TAX_RATE_NORMAL_LOW),
  normalHigh: pct(CORPORATE_TAX_RATE_NORMAL_HIGH),
  transparent: pct(CORPORATE_TAX_RATE_TRANSPARENT),
} as const;
/** ISA 비과세 한도 초과분 분리과세율(지방세 포함 %). */
export const ISA_SEPARATE_TAX_PCT = pct(ISA_SEPARATE_TAX_RATE);

export interface NumericDraftOptions {
  min?: number;
  max?: number;
  fallback?: number;
  commit: boolean;
}

export function resolveNumericDraft(
  raw: string,
  opts: NumericDraftOptions
): { display: string; committedValue: number | null } {
  const minBound = opts.min ?? -Infinity;
  const maxBound = opts.max ?? Infinity;
  const trimmed = raw.trim();

  if (!opts.commit) {
    // 입력 중에는 빈 문자열(""), 소수점 진행("2."), 음수 기호("-"), 혹은 소수점 끝 0("2.0")을 그대로 보존
    if (
      trimmed === '' ||
      trimmed === '-' ||
      trimmed.endsWith('.') ||
      /\.\d*0$/.test(trimmed)
    ) {
      return { display: raw, committedValue: null };
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return { display: raw, committedValue: null };
    }
    // 다자리 숫자 입력 중(예: min=50인데 '53'을 치기 위해 첫 글자 '5'를 입력한 순간, 또는 소수점 수정 중 '25'가 된 순간)
    // 범위 밖이면 강제 클램핑하지 않고 다음 키 입력 또는 포커스 해제(blur)까지 대기
    if (parsed < minBound || parsed > maxBound) {
      return { display: raw, committedValue: null };
    }
    return { display: raw, committedValue: parsed };
  }

  // 포커스 해제(blur) 또는 Enter 확정 시: 빈 값이면 fallback 적용 후 [min, max] 범위로 클램핑
  const fallbackVal = opts.fallback ?? (Number.isFinite(minBound) ? minBound : 0);
  const parsed = trimmed === '' ? NaN : Number(trimmed);
  const base = Number.isFinite(parsed) ? parsed : fallbackVal;
  const clamped = Math.max(minBound, Math.min(maxBound, base));
  return { display: String(clamped), committedValue: clamped };
}

export interface NumericInputProps {
  value: number;
  onChange: (nextValue: number) => void;
  min?: number;
  max?: number;
  step?: number;
  fallback?: number;
  ariaLabel?: string;
  /** X4: 입력 단위(원) — 지정 시 1억 이상이면 '1억 5,000만' 읽어주기를 입력칸 옆에 표시 (0 하나 오타 방지). */
  readoutWon?: number;
}

/** 입력값 × 단위가 1억 이상일 때만 한글 금액 읽어주기 문자열을 돌려준다. */
export const amountReadout = (raw: number, unitWon?: number): string | null => {
  if (!unitWon || !Number.isFinite(raw)) return null;
  const won = raw * unitWon;
  return Math.abs(won) >= 100_000_000 ? `= ${formatKRW(won)}` : null;
};

export const NumericInput: React.FC<NumericInputProps> = ({
  value,
  onChange,
  min,
  max,
  step,
  fallback,
  ariaLabel,
  readoutWon,
}) => {
  const [draft, setDraft] = useState<string>(() => String(value));
  const readout = amountReadout(draft.trim() === '' ? NaN : Number(draft), readoutWon);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(String(value));
    }
  }, [value, focused]);

  const commitDraft = (raw: string) => {
    const res = resolveNumericDraft(raw, {
      min,
      max,
      fallback: fallback ?? value,
      commit: true,
    });
    setDraft(res.display);
    if (res.committedValue !== null && res.committedValue !== value) {
      onChange(res.committedValue);
    }
  };

  return (
    <>
    <input
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      max={max}
      aria-label={ariaLabel}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        const raw = e.target.value;
        const res = resolveNumericDraft(raw, {
          min,
          max,
          fallback: fallback ?? value,
          commit: false,
        });
        setDraft(res.display);
        if (res.committedValue !== null && res.committedValue !== value) {
          onChange(res.committedValue);
        }
      }}
      onBlur={(e) => {
        setFocused(false);
        commitDraft(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commitDraft((e.target as HTMLInputElement).value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
    {readout && (
      <span className="num-readout num" aria-live="polite">
        {readout}
      </span>
    )}
    </>
  );
};

export interface FieldHelpSpec {
  title: string;
  summary: string;
  statutoryRule: string;
  defaultTip: string;
}

export const FIELD_HELP_CATALOG: Record<string, FieldHelpSpec> = {
  targetRetirementAge: {
    title: '은퇴 목표 연령 (D-Day)',
    summary: '근로·사업소득이 종료되고 금융자산 및 연금에서 생활비 인출이 시작되는 기준 나이입니다.',
    statutoryRule:
      '만 55세 이전에 은퇴하면 사적연금(IRP·연금저축) 중도인출 시 16.5% 기타소득세가 부과되므로, 55세 전까지 ISA·법인출자원금·일반계좌로 버티는 가교(Bridge) 설계가 작동합니다.',
    defaultTip: '기본값은 60세이며, 조기 은퇴 시 45~55세로 설정해 시뮬레이션할 수 있습니다.',
  },
  currentAgeSelf: {
    title: '본인 현재 연령 및 가구 구성',
    summary: '물가상승률(CPI) 복리 반영과 은퇴 전 추가 저축·복리 증식 기간을 산출하는 시작 연령입니다.',
    statutoryRule:
      '현재 나이(0년차)부터 100세까지의 모든 생활비와 국민연금 수령액이 매년 물가상승률만큼 복리로 연동됩니다.',
    defaultTip: '기본값은 50세입니다. 같은 화면에서 가구 형태(부부 2인 / 1인 단독)와 배우자 현재 연령을 함께 설정할 수 있습니다.',
  },
  targetMonthlyLiving: {
    title: '은퇴 후 목표 순월생활비 (현재가치)',
    summary: '세금과 건강보험료를 모두 납부한 뒤 매월 실제로 소비할 순수 생활비(오늘 화폐가치 기준)입니다.',
    statutoryRule:
      '은퇴 시점에는 설정한 물가상승률(기본 2.5%)만큼 자동으로 증액된 명목 금액을 조달하며, 부족한 세금·건보료는 엔진이 역산(Gross-Up)하여 추가 인출합니다. 상세 옵션의 은퇴 후 월 고정지출은 이 금액과 별도로 합산됩니다.',
    defaultTip: '기본값은 월 500만원입니다. 연령대별 차등 지출(Go/Slow/No-Go) 및 일시 목돈 이벤트는 하단 [⚙️ 상세 입력 옵션]에서 설정하세요.',
  },
  activeSeniorDelta: {
    title: '액티브 시니어 연령대별 지출 가감폭 (±%)',
    summary: '은퇴 직후 활동기(Go-Go)에는 목표 생활비보다 더 쓰고, 후기(No-Go)에는 기본 생활비를 줄이는 가감 비율입니다.',
    statutoryRule:
      '활동기(~액티브기 종료 연령)에는 기준 생활비 × (1 + 가감폭%), 안정기(~77세)에는 100%, 케어기(78세~)에는 (1 - 가감폭%)에 월 간병·의료 추가비를 더해 물가연동 지출을 산출합니다.',
    defaultTip: '기본값은 ±25%입니다. 예를 들어 20%로 설정하면 활동기 120%, 안정기 100%, 후기 80%(+간병비)가 적용됩니다.',
  },
  preRetirementSavings: {
    title: '은퇴 전 일반계좌 월 저축액 (절세계좌 추가납입 별도)',
    summary: '현재부터 은퇴(D-Day) 전까지 매월 일반 금융자산(개인·법인 배분 대상)으로 적립할 저축 금액입니다.',
    statutoryRule:
      '아래에서 설정하는 절세계좌(ISA·연금저축) 연간 추가납입액과는 별개로 집계되며, 일반계좌 저축액이 절세계좌 납입 때문에 줄어들지 않고 전액 추가 적립됩니다.',
    defaultTip: '같은 화면 하단에서 ISA(연 2,000만/총 1억 한도) 및 연금저축(연 1,800만 한도) 연간 추가납입액을 함께 조정할 수 있습니다.',
  },
  totalInvestment: {
    title: '현재 보유 일반 금융자산 (자유 투자 원금)',
    summary: '현재 시점에 절세계좌(ISA·연금저축·IRP) 외에 예금·주식·ETF 등으로 보유 중인 일반 금융자산 총액입니다.',
    statutoryRule:
      `현재 보유 중인 이 일반 금융자산이 개인 일반계좌(해외직투 양도세 22% / 배당소득세 15.4%)와 가족법인(법인세 ${CORP_TAX_PCT.normalLow}~${CORP_TAX_PCT.normalHigh}% + 출자원금 비과세 회수) 사이에서 최적 비율(r*)로 배분됩니다.`,
    defaultTip: '기본값은 현재 보유 기준 10억 원(100,000만원)입니다. 일반·법인 계좌의 수익률, 해외직투 비중, 1,274종 ETF 구성은 [6. 일반·법인 수익률] 단계에서 설정합니다.',
  },
  overseasEtfRatio: {
    title: '해외직투 ETF 비중 (일반금융계좌 전용)',
    summary: '일반 금융계좌 내 미국 등 해외 거래소 상장 주식·ETF 직접투자 비중입니다.',
    statutoryRule:
      '이 비중은 일반금융계좌에만 적용됩니다(절세·연금계좌는 국내상장 ETF만 편입 가능). 해외직투 매도차익은 연 250만원 기본공제 후 22% 양도소득세(분리과세, 건보료 미부과)가 적용됩니다.',
    defaultTip: '기본값은 70%입니다. 상단 [🧩 ETF 포트폴리오 입력] 탭을 선택하면 보유 종목의 해외상장 비중에서 자동 산출됩니다.',
  },
  portfolioInputMode: {
    title: '포트폴리오 입력 방식 및 적용 범위',
    summary: '성장·배당 요약 수익률을 사용할지, 1,274종 ETF 카탈로그에서 종목을 직접 구성할지 선택합니다.',
    statutoryRule:
      '일반·법인 계좌는 한·미 1,274종 ETF 전체를, 절세·연금계좌(ISA·연금저축·IRP)는 국내상장 KRX ETF 전용 프리셋 및 종목을 각각 독립적으로 구성할 수 있습니다.',
    defaultTip: '빠른 시뮬레이션은 [🎚️ 간편 슬라이더 입력] 탭을, 실제 보유 종목 및 추천 포트폴리오 적용은 [🧩 ETF 포트폴리오 입력] 탭을 활용하세요.',
  },
  shelteredAccounts: {
    title: '현재 보유 절세·퇴직연금 3대 계좌 잔액 및 은퇴 퇴직금',
    summary: '현재 시점에 이미 적립된 개인 절세계좌(IRP · 연금저축 · ISA) 잔액과 은퇴(D-Day) 시점에 추가로 유입될 예상 퇴직금입니다.',
    statutoryRule:
      `중개형 ISA(비과세+${ISA_SEPARATE_TAX_PCT}% 분리과세)와 IRP·연금저축(연 1,500만원/인 분리과세 3.3~5.5%) 인출액은 지역가입자 건강보험료 소득 산정에서 제외됩니다. 사적연금(연금저축·IRP)은 은퇴 이후 만 55세부터 앞순위 비과세 재원(국민연금·법인급여·ISA)이 부족할 때 저율 한도 내에서 자동으로 최적 개시됩니다.`,
    defaultTip: '지금 계좌에 들어있는 현재 잔액(은퇴 전 복리 증식됨)과 은퇴 당일에 새로 들어올 예상 퇴직금(은퇴 시점 일시 유입)을 구분해 입력하세요.',
  },
  currentRetirementPension: {
    title: '본인 퇴직연금 (IRP / DC) 현재 보유 잔액',
    summary: '현재 시점에 내 명의의 IRP 또는 DC형 퇴직연금 계좌에 이미 입금되어 운용 중인 평가금액입니다.',
    statutoryRule:
      '여기에 입력한 금액은 현재 나이(0년차)부터 은퇴(D-Day)까지 매년 IRP 기대수익률로 복리 증식됩니다. 따라서 퇴직연금 제도가 없는 회사(일반 법정 퇴직금)나 DB형 가입자가 퇴사 시 받을 예상 퇴직금을 여기에 넣으면 은퇴 전 기간 동안 중복 복리가 붙어 과대평가됩니다.',
    defaultTip: '현재 실제로 IRP·DC 계좌에 찍혀 있는 잔액만 입력하고, 퇴직연금 미가입(일반 퇴직금)·DB형 퇴직금이나 앞으로 은퇴 전까지 회사에서 추가로 들어올 퇴직연금 합계는 아래 [은퇴 시 추가 수령할 예상 퇴직금] 칸에 입력하세요.',
  },
  expectedSeverancePay: {
    title: '은퇴 시 추가 수령할 예상 퇴직금 (일반 퇴직금 · DB형 · 향후 DC 추가적립 합계)',
    summary: '현재 이미 쌓인 IRP/DC 잔액 외에, 앞으로 은퇴할 때까지 추가로 적립되거나 퇴사 시 일시금으로 정산받을 예상 퇴직급여 총액입니다.',
    statutoryRule:
      '은퇴 당일(D-Day)에 일시 유입되므로 은퇴 전 중복 복리가 붙지 않으며, 부부 가구는 본인·배우자 각자의 근속연수공제 및 환산급여 누진세율로 퇴직소득세를 개별 산출합니다. [IRP 이체] 선택 시 ① D-Day 퇴직소득세 원천징수(0원) 없이 전액 IRP 원금으로 이연되어 세금 아낀 금액까지 복리 운용되고, ② 55세 이후 인출 시 원래 퇴직소득세의 30%(1~10년차)~40%(11년차+)를 감면받으며 부부 인별 IRP 지분에 따라 연 1,500만 원 저율 분리과세(3.3~5.5%) 한도가 각자 적용됩니다.',
    defaultTip: '① 지금 이후 은퇴 전까지 DC 계좌에 추가로 들어올 회사 납입금 예상 합계와 ② 퇴직연금 미가입(일반 법정 퇴직금)·DB형 퇴직금·희망퇴직 위로금 두 가지 용도 모두 이 칸에 입력하며, 배우자 퇴직금은 아래 배우자 예상 퇴직금 칸에 분리해 입력하시면 누진세율 왜곡이 방지됩니다.',
  },
  portfolioReturn: {
    title: '일반 · 법인 금융계좌 목표 수익률 및 성장:배당 비중',
    summary: '개인 일반과세계좌와 가족법인 금융계좌의 기대수익률 및 해외상장 ETF 직접투자 비중입니다.',
    statutoryRule:
      '성장형 자산(자본차익 중심)과 배당형 자산(현금배당 중심)의 가중평균으로 일반·법인 계좌의 연간 목표수익률을 산출합니다. 상단 [🧩 ETF 포트폴리오 입력] 탭을 선택하면 추천 포트폴리오 4종 프리셋과 한·미 1,274종 ETF 직접 구성 빌더로 즉시 전환할 수 있습니다.',
    defaultTip: '기본값은 성장 6.0% · 배당 4.0% · 비중 70:30(가중평균 연 5.40%), 해외직투 비중 70%입니다.',
  },
  shelteredPortfolioReturn: {
    title: '절세 · 연금계좌 (ISA · 연금저축 · IRP) 목표 수익률',
    summary: '중개형 ISA, 연금저축펀드, 퇴직연금(IRP) 3대 절세계좌의 운용 기대수익률입니다.',
    statutoryRule:
      '절세·연금계좌에서는 미국 상장 ETF 직접 매수가 불가하며 국내상장 ETF(TIGER/KODEX 미국S&P500 등)로 운용합니다. 특히 퇴직연금(IRP/DC)은 위험자산(주식형) 70% 한도 규정에 따라 최소 30%를 안전자산(채권·예금 등)으로 편입해야 합니다.',
    defaultTip: '1차로 [일반·법인 계좌 동일 적용(IRP 70% 한도 자동 적용)] 또는 [절세·연금계좌 수익률 별도 적용]을 선택하고, 별도 적용 시 [간편 수익률 입력]과 [KRX ETF 포트폴리오 입력] 중 하나를 선택해 보세요.',
  },
  inflationAndViewMode: {
    title: '장기 물가상승률 (CPI) · 화폐가치 기준 · 시장 하락장 시나리오',
    summary: '생애 생활비와 국민연금 수령액을 매년 인상하는 물가 지수, 실질 구매력 할인율, 그리고 은퇴 직후 시장 충격 시나리오입니다.',
    statutoryRule:
      '실질 구매력 기준(권장)을 선택하면 미래 100세 시점의 명목 자산을 (1 + 물가상승률)^경과연수로 나누어 오늘의 화폐가치로 환산해 보여줍니다.',
    defaultTip: '기본값은 물가상승률 연 2.5%, 화폐기준은 실질 구매력이며, 같은 화면에서 은퇴 직후 하락장 스트레스 시나리오를 바로 점검할 수 있습니다.',
  },
  realEstateAndPension: {
    title: '거주 부동산 공시가격 및 국민연금',
    summary: '지역가입자 건강보험료 재산보험료 산정 기준이 되는 주택 공시가격과 종신 현금흐름인 국민연금입니다.',
    statutoryRule:
      '2024년 건보료 개편에 따라 공시가격×60%(공정시장가액비율)에서 기본공제 1억 원을 뺀 금액에 재산보험료가 부과됩니다. 국민연금은 인출 워터폴 1순위로 생활비에 충당됩니다.',
    defaultTip: '하단 [⚙️ 상세 입력 옵션]에서 다운사이징(공시가 재설정), 매각 후 반전세·월세 전환, 주택연금, 국민연금 추납(본인/배우자·기간·월납입액)을 설정할 수 있습니다.',
  },
  healthReform2024: {
    title: '2024년 지역가입자 건보 재산 1억 일괄 기본공제',
    summary: '2024년 2월 시행된 국민건강보험법 시행령 개정에 따른 재산보험료 기본공제 확대 기준입니다.',
    statutoryRule:
      '주택 공시가격 × 공정시장가액비율(60%)에서 기존 차등공제 대신 1억 원을 일괄 공제한 뒤 재산등급 점수(점당 211.5원 + 장기요양 13.14%)를 산정합니다.',
    defaultTip: '현행 법령 기준인 [적용 (2024.2 개정 1억 일괄공제)] 유지를 권장합니다.',
  },
  corporateAllocation: {
    title: '개인 : 가족법인 배분 비율 및 법인 지배구조',
    summary: '일반 금융자산을 개인 명의와 가족법인 명의에 몇 대 몇으로 나눌지 결정하는 핵심 레버입니다.',
    statutoryRule:
      '가족법인에 출자한 원금(가수금)은 세금과 건보료 없이 비과세로 선회수할 수 있고, 직장가입자 최소 임원 급여(월 100만원)를 통해 고액 부동산 보유자의 지역건보료를 방어합니다.',
    defaultTip: '기본값은 황금분할 수리 솔버가 100세 세후 순자산이 최대가 되는 최적 비율(r*)을 자동으로 찾아 적용합니다.',
  },
  corpExecutiveCount: {
    title: '가족법인 등기임원 수 (1인 단독 vs 부부 2인)',
    summary: '가족법인에서 직장가입자 급여를 수령할 등기임원 인원수입니다.',
    statutoryRule:
      '엔진은 직장가입자 최소 보수월액(인당 월 100만원)으로 건보료를 최소화합니다. 만 60세 미만 임원 급여의 국민연금 보험료율은 2026년 9.5%(노사 각 4.75%)에서 매년 +0.5%p씩 인상되어 2033년 13.0%(노사 각 6.5%) 상한에 도달하며, 만 60세 이상은 국민연금이 면제됩니다. 1인 단독 임원 시 배우자를 직장건보 피부양자로 무상 등재할 수 있고, 2인 공동 임원 시 부부 각자 급여로 법인 비용 처리가 가능합니다.',
    defaultTip: '배우자의 별도 과세소득이 크지 않다면 1인 단독 임원(배우자 피부양자 등재)이 유리할 수 있으며, 결과 화면에서 1인 vs 2인 유불리를 자동 비교합니다.',
  },
  corpTaxType: {
    title: '법인세 과세 체계 (일반법인 vs 성실신고확인 대상)',
    summary: '가족법인의 투자수익(배당·양도차익)에 적용되는 법인세율 체계입니다.',
    statutoryRule:
      `2026년 개정 법인세법 기준, 일반법인은 과세표준 2억 원 이하 구간에 지방소득세 포함 ${CORP_TAX_PCT.normalLow}%(2억~200억 ${CORP_TAX_PCT.normalHigh}%)가 적용됩니다. 반면 지배주주 지분 50% 초과·이자·배당·임대소득 비중 50% 이상·상시근로자 5인 미만인 성실신고확인 대상 소규모 법인은 2억 원 이하 저율 구간이 배제되어 처음부터 ${CORP_TAX_PCT.transparent}%가 적용됩니다.`,
    defaultTip: `금융자산 운용 가족법인은 대부분 성실신고확인 대상이므로 기본값은 소규모 성실신고(${CORP_TAX_PCT.transparent}%)입니다. 요건에서 벗어나는 일반법인(2억 이하 ${CORP_TAX_PCT.normalLow}%)으로 전환해 법인 실익 손익분기점을 비교해 보세요. 투자업(기타 금융업 659902)을 등록해 ETF 매매차익을 매출로 계상하고 (임대+이자+배당)을 매출의 50% 미만으로 관리하는 방법은 결과 5의 ⓘ '성실신고 22% 피하는 법'을 참고하세요(세무대리인 확인 필수).`,
  },
  corpMaintenanceFee: {
    title: '연간 법인 기장·유지 고정비',
    summary: '세무사 월 기장료, 법인 결산·세무조정 수수료, 등기·공과금 등 매년 지출되는 법인 유지 고정비용입니다.',
    statutoryRule:
      '은퇴(D-Day) 이후 법인 운용 기간 동안 입력한 금액(명목, 물가 미연동)이 매년 법인 계좌에서 차감되며, 법인세 과세표준 산정 시 비용(손금)으로 차감됩니다.',
    defaultTip: '소규모 가족법인 기준 연 240만~360만원(월 20만~30만원 + 결산 조정료) 수준이 일반적입니다.',
  },
  corpLiquidationMode: {
    title: '법인 청산·출구 과세 기준 (출자원금 비과세 vs 단순과세)',
    summary: '법인 자산을 개인으로 회수하거나 100세 시점 가처분 순자산을 평가할 때 적용하는 세법 기준입니다.',
    statutoryRule:
      '소득세법 제17조 제2항 제3호에 따라 주주가 법인에 납입한 출자원금(자본금·가수금) 한도까지의 원금반환·감자는 의제배당 과세 및 건보료 없이 비과세로 선회수됩니다. 잉여금 초과분만 배당소득세가 부과됩니다.',
    defaultTip: '실제 세법 규정을 반영한 [출자원금 비과세 선회수 (§17②3)] 설정을 권장합니다.',
  },
};

export const FieldHelpBadge: React.FC<{ helpKey: keyof typeof FIELD_HELP_CATALOG }> = ({
  helpKey,
}) => {
  const spec = FIELD_HELP_CATALOG[helpKey];
  if (!spec) return null;
  // 대부분 <label> 안에 있어서, 탭하면 label이 클릭을 입력칸으로 넘겨 키보드가 뜨고 도움말이 닫힌다 → 기본 동작만 막는다.
  return (
    <span
      className="field-help-trigger"
      tabIndex={0}
      aria-label={`${spec.title} 도움말`}
      onClick={(e) => e.preventDefault()}
    >
      <span className="field-help-icon">ⓘ 설명</span>
      <span className="field-help-popover" role="tooltip">
        <strong className="field-help-title">{spec.title}</strong>
        <span className="field-help-summary">{spec.summary}</span>
        <span className="field-help-rule">
          <strong>세법·건보 반영 기준:</strong> {spec.statutoryRule}
        </span>
        <span className="field-help-tip">
          <strong>권장 설정:</strong> {spec.defaultTip}
        </span>
      </span>
    </span>
  );
};
