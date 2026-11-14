import {
  calculateAnnualPropertyHoldingTax,
  calculateCorporateTax,
  calculateGiftOrInheritanceTax,
  calculateHouseholdPersonalPensionTax,
  calculateIndividualCombinedTax,
  calculateIrpSeveranceTax,
  calculateIsaTax,
  calculateOverseasCapitalGainsTax,
  calculatePersonalPensionTax,
  calculateRegionalHealthInsurance,
  calculateRetirementIncomeTax,
  calculateWorkplaceNonSalaryHealthInsurance,
  calculateHouseholdCombinedTax,
  evaluateDependentEligibility,
  getDeferredSeveranceTaxMultiplier,
  getRegionalPropertyPoints,
  householdHealthFinancialIncome,
  solveExecutivePayroll,
} from '../src/engine/taxAndHealth';
import { DEFAULT_SIMULATION_INPUTS } from '../src/engine/presets';
import {
  CORPORATE_TAX_RATE_NORMAL_HIGH,
  CORPORATE_TAX_RATE_NORMAL_LOW,
  CORPORATE_TAX_RATE_TRANSPARENT,
  EFFECTIVE_HEALTH_INSURANCE_RATE,
  HEALTH_INSURANCE_BASE_RATE,
  LONG_TERM_CARE_INSURANCE_RATIO,
  NATIONAL_PENSION_RATE_CAP,
  NATIONAL_PENSION_RATE_TOTAL,
  REGIONAL_HEALTH_MIN_MONTHLY_PREMIUM_KRW,
  REGIONAL_HEALTH_POINT_VALUE_KRW,
  getNationalPensionRateEmployee,
  getNationalPensionRateTotal,
} from '../src/engine/constants';

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// 1. ISA 비과세 및 9.9% 분리과세 검증
check(calculateIsaTax(1_800_000, false) === 0, 'ISA 200만 원 이하 비과세');
check(calculateIsaTax(12_000_000, false) === 990_000, 'ISA 초과 1,000만 원 × 9.9% = 99만 원');

// 2. IRP 퇴직소득세 30%/40% 감면 검증
check(calculateIrpSeveranceTax(10_000_000, 5) === 420_000, '10년 이하 4.2%');
check(calculateIrpSeveranceTax(10_000_000, 15) === 360_000, '10년 초과 3.6%');

// 3. 사적연금 만 55세 미만 페널티 & 1,500만 초과 Min-Tax 분기 검증
const earlyPen = calculatePersonalPensionTax(10_000_000, 52);
check(earlyPen.selectedMode === 'early_penalty_165', '55세 미만 기타소득세 16.5%');
check(earlyPen.tax === 1_650_000, '55세 미만 세액 165만 원');

const lowPen = calculatePersonalPensionTax(12_000_000, 60);
check(lowPen.selectedMode === 'low_separate', '1,500만 이하 저율 분리과세');
check(lowPen.tax === 660_000, '60세 5.5% = 66만 원');

const coupleLowPen = calculatePersonalPensionTax(25_000_000, 60, 0, true);
check(coupleLowPen.selectedMode === 'low_separate', '부부 합산 3,000만 이하 저율 분리과세 (7-A)');
check(coupleLowPen.tax === 1_375_000, '60세 부부 2,500만 × 5.5% = 137.5만 원');

const over15mLowOther = calculatePersonalPensionTax(20_000_000, 65, 0);
check(
  over15mLowOther.selectedMode === 'comprehensive_progressive',
  '타 소득 없을 때 2,000만 사적연금은 종소세 합산이 유리'
);
check(
  over15mLowOther.tax < Math.round(20_000_000 * 0.165),
  'Min-Tax가 16.5% 분리과세보다 낮아야 함'
);

// 4. 해외직투 250만 원 공제 후 22% 양도세
check(calculateOverseasCapitalGainsTax(2_000_000) === 0, '250만 이하 비과세');
check(calculateOverseasCapitalGainsTax(12_500_000) === 2_200_000, '초과 1,000만 × 22% = 220만');

