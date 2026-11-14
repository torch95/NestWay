import {
  BASE_SEVERANCE_EFFECTIVE_TAX_RATE,
  COMPREHENSIVE_FINANCIAL_INCOME_THRESHOLD,
  CORPORATE_DIVIDEND_GROSS_UP_RATE,
  CORPORATE_TAX_LOW_BRACKET_CAP,
  CORPORATE_TAX_RATE_NORMAL_HIGH,
  CORPORATE_TAX_RATE_NORMAL_LOW,
  CORPORATE_TAX_RATE_TRANSPARENT,
  DEPENDENT_HIGH_PROPERTY_INCOME_CAP,
  DEPENDENT_INCOME_CAP,
  DEPENDENT_PROPERTY_ABSOLUTE_CAP,
  DEPENDENT_PROPERTY_TAX_BASE_CAP,
  DIVIDEND_WITHHOLDING_TAX_RATE,
  EARLY_PENSION_WITHDRAWAL_PENALTY_RATE,
  EFFECTIVE_HEALTH_INSURANCE_RATE,
  HEALTH_INSURANCE_FINANCIAL_INCOME_CLIFF,
  IRP_SEVERANCE_DISCOUNT_10Y_OR_LESS,
  IRP_SEVERANCE_DISCOUNT_OVER_10Y,
  IRP_SEVERANCE_DISCOUNT_OVER_20Y,
  ISA_SEPARATE_TAX_RATE,
  ISA_TAX_EXEMPT_GAIN_GENERAL,
  ISA_TAX_EXEMPT_GAIN_LOW_INCOME,
  JONGBU_DEDUCTION_PER_PERSON_JOINT,
  JONGBU_DEDUCTION_SINGLE_1HOME,
  LEGACY_PROPERTY_BASIC_DEDUCTION,
  NATIONAL_PENSION_EXEMPT_AGE,
  getNationalPensionRateEmployee,
  OVERSEAS_CAPITAL_GAINS_TAX_RATE,
  OVERSEAS_STOCK_BASIC_DEDUCTION,
  PENSION_ELIGIBLE_AGE,
  PERSONAL_PENSION_HIGH_SEPARATE_RATE,
  PERSONAL_PENSION_LOW_TAX_THRESHOLD,
  PERSONAL_PENSION_RATE_70_TO_79,
  PERSONAL_PENSION_RATE_80_PLUS,
  PERSONAL_PENSION_RATE_UNDER_70,
  REFORM_2024_PROPERTY_BASIC_DEDUCTION,
  LONG_TERM_CARE_INSURANCE_RATIO,
  REGIONAL_HEALTH_MAX_MONTHLY_PREMIUM_KRW,
  REGIONAL_HEALTH_MIN_MONTHLY_PREMIUM_KRW,
  REGIONAL_HEALTH_POINT_VALUE_KRW,
  REGIONAL_HEALTH_PROPERTY_GRADES,
  REGIONAL_HEALTH_PROPERTY_TOP_POINTS,
  REGIONAL_INCOME_MIN_ASSESSABLE_ANNUAL_KRW,
  WORKPLACE_NON_SALARY_INCOME_THRESHOLD,
} from './constants';
import type { CorporateTaxType, OwnershipType } from './types';

/**
 * 종합소득세 8단계 누진세율 산출 (지방소득세 10% 포함)
 */
export function calculateProgressiveIncomeTax(taxableBase: number): number {
  const base = Math.max(0, taxableBase);
  if (base <= 0) return 0;

  let nationalTax = 0;
  if (base <= 14_000_000) {
    nationalTax = base * 0.06;
  } else if (base <= 50_000_000) {
    nationalTax = 840_000 + (base - 14_000_000) * 0.15;
  } else if (base <= 88_000_000) {
    nationalTax = 6_240_000 + (base - 50_000_000) * 0.24;
  } else if (base <= 150_000_000) {
    nationalTax = 15_360_000 + (base - 88_000_000) * 0.35;
  } else if (base <= 300_000_000) {
    nationalTax = 37_060_000 + (base - 150_000_000) * 0.38;
  } else if (base <= 500_000_000) {
    nationalTax = 94_060_000 + (base - 300_000_000) * 0.40;
  } else if (base <= 1_000_000_000) {
    nationalTax = 174_060_000 + (base - 500_000_000) * 0.42;
  } else {
    nationalTax = 384_060_000 + (base - 1_000_000_000) * 0.45;
  }

  return Math.round(nationalTax * 1.1);
}

/**
 * 연금소득공제 (소득세법 제47조의2, 최대 900만 원 한도)
 */
export function calculatePensionIncomeDeduction(grossPension: number): number {
  const p = Math.max(0, grossPension);
  if (p <= 3_500_000) return p;
  if (p <= 7_000_000) return 3_500_000 + (p - 3_500_000) * 0.4;
  if (p <= 14_000_000) return 4_900_000 + (p - 7_000_000) * 0.2;
  return Math.min(9_000_000, 6_300_000 + (p - 14_000_000) * 0.1);
}

/**
 * 근로소득공제 (소득세법 제47조, 최대 2,000만 원 한도)
 */
export function calculateEarnedIncomeDeduction(grossSalary: number): number {
  const s = Math.max(0, grossSalary);
  if (s <= 5_000_000) return s * 0.7;
  if (s <= 15_000_000) return 3_500_000 + (s - 5_000_000) * 0.4;
  if (s <= 45_000_000) return 7_500_000 + (s - 15_000_000) * 0.15;
  if (s <= 100_000_000) return 12_000_000 + (s - 45_000_000) * 0.05;
  return Math.min(20_000_000, 14_750_000 + (s - 100_000_000) * 0.02);
}

