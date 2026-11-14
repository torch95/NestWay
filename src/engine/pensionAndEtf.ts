import {
  NATIONAL_PENSION_2026_REFORM_EXEMPT_ADDITION,
  NATIONAL_PENSION_A_VALUE_MONTHLY,
  NATIONAL_PENSION_ADDITIONAL_ACCRUAL_FACTOR,
  NATIONAL_PENSION_DEFERRED_MULTIPLIER,
  NATIONAL_PENSION_EARLY_MULTIPLIER,
  NATIONAL_PENSION_NORMAL_MULTIPLIER,
  SIMULATION_BASE_YEAR,
} from './constants';
import type {
  AccountAssetInputs,
  BasicAssetInputs,
  EtfHolding,
  MarketStressScenarioType,
  PensionClaimTiming,
  PensionInputs,
  PortfolioEvaluationSummary,
  RealEstateInputs,
} from './types';

/**
 * 국민연금 재직자 노령연금 감액 산출 (국민연금법 제63조의2 · 2026.06.17 개정 A값+200만=월 5,193,511원 미만 감액 폐지 반영)
 */
export function calculatePublicPensionWorkReduction(
  monthlyPension: number,
  monthlyWorkOrBusinessIncome: number,
  apply2026Reform = true
): {
  thresholdMonthly: number;
  excessIncome: number;
  monthlyReduction: number;
  adjustedMonthlyPension: number;
  savedBy2026ReformMonthly: number;
} {
  const pen = Math.max(0, Math.round(monthlyPension));
  const inc = Math.max(0, Math.round(monthlyWorkOrBusinessIncome));
  const aVal = NATIONAL_PENSION_A_VALUE_MONTHLY;

  // 종전 5구간 감액 함수 (초과소득 0~100만: 5%, 100~200만: +10%, 200~300만: +15%, 300~400만: +20%, 400만~: +25%, 연금액의 50% 상한)
  const calcLegacyReduction = (excess: number): number => {
    if (excess <= 0) return 0;
    let red = 0;
    if (excess <= 1_000_000) {
      red = excess * 0.05;
    } else if (excess <= 2_000_000) {
      red = 50_000 + (excess - 1_000_000) * 0.1;
    } else if (excess <= 3_000_000) {
      red = 150_000 + (excess - 2_000_000) * 0.15;
    } else if (excess <= 4_000_000) {
      red = 300_000 + (excess - 3_000_000) * 0.2;
    } else {
      red = 500_000 + (excess - 4_000_000) * 0.25;
    }
    return Math.min(Math.floor(pen * 0.5), Math.round(red));
  };

  const legacyExcess = Math.max(0, inc - aVal);
  const legacyReduction = calcLegacyReduction(legacyExcess);

  if (!apply2026Reform) {
    return {
      thresholdMonthly: aVal,
      excessIncome: legacyExcess,
      monthlyReduction: legacyReduction,
      adjustedMonthlyPension: Math.max(0, pen - legacyReduction),
      savedBy2026ReformMonthly: 0,
    };
  }

  // 2026.06.17 시행 개정: 초과소득 200만 원 미만(1·2구간, 월 소득 A+200만 = 5,193,511원 미만) 감액 전면 폐지
  const reformThreshold = aVal + NATIONAL_PENSION_2026_REFORM_EXEMPT_ADDITION;
  if (inc < reformThreshold) {
    return {
      thresholdMonthly: reformThreshold,
      excessIncome: 0,
      monthlyReduction: 0,
      adjustedMonthlyPension: pen,
      savedBy2026ReformMonthly: legacyReduction,
    };
  }
  // 200만 원 이상 초과 시 1·2구간(15만 원) 감액이 면제되고 3구간(15만원 + 200만 초과분*15%), 4구간, 5구간 감액 적용
  // calcLegacyReduction(legacyExcess)은 excess >= 2,000,000일 때 정확히 해당 법정 산식(50% 상한 포함)과 일치함
  const reformReduction = legacyReduction;
  return {
    thresholdMonthly: reformThreshold,
    excessIncome: inc - reformThreshold,
    monthlyReduction: reformReduction,
    adjustedMonthlyPension: Math.max(0, pen - reformReduction),
    savedBy2026ReformMonthly: 0,
  };
}