// 5. 2026 법인세(법인세법 §55, 2025.12.2 개정 · 2026.1.1 이후 개시 사업연도): 일반 2억 이하 10% / 2억~200억 20%,
//    성실신고확인 소규모법인 200억 이하 20% — 지방소득세 10% 포함 11% / 22%
check(calculateCorporateTax(100_000_000, 'normal') === 11_000_000, '일반법인 2억 이하 11% (10% + 지방 1%)');
check(
  calculateCorporateTax(300_000_000, 'normal') === 22_000_000 + 22_000_000,
  '일반법인 3억 = 2억×11% + 1억×22%'
);
check(
  calculateCorporateTax(100_000_000, 'transparent') === 22_000_000,
  '성실신고 소규모법인 1억 = 22% (2억 이하 저율구간 없음)'
);
check(
  CORPORATE_TAX_RATE_NORMAL_LOW === 0.11 && CORPORATE_TAX_RATE_NORMAL_HIGH === 0.22 && CORPORATE_TAX_RATE_TRANSPARENT === 0.22,
  '2026 법인세 상수 11% / 22% / 22% (UI 표기 단일 출처)'
);
check(
  DEFAULT_SIMULATION_INPUTS.corporate.taxType === 'transparent',
  '투자법인 기본값은 성실신고확인 소규모법인(지배주주 50% 초과·이자배당 50% 이상·상시근로자 5인 미만)'
);

// 5-b. 이연퇴직소득 연금수령 감면 3단계 (소득세법 §129①5의3: 10년 이하 70% / 20년 이하 60% / 20년 초과 50%, 2026.1.1 수령분부터)
check(
  getDeferredSeveranceTaxMultiplier(1) === 0.7 &&
    getDeferredSeveranceTaxMultiplier(10) === 0.7 &&
    getDeferredSeveranceTaxMultiplier(11) === 0.6 &&
    getDeferredSeveranceTaxMultiplier(20) === 0.6 &&
    getDeferredSeveranceTaxMultiplier(21) === 0.5,
  '연금 실제 수령연차 1~10년 70% · 11~20년 60% · 21년~ 50%'
);
check(calculateIrpSeveranceTax(10_000_000, 25) === 300_000, '20년 초과 연차 3.0% (6% × 50%)');

// 6. 지역건보 2024 개정(1억 공제) & 부부 공동명의 역전 방지 상한 검증
const regSingle = calculateRegionalHealthInsurance({
  assessedPropertyValue: 1_200_000_000,
  ownership: 'single',
  fairMarketValueRatio: 60,
  apply2024Reform: true,
  assessableAnnualIncome: 10_000_000,
  hasSpouse: true,
});
const regJoint = calculateRegionalHealthInsurance({
  assessedPropertyValue: 1_200_000_000,
  ownership: 'joint',
  fairMarketValueRatio: 60,
  apply2024Reform: true,
  assessableAnnualIncome: 10_000_000,
  hasSpouse: true,
});
check(
  regJoint.annualTotal === regSingle.annualTotal,
  '지역건보 재산은 세대 합산 후 1억 1회 공제(시행령 별표4 제1호) → 공동명의·단독명의 동일'
);
// 6-a. 시행령 별표4 재산등급 60단계 표 (2026.9.15 공포본 원문 대조): 공제 후 금액(만원) 상한 → 점수
const propOnlyMonthly = (taxBaseAfterDeduction: number, ownership: 'single' | 'joint' = 'single') =>
  calculateRegionalHealthInsurance({
    assessedPropertyValue: taxBaseAfterDeduction + 100_000_000, // 공정시장가액비율 100% → 과표 = 공시가
    ownership,
    fairMarketValueRatio: 100,
    apply2024Reform: true,
    assessableAnnualIncome: 0,
    hasSpouse: true,
  }).monthlyTotal;