/**
 * ISA 인출 수익 과세 (200만/400만 비과세 후 초과 수익 9.9% 분리과세, 누적 잔여 한도 지정 지원)
 */
export function calculateIsaTax(
  realizedGain: number,
  isLowIncome = false,
  customExemptLimit?: number
): number {
  const gain = Math.max(0, realizedGain);
  const exempt =
    customExemptLimit !== undefined
      ? Math.max(0, customExemptLimit)
      : isLowIncome
        ? ISA_TAX_EXEMPT_GAIN_LOW_INCOME
        : ISA_TAX_EXEMPT_GAIN_GENERAL;
  return Math.round(Math.max(0, gain - exempt) * ISA_SEPARATE_TAX_RATE);
}

/**
 * 이연퇴직소득 연금수령 세율 배수 (소득세법 §129①5의3: 연금 실제 수령연차 10년 이하 70% / 20년 이하 60% / 20년 초과 50%)
 */
export function getDeferredSeveranceTaxMultiplier(annuityYear: number): number {
  if (annuityYear > 20) return IRP_SEVERANCE_DISCOUNT_OVER_20Y;
  if (annuityYear > 10) return IRP_SEVERANCE_DISCOUNT_OVER_10Y;
  return IRP_SEVERANCE_DISCOUNT_10Y_OR_LESS;
}

/**
 * IRP 퇴직연금 인출 세액 (연금 수령연차 10년 이하 30% / 20년 이하 40% / 20년 초과 50% 감면)
 */
export function calculateIrpSeveranceTax(
  withdrawalAmount: number,
  yearsSinceRetirement: number
): number {
  const amt = Math.max(0, withdrawalAmount);
  if (amt <= 0) return 0;
  return Math.round(
    amt * BASE_SEVERANCE_EFFECTIVE_TAX_RATE * getDeferredSeveranceTaxMultiplier(yearsSinceRetirement)
  );
}

/**
 * 퇴직소득세 (소득세법 §48, 2023 개정 근속연수공제 · 환산급여 12배/근속연수 · 환산급여공제 · 누진세율 · 지방소득세 10% 포함)
 */
export function calculateRetirementIncomeTax(
  severancePay: number,
  serviceYears: number
): {
  tax: number;
  effectiveRate: number;
  serviceYearDeduction: number;
  convertedSalary: number;
  convertedSalaryDeduction: number;
  taxableBase: number;
} {
  const pay = Math.max(0, Math.round(severancePay));
  const n = Math.max(1, Math.round(serviceYears));
  if (pay <= 0) {
    return { tax: 0, effectiveRate: 0, serviceYearDeduction: 0, convertedSalary: 0, convertedSalaryDeduction: 0, taxableBase: 0 };
  }
  const serviceYearDeduction =
    n <= 5
      ? 1_000_000 * n
      : n <= 10
        ? 5_000_000 + 2_000_000 * (n - 5)
        : n <= 20
          ? 15_000_000 + 2_500_000 * (n - 10)
          : 40_000_000 + 3_000_000 * (n - 20);
  const convertedSalary = Math.max(0, ((pay - serviceYearDeduction) * 12) / n);
  const convertedSalaryDeduction =
    convertedSalary <= 8_000_000
      ? convertedSalary
      : convertedSalary <= 70_000_000
        ? 8_000_000 + (convertedSalary - 8_000_000) * 0.6
        : convertedSalary <= 100_000_000
          ? 45_200_000 + (convertedSalary - 70_000_000) * 0.55
          : convertedSalary <= 300_000_000
            ? 61_700_000 + (convertedSalary - 100_000_000) * 0.45
            : 151_700_000 + (convertedSalary - 300_000_000) * 0.35;
  const taxableBase = Math.max(0, convertedSalary - convertedSalaryDeduction);
  // calculateProgressiveIncomeTax는 지방소득세 10%를 포함하므로 환산산출세액 × n/12 에 그대로 적용
  const tax = Math.round((calculateProgressiveIncomeTax(taxableBase) * n) / 12);
  return {
    tax,
    effectiveRate: tax / pay,
    serviceYearDeduction,
    convertedSalary,
    convertedSalaryDeduction,
    taxableBase,
  };
}

/**
 * 사적연금(연금저축) 인출 과세 — 만 55세 가드 및 인당 1,500만 원(부부 합산 최대 3,000만 원) 초과 시 Min-Tax 비교과세
 * 종합과세 비교(§64의4)는 공적연금과 합산한 총연금액에 연금소득공제(§47의2, 900만 한도)를 1회 적용한 증분 세액
 */
