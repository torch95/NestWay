/**
 * Statutory Korean Tax, Pension, and Health Insurance Constants (2026 Canonical).
 * Values with distinct statutory sources are kept as distinct named constants.
 */

export const LIFE_EXPECTANCY_AGE = 100;
export const SIMULATION_BASE_YEAR = 2026; // 원장 idx 0 = 2026년 (출생연도 = 2026 − 현재 나이)
export const PENSION_ELIGIBLE_AGE = 55;
export const NATIONAL_PENSION_EXEMPT_AGE = 60;

// 1. ISA (조세특례제한법 제91조의18)
export const ISA_ANNUAL_CAP_PER_PERSON = 20_000_000;
export const ISA_CARRYOVER_YEARS = 5;
export const ISA_LIFETIME_CAP_PER_PERSON = ISA_ANNUAL_CAP_PER_PERSON * ISA_CARRYOVER_YEARS; // 100,000,000
export const ISA_TAX_EXEMPT_GAIN_GENERAL = 2_000_000;
export const ISA_TAX_EXEMPT_GAIN_LOW_INCOME = 4_000_000;
export const ISA_SEPARATE_TAX_RATE = 0.099; // 지방소득세 포함 9.9%
export const ISA_MANDATORY_HOLDING_YEARS = 3;
export const ISA_LONG_TERM_EXTENSION_YEARS = 30;

// 2. 사적연금 (연금저축 + IRP, 소득세법 제129조)
export const PERSONAL_PENSION_ANNUAL_CAP_PER_PERSON = 18_000_000;
export const PERSONAL_PENSION_SAVINGS_CREDIT_CAP_PER_PERSON = 6_000_000; // 연금저축계좌 단독 세액공제 한도 연 600만 원 (소득세법 제59조의3①)
export const PERSONAL_PENSION_TAX_CREDIT_CAP_PER_PERSON = 9_000_000; // 연금저축 600만 + IRP 300만
export const PERSONAL_PENSION_LOW_TAX_THRESHOLD = 15_000_000; // 연 1,500만 원 이하 저율 분리과세
export const PERSONAL_PENSION_RATE_UNDER_70 = 0.055; // 55~69세 5.5%
export const PERSONAL_PENSION_RATE_70_TO_79 = 0.044; // 70~79세 4.4%
export const PERSONAL_PENSION_RATE_80_PLUS = 0.033; // 80세 이상 3.3%
export const PERSONAL_PENSION_HIGH_SEPARATE_RATE = 0.165; // 1,500만 초과 시 16.5% 분리과세 또는 종소세 비교
export const EARLY_PENSION_WITHDRAWAL_PENALTY_RATE = 0.165; // 55세 미만 기타소득세

// 3. 퇴직연금 이연퇴직소득세 (소득세법 제129조①5의3: 연금 실제 수령연차 10년 이하 70% / 10년 초과~20년 이하 60% / 20년 초과 50%, 2026.1.1 수령분부터)
export const BASE_SEVERANCE_EFFECTIVE_TAX_RATE = 0.06; // 퇴직소득 기본 실효세율 기준(6%)
export const IRP_SEVERANCE_DISCOUNT_10Y_OR_LESS = 0.70; // 30% 감면 -> 4.2%
export const IRP_SEVERANCE_DISCOUNT_OVER_10Y = 0.60; // 40% 감면 -> 3.6%
export const IRP_SEVERANCE_DISCOUNT_OVER_20Y = 0.50; // 50% 감면 -> 3.0%

// 4. 금융소득종합과세 및 해외주식 양도소득세 (소득세법 제14조, 제17조 제3항, 제56조, 제118조의2)
export const COMPREHENSIVE_FINANCIAL_INCOME_THRESHOLD = 20_000_000;
export const DIVIDEND_WITHHOLDING_TAX_RATE = 0.154; // 14% + 지방세 1.4%
export const CORPORATE_DIVIDEND_GROSS_UP_RATE = 0.10; // 내국법인 배당 종합과세 시 10% 배당가산 및 배당세액공제
export const CORPORATE_DIVIDEND_GROSS_UP_RATE_2027 = 0.11; // 소득세법 §17③ 개정: 2027.1.1 이후 지급 배당부터 배당가산율 11%, 2026년은 기존 10% 유지
export const OVERSEAS_STOCK_BASIC_DEDUCTION = 2_500_000; // 연 250만 원 기본공제
export const OVERSEAS_CAPITAL_GAINS_TAX_RATE = 0.22; // 지방세 포함 22%