export function calculateAdditionalPensionIncrease(
  applyAdditional: boolean,
  additionalMonths: number,
  monthlyContribution: number
): number {
  if (!applyAdditional) return 0;
  const m = Math.max(0, additionalMonths || 0);
  const c = Math.max(0, monthlyContribution || 0);
  return Math.round(m * c * NATIONAL_PENSION_ADDITIONAL_ACCRUAL_FACTOR);
}

/**
 * 출생연도별 노령연금 수급개시연령 (국민연금법 부칙 법률 제8541호 §8)
 */
export function getStatutoryPensionAge(birthYear: number): number {
  if (birthYear <= 1952) return 60;
  if (birthYear <= 1956) return 61;
  if (birthYear <= 1960) return 62;
  if (birthYear <= 1964) return 63;
  if (birthYear <= 1968) return 64;
  return 65;
}

/** 수령 개시연령: 정상 = 출생연도별 법정연령, 조기 = 5년 앞당김(연 6% 감액), 연기 = 5년 늦춤(연 7.2% 가산) */
export function getPensionClaimStartAge(timing: PensionClaimTiming, birthYear = 1969): number {
  const normal = getStatutoryPensionAge(birthYear);
  if (timing === 'early') return normal - 5;
  if (timing === 'deferred') return normal + 5;
  return normal;
}

export function getPensionTimingMultiplier(timing: PensionClaimTiming): number {
  if (timing === 'early') return NATIONAL_PENSION_EARLY_MULTIPLIER;
  if (timing === 'deferred') return NATIONAL_PENSION_DEFERRED_MULTIPLIER;
  return NATIONAL_PENSION_NORMAL_MULTIPLIER;
}