export function calculatePersonalPensionTax(
  annualWithdrawal: number,
  ageSelf: number,
  otherComprehensiveTaxableBase = 0,
  hasSpouse = false,
  publicPensionAnnual = 0
): {
  tax: number;
  selectedMode: 'early_penalty_165' | 'low_separate' | 'separate_165' | 'comprehensive_progressive';
} {
  const amt = Math.max(0, annualWithdrawal);
  if (amt <= 0) {
    return { tax: 0, selectedMode: 'low_separate' };
  }
  if (ageSelf < PENSION_ELIGIBLE_AGE) {
    return {
      tax: Math.round(amt * EARLY_PENSION_WITHDRAWAL_PENALTY_RATE),
      selectedMode: 'early_penalty_165',
    };
  }
  const lowTaxThreshold = PERSONAL_PENSION_LOW_TAX_THRESHOLD * (hasSpouse ? 2 : 1);
  if (amt <= lowTaxThreshold) {
    const rate =
      ageSelf >= 80
        ? PERSONAL_PENSION_RATE_80_PLUS
        : ageSelf >= 70
          ? PERSONAL_PENSION_RATE_70_TO_79
          : PERSONAL_PENSION_RATE_UNDER_70;
    return {
      tax: Math.round(amt * rate),
      selectedMode: 'low_separate',
    };
  }

  const separate165Tax = Math.round(amt * PERSONAL_PENSION_HIGH_SEPARATE_RATE);
  const pub = Math.max(0, publicPensionAnnual);
  const baseBefore = Math.max(0, otherComprehensiveTaxableBase);
  const incrementalDeduction =
    calculatePensionIncomeDeduction(pub + amt) - calculatePensionIncomeDeduction(pub);
  // 본인공제 150만은 종합소득에서 1회: 공적연금·근로 과표가 이미 있으면 재차감하지 않음
  const basicDeduction = baseBefore > 0 || pub > 0 ? 0 : 1_500_000;
  const netPensionBase = Math.max(0, amt - incrementalDeduction - basicDeduction);
  const progressiveIncrementalTax =
    calculateProgressiveIncomeTax(baseBefore + netPensionBase) -
    calculateProgressiveIncomeTax(baseBefore);

  if (progressiveIncrementalTax < separate165Tax) {
    return { tax: progressiveIncrementalTax, selectedMode: 'comprehensive_progressive' };
  }
  return { tax: separate165Tax, selectedMode: 'separate_165' };
}

/**
 * 해외직투 ETF 양도소득세 (1인 연 250만 원 / 부부 합산 최대 500만 원 기본공제 후 22% 분류과세)
 * selfShare 지정 시 부부 간 명의 비중에 따라 인별 실현차익 및 250만 공제 각각 적용
 */
export function calculateOverseasCapitalGainsTax(
  realizedGain: number,
  hasSpouse = false,
  selfShare?: number
): number {
  const gain = Math.max(0, realizedGain);
  if (!hasSpouse) {
    return Math.round(Math.max(0, gain - OVERSEAS_STOCK_BASIC_DEDUCTION) * OVERSEAS_CAPITAL_GAINS_TAX_RATE);
  }
  if (selfShare === undefined) {
    return Math.round(Math.max(0, gain - OVERSEAS_STOCK_BASIC_DEDUCTION * 2) * OVERSEAS_CAPITAL_GAINS_TAX_RATE);
  }
  const s = Math.min(1, Math.max(0, selfShare));
  const g1 = Math.round(gain * s);
  const g2 = gain - g1;
  const d1 = Math.max(0, g1 - OVERSEAS_STOCK_BASIC_DEDUCTION);
  const d2 = Math.max(0, g2 - OVERSEAS_STOCK_BASIC_DEDUCTION);
  return Math.round((d1 + d2) * OVERSEAS_CAPITAL_GAINS_TAX_RATE);
}

/**
 * 개인 배당소득 + 공적연금 통합 소득세 (소득세법 제62조 금융소득종합과세 비교과세 + 제17조③·제56조 법인배당 Gross-Up 10%/11% 및 배당세액공제 반영)
 */