// 5. 법인세 및 임원 보수 (법인세법 제55조, 2025.12.2 개정 · 2026.1.1 이후 개시 사업연도, 지방소득세 10% 포함)
export const CORPORATE_TAX_LOW_BRACKET_CAP = 200_000_000; // 2억 이하
export const CORPORATE_TAX_RATE_NORMAL_LOW = 0.11; // 일반법인 2억 이하 10% + 지방세 1%
export const CORPORATE_TAX_RATE_NORMAL_HIGH = 0.22; // 일반법인 2억 초과~200억 20% + 지방세 2%
export const CORPORATE_TAX_RATE_TRANSPARENT = 0.22; // 성실신고확인 소규모법인(법인세법 §55② 2억 이하 저율 배제) 200억 이하 20% + 지방세 2%
export const WORKPLACE_MIN_MONTHLY_SALARY_PER_EXEC = 1_000_000; // 직장가입자 유지 최소 월보수 기준
export const CORPORATE_NOL_CARRYFORWARD_YEARS = 15; // 법인세법 §13①1호 이월결손금 15년 공제
export const CORPORATE_NOL_DEDUCTION_CAP_RATIO = 0.80; // 법인세법 §13① 각 사업연도 소득의 80% 공제 한도
export const CORPORATE_CAPITAL_REGISTRATION_TAX_RATE = 0.0048; // 지방세법 §28①6호 법인 설립·유상증자 등록면허세 0.4% + 지방교육세 0.08% = 0.48%
export const SHAREHOLDER_LOAN_DEEMED_INTEREST_RATE = 0.046; // 상증세법 §41의4·§45의5 당좌대출이자율 연 4.6%
export const SHAREHOLDER_LOAN_SAFE_HARBOR_PRINCIPAL = Math.floor(10_000_000 / 0.046); // ~217,391,304원: 연간 적정이자 1,000만 원 미만 면세 기준 원금

// 5-a. 상속세 및 증여세법 (상증세법 §21·§22·§26·§53)
export const SPOUSAL_GIFT_EXEMPTION_10Y = 600_000_000; // 상증세법 §53 배우자 증여재산공제 10년 합산 6억 원
export const ADULT_CHILD_GIFT_EXEMPTION_10Y = 50_000_000; // 상증세법 §53 성년 자녀 증여재산공제 10년 합산 5,000만 원
export const INHERITANCE_LUMP_SUM_DEDUCTION = 500_000_000; // 상증세법 §21 일괄공제 5억 원
export const INHERITANCE_FINANCIAL_ASSET_DEDUCTION_CAP = 200_000_000; // 상증세법 §22 금융재산상속공제 순금융재산의 20%, 한도 2억 원 — 지배주주 비상장주식 제외

// 5-b. 종합부동산세법 (종부세법 §8①)
export const JONGBU_DEDUCTION_SINGLE_1HOME = 1_200_000_000; // 종부세법 §8① 1세대 1주택 단독명의 기본공제 12억
export const JONGBU_DEDUCTION_PER_PERSON_JOINT = 900_000_000; // 종부세법 §8① 부부 공동명의 인별 기본공제 9억, 합산 18억

// 6. 국민건강보험료 (국민건강보험법 제69조~제72조 및 시행령 제41조, 2026 보험료율 7.19% / 장기요양 13.14% / 점수당 211.5원)
export const HEALTH_INSURANCE_BASE_RATE = 0.0719;
export const LONG_TERM_CARE_INSURANCE_RATIO = 0.1314;
export const EFFECTIVE_HEALTH_INSURANCE_RATE =
  HEALTH_INSURANCE_BASE_RATE * (1 + LONG_TERM_CARE_INSURANCE_RATIO); // ~0.08134766
export const REGIONAL_HEALTH_POINT_VALUE_KRW = 211.5;
export const REGIONAL_HEALTH_MIN_MONTHLY_PREMIUM_KRW = 20_160; // 지역가입자 월 최저보험료(장기요양 제외 건보 하한)
export const REGIONAL_HEALTH_MAX_MONTHLY_PREMIUM_KRW = 4_591_740; // 2026 지역가입자 월별 보험료 상한(보건복지부 고시 제2025-222호, 장기요양 제외)
export const REGIONAL_INCOME_MIN_ASSESSABLE_ANNUAL_KRW = 3_360_000; // 연 336만 원 이하 소득은 소득보험료 미부과(최저보험료 대상)
export const HEALTH_INSURANCE_FINANCIAL_INCOME_CLIFF = 10_000_000; // 연 1,000만 원 이하 분리과세 금융소득은 건보 부과소득·피부양자 소득에서 0원 절사
export const REFORM_2024_PROPERTY_BASIC_DEDUCTION = 100_000_000;
export const LEGACY_PROPERTY_BASIC_DEDUCTION = 50_000_000;
/**
 * 국민건강보험법 시행령 [별표 4] 제3호 재산등급별 점수 (개정 2024.5.7, 2026.9.15 공포본 원문 대조)
 * [세대 합산 재산 − 기본공제 1억] 금액(만원) 상한(이하) → 점수. 60등급(77억8,124만 초과)은 REGIONAL_HEALTH_PROPERTY_TOP_POINTS.
 */