const ltc = (points: number) => Math.round(points * 211.5 * (1 + 0.1314));
check(getRegionalPropertyPoints(0) === 0, '공제 후 0원 이하 → 재산점수 0');
check(getRegionalPropertyPoints(4_500_000) === 22 && getRegionalPropertyPoints(4_500_001) === 44, '1등급 450만 이하 22점 / 초과 44점');
check(getRegionalPropertyPoints(100_000_000) === 439, '1억(18등급 9,570~10,700만) 439점');
check(getRegionalPropertyPoints(500_000_000) === 812, '5억(33등급 48,100~53,600만) 812점');
check(getRegionalPropertyPoints(620_000_000) === 881, '6.2억(35등급 59,700~66,500만) 881점');
check(getRegionalPropertyPoints(1_000_000_000) === 1_041, '10억(39등급 91,800~103,000만) 1,041점');
check(
  getRegionalPropertyPoints(7_781_240_000) === 2_271 && getRegionalPropertyPoints(7_781_240_001) === 2_341,
  '59등급 상한 77억8,124만 2,271점 / 초과 60등급 2,341점'
);
check(propOnlyMonthly(100_000_000) === ltc(439), '공제 후 1억 월 재산보험료 = 439점 × 211.5 × 1.1314');
check(propOnlyMonthly(500_000_000) === ltc(812), '공제 후 5억 → 812점');
check(propOnlyMonthly(1_000_000_000) === ltc(1_041), '공제 후 10억 → 1,041점');
const joint3eok = calculateRegionalHealthInsurance({
  assessedPropertyValue: 300_000_000,
  ownership: 'joint',
  fairMarketValueRatio: 60,
  apply2024Reform: true,
  assessableAnnualIncome: 0,
  hasSpouse: true,
});
check(
  joint3eok.monthlyTotal === ltc(386),
  `공시 3억 공동명의: 과표 1.8억 - 1억 = 8,000만(16등급 386점), 인별 공제 금지 (실측 ${joint3eok.monthlyTotal})`
);
check(
  regSingle.monthlyTotal === Math.round(881 * 211.5 * (1 + 0.1314) + (10_000_000 / 12) * 0.0719 * (1 + 0.1314)),
  `DEFAULT 공시 12억(과표 7.2억 - 1억 = 6.2억) 881점 + 소득 1,000만 (실측 ${regSingle.monthlyTotal})`
);
// 6-b. 2026 건보 요율(7.19%)·장기요양(13.14%)·점수당 211.5원·지역가입자 월 하한 20,160원
check(
  Math.abs(HEALTH_INSURANCE_BASE_RATE - 0.0719) < 1e-12 &&
    Math.abs(LONG_TERM_CARE_INSURANCE_RATIO - 0.1314) < 1e-12 &&
    REGIONAL_HEALTH_POINT_VALUE_KRW === 211.5 &&
    REGIONAL_HEALTH_MIN_MONTHLY_PREMIUM_KRW === 20_160,
  '2026 건보 상수(7.19% / 13.14% / 211.5원 / 하한 20,160원)'
);
const regFloor = calculateRegionalHealthInsurance({
  assessedPropertyValue: 0,
  ownership: 'single',
  fairMarketValueRatio: 60,
  apply2024Reform: true,
  assessableAnnualIncome: 3_000_000,
  hasSpouse: false,
});
check(regFloor.monthlyTotal === 20_160, '재산 0·소득 300만 지역가입자는 월 하한 20,160원 부과');
// 재산 점수 경로가 장기요양 상수(1 + 0.1314)를 참조하는지 역산 검증 (매직넘버 1.1295 제거)
const regPropOnly = calculateRegionalHealthInsurance({
  assessedPropertyValue: 1_000_000_000,
  ownership: 'single',
  fairMarketValueRatio: 60,
  apply2024Reform: true,
  assessableAnnualIncome: 0,
  hasSpouse: false,
});
// 과표 10억 × 60% = 6억 - 1억 = 5억 → 별표4 33등급 812점
check(
  regPropOnly.monthlyTotal === Math.round(812 * 211.5 * (1 + 0.1314)),
  '재산 건보료 = 별표4 등급점수 × 211.5원 × (1 + 장기요양 13.14%)'
);

// 6-c. 종합소득 적층(1-b): 임원 근로소득 과표 3,000만 위에 배당 5,000만이 올라가면 상위 누진 구간 적용으로 세액 증가
const stackedNone = calculateIndividualCombinedTax(50_000_000, 0, 0);
const stackedSalary = calculateIndividualCombinedTax(50_000_000, 0, 30_000_000);
check(
  stackedSalary.totalTax > stackedNone.totalTax &&
    stackedSalary.comprehensiveTaxableBase === 30_000_000 + 30_000_000,
  '급여 과표 적층 시 2,000만 초과 배당 세액 증가 + comprehensiveTaxableBase = 급여과표 + 초과배당'
);
check(
  calculateIndividualCombinedTax(10_000_000, 0, 30_000_000).dividendTax === 1_540_000,
  '2,000만 이하 배당은 급여 과표와 무관하게 15.4% 분리과세'
);
// 6-d. 사적연금 1인당 1,500만 한도(1-d): 3,000만 인출을 본인 100%가 받으면 초과분 Min-Tax, 50:50이면 전액 저율 5.5%
const penSelfOnly = calculateHouseholdPersonalPensionTax(30_000_000, 65, 0, 1.0);
const penSplit = calculateHouseholdPersonalPensionTax(30_000_000, 65, 0, 0.5);
check(penSplit === Math.round(15_000_000 * 0.055) * 2, '50:50 분할 3,000만은 인별 1,500만 이하 → 5.5% × 2');
check(penSelfOnly > penSplit, '배우자 계좌 0원이면 합산 3,000만 임계 불가 → 본인 1,500만 초과분 과세 증가');
check(
  penSelfOnly === calculatePersonalPensionTax(30_000_000, 65, 0, false).tax,
  '본인 100% 지분 가구 세액 = 1인 기준 세액'
);