export function calculateIndividualCombinedTax(
  taxableDividendOrParams:
    | number
    | {
        taxableDividend?: number;
        publicPension?: number;
        publicPensionAnnual?: number;
        otherTaxableBase?: number;
        otherComprehensiveTaxableBase?: number;
        corpDividend?: number;
        eligibleGrossUpDividend?: number;
        grossUpRate?: number;
      },
  publicPensionAnnual = 0,
  otherComprehensiveTaxableBase = 0,
  eligibleGrossUpDividend = 0,
  grossUpRate?: number
): {
  dividendTax: number;
  pensionTax: number;
  totalTax: number;
  pensionTaxableBase: number;
  /** 누진 적층 완료 후 종합과세표준(기타소득 과표 + 연금 과표 + 2,000만 초과 배당) — 사적연금 Min-Tax 비교의 기준 */
  comprehensiveTaxableBase: number;
} {
  let div = 0;
  let pen = 0;
  let otherBase = 0;
  let grossUpEligible = 0;
  let effectiveGrossUpRate = CORPORATE_DIVIDEND_GROSS_UP_RATE;
  if (typeof taxableDividendOrParams === 'object' && taxableDividendOrParams !== null) {
    div = Math.max(0, taxableDividendOrParams.taxableDividend || 0);
    pen = Math.max(
      0,
      taxableDividendOrParams.publicPension || taxableDividendOrParams.publicPensionAnnual || 0
    );
    otherBase = Math.max(
      0,
      taxableDividendOrParams.otherTaxableBase ||
        taxableDividendOrParams.otherComprehensiveTaxableBase ||
        0
    );
    grossUpEligible = Math.max(
      0,
      taxableDividendOrParams.corpDividend ||
        taxableDividendOrParams.eligibleGrossUpDividend ||
        0
    );
    if (taxableDividendOrParams.grossUpRate !== undefined) {
      effectiveGrossUpRate = taxableDividendOrParams.grossUpRate;
    } else if (grossUpRate !== undefined) {
      effectiveGrossUpRate = grossUpRate;
    }
  } else {
    div = Math.max(0, taxableDividendOrParams || 0);
    pen = Math.max(0, publicPensionAnnual || 0);
    otherBase = Math.max(0, otherComprehensiveTaxableBase || 0);
    grossUpEligible = Math.max(0, eligibleGrossUpDividend || 0);
    if (grossUpRate !== undefined) {
      effectiveGrossUpRate = grossUpRate;
    }
  }
  // 기타 종합소득 과표(예: 법인 임원 근로소득 과표)는 이미 자체 세액이 산출되어 있으므로
  // 여기서는 배당·연금이 그 위에 "적층"되어 상위 누진 구간을 적용받는 효과만 반영한다.
  const taxOnOther = calculateProgressiveIncomeTax(otherBase);

  const pensionDeduction = calculatePensionIncomeDeduction(pen);
  // 본인공제 150만은 종합소득에서 1회: 기타 과표(임원 근로소득 과표)가 있으면 이미 차감된 것으로 봄
  const basicDeduction = otherBase > 0 ? 0 : 1_500_000;
  const pensionTaxableBase = Math.max(0, pen - pensionDeduction - basicDeduction);
  const pensionTax = calculateProgressiveIncomeTax(otherBase + pensionTaxableBase) - taxOnOther;

  if (div <= COMPREHENSIVE_FINANCIAL_INCOME_THRESHOLD) {
    const dividendTax = Math.round(div * DIVIDEND_WITHHOLDING_TAX_RATE);
    return {
      dividendTax,
      pensionTax,
      totalTax: dividendTax + pensionTax,
      pensionTaxableBase,
      comprehensiveTaxableBase: otherBase + pensionTaxableBase,
    };
  }

  const baseWithholding = Math.round(
    COMPREHENSIVE_FINANCIAL_INCOME_THRESHOLD * DIVIDEND_WITHHOLDING_TAX_RATE
  );
  const excessDiv = div - COMPREHENSIVE_FINANCIAL_INCOME_THRESHOLD;
  // 내국법인 과세배당(소득세법 §17③·§56): 2,000만 초과분 중 법인세 과세재원 배당액에 Gross-Up(기본 10%, 2027+ 11%) 가산 후 산출세액에서 배당세액공제(지방소득세 10% 포함 ×1.1) 차감
  const grossUpBase = Math.min(excessDiv, Math.max(0, eligibleGrossUpDividend));
  const grossUpAmount = Math.round(grossUpBase * effectiveGrossUpRate);
  const dividendTaxCreditWithLocal = Math.round(grossUpAmount * 1.1);
  const progressiveOnExcess =
    calculateProgressiveIncomeTax(otherBase + pensionTaxableBase + excessDiv + grossUpAmount) -
    taxOnOther -
    pensionTax -
    dividendTaxCreditWithLocal;
  const minWithholdingOnExcess = Math.round(excessDiv * DIVIDEND_WITHHOLDING_TAX_RATE);
  const dividendTax = baseWithholding + Math.max(progressiveOnExcess, minWithholdingOnExcess);

  return {
    dividendTax,
    pensionTax,
    totalTax: dividendTax + pensionTax,
    pensionTaxableBase,
    comprehensiveTaxableBase: otherBase + pensionTaxableBase + excessDiv,
  };
}

/**
 * 가구 개인소득세(소득세는 개인 단위 과세): 본인·배우자 각자의 공적연금 + 기타 과표 위에
 * 가구 배당(일반계좌 + 법인배당)을 지분 귀속해 calculateIndividualCombinedTax를 인별 적용
 */
export function calculateHouseholdCombinedTax(p: {
  taxableDividend: number;
  corpDividend: number;
  selfPublicPension: number;
  spousePublicPension: number;
  selfOtherBase: number;
  spouseOtherBase: number;
  hasSpouse: boolean;
  dividendSelfShare?: number;
  corpDividendSelfShare?: number;
  grossUpRate?: number;
}): { totalTax: number; selfComprehensiveBase: number; spouseComprehensiveBase: number } {
  const div = Math.max(0, p.taxableDividend);
  const corpDiv = Math.max(0, p.corpDividend);
  const divSelfShare =
    p.dividendSelfShare !== undefined
      ? Math.min(1, Math.max(0, p.dividendSelfShare))
      : p.hasSpouse
        ? 0.5
        : 1.0;
  const corpDivSelfShare =
    p.corpDividendSelfShare !== undefined
      ? Math.min(1, Math.max(0, p.corpDividendSelfShare))
      : p.hasSpouse
        ? 0.5
        : 1.0;
  const selfDiv = p.hasSpouse ? Math.round(div * divSelfShare) : div;
  const selfCorpDiv = p.hasSpouse ? Math.round(corpDiv * corpDivSelfShare) : corpDiv;
  const self = calculateIndividualCombinedTax(
    selfDiv + selfCorpDiv,
    p.selfPublicPension,
    p.selfOtherBase,
    selfCorpDiv,
    p.grossUpRate
  );
  if (!p.hasSpouse) {
    return { totalTax: self.totalTax, selfComprehensiveBase: self.comprehensiveTaxableBase, spouseComprehensiveBase: 0 };
  }
  const spouse = calculateIndividualCombinedTax(
    div - selfDiv + (corpDiv - selfCorpDiv),
    p.spousePublicPension,
    p.spouseOtherBase,
    corpDiv - selfCorpDiv,
    p.grossUpRate
  );
  return {
    totalTax: self.totalTax + spouse.totalTax,
    selfComprehensiveBase: self.comprehensiveTaxableBase,
    spouseComprehensiveBase: spouse.comprehensiveTaxableBase,
  };
}