export function calculateAnnualPublicPension(params: {
  ageSelf: number;
  ageSpouse: number;
  elapsedYears: number;
  inflationRatePercent: number;
  pension: PensionInputs;
  isPreRetirementEmployed?: boolean;
  selfMonthlyWorkIncome?: number;
  spouseMonthlyWorkIncome?: number;
}): {
  selfAnnual: number;
  spouseAnnual: number;
  totalAnnual: number;
} {
  const { ageSelf, ageSpouse, elapsedYears, inflationRatePercent, pension } = params;
  const hasSpouse = pension.hasSpouse ?? true;
  const cpiMultiplier = Math.pow(1 + (inflationRatePercent || 0) / 100, Math.max(0, elapsedYears));

  const birthYearSelf = SIMULATION_BASE_YEAR - (ageSelf - Math.max(0, elapsedYears));
  const normalAgeSelf = getStatutoryPensionAge(birthYearSelf);
  const startSelf = getPensionClaimStartAge(
    pension.claimTimingSelf,
    birthYearSelf
  );
  let selfMonthlyBase = 0;
  if (ageSelf >= startSelf) {
    const baseSelf =
      Math.max(0, pension.expectedMonthlyPensionSelf || 0) +
      calculateAdditionalPensionIncrease(
        pension.applyAdditionalPensionSelf,
        pension.additionalMonthsSelf,
        pension.monthlyContributionSelf
      );
    selfMonthlyBase = Math.round(
      baseSelf * getPensionTimingMultiplier(pension.claimTimingSelf)
    );
  }

  let spouseMonthlyBase = 0;
  let birthYearSpouse = 0;
  let normalAgeSpouse = 0;
  let startSpouse = 0;
  if (hasSpouse) {
    birthYearSpouse = SIMULATION_BASE_YEAR - (ageSpouse - Math.max(0, elapsedYears));
    normalAgeSpouse = getStatutoryPensionAge(birthYearSpouse);
    startSpouse = getPensionClaimStartAge(
      pension.claimTimingSpouse,
      birthYearSpouse
    );
    if (ageSpouse >= startSpouse) {
      const baseSpouse =
        Math.max(0, pension.expectedMonthlyPensionSpouse || 0) +
        calculateAdditionalPensionIncrease(
          pension.applyAdditionalPensionSpouse,
          pension.additionalMonthsSpouse,
          pension.monthlyContributionSpouse
        );
      spouseMonthlyBase = Math.round(
        baseSpouse * getPensionTimingMultiplier(pension.claimTimingSpouse)
      );
    }
  }

  let selfAnnual = Math.round(selfMonthlyBase * 12 * cpiMultiplier);
  let spouseAnnual = Math.round(spouseMonthlyBase * 12 * cpiMultiplier);

  // 국민연금법 §66 (Early Old-Age Pension Suspension during income-earning employment before normal age)
  if (
    pension.claimTimingSelf === 'early' &&
    ageSelf >= startSelf &&
    ageSelf < normalAgeSelf &&
    (params.isPreRetirementEmployed === true ||
      (params.selfMonthlyWorkIncome ?? 0) > NATIONAL_PENSION_A_VALUE_MONTHLY)
  ) {
    selfAnnual = 0;
  }

  if (
    hasSpouse &&
    pension.claimTimingSpouse === 'early' &&
    ageSpouse >= startSpouse &&
    ageSpouse < normalAgeSpouse &&
    (params.spouseMonthlyWorkIncome ?? 0) > NATIONAL_PENSION_A_VALUE_MONTHLY
  ) {
    spouseAnnual = 0;
  }

  // 국민연금법 §63조의2 (5-year work income reduction window)
  if (
    selfAnnual > 0 &&
    (params.selfMonthlyWorkIncome ?? 0) > 0 &&
    ageSelf < normalAgeSelf + 5
  ) {
    const selfWorkReal = Math.round((params.selfMonthlyWorkIncome ?? 0) / cpiMultiplier);
    const selfReduction = calculatePublicPensionWorkReduction(selfMonthlyBase, selfWorkReal);
    selfAnnual = Math.round(selfReduction.adjustedMonthlyPension * 12 * cpiMultiplier);
  }

  if (
    hasSpouse &&
    spouseAnnual > 0 &&
    (params.spouseMonthlyWorkIncome ?? 0) > 0 &&
    ageSpouse < normalAgeSpouse + 5
  ) {
    const spouseWorkReal = Math.round((params.spouseMonthlyWorkIncome ?? 0) / cpiMultiplier);
    const spouseReduction = calculatePublicPensionWorkReduction(spouseMonthlyBase, spouseWorkReal);
    spouseAnnual = Math.round(spouseReduction.adjustedMonthlyPension * 12 * cpiMultiplier);
  }

  return {
    selfAnnual,
    spouseAnnual,
    totalAnnual: selfAnnual + spouseAnnual,
  };
}

export interface RealEstateYearEvaluation {
  effectiveAssessedValue: number;
  effectiveLeaseDeposit: number;
  annualRentOutflow: number;
  annualHousingPensionInflow: number;
  downsizingPersonalCashInflow: number;
  downsizingCorpCashInflow: number;
}