// 6-e. 퇴직소득세(1-c): 3억/근속 20년 → 근속공제 4,000만, 환산급여 1.56억, 환산공제 8,690만, 과표 6,910만 → 19,844,000원
const sev = calculateRetirementIncomeTax(300_000_000, 20);
check(
  sev.serviceYearDeduction === 40_000_000 &&
    Math.round(sev.convertedSalary) === 156_000_000 &&
    Math.round(sev.taxableBase) === 69_100_000 &&
    sev.tax === 19_844_000,
  `퇴직소득세 3억/20년 = 19,844,000원 (실측 ${sev.tax})`
);
check(calculateRetirementIncomeTax(55_000_000, 26).tax === 0, '5,500만/26년은 근속연수공제(5,800만) 이내 → 0원');
check(calculateRetirementIncomeTax(0, 10).tax === 0, '퇴직금 0원 → 0원');
check(
  calculateRetirementIncomeTax(1_000_000_000, 10).effectiveRate > calculateRetirementIncomeTax(300_000_000, 20).effectiveRate,
  '고액·단기근속일수록 실효세율 상승'
);

// 7. 직장가입자 보수외소득 2,000만 원 초과 건보료 & 만 60세 임원 국민연금 면제 검증
check(calculateWorkplaceNonSalaryHealthInsurance(18_000_000) === 0, '2,000만 이하 보수외 건보 0원');
check(
  calculateWorkplaceNonSalaryHealthInsurance(30_000_000) > 700_000,
  '3,000만 보수외소득 시 초과 1,000만 원에 건보료 부과'
);

const payroll55 = solveExecutivePayroll(2_500_000, 2, 55);
const payroll62 = solveExecutivePayroll(2_500_000, 2, 62);
check(
  payroll62.annualTotalCorporatePayrollCost < payroll55.annualTotalCorporatePayrollCost,
  '만 60세 이상 임원은 국민연금 납부 면제로 총 인건비가 낮아야 함'
);
check(
  Math.abs(payroll62.annualTotalNetSalary - 2_500_000 * 12 * 2) <= 20_000,
  '역산된 실수령 연봉이 목표치와 수렴해야 함'
);

// 8. 개인 배당 + 국민연금 종합과세 비교과세 검증
const combinedUnder = calculateIndividualCombinedTax(15_000_000, 20_000_000);
check(
  combinedUnder.dividendTax === Math.round(15_000_000 * 0.154),
  '2,000만 이하 배당 15.4% 분리과세'
);

// 9. P0/P1 고도화: ISA 누적 비과세한도 차감, 법인배당 Gross-Up(10%) 세액공제, 건보 피부양자 3단계(5.4억/9억/1천만) 검증
check(
  calculateIsaTax(5_000_000, false, 0) === Math.round(5_000_000 * 0.099),
  'ISA 누적 비과세한도 소진(0원) 시 전액 9.9% 분리과세'
);
const noGrossUp = calculateIndividualCombinedTax(50_000_000, 0, 30_000_000, 0);
const withCorpGrossUp = calculateIndividualCombinedTax(50_000_000, 0, 30_000_000, 50_000_000);
check(
  withCorpGrossUp.totalTax < noGrossUp.totalTax &&
    withCorpGrossUp.dividendTax >= Math.round(50_000_000 * 0.154),
  '법인배당 Gross-Up(10%) 및 배당세액공제 반영 시 종합소득 산출세액 경감 및 15.4% 비교과세 하한 준수'
);
const depTierMid = calculateRegionalHealthInsurance({
  assessedPropertyValue: 1_200_000_000, // 공정시장가액 60% = 과표 7.2억 (5.4억 초과 ~ 9억 이하)
  ownership: 'single',
  fairMarketValueRatio: 60,
  apply2024Reform: true,
  assessableAnnualIncome: 8_000_000,
  dependentAssessableIncome: 12_000_000, // 1,000만 원 초과 → 피부양자 탈락
  hasSpouse: false,
});
check(
  depTierMid.isDependentEligible === false && depTierMid.dependentIncomeHeadroom === 0,
  '재산과표 5.4억~9억 구간에서 연 소득 1,000만 원 초과 시 피부양자 탈락'
);
const depTierLow = calculateRegionalHealthInsurance({
  assessedPropertyValue: 800_000_000, // 과표 4.8억 (5.4억 이하 → 소득한도 2,000만)
  ownership: 'single',
  fairMarketValueRatio: 60,
  apply2024Reform: true,
  assessableAnnualIncome: 8_000_000,
  dependentAssessableIncome: 12_000_000,
  hasSpouse: false,
});
check(
  depTierLow.isDependentEligible === true && depTierLow.dependentIncomeHeadroom === 8_000_000,
  '재산과표 5.4억 이하 구간에서 연 소득 1,200만 원은 피부양자 충족 및 여유한도 800만 원'
);