/** 건보 부과·피부양자 금융소득: 이자·배당은 인별 연 1,000만 원 초과 시에만 전액 반영(시행규칙) — 가구 금융소득을 지분 귀속 */
export function householdHealthFinancialIncome(
  totalFinancialIncome: number,
  hasSpouse: boolean,
  selfShare = 0.5
): number {
  const total = Math.max(0, totalFinancialIncome);
  const share = Math.min(1, Math.max(0, selfShare));
  const parts = hasSpouse ? [Math.round(total * share), total - Math.round(total * share)] : [total];
  return parts.reduce((s, x) => s + (x > HEALTH_INSURANCE_FINANCIAL_INCOME_CLIFF ? x : 0), 0);
}

/**
 * 주택 보유세 (지방세법 §110~§112 재산세 + 종합부동산세법 §8~§10 종부세)
 * - 재산세: 1세대 1주택 특례 공정시장가액비율(<=3억 43%, <=6억 44%, >6억 45%) 및 9억 이하 특례세율(§111의2) 적용
 *   도시지역분(0.14%) 및 지방교육세(20%) 포함
 * - 종부세: 공정시장가액비율 60%, 농특세 20% 포함
 *   부부 공동명의(joint && hasSpouse): 인별 9억 기본공제(합산 18억), 지분 50:50 각각 과표 산출
 *   단독명의(single 또는 !hasSpouse): 1세대 1주택 단독 12억 기본공제 + 고령자(최대 40%) 및 장기보유(최대 50%) 합산 최대 80% 세액공제
 */
const propertyHoldingTaxCache = new Map<string, {
  propertyTaxTotal: number;
  comprehensiveRealEstateTax: number;
  totalHoldingTax: number;
}>();

export function calculateAnnualPropertyHoldingTax(params: {
  assessedPropertyValue: number;
  ownership: OwnershipType;
  hasSpouse: boolean;
  ageSelf?: number;
  holdingYears?: number;
}): {
  propertyTaxTotal: number;
  comprehensiveRealEstateTax: number;
  totalHoldingTax: number;
} {
  const assessed = Math.max(0, Math.round(params.assessedPropertyValue));
  if (assessed <= 0) {
    return { propertyTaxTotal: 0, comprehensiveRealEstateTax: 0, totalHoldingTax: 0 };
  }

  const cacheKey = `${assessed}:${params.ownership}:${params.hasSpouse}:${params.ageSelf ?? 60}:${params.holdingYears ?? 10}`;
  const cached = propertyHoldingTaxCache.get(cacheKey);
  if (cached) return cached;

  // 1. 재산세 (지방세법 §110~§112)
  const propFmv = assessed <= 300_000_000 ? 0.43 : assessed <= 600_000_000 ? 0.44 : 0.45;
  const propBase = Math.round(assessed * propFmv);

  let basePropTax = 0;
  if (assessed <= 900_000_000) {
    // 1세대 1주택 특례세율 (지방세법 §111의2)
    if (propBase <= 60_000_000) {
      basePropTax = propBase * 0.0005;
    } else if (propBase <= 150_000_000) {
      basePropTax = 30_000 + (propBase - 60_000_000) * 0.001;
    } else if (propBase <= 300_000_000) {
      basePropTax = 120_000 + (propBase - 150_000_000) * 0.002;
    } else {
      basePropTax = 420_000 + (propBase - 300_000_000) * 0.0035;
    }
  } else {
    // 표준세율 (지방세법 §111)
    if (propBase <= 60_000_000) {
      basePropTax = propBase * 0.001;
    } else if (propBase <= 150_000_000) {
      basePropTax = 60_000 + (propBase - 60_000_000) * 0.0015;
    } else if (propBase <= 300_000_000) {
      basePropTax = 195_000 + (propBase - 150_000_000) * 0.0025;
    } else {
      basePropTax = 570_000 + (propBase - 300_000_000) * 0.004;
    }
  }

  // 도시지역분(propBase * 0.14%) + 지방교육세(basePropTax * 20%)
  const propertyTaxTotal = Math.round(basePropTax * 1.2 + propBase * 0.0014);

  // 2. 종합부동산세 (종합부동산세법 §8~§10)
  function calcJongbuBracket(base: number): number {
    if (base <= 0) return 0;
    if (base <= 300_000_000) return base * 0.005;
    if (base <= 600_000_000) return 1_500_000 + (base - 300_000_000) * 0.007;
    if (base <= 1_200_000_000) return 3_600_000 + (base - 600_000_000) * 0.010;
    if (base <= 2_500_000_000) return 9_600_000 + (base - 1_200_000_000) * 0.013;
    if (base <= 5_000_000_000) return 26_500_000 + (base - 2_500_000_000) * 0.015;
    if (base <= 9_400_000_000) return 64_000_000 + (base - 5_000_000_000) * 0.020;
    return 152_000_000 + (base - 9_400_000_000) * 0.027;
  }

  let comprehensiveRealEstateTax = 0;
  if (params.ownership === 'joint' && params.hasSpouse) {
    const personExcess = Math.max(0, assessed / 2 - JONGBU_DEDUCTION_PER_PERSON_JOINT);
    const personBase = Math.round(personExcess * 0.60);
    const personGross = Math.max(0, calcJongbuBracket(personBase) - Math.round(personBase * propFmv * 0.004));
    comprehensiveRealEstateTax = Math.round(personGross * 2 * 1.2);
  } else {
    const excess = Math.max(0, assessed - JONGBU_DEDUCTION_SINGLE_1HOME);
    const jongbuBase = Math.round(excess * 0.60);
    const grossJongbu = Math.max(0, calcJongbuBracket(jongbuBase) - Math.round(jongbuBase * propFmv * 0.004));
    const age = params.ageSelf ?? 60;
    const seniorCredit = age >= 70 ? 0.40 : age >= 65 ? 0.30 : age >= 60 ? 0.20 : 0;
    const holding = params.holdingYears ?? 10;
    const holdingCredit = holding >= 15 ? 0.50 : holding >= 10 ? 0.40 : holding >= 5 ? 0.20 : 0;
    const creditRatio = Math.min(0.80, seniorCredit + holdingCredit);
    comprehensiveRealEstateTax = Math.round(grossJongbu * (1 - creditRatio) * 1.2);
  }

  const result = {
    propertyTaxTotal,
    comprehensiveRealEstateTax,
    totalHoldingTax: propertyTaxTotal + comprehensiveRealEstateTax,
  };
  propertyHoldingTaxCache.set(cacheKey, result);
  return result;
}