export function evaluateRealEstateForYear(
  ageSelf: number,
  realEstate: RealEstateInputs,
  corporateRatioPercent: number
): RealEstateYearEvaluation {
  const baseAssessed =
    realEstate.housingType === 'rent' ? 0 : Math.max(0, realEstate.officiallyAssessedValue || 0);
  const baseDeposit =
    realEstate.housingType === 'rent' ? Math.max(0, realEstate.leaseDeposit || 0) : 0;
  const baseRentMonthly =
    realEstate.housingType === 'rent' ? Math.max(0, realEstate.monthlyRent || 0) : 0;

  const tr = realEstate.transition;
  if (!tr || tr.strategy === 'keep') {
    return {
      effectiveAssessedValue: baseAssessed,
      effectiveLeaseDeposit: baseDeposit,
      annualRentOutflow: baseRentMonthly * 12,
      annualHousingPensionInflow: 0,
      downsizingPersonalCashInflow: 0,
      downsizingCorpCashInflow: 0,
    };
  }

  if (tr.strategy === 'housing_pension') {
    const startAge = Math.max(55, tr.housingPensionStartAge ?? 65);
    const monthlyPayout = ageSelf >= startAge ? Math.max(0, tr.housingPensionMonthlyPayout || 0) : 0;
    return {
      effectiveAssessedValue: baseAssessed,
      effectiveLeaseDeposit: baseDeposit,
      annualRentOutflow: baseRentMonthly * 12,
      annualHousingPensionInflow: monthlyPayout * 12,
      downsizingPersonalCashInflow: 0,
      downsizingCorpCashInflow: 0,
    };
  }

  const triggerAge = tr.downsizingAge ?? 65;
  if (ageSelf < triggerAge) {
    return {
      effectiveAssessedValue: baseAssessed,
      effectiveLeaseDeposit: baseDeposit,
      annualRentOutflow: baseRentMonthly * 12,
      annualHousingPensionInflow: 0,
      downsizingPersonalCashInflow: 0,
      downsizingCorpCashInflow: 0,
    };
  }

  const isTriggerYear = ageSelf === triggerAge;
  const newAssessed =
    tr.strategy === 'sell_rent' || tr.targetHousingType === 'rent'
      ? 0
      : Math.max(0, tr.downsizedAssessedValue ?? 0);
  const newDeposit =
    tr.strategy === 'sell_rent' || tr.targetHousingType === 'rent'
      ? Math.max(0, tr.targetLeaseDeposit ?? 0)
      : 0;
  const newMonthlyRent =
    tr.strategy === 'sell_rent'
      ? Math.max(0, tr.monthlyRentExpense ?? tr.targetMonthlyRent ?? 0)
      : tr.targetHousingType === 'rent'
        ? Math.max(0, tr.targetMonthlyRent ?? 0)
        : 0;

  let downsizingPersonalCashInflow = 0;
  let downsizingCorpCashInflow = 0;

  if (isTriggerYear) {
    const fallbackSurplus = Math.max(0, baseAssessed - newAssessed - newDeposit);
    const totalSurplus = Math.max(0, tr.downsizingActualSurplusCash ?? fallbackSurplus);
    // [Phase G1 Guard] 순수 개인(cRatio===0)일 때는 매각 잉여금이 법인으로 증발하지 않도록 전액 개인 귀속
    const effectiveCorpShare =
      corporateRatioPercent <= 0
        ? 0
        : corporateRatioPercent >= 100
          ? 1
          : Math.min(100, Math.max(0, tr.downsizingCorpAllocationRatio ?? corporateRatioPercent)) /
            100;
    downsizingCorpCashInflow = Math.round(totalSurplus * effectiveCorpShare);
    downsizingPersonalCashInflow = totalSurplus - downsizingCorpCashInflow;
  }

  return {
    effectiveAssessedValue: newAssessed,
    effectiveLeaseDeposit: newDeposit,
    annualRentOutflow: newMonthlyRent * 12,
    annualHousingPensionInflow: 0,
    downsizingPersonalCashInflow,
    downsizingCorpCashInflow,
  };
}

export function calculateCurrentShelteredTotal(
  accounts: AccountAssetInputs,
  hasSpouse = true
): number {
  return (
    Math.max(0, accounts.selfIsaBalance || 0) +
    Math.max(0, accounts.selfPersonalPensionBalance || 0) +
    Math.max(0, accounts.selfRetirementPensionBalance || 0) +
    (hasSpouse
      ? Math.max(0, accounts.spouseIsaBalance || 0) +
        Math.max(0, accounts.spousePersonalPensionBalance || 0) +
        Math.max(0, accounts.spouseRetirementPensionBalance || 0)
      : 0)
  );
}

const NON_DOMESTIC_EQUITY_KRX_RE =
  /미국|나스닥|NASDAQ|S&P|글로벌|차이나|중국|항셍|일본|니케이|인도|베트남|유럽|선진국|신흥국|해외|월드|필라델피아|빅테크|테슬라|엔비디아|애플|마이크로소프트|채권|국채|국고채|회사채|단기채|종합채|물가채|전단채|금융채|특수채|머니마켓|MMF|CD|KOFR|SOFR|금리|파킹|골드|금현물|은현물|원유|구리|농산물|원자재|커머디티|리츠|REIT|인버스|레버리지|선물|2X|블룸버그|다우존스|러셀|스트립|하이일드|달러|엔화|환헤지/i;