// 10. 국민연금 보험료율 연차별 인상 스케줄 (2026년 9.5% → 매년 +0.5%p → 2033년 13.0% 상한) 검증
check(
  NATIONAL_PENSION_RATE_TOTAL === 0.095 &&
    NATIONAL_PENSION_RATE_CAP === 0.13 &&
    getNationalPensionRateTotal(0) === 0.095 &&
    getNationalPensionRateTotal(1) === 0.1 &&
    getNationalPensionRateTotal(7) === 0.13 &&
    getNationalPensionRateTotal(15) === 0.13 &&
    getNationalPensionRateEmployee(0) === 0.0475 &&
    getNationalPensionRateEmployee(7) === 0.065,
  '국민연금 보험료율이 2026년(idx=0) 9.5%에서 매년 +0.5%p씩 인상되어 2033년(idx>=7) 13.0%(노사 각 6.5%) 상한에 도달해야 함'
);
const payroll55Y0 = solveExecutivePayroll(2_500_000, 2, 55, 0);
const payroll55Y3 = solveExecutivePayroll(2_500_000, 2, 55, 3);
const payroll55Y7 = solveExecutivePayroll(2_500_000, 2, 55, 7);
const payroll55Y12 = solveExecutivePayroll(2_500_000, 2, 55, 12);
const payroll62Y7 = solveExecutivePayroll(2_500_000, 2, 62, 7);
check(
  payroll55Y0.annualTotalCorporatePayrollCost < payroll55Y3.annualTotalCorporatePayrollCost &&
    payroll55Y3.annualTotalCorporatePayrollCost < payroll55Y7.annualTotalCorporatePayrollCost &&
    payroll55Y7.annualTotalCorporatePayrollCost === payroll55Y12.annualTotalCorporatePayrollCost &&
    payroll62Y7.annualTotalCorporatePayrollCost === payroll62.annualTotalCorporatePayrollCost,
  '만 60세 미만 임원 인건비는 경과연수(0→3→7년)에 따라 증가하고 7년차 이후 상한 고정되며, 만 60세 이상은 연차 무관 면제 유지'
);