/**
 * 상속세 및 증여세법 제26조 5단계 초과누진세율 산출 (신고세액공제 3% 선택적 반영)
 */
export function calculateGiftOrInheritanceTax(taxableBase: number, applyFilingCredit = true): number {
  const base = Math.max(0, Math.round(taxableBase));
  if (base <= 0) return 0;

  let tax = 0;
  if (base <= 100_000_000) {
    tax = base * 0.10;
  } else if (base <= 500_000_000) {
    tax = 10_000_000 + (base - 100_000_000) * 0.20;
  } else if (base <= 1_000_000_000) {
    tax = 90_000_000 + (base - 500_000_000) * 0.30;
  } else if (base <= 3_000_000_000) {
    tax = 240_000_000 + (base - 1_000_000_000) * 0.40;
  } else {
    tax = 1_040_000_000 + (base - 3_000_000_000) * 0.50;
  }

  return Math.round(tax * (applyFilingCredit ? 0.97 : 1.0));
}

/**
 * 부부 합산 연금저축/IRP 연금수령액을 인별 지분(selfShare)으로 나눠 **1인당 1,500만 원** 저율 분리과세 한도를
 * 각각 적용한 가구 세액 (배우자 계좌가 없으면 가구 저율 한도는 1,500만 원뿐 — 합산 3,000만 임계 금지)
 */
export function calculateHouseholdPersonalPensionTax(
  annualWithdrawalTotal: number,
  ageSelf: number,
  selfOtherComprehensiveTaxableBase: number,
  selfShare: number,
  ageSpouse: number = ageSelf
): number {
  const total = Math.max(0, annualWithdrawalTotal);
  if (total <= 0) return 0;
  const share = Math.min(1, Math.max(0, selfShare));
  const selfAmt = Math.round(total * share);
  return calculateHouseholdPersonalPensionTaxByPerson(
    selfAmt,
    total - selfAmt,
    ageSelf,
    ageSpouse,
    selfOtherComprehensiveTaxableBase
  );
}

/** 인별 연금소득(연금저축 + IRP 운용수익/자기부담금 합산) 금액을 직접 지정하는 가구 세액 (인별 기타 과표·공적연금 반영) */
export function calculateHouseholdPersonalPensionTaxByPerson(
  selfAnnualPension: number,
  spouseAnnualPension: number,
  ageSelf: number,
  ageSpouse: number,
  selfOtherComprehensiveTaxableBase = 0,
  spouseOtherComprehensiveTaxableBase = 0,
  selfPublicPension = 0,
  spousePublicPension = 0
): number {
  const selfTax = calculatePersonalPensionTax(
    Math.max(0, Math.round(selfAnnualPension)),
    ageSelf,
    selfOtherComprehensiveTaxableBase,
    false,
    selfPublicPension
  ).tax;
  const spouseTax = calculatePersonalPensionTax(
    Math.max(0, Math.round(spouseAnnualPension)),
    ageSpouse,
    spouseOtherComprehensiveTaxableBase,
    false,
    spousePublicPension
  ).tax;
  return selfTax + spouseTax;
}

/**
 * 법인세 산출 (법인세법 §55, 2026.1.1 이후 개시 사업연도 · 지방소득세 포함)
 * - 일반법인: 2억 이하 11%, 2억 초과 22%
 * - 성실신고확인 소규모법인(transparent): 2억 이하 저율구간 없이 22%
 * 저장된 레거시 customCorporateTaxRate(9.9/20.9 등, UI 입력란 없음)는 법정세율을 덮어쓰지 않도록 무시한다.
 */
export function calculateCorporateTax(taxableIncome: number, taxType: CorporateTaxType): number {
  const income = Math.max(0, taxableIncome);
  if (income <= 0) return 0;

  if (taxType === 'transparent') {
    return Math.round(income * CORPORATE_TAX_RATE_TRANSPARENT);
  }
  if (income <= CORPORATE_TAX_LOW_BRACKET_CAP) {
    return Math.round(income * CORPORATE_TAX_RATE_NORMAL_LOW);
  }
  const lowPart = CORPORATE_TAX_LOW_BRACKET_CAP * CORPORATE_TAX_RATE_NORMAL_LOW;
  const excessPart = (income - CORPORATE_TAX_LOW_BRACKET_CAP) * CORPORATE_TAX_RATE_NORMAL_HIGH;
  return Math.round(lowPart + excessPart);
}

/**
 * 지역가입자 재산보험료 부과점수 (국민건강보험법 시행령 별표4 제3호 60등급 표)
 * @param taxBaseAfterDeduction 세대 합산 재산(재산세 과표 + 전월세 평가액) − 기본공제 후 금액(원)
 */