export function classifyKrxEtfTaxProfile(h: EtfHolding): {
  isKrxTaxableGain: boolean;
  defaultTaxStandardRatio: number;
} {
  if (h.market !== 'KRX') {
    return { isKrxTaxableGain: false, defaultTaxStandardRatio: 1.0 };
  }

  const name = h.name || '';
  const hasNonDomesticUnderlying = NON_DOMESTIC_EQUITY_KRX_RE.test(name);
  const isCoveredCall =
    h.productType === 'covered_call' ||
    h.category === 'COVERED_CALL' ||
    /커버드콜|프리미엄|타겟데일리|타겟위클리/i.test(name);

  if (isCoveredCall) {
    if (!hasNonDomesticUnderlying) {
      // 순수 국내 지수 기초 커버드콜 (예: KODEX 200타겟위클리커버드콜):
      // 장내 옵션프리미엄 및 국내주식 매매차익 비과세 (소득세법 시행령 §26의3)
      return { isKrxTaxableGain: false, defaultTaxStandardRatio: 0.25 };
    } else {
      // 해외/채권 기초 국내상장 커버드콜 (예: 458760 TIGER 미국배당+7%프리미엄다우존스):
      // 장외 옵션프리미엄 및 해외배당 과세 대상 (기본 과표 0.95 적용)
      return { isKrxTaxableGain: true, defaultTaxStandardRatio: 0.95 };
    }
  }

  if (
    h.category === 'DOMESTIC_INDEX' ||
    h.category === 'DOMESTIC_EQUITY' ||
    h.category === 'KR_INDEX'
  ) {
    return { isKrxTaxableGain: false, defaultTaxStandardRatio: 1.0 };
  }

  if ((h.category === 'OTHER' || !h.category) && !hasNonDomesticUnderlying) {
    // 순수 국내 섹터/지수 ETF (예: 229200 KODEX 코스닥150, 091160 KODEX 반도체, 396500 TIGER 반도체TOP10 등)
    return { isKrxTaxableGain: false, defaultTaxStandardRatio: 1.0 };
  }

  // 그 외: KRX 해외지수(360750 등), 채권(273130 등), 파킹/금리(488770 등), 레버리지/인버스(122630 등)
  return { isKrxTaxableGain: true, defaultTaxStandardRatio: 1.0 };
}

export function evaluateHoldingsList(holdings: EtfHolding[]): PortfolioEvaluationSummary | null {
  if (!holdings || holdings.length === 0) return null;
  const totalAmt = holdings.reduce((acc, h) => acc + Math.max(0, h.amount || 0), 0);
  if (totalAmt <= 0) return null;
  let weightedGrowth = 0;
  let weightedDiv = 0;
  let weightedTaxableDiv = 0;
  let weightedExpense = 0;
  let overseasAmt = 0;
  let krxTaxableGainAmt = 0;
  for (const h of holdings) {
    const amt = Math.max(0, h.amount || 0);
    const w = amt / totalAmt;
    const divYield = h.dividendYield || 0;
    const profile = classifyKrxEtfTaxProfile(h);
    const taxStd =
      h.taxStandardRatio !== undefined
        ? Math.min(1, Math.max(0, h.taxStandardRatio))
        : profile.defaultTaxStandardRatio;
    weightedGrowth += (h.expectedGrowthRate || 0) * w;
    weightedDiv += divYield * w;
    weightedTaxableDiv += divYield * w * taxStd;
    weightedExpense += (h.actualExpenseRatio ?? h.expenseRatio ?? 0) * w;
    if (h.market === 'US' || h.productType === 'overseas_direct') {
      overseasAmt += amt;
    } else if (h.market === 'KRX' && profile.isKrxTaxableGain) {
      // KRX 상장 기타 ETF (해외지수·채권·해외커버드콜·리츠 등): 개인 일반계좌 매도 시 매매차익 15.4% 배당소득세 과세 대상
      krxTaxableGainAmt += amt;
    }
  }
  const netGrowth = Math.max(-50, weightedGrowth - weightedExpense);
  const overseasDirectRatio = Math.round((overseasAmt / totalAmt) * 1000) / 10;
  const taxableDividendRatio =
    weightedDiv > 0 ? Number(Math.min(1, Math.max(0, weightedTaxableDiv / weightedDiv)).toFixed(4)) : 1;
  const krxTaxableGainRatio = Number(Math.min(1, Math.max(0, krxTaxableGainAmt / totalAmt)).toFixed(4));
  return {
    effectiveGrowthRate: Number(netGrowth.toFixed(2)),
    effectiveDividendYield: Number(weightedDiv.toFixed(2)),
    effectiveTotalReturn: Number((netGrowth + weightedDiv).toFixed(2)),
    weightedExpenseRatio: Number(weightedExpense.toFixed(3)),
    overseasDirectRatio,
    estimatedFirstYearMonthlyDividend: Math.round((totalAmt * (weightedDiv / 100)) / 12),
    taxableDividendRatio,
    krxTaxableGainRatio,
  };
}