// 11. B4-E3: 소득세는 개인 단위 — 부부 공적연금·배당을 1인에게 합산하지 않음 (배당·법인배당은 지분 50:50 가정)
{
  const sep =
    calculateIndividualCombinedTax(0, 21_600_000).pensionTax + calculateIndividualCombinedTax(0, 9_600_000).pensionTax;
  const hh = calculateHouseholdCombinedTax({
    taxableDividend: 0,
    corpDividend: 0,
    selfPublicPension: 21_600_000,
    spousePublicPension: 9_600_000,
    selfOtherBase: 0,
    spouseOtherBase: 0,
    hasSpouse: true,
  });
  check(
    hh.totalTax === sep && hh.totalTax < calculateIndividualCombinedTax(0, 31_200_000).pensionTax,
    `E3 부부 공적연금 인별 과세 ${hh.totalTax} = 개별 합 ${sep} < 1인 합산 ${calculateIndividualCombinedTax(0, 31_200_000).pensionTax}`
  );
  const hhDiv = calculateHouseholdCombinedTax({
    taxableDividend: 30_000_000,
    corpDividend: 10_000_000,
    selfPublicPension: 24_000_000,
    spousePublicPension: 0,
    selfOtherBase: 0,
    spouseOtherBase: 0,
    hasSpouse: true,
  });
  const expectSelf = calculateIndividualCombinedTax(20_000_000, 24_000_000, 0, 5_000_000).totalTax;
  const expectSpouse = calculateIndividualCombinedTax(20_000_000, 0, 0, 5_000_000).totalTax;
  check(
    hhDiv.totalTax === expectSelf + expectSpouse,
    `E3 가구 배당 4,000만(일반 3,000만 + 법인 1,000만)은 인당 2,000만으로 나눠 분리과세 판정 (${hhDiv.totalTax} vs ${expectSelf + expectSpouse})`
  );
  const single = calculateHouseholdCombinedTax({
    taxableDividend: 30_000_000,
    corpDividend: 10_000_000,
    selfPublicPension: 24_000_000,
    spousePublicPension: 0,
    selfOtherBase: 0,
    spouseOtherBase: 0,
    hasSpouse: false,
  });
  check(
    single.totalTax === calculateIndividualCombinedTax(40_000_000, 24_000_000, 0, 10_000_000).totalTax,
    'E3 배우자 없음 = 1인 전액 귀속'
  );
  // 본인공제 150만은 종합소득에서 1회: 임원 근로소득 과표(이미 150만 차감)가 있으면 연금 과표에서 다시 빼지 않음
  const withSalary = calculateIndividualCombinedTax(0, 20_000_000, 10_000_000);
  check(
    withSalary.pensionTaxableBase === 20_000_000 - 6_900_000,
    `E3 본인공제 이중차감 금지: 연금 2,000만 − 연금소득공제 690만 = 1,310만 (실측 ${withSalary.pensionTaxableBase})`
  );
  check(
    householdHealthFinancialIncome(18_000_000, true) === 0 &&
      householdHealthFinancialIncome(18_000_000, false) === 18_000_000 &&
      householdHealthFinancialIncome(24_000_000, true) === 24_000_000,
    'E3 건보 금융소득 1,000만 컷은 인별 판정 (부부 1,800만 → 인당 900만 → 0)'
  );
}

// 12. B4-E6: 사적연금 1,500만 초과 종합과세 비교는 공적+사적 연금 합계에 연금소득공제 1회 (§47의2·§64의4)
{
  const r = calculatePersonalPensionTax(20_000_000, 66, 7_100_000, false, 15_000_000);
  check(
    r.selectedMode === 'comprehensive_progressive' && r.tax === 2_286_900,
    `E6 공적 1,500만(과표 710만) + 사적 2,000만 → 증분 과표 1,800만, 세액 2,286,900 (실측 ${r.tax}/${r.selectedMode})`
  );
}

// 13. B4-E4: 피부양자 — 재산은 인별 재산세 과표(1억 공제·보증금 없음), 5.4~9억 구간은 소득 1,000만 이하
{
  const a = evaluateDependentEligibility(630_000_000, 8_000_000);
  const b = evaluateDependentEligibility(630_000_000, 15_000_000);
  const c = evaluateDependentEligibility(540_000_000, 20_000_000);
  const d = evaluateDependentEligibility(900_000_001, 0);
  check(a.eligible && a.headroom === 2_000_000, `E4 과표 6.3억·소득 800만 → 충족, 여유 200만 (${JSON.stringify(a)})`);
  check(!b.eligible && b.headroom === 0, 'E4 과표 6.3억·소득 1,500만 → 탈락');
  check(c.eligible && c.headroom === 0, 'E4 과표 5.4억·소득 2,000만 → 경계 충족');
  check(!d.eligible && d.headroom === 0, 'E4 과표 9억 초과 → 소득 무관 탈락');
  const reg = calculateRegionalHealthInsurance({
    assessedPropertyValue: 1_050_000_000, // 과표 6.3억
    ownership: 'single',
    fairMarketValueRatio: 60,
    apply2024Reform: true,
    assessableAnnualIncome: 0,
    dependentAssessableIncome: 8_000_000,
    hasSpouse: false,
  });
  check(
    reg.isDependentEligible && reg.dependentIncomeHeadroom === 2_000_000,
    `E4 공시 10.5억(과표 6.3억, 1억 공제 전) 소득 800만 → 여유 200만 (종전 1,200만) (실측 ${reg.dependentIncomeHeadroom})`
  );
  const renter = calculateRegionalHealthInsurance({
    assessedPropertyValue: 0,
    leaseDeposit: 2_000_000_000,
    ownership: 'single',
    fairMarketValueRatio: 60,
    apply2024Reform: true,
    assessableAnnualIncome: 0,
    dependentAssessableIncome: 5_000_000,
    hasSpouse: false,
  });
  check(renter.isDependentEligible, 'E4 전월세 보증금은 피부양자 재산(재산세 과표)에 불포함');
}