export function getRegionalPropertyPoints(taxBaseAfterDeduction: number): number {
  if (!(taxBaseAfterDeduction > 0)) return 0;
  for (const [upperManWon, points] of REGIONAL_HEALTH_PROPERTY_GRADES) {
    if (taxBaseAfterDeduction <= upperManWon * 10_000) return points;
  }
  return REGIONAL_HEALTH_PROPERTY_TOP_POINTS;
}

/**
 * 지역가입자 건강보험료 산출 (2024.2 재산 기본공제 1억 개정 + 시행령 별표4 재산등급 60단계 표 + 피부양자 재산 5.4~9억 구간 연소득 1,000만 원 캡 반영)
 */
export function calculateRegionalHealthInsurance(params: {
  assessedPropertyValue: number;
  leaseDeposit?: number;
  ownership: OwnershipType;
  fairMarketValueRatio: number;
  apply2024Reform?: boolean;
  assessableAnnualIncome: number;
  /** 피부양자 자격 판정용 연간 합산소득 (공적연금 100% + 건보 반영 금융소득, 미지정 시 assessableAnnualIncome 사용) */
  dependentAssessableIncome?: number;
  hasSpouse?: boolean;
}): {
  annualTotal: number;
  monthlyTotal: number;
  propertyTaxBase: number;
  isDependentEligible: boolean;
  dependentIncomeHeadroom: number;
} {
  const fmvRatio = (params.fairMarketValueRatio || 60) / 100;
  const rawPropertyBase =
    Math.max(0, params.assessedPropertyValue) * fmvRatio +
    Math.max(0, params.leaseDeposit || 0) * 0.3;

  const basicDeduction =
    params.apply2024Reform ?? true
      ? REFORM_2024_PROPERTY_BASIC_DEDUCTION
      : LEGACY_PROPERTY_BASIC_DEDUCTION;

  const householdTaxBase = Math.max(0, rawPropertyBase - basicDeduction);
  // 시행령 별표4 제1호: 세대 재산 합산액에서 1억을 1회 공제 → 공동명의 여부와 무관
  const effectivePropertyPoints = getRegionalPropertyPoints(householdTaxBase);

  const propertyMonthly =
    effectivePropertyPoints * REGIONAL_HEALTH_POINT_VALUE_KRW * (1 + LONG_TERM_CARE_INSURANCE_RATIO);
  const incomeAssessable = Math.max(0, params.assessableAnnualIncome);
  const incomeMonthly =
    incomeAssessable > REGIONAL_INCOME_MIN_ASSESSABLE_ANNUAL_KRW
      ? (incomeAssessable / 12) * EFFECTIVE_HEALTH_INSURANCE_RATE
      : 0;

  // 지역가입자 월별 보험료 상·하한 (국민건강보험법 제69조제6항 및 보건복지부 고시, 장기요양보험료 포함)
  const maxMonthlyWithLtc = Math.round(
    REGIONAL_HEALTH_MAX_MONTHLY_PREMIUM_KRW * (1 + LONG_TERM_CARE_INSURANCE_RATIO)
  );
  const monthlyTotal = Math.min(
    maxMonthlyWithLtc,
    Math.max(
      REGIONAL_HEALTH_MIN_MONTHLY_PREMIUM_KRW,
      Math.round(propertyMonthly + incomeMonthly)
    )
  );

  // 피부양자 판정(단일 인 기준): 명의 재산 전부를 본인 재산세 과표로 봄. 부부 인별 판정은 ledgerKernel이 evaluateDependentEligibility로 수행
  const depIncome = Math.max(
    0,
    params.dependentAssessableIncome ?? params.assessableAnnualIncome
  );
  const dependent = evaluateDependentEligibility(
    Math.max(0, params.assessedPropertyValue) * fmvRatio,
    depIncome
  );

  return {
    annualTotal: monthlyTotal * 12,
    monthlyTotal,
    propertyTaxBase: householdTaxBase,
    isDependentEligible: dependent.eligible,
    dependentIncomeHeadroom: dependent.headroom,
  };
}

/**
 * 피부양자 재산·소득 요건 (국민건강보험법 시행규칙 별표1의2) — 1인 기준
 * - 재산: 본인 명의 재산세 과세표준 합계(공시가 × 공정시장가액비율. 지역보험료용 1억 공제·전월세 보증금 미적용)
 *   ≤ 5.4억: 연소득 ≤ 2,000만 / 5.4억 초과 ~ 9억 이하: 연소득 ≤ 1,000만 / 9억 초과: 탈락
 * - 소득: 공적연금 100% + 인별 1,000만 초과 금융소득 등 연간 합산소득 (부부는 둘 다 충족해야 함 — 호출부에서 판정)
 */
export function evaluateDependentEligibility(
  propertyTaxBase: number,
  annualIncome: number
): { eligible: boolean; headroom: number } {
  const base = Math.max(0, propertyTaxBase);
  const income = Math.max(0, annualIncome);
  if (base > DEPENDENT_PROPERTY_ABSOLUTE_CAP) return { eligible: false, headroom: 0 };
  const cap = base > DEPENDENT_PROPERTY_TAX_BASE_CAP ? DEPENDENT_HIGH_PROPERTY_INCOME_CAP : DEPENDENT_INCOME_CAP;
  return income <= cap ? { eligible: true, headroom: cap - income } : { eligible: false, headroom: 0 };
}

/**
 * 직장가입자 보수외소득(금융+공적연금 2,000만 원 초과분) 소득월액 건강보험료 (국민건강보험법 제71조)
 */