export const REGIONAL_HEALTH_PROPERTY_GRADES: ReadonlyArray<readonly [number, number]> = [
  [450, 22], [900, 44], [1_350, 66], [1_800, 97], [2_250, 122], [2_700, 146], [3_150, 171], [3_600, 195],
  [4_050, 219], [4_500, 244], [5_020, 268], [5_590, 294], [6_220, 320], [6_930, 344], [7_710, 365],
  [8_590, 386], [9_570, 412], [10_700, 439], [11_900, 465], [13_300, 490], [14_800, 516], [16_400, 535],
  [18_300, 559], [20_400, 586], [22_700, 611], [25_300, 637], [28_100, 659], [31_300, 681], [34_900, 706],
  [38_800, 731], [43_200, 757], [48_100, 785], [53_600, 812], [59_700, 841], [66_500, 881], [74_000, 921],
  [82_400, 961], [91_800, 1_001], [103_000, 1_041], [114_000, 1_091], [127_000, 1_141], [142_000, 1_191],
  [158_000, 1_241], [176_000, 1_291], [196_000, 1_341], [218_000, 1_391], [242_000, 1_451], [270_000, 1_511],
  [300_000, 1_571], [330_000, 1_641], [363_000, 1_711], [399_300, 1_781], [439_230, 1_851], [483_153, 1_921],
  [531_468, 1_991], [584_615, 2_061], [643_077, 2_131], [707_385, 2_201], [778_124, 2_271],
];
export const REGIONAL_HEALTH_PROPERTY_TOP_POINTS = 2_341;
export const WORKPLACE_NON_SALARY_INCOME_THRESHOLD = 20_000_000; // 보수외소득 월액보험료 기준 2,000만 원
export const DEPENDENT_INCOME_CAP = 20_000_000; // 피부양자 소득 상한 2,000만 원 (재산과표 5.4억 이하)
export const DEPENDENT_HIGH_PROPERTY_INCOME_CAP = 10_000_000; // 재산과표 5.4억 초과 ~ 9억 이하 구간 피부양자 소득 상한 1,000만 원
export const DEPENDENT_PROPERTY_TAX_BASE_CAP = 540_000_000; // 피부양자 재산 과표 5.4억
export const DEPENDENT_PROPERTY_ABSOLUTE_CAP = 900_000_000; // 피부양자 재산 과표 9억 초과 단독 박탈

// 7. 국민연금 (국민연금법 제63조의2 2026.06.17 개정 재직자 감액 기준 및 추납)
export const NATIONAL_PENSION_ADDITIONAL_ACCRUAL_FACTOR = 0.0055; // 추납 개월수 × 월보험료 × 0.0055
export const NATIONAL_PENSION_EARLY_MULTIPLIER = 0.70; // 60세 조기수령 (연 -6% × 5년 = 70%)
export const NATIONAL_PENSION_NORMAL_MULTIPLIER = 1.00; // 65세 정상수령 (100%)
export const NATIONAL_PENSION_DEFERRED_MULTIPLIER = 1.36; // 70세 연기수령 (연 +7.2% × 5년 = 136%)
export const NATIONAL_PENSION_A_VALUE_MONTHLY = 3_193_511; // 2026년 국민연금 가입자 평균소득월액(A값)
export const NATIONAL_PENSION_2026_REFORM_EXEMPT_ADDITION = 2_000_000; // 2026.06.17 시행 정상·연기연금 감액 면제 추가 기준액 (+200만 원)
export const NATIONAL_PENSION_RATE_TOTAL = 0.095; // 2026년 기준 합산 9.5% (근로자 4.75% + 사용자 4.75%)
export const NATIONAL_PENSION_RATE_ANNUAL_STEP = 0.005; // 매년 +0.5%p 인상 (국민연금법 개정, 2026~2033)
export const NATIONAL_PENSION_RATE_CAP = 0.13; // 2033년 이후 상한 13.0% (근로자 6.5% + 사용자 6.5%)

/**
 * 시뮬레이션 경과연수(idx: 0 = 2026년)에 따른 국민연금 총 보험료율(노사 합산) 산출
 * 2026년 9.5%에서 매년 +0.5%p씩 인상하여 2033년(idx >= 7) 이후 13.0% 상한 도달
 */
export function getNationalPensionRateTotal(elapsedYears = 0): number {
  const stepYears = Math.max(0, Math.floor(elapsedYears));
  return Math.min(
    NATIONAL_PENSION_RATE_CAP,
    Number((NATIONAL_PENSION_RATE_TOTAL + stepYears * NATIONAL_PENSION_RATE_ANNUAL_STEP).toFixed(4))
  );
}

/**
 * 시뮬레이션 경과연수(idx: 0 = 2026년)에 따른 국민연금 근로자/사용자 각 50% 부담률 산출
 * 2026년 4.75% → 매년 +0.25%p → 2033년 이후 6.5% 상한
 */
export function getNationalPensionRateEmployee(elapsedYears = 0): number {
  return Number((getNationalPensionRateTotal(elapsedYears) / 2).toFixed(5));
}