export function evaluatePortfolio(asset: BasicAssetInputs): PortfolioEvaluationSummary {
  if (asset.inputMode === 'detailed' && asset.holdings && asset.holdings.length > 0) {
    const detailedEval = evaluateHoldingsList(asset.holdings);
    if (detailedEval) return detailedEval;
  }

  const growth = asset.growthRate ?? 6.0;
  const div = asset.dividendYield ?? 4.0;
  const rawGrowthRatio = Math.min(100, Math.max(0, asset.growthEtfRatio ?? 70));
  const rawDivRatio = Math.min(
    100,
    Math.max(0, asset.dividendEtfRatio ?? 100 - rawGrowthRatio)
  );
  const ratioSum = rawGrowthRatio + rawDivRatio > 0 ? rawGrowthRatio + rawDivRatio : 100;
  const wGrowth = rawGrowthRatio / ratioSum;
  const wDiv = rawDivRatio / ratioSum;
  const effectiveGrowthRate = Number((growth * wGrowth).toFixed(2));
  const effectiveDividendYield = Number((div * wDiv).toFixed(2));

  return {
    effectiveGrowthRate,
    effectiveDividendYield,
    effectiveTotalReturn: Number((effectiveGrowthRate + effectiveDividendYield).toFixed(2)),
    weightedExpenseRatio: 0,
    overseasDirectRatio: asset.overseasEtfRatio ?? 70,
    estimatedFirstYearMonthlyDividend: Math.round(
      (Math.max(0, asset.totalInvestment || 0) * (effectiveDividendYield / 100)) / 12
    ),
    taxableDividendRatio: 1,
    krxTaxableGainRatio: 0,
  };
}

export function evaluateShelteredPortfolio(
  accounts: AccountAssetInputs,
  fallbackSummary: PortfolioEvaluationSummary
): PortfolioEvaluationSummary {
  if (accounts.shelteredHoldings && accounts.shelteredHoldings.length > 0) {
    const detailed = evaluateHoldingsList(accounts.shelteredHoldings);
    if (detailed) return detailed;
  }
  return fallbackSummary;
}

export function getStressAdjustedGrowthRate(
  scenario: MarketStressScenarioType,
  yearsSinceRetirement: number,
  baseGrowthRatePercent: number
): number {
  if (yearsSinceRetirement < 0 || scenario === 'none') {
    return baseGrowthRatePercent;
  }
  const schedules: Record<Exclude<MarketStressScenarioType, 'none'>, number[]> = {
    early_drop_20: [-20, -5, 12, 10],
    early_drop_30: [-30, -10, 15, 12],
    dotcom_crash: [-15, -18, -22, 18, 12],
    gfc_2008: [-35, 20, 12],
    stagflation: [-8, -6, -4, -2, 2],
  };
  const seq = schedules[scenario];
  if (yearsSinceRetirement < seq.length) {
    return seq[yearsSinceRetirement];
  }
  return baseGrowthRatePercent;
}