// 14. B5-③: 대표이사·등기임원은 근로자가 아니므로 고용보험(근로자 0.9% / 사업주 1.15%) 적용 제외 — 국민연금·건강보험만
{
  const p = solveExecutivePayroll(2_500_000, 1, 62); // 60세 이상: 국민연금 면제 → 건강보험(장기요양 포함)만
  check(
    p.annualEmployeeInsurance === Math.round((p.annualTotalGrossSalary * EFFECTIVE_HEALTH_INSURANCE_RATE) / 2) &&
      p.annualEmployerInsurance === p.annualEmployeeInsurance,
    `B5-③ 임원 4대보험 = 건강보험 노사 각 50%만 (근로자분 ${p.annualEmployeeInsurance}, 사업주분 ${p.annualEmployerInsurance})`
  );
}

// 15. Batch 2: 주택 보유세 (재산세 + 종부세)
{
  const single12 = calculateAnnualPropertyHoldingTax({
    assessedPropertyValue: 1_200_000_000,
    ownership: 'single',
    hasSpouse: true,
    ageSelf: 60,
    holdingYears: 10,
  });
  check(
    single12.propertyTaxTotal > 0 && single12.comprehensiveRealEstateTax === 0,
    `Batch 2 12억 단독주택 재산세 부과(${single12.propertyTaxTotal}), 종부세 0원 (기본공제 12억)`
  );

  const joint18 = calculateAnnualPropertyHoldingTax({
    assessedPropertyValue: 1_800_000_000,
    ownership: 'joint',
    hasSpouse: true,
    ageSelf: 60,
    holdingYears: 10,
  });
  check(
    joint18.comprehensiveRealEstateTax === 0,
    `Batch 2 18억 공동명의 종부세 0원 (인당 9억 × 2 = 18억 공제)`
  );

  const singleYoung18 = calculateAnnualPropertyHoldingTax({
    assessedPropertyValue: 1_800_000_000,
    ownership: 'single',
    hasSpouse: false,
    ageSelf: 50,
    holdingYears: 2,
  });
  check(
    singleYoung18.comprehensiveRealEstateTax > 0,
    `Batch 2 18억 단독명의 청년 종부세 > 0 (실측 ${singleYoung18.comprehensiveRealEstateTax})`
  );
}

// 16. Batch 2: 부부 일반금융자산 본인 명의 비중 (selfOwnershipPercent)
{
  const taxHalf = calculateOverseasCapitalGainsTax(5_000_000, true, 0.5);
  const taxFull = calculateOverseasCapitalGainsTax(5_000_000, true, 1.0);
  check(
    taxHalf === 0 && taxFull === 550_000,
    `Batch 2 해외주식 500만 원 차익: 50% 분산 시 0원, 100% 편중 시 550,000원 (실측 ${taxHalf}, ${taxFull})`
  );

  const healthHalf = householdHealthFinancialIncome(16_000_000, true, 0.5);
  const healthFull = householdHealthFinancialIncome(16_000_000, true, 1.0);
  check(
    healthHalf === 0 && healthFull === 16_000_000,
    `Batch 2 금융소득 1,600만 원 건보 부과: 50% 분산 시 0원, 100% 편중 시 16,000,000원 (실측 ${healthHalf}, ${healthFull})`
  );
}

// 17. Batch 2: 상속·증여세 5단계 누진세율 및 3% 신고세액공제
{
  const t1 = calculateGiftOrInheritanceTax(100_000_000, true);
  check(t1 === 9_700_000, `Batch 2 1억 과표 상증세 9.7백만 원 (실측 ${t1})`);
  const t5 = calculateGiftOrInheritanceTax(500_000_000, true);
  check(t5 === 87_300_000, `Batch 2 5억 과표 상증세 87.3백만 원 (실측 ${t5})`);
}

console.log('✅ PASS: taxAndHealth.test.ts (77 assertions passed)');