export function calculateWorkplaceNonSalaryHealthInsurance(
  assessableNonSalaryIncome: number
): number {
  const excess = Math.max(0, assessableNonSalaryIncome - WORKPLACE_NON_SALARY_INCOME_THRESHOLD);
  if (excess <= 0) return 0;
  const monthlyFee = Math.floor((excess / 12) * EFFECTIVE_HEALTH_INSURANCE_RATE);
  return monthlyFee * 12;
}

export interface ExecutivePayrollResult {
  executiveCount: 1 | 2;
  monthlyGrossPerPerson: number;
  monthlyNetPerPerson: number;
  annualTotalGrossSalary: number;
  annualTotalNetSalary: number;
  annualEarnedIncomeTax: number;
  annualEmployeeInsurance: number;
  annualEmployerInsurance: number;
  annualWorkplaceHealthInsTotal: number;
  annualTotalCorporatePayrollCost: number;
  /** 1인당 근로소득 과세표준(근로소득공제·본인공제 차감 후) — 배당·연금 종합과세 적층 기준 */
  earnedIncomeTaxableBasePerPerson: number;
}

const executivePayrollCache = new Map<string, ExecutivePayrollResult>();

/**
 * 법인 임원 목표 실수령 월급 → 세전 연봉·근로소득세·노사 4대보험 정밀 역산 솔버
 * (만 60세 이상 국민연금 면제 `국민연금법 §88` 반영 및 노사 건보료 100% 단일 합산)
 */
export function solveExecutivePayroll(
  targetMonthlyNetPerPerson: number,
  executiveCount: 1 | 2,
  executiveAge: number,
  elapsedYears = 0
): ExecutivePayrollResult {
  const targetNetAnnualPerPerson = Math.max(0, Math.round(targetMonthlyNetPerPerson)) * 12;
  if (targetNetAnnualPerPerson <= 0) {
    return {
      executiveCount,
      monthlyGrossPerPerson: 0,
      monthlyNetPerPerson: 0,
      annualTotalGrossSalary: 0,
      annualTotalNetSalary: 0,
      annualEarnedIncomeTax: 0,
      annualEmployeeInsurance: 0,
      annualEmployerInsurance: 0,
      annualWorkplaceHealthInsTotal: 0,
      annualTotalCorporatePayrollCost: 0,
      earnedIncomeTaxableBasePerPerson: 0,
    };
  }

  const isExemptPension = executiveAge >= NATIONAL_PENSION_EXEMPT_AGE;
  const pensionRate = isExemptPension ? 0 : getNationalPensionRateEmployee(elapsedYears);
  const cacheKey = `${targetNetAnnualPerPerson}:${executiveCount}:${pensionRate}`;
  const cached = executivePayrollCache.get(cacheKey);
  if (cached) return cached;

  const healthEmployeeRate = EFFECTIVE_HEALTH_INSURANCE_RATE / 2; // ~4.004%
  // 대표이사·등기임원은 근로기준법상 근로자가 아니므로 고용보험·산재보험 적용 제외 — 국민연금·건강보험만 사업장가입
  const employeeInsRate = pensionRate + healthEmployeeRate;
  const employerInsRate = pensionRate + healthEmployeeRate;

  const computeNetForGross = (annualGross: number) => {
    const empIns = Math.round(annualGross * employeeInsRate);
    const earnedDeduction = calculateEarnedIncomeDeduction(annualGross);
    const taxable = Math.max(0, annualGross - earnedDeduction - empIns - 1_500_000);
    const rawTax = calculateProgressiveIncomeTax(taxable);
    // 근로소득세액공제 (간이 반영: 산출세액의 55% 최대 66만 원)
    const taxCredit = Math.min(660_000, Math.round(rawTax * 0.55));
    const finalTax = Math.max(0, rawTax - taxCredit);
    const net = annualGross - empIns - finalTax;
    return { net, empIns, finalTax, taxable };
  };

  let low = targetNetAnnualPerPerson;
  let high = targetNetAnnualPerPerson * 2.0 + 12_000_000;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    const { net } = computeNetForGross(mid);
    if (net < targetNetAnnualPerPerson) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const annualGrossPerPerson = Math.round((low + high) / 2);
  const {
    net: netPerPerson,
    empIns: empInsPerPerson,
    finalTax: taxPerPerson,
    taxable: earnedIncomeTaxableBasePerPerson,
  } = computeNetForGross(annualGrossPerPerson);
  const employerInsPerPerson = Math.round(annualGrossPerPerson * employerInsRate);
  const healthInsPerPersonTotal = Math.round(annualGrossPerPerson * EFFECTIVE_HEALTH_INSURANCE_RATE);

  const annualTotalGrossSalary = annualGrossPerPerson * executiveCount;
  const annualTotalNetSalary = netPerPerson * executiveCount;
  const annualEarnedIncomeTax = taxPerPerson * executiveCount;
  const annualEmployeeInsurance = empInsPerPerson * executiveCount;
  const annualEmployerInsurance = employerInsPerPerson * executiveCount;
  const annualWorkplaceHealthInsTotal = healthInsPerPersonTotal * executiveCount;

  const result: ExecutivePayrollResult = {
    executiveCount,
    monthlyGrossPerPerson: Math.round(annualGrossPerPerson / 12),
    monthlyNetPerPerson: Math.round(netPerPerson / 12),
    annualTotalGrossSalary,
    annualTotalNetSalary,
    annualEarnedIncomeTax,
    annualEmployeeInsurance,
    annualEmployerInsurance,
    annualWorkplaceHealthInsTotal,
    annualTotalCorporatePayrollCost: annualTotalGrossSalary + annualEmployerInsurance,
    earnedIncomeTaxableBasePerPerson,
  };
  executivePayrollCache.set(cacheKey, result);
  return result;
}
