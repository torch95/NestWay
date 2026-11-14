import {
  BASE_SEVERANCE_EFFECTIVE_TAX_RATE,
  CORPORATE_CAPITAL_REGISTRATION_TAX_RATE,
  CORPORATE_DIVIDEND_GROSS_UP_RATE_2027,
  CORPORATE_NOL_CARRYFORWARD_YEARS,
  CORPORATE_NOL_DEDUCTION_CAP_RATIO,
  DIVIDEND_WITHHOLDING_TAX_RATE,
  EFFECTIVE_HEALTH_INSURANCE_RATE,
  HEALTH_INSURANCE_BASE_RATE,
  HEALTH_INSURANCE_FINANCIAL_INCOME_CLIFF,
  ISA_LIFETIME_CAP_PER_PERSON,
  ISA_TAX_EXEMPT_GAIN_GENERAL,
  LIFE_EXPECTANCY_AGE,
  LONG_TERM_CARE_INSURANCE_RATIO,
  PENSION_ELIGIBLE_AGE,
  PERSONAL_PENSION_ANNUAL_CAP_PER_PERSON,
  PERSONAL_PENSION_LOW_TAX_THRESHOLD,
  PERSONAL_PENSION_HIGH_SEPARATE_RATE,
  PERSONAL_PENSION_RATE_70_TO_79,
  PERSONAL_PENSION_RATE_80_PLUS,
  PERSONAL_PENSION_RATE_UNDER_70,
  PERSONAL_PENSION_SAVINGS_CREDIT_CAP_PER_PERSON,
  REGIONAL_HEALTH_MAX_MONTHLY_PREMIUM_KRW,
  WORKPLACE_MIN_MONTHLY_SALARY_PER_EXEC,
} from './constants';
import {
  calculateAnnualPublicPension,
  evaluatePortfolio,
  evaluateRealEstateForYear,
  evaluateShelteredPortfolio,
  getStressAdjustedGrowthRate,
} from './pensionAndEtf';
import {
  calculateAnnualPropertyHoldingTax,
  calculateCorporateTax,
  calculateHouseholdCombinedTax,
  calculateHouseholdPersonalPensionTaxByPerson,
  calculateIndividualCombinedTax,
  calculateRetirementIncomeTax,
  calculateIsaTax,
  calculateOverseasCapitalGainsTax,
  calculateRegionalHealthInsurance,
  calculateWorkplaceNonSalaryHealthInsurance,
  evaluateDependentEligibility,
  getDeferredSeveranceTaxMultiplier,
  householdHealthFinancialIncome,
  solveExecutivePayroll,
  type ExecutivePayrollResult,
} from './taxAndHealth';
import {
  calculateCurrentLiquidAssets,
  getMonthlyLivingExpenseForAge,
  normalizeCashflow,
  type CanonicalLedgerRunResult,
  type CanonicalYearRow,
  type CorporateTaxType,
  type DayOneBlueprint,
  type SimulationInputs,
} from './types';

export interface CorporateExitBreakdown {
  /** 청산·분배 시 법인 단계 법인세: 미실현이익(잔액 − 원가) + 미납 실현이익을 분배 연수에 걸쳐 실현 */
  latentCorporateTax: number;
  /** 출자금(가수금) 비과세 환급 — 의제배당 계산 시 주식 취득가액 차감(소득세법 §17②) */
  capitalReturn: number;
  /** 의제배당(잔여재산 분배액 − 출자금, 소득세법 §17①3·②) */
  deemedDividend: number;
  /** 의제배당 인별(지분 균등)·연도별 균등 분할 금융소득종합과세(§14·§62 비교과세, §17③·§56 Gross-up·배당세액공제) */
  dividendTax: number;
  /** 분배 연도 지역 소득보험료 증분(인별 금융소득 1,000만 초과분 전액 부과, 월 상한·장기요양 반영) */
  extraHealthInsurance: number;
  netValue: number;
}

/** 원장·출구 매트릭스 공통 분배 연수: 일시 청산 1년, 그 외(분할 배당·지분승계)는 분할 연수(기본 10년) */
export function getCorporateExitDistributionYears(corporate: SimulationInputs['corporate']): number {
  if (corporate.exitStrategy === 'lump_sum_liquidation') return 1;
  return Math.max(1, Math.round(corporate.phasedExitDurationYears || 10));
}

function splitEvenly(total: number, parts: number): { base: number; last: number } {
  const base = Math.floor(total / parts);
  return { base, last: total - base * (parts - 1) };
}

/**
 * E-3/G2: 임원 보수 노사 비용 — 국민연금 사업장가입(60세 미만, 국민연금법 §8)을 임원별 만 나이로 판정.
 * 부부 공동임원의 나이가 60세를 사이에 두면 1인씩 산출해 합산. 원장·손익분기·임원 구조 비교가 같은 함수를 사용.
 */
export function solveHouseholdExecutivePayroll(
  targetMonthlyNetPerExec: number,
  executiveCount: 1 | 2,
  ageSelf: number,
  ageSpouse: number,
  elapsedYears: number
): ExecutivePayrollResult & {
  spouseEarnedIncomeTaxableBase: number;
  selfMonthlyGrossPerPerson: number;
  spouseMonthlyGrossPerPerson: number;
} {
  if (executiveCount === 2 && (ageSelf < 60) !== (ageSpouse < 60)) {
    const selfPay = solveExecutivePayroll(targetMonthlyNetPerExec, 1, ageSelf, elapsedYears);
    const spousePay = solveExecutivePayroll(targetMonthlyNetPerExec, 1, ageSpouse, elapsedYears);
    return {
      ...selfPay,
      executiveCount: 2,
      annualTotalGrossSalary: selfPay.annualTotalGrossSalary + spousePay.annualTotalGrossSalary,
      annualTotalNetSalary: selfPay.annualTotalNetSalary + spousePay.annualTotalNetSalary,
      annualEarnedIncomeTax: selfPay.annualEarnedIncomeTax + spousePay.annualEarnedIncomeTax,
      annualEmployeeInsurance: selfPay.annualEmployeeInsurance + spousePay.annualEmployeeInsurance,
      annualEmployerInsurance: selfPay.annualEmployerInsurance + spousePay.annualEmployerInsurance,
      annualWorkplaceHealthInsTotal:
        selfPay.annualWorkplaceHealthInsTotal + spousePay.annualWorkplaceHealthInsTotal,
      annualTotalCorporatePayrollCost:
        selfPay.annualTotalCorporatePayrollCost + spousePay.annualTotalCorporatePayrollCost,
      spouseEarnedIncomeTaxableBase: spousePay.earnedIncomeTaxableBasePerPerson,
      selfMonthlyGrossPerPerson: selfPay.monthlyGrossPerPerson,
      spouseMonthlyGrossPerPerson: spousePay.monthlyGrossPerPerson,
    };
  }
  const pay = solveExecutivePayroll(targetMonthlyNetPerExec, executiveCount, ageSelf, elapsedYears);
  return {
    ...pay,
    spouseEarnedIncomeTaxableBase: pay.earnedIncomeTaxableBasePerPerson,
    selfMonthlyGrossPerPerson: pay.monthlyGrossPerPerson,
    spouseMonthlyGrossPerPerson: pay.monthlyGrossPerPerson,
  };
}

/**
 * 법인 청산가치 (가정: 지분 균등 shareholderCount명, distributionYears년 균등 분배, 분배 연도에 다른 종합소득 없음, 명목 합계·할인 없음)
 */
export function resolveCorporateExitBreakdown(p: {
  corpBalance: number;
  costBasis: number;
  paidInCapital: number;
  pendingRealizedGain: number;
  taxType: CorporateTaxType;
  liquidationTaxMode: 'simple_gross' | 'capital_return_exempt';
  shareholderCount: 1 | 2;
  distributionYears: number;
  carryforwardLoss?: number;
  grossUpRate?: number;
}): CorporateExitBreakdown {
  const bal = Math.max(0, Math.round(p.corpBalance));
  if (bal <= 0) {
    return {
      latentCorporateTax: 0,
      capitalReturn: 0,
      deemedDividend: 0,
      dividendTax: 0,
      extraHealthInsurance: 0,
      netValue: 0,
    };
  }
  const years = Math.max(1, Math.round(p.distributionYears));
  const rawGain = Math.max(0, bal - Math.max(0, Math.round(p.costBasis)) + Math.round(p.pendingRealizedGain));
  let gain = rawGain;
  if (p.carryforwardLoss && p.carryforwardLoss > 0) {
    const nolOffset = Math.min(
      Math.floor(rawGain * CORPORATE_NOL_DEDUCTION_CAP_RATIO),
      Math.max(0, Math.round(p.carryforwardLoss))
    );
    gain = Math.max(0, rawGain - nolOffset);
  }
  const g = splitEvenly(gain, years);
  const latentCorporateTax = Math.min(
    bal,
    calculateCorporateTax(g.base, p.taxType) * (years - 1) + calculateCorporateTax(g.last, p.taxType)
  );
  const distributable = bal - latentCorporateTax;
  const capitalReturn =
    p.liquidationTaxMode === 'capital_return_exempt'
      ? Math.min(distributable, Math.max(0, Math.round(p.paidInCapital)))
      : 0;
  const deemedDividend = distributable - capitalReturn;
  const parts = years * p.shareholderCount;
  const d = splitEvenly(deemedDividend, parts);
  const taxOn = (amt: number) =>
    calculateIndividualCombinedTax(amt, 0, 0, amt, p.grossUpRate).dividendTax;
  const dividendTax = taxOn(d.base) * (parts - 1) + taxOn(d.last);
  // 분배 연도 지역 소득보험료 증분: 인별 금융소득 1,000만 초과 시 전액 부과(시행규칙 §44①), 세대 월 상한(고시) 후 장기요양 가산
  const perYearDividend = deemedDividend / years;
  const assessable =
    perYearDividend / p.shareholderCount > HEALTH_INSURANCE_FINANCIAL_INCOME_CLIFF ? perYearDividend : 0;
  const yearlyHealth =
    Math.min(REGIONAL_HEALTH_MAX_MONTHLY_PREMIUM_KRW * 12, assessable * HEALTH_INSURANCE_BASE_RATE) *
    (1 + LONG_TERM_CARE_INSURANCE_RATIO);
  const extraHealthInsurance = Math.min(
    distributable - dividendTax,
    Math.round(yearlyHealth * years)
  );
  return {
    latentCorporateTax,
    capitalReturn,
    deemedDividend,
    dividendTax,
    extraHealthInsurance,
    netValue: distributable - dividendTax - extraHealthInsurance,
  };
}

/** E-2: 개인 연금계좌 청산세 정밀화 옵션 (미지정 시 기존 잔고 일괄 3.3% 유지) */
export interface PersonalExitTaxOptions {
  /** 연금계좌(IRP+연금저축) 잔고 중 본인 귀속 비율(0~1), 나머지는 배우자 귀속. hasSpouse=false면 1로 간주 */
  pensionSelfShare: number;
  /** 잔고 균등 분할 수령 연수 — 법인 출구와 같은 연수를 써서 전략 간 대칭 */
  distributionYears: number;
  /** 비세액공제 연금저축 원금 (소득세법 시행령 §40의2③: 0% 비과세 반환) */
  uncreditedPensionBasis?: number;
  /** KRX 상장 기타 ETF(해외지수·채권·해외커버드콜 등) 매매차익 과표 비중 (0~1) */
  krxTaxableGainRatio?: number;
}

export function resolvePersonalExitNetWorth(
  endTaxable: number,
  taxableBasis: number,
  overseasRatio: number,
  endIrp: number,
  endPersonalPension: number,
  hasSpouse = false,
  options?: PersonalExitTaxOptions
): number {
  const taxableBal = Math.max(0, Math.round(endTaxable));
  const basis = Math.max(0, Math.round(taxableBasis));
  const ovRatio = Math.min(1, Math.max(0, overseasRatio));
  const unrealizedGain = Math.max(0, taxableBal - basis);
  const overseasUnrealizedGain = Math.round(unrealizedGain * ovRatio);
  const latentOverseasTax = calculateOverseasCapitalGainsTax(overseasUnrealizedGain, hasSpouse);

  let latentKrxExitCost = 0;
  if (options && (options.krxTaxableGainRatio ?? 0) > 0 && unrealizedGain > 0) {
    const krxRatio = Math.min(Math.max(0, 1 - ovRatio), Math.max(0, options.krxTaxableGainRatio ?? 0));
    const krxUnrealizedGain = Math.round(unrealizedGain * krxRatio);
    if (krxUnrealizedGain > 0) {
      const years = Math.max(1, Math.round(options.distributionYears));
      const persons = hasSpouse ? 2 : 1;
      const perPersonPerYear = Math.round(krxUnrealizedGain / persons / years);
      const annualDivTaxPerPerson = calculateIndividualCombinedTax({
        taxableDividend: perPersonPerYear,
        corpDividend: 0,
        publicPension: 0,
        otherTaxableBase: 0,
      }).totalTax;
      const annualExtraNhisPerPerson =
        perPersonPerYear > HEALTH_INSURANCE_FINANCIAL_INCOME_CLIFF
          ? Math.round((perPersonPerYear / 12) * EFFECTIVE_HEALTH_INSURANCE_RATE) * 12
          : 0;
      latentKrxExitCost = (annualDivTaxPerPerson + annualExtraNhisPerPerson) * persons * years;
    }
  }

  const netTaxable = Math.max(0, taxableBal - latentOverseasTax - latentKrxExitCost);

  const pensionBal =
    Math.max(0, Math.round(endIrp)) + Math.max(0, Math.round(endPersonalPension));
  let latentPensionTax = Math.round(pensionBal * PERSONAL_PENSION_RATE_80_PLUS);
  if (options && pensionBal > 0) {
    const uncredited = Math.min(
      pensionBal,
      Math.max(0, Math.round(options.uncreditedPensionBasis ?? 0))
    );
    const taxablePensionBal = Math.max(0, pensionBal - uncredited);
    // 인별 연 1,500만 이하 3.3% 저율 분리과세, 초과분 16.5% 분리과세 (소득세법 §64의4) — 분할연수 동안 균등 수령 가정
    const years = Math.max(1, Math.round(options.distributionYears));
    const selfShare = hasSpouse ? Math.min(1, Math.max(0, options.pensionSelfShare)) : 1;
    const taxForPerson = (bal: number) => {
      const perYear = bal / years;
      const low = Math.min(perYear, PERSONAL_PENSION_LOW_TAX_THRESHOLD);
      return years * (low * PERSONAL_PENSION_RATE_80_PLUS + (perYear - low) * PERSONAL_PENSION_HIGH_SEPARATE_RATE);
    };
    latentPensionTax = Math.round(
      taxForPerson(taxablePensionBal * selfShare) + taxForPerson(taxablePensionBal * (1 - selfShare))
    );
  }
  const netPension = Math.max(0, pensionBal - latentPensionTax);

  return netTaxable + netPension;
}

/**
 * 단일 정규 5대 바스켓 원장 커널 (Single Canonical 5-Basket Ledger Kernel)
 * 개인 100%, 법인 100%, 하이브리드 최적해(r*) 전 전략을 단 하나의 연차 전이 루프로 구동한다.
 */
export function runCanonicalLedger(
  rawInputs: SimulationInputs,
  overridePersonalRatio?: number
): CanonicalLedgerRunResult {
  const inputs: SimulationInputs = {
    ...rawInputs,
    cashflow: normalizeCashflow(rawInputs.cashflow),
  };

  const hasSpouse = inputs.pension.hasSpouse ?? true;
  const pRatio = Math.min(
    100,
    Math.max(0, Math.round(overridePersonalRatio ?? inputs.hybrid.personalRatio ?? 50))
  );
  const cRatio = 100 - pRatio;

  const currentAgeSelf = Math.min(
    LIFE_EXPECTANCY_AGE,
    Math.max(20, Math.round(inputs.pension.currentAgeSelf || 50))
  );
  const currentAgeSpouse = Math.max(20, Math.round(inputs.pension.currentAgeSpouse || 48));
  const targetRetirementAgeSelf = Math.max(
    currentAgeSelf,
    Math.round(inputs.transition.targetRetirementAgeSelf || currentAgeSelf)
  );
  const horizonYears = LIFE_EXPECTANCY_AGE - currentAgeSelf + 1;
  const corpDeferred =
    inputs.corporate.injectionTiming === 'retirement' && targetRetirementAgeSelf > currentAgeSelf;
  const preRetPRatio = corpDeferred ? 100 : pRatio;

  const portfolio = evaluatePortfolio(inputs.asset);
  const rawPortfolioGrowth = portfolio.effectiveGrowthRate;
  // 수익률 시나리오 시프트(%p): 여기(일반·법인 → 대칭 절세계좌)와 아래 계좌별 지정 수익률에서만 가산
  const returnShift = inputs.asset.returnShiftPct ?? 0;
  const baseGrowthRate = portfolio.effectiveGrowthRate + returnShift;
  const baseDivYield = portfolio.effectiveDividendYield;
  const overseasRatio = Math.min(1, Math.max(0, portfolio.overseasDirectRatio / 100));
  const taxableDivRatio = Math.min(1, Math.max(0, portfolio.taxableDividendRatio ?? 1));
  const krxTaxableGainRatio = Math.min(1, Math.max(0, portfolio.krxTaxableGainRatio ?? 0));
  const acc = inputs.accounts;
  const useCustomAccountRates = Boolean(inputs.accounts.overrideSymmetricAccountReturns);
  const shelteredPortfolio =
    acc.shelteredInputMode === 'detailed' ? evaluateShelteredPortfolio(acc, portfolio) : null;

  // 초기 5대 바스켓 시드 (3-A & 4-A):
  // - 기존 절세계좌(IRP, ISA, 연금저축)는 개인 명의 계좌에 그대로 보존
  // - 자유 투자 금융자산(totalInvestment)만 pRatio : cRatio 비율로 개인 일반과세계좌와 법인(출자원금)에 배분
  let irp =
    Math.max(0, Math.round(acc.selfRetirementPensionBalance || 0)) +
    (hasSpouse ? Math.max(0, Math.round(acc.spouseRetirementPensionBalance || 0)) : 0);

  const initialConfiguredIsa =
    Math.max(0, Math.round(acc.selfIsaBalance || 0)) +
    (hasSpouse ? Math.max(0, Math.round(acc.spouseIsaBalance || 0)) : 0);
  const initialConfiguredPersonalPension =
    Math.max(0, Math.round(acc.selfPersonalPensionBalance || 0)) +
    (hasSpouse ? Math.max(0, Math.round(acc.spousePersonalPensionBalance || 0)) : 0);
  const initialFreeInvestment = Math.max(0, Math.round(inputs.asset.totalInvestment || 0));

  let isa = initialConfiguredIsa;
  let isaBasis = isa;
  const rawSelfOwnPct = inputs.asset.selfOwnershipPercent;
  const generalSelfShare = hasSpouse ? Math.min(1, Math.max(0, (rawSelfOwnPct ?? 50) / 100)) : 1;
  const explicitSelfShare =
    hasSpouse && rawSelfOwnPct !== undefined && rawSelfOwnPct !== 50 ? generalSelfShare : undefined;

  const selfHasIsa = (acc.selfIsaBalance || 0) > 0 || (acc.selfIsaAnnualAddition || 0) > 0;
  const spouseHasIsa =
    hasSpouse && ((acc.spouseIsaBalance || 0) > 0 || (acc.spouseIsaAnnualAddition || 0) > 0);
  const activeIsaPersons = Math.max(1, (selfHasIsa ? 1 : 0) + (spouseHasIsa ? 1 : 0));
  // [GAP-06] ISA 비과세 한도(조특법 §91의18: 일반형 200만/인, 부부 합산 400만)는 연도별 리셋이 아닌 통산 누적 한도로 관리
  let isaRemainingExemptGain =
    ISA_TAX_EXEMPT_GAIN_GENERAL *
    (initialConfiguredIsa === 0 && !selfHasIsa && !spouseHasIsa ? (hasSpouse ? 2 : 1) : activeIsaPersons);
  let personalPension = initialConfiguredPersonalPension;
  let taxable = Math.round(initialFreeInvestment * (preRetPRatio / 100));
  let taxableBasis = taxable;
  let corp = initialFreeInvestment - taxable;
  let corpPaidInCapital = corp;
  // A1: 법인 투자자산 취득원가(실현주의 과세 기준) — 출자·이전 원금과 재투자 배당은 가산, 현금 유출 시 비례 차감
  let corpBasis = corp;
  const isCapitalStockMode = inputs.corporate.fundingStructure === 'capital_stock';
  const applyCorpCapitalRegTax = (injectedAmt: number): number => {
    if (!isCapitalStockMode || injectedAmt <= 0) return 0;
    const regTax = Math.min(corp, Math.round(injectedAmt * CORPORATE_CAPITAL_REGISTRATION_TAX_RATE));
    corp -= regTax;
    corpPaidInCapital = Math.max(0, corpPaidInCapital - regTax);
    corpBasis = Math.max(0, corpBasis - regTax);
    return regTax;
  };
  const corpNolBuckets: Array<{ idx: number; amount: number }> = [];
  // 배당·가수금·법인세 납부를 위한 매도 실현차익은 다음 해 법인세 신고 때 과세(법인세법 §60 사업연도 종료 후 3개월 내 신고)
  let corpPendingRealizedGain = 0;
  let corpDividendCash = 0; // 당해 수령 배당 현금: 유출에 먼저 충당하며 실현차익이 생기지 않음
  const corpShareholderCount: 1 | 2 = hasSpouse ? 2 : 1;
  const corpExitYears = getCorporateExitDistributionYears(inputs.corporate);
  const isCorpYearlyRecognition = inputs.corporate.taxRecognitionMode === 'yearly';
  /** 법인 현금 유출 amount의 실현차익(음수 = 실현손실). corp 차감 전에 호출 */
  const realizeCorpOutflow = (amount: number): number => {
    if (amount <= 0 || corp <= 0) return 0;
    const out = Math.min(amount, corp);
    const fromCash = Math.min(out, corpDividendCash);
    corpDividendCash -= fromCash;
    const cashBasis = Math.min(corpBasis, fromCash);
    const fromSale = out - fromCash;
    const saleBasis =
      fromSale > 0 && corp - fromCash > 0
        ? Math.round(((corpBasis - cashBasis) * fromSale) / (corp - fromCash))
        : 0;
    corpBasis = Math.max(0, corpBasis - cashBasis - saleBasis);
    return fromSale - saleBasis;
  };

  let selfIsaPrincipal = Math.min(
    ISA_LIFETIME_CAP_PER_PERSON,
    Math.max(0, Math.round(acc.selfIsaBalance || 0))
  );
  let spouseIsaPrincipal = hasSpouse
    ? Math.min(ISA_LIFETIME_CAP_PER_PERSON, Math.max(0, Math.round(acc.spouseIsaBalance || 0)))
    : 0;

  const currentLiquidCapital = calculateCurrentLiquidAssets(inputs);
  const inflationRate = (inputs.transition.inflationRate ?? 2.5) / 100;
  const isRealView = inputs.transition.viewMode === 'real';
  const liquidationMode = inputs.corporate.liquidationTaxMode ?? 'capital_return_exempt';

  const effectiveExecCount: 1 | 2 = hasSpouse ? inputs.corporate.executiveCount : 1;
  const targetMonthlyNetPerExec = Math.max(
    WORKPLACE_MIN_MONTHLY_SALARY_PER_EXEC,
    Math.round(inputs.corporate.executiveSalaryMonthly || WORKPLACE_MIN_MONTHLY_SALARY_PER_EXEC)
  );

  // 1-d: 연금저축 바스켓은 부부 합산 단일 잔액이므로 납입 기여액 비율로 인별 지분을 추적해 1인당 1,500만 저율 한도를 적용
  let selfPensionContrib = Math.max(0, Math.round(acc.selfPersonalPensionBalance || 0));
  let spousePensionContrib = hasSpouse
    ? Math.max(0, Math.round(acc.spousePersonalPensionBalance || 0))
    : 0;
  const pensionSelfShare = () => {
    const tot = selfPensionContrib + spousePensionContrib;
    return tot > 0 ? selfPensionContrib / tot : 1;
  };
  // 1-a: 지역/직장 건보 소득월액은 전년도 소득 기준으로 부과되므로 법인 과세배당 및 국내기타ETF 매매차익은 다음 해 건보 베이스에 반영
  let prevYearExtraFinancialIncome = 0;
  let uncreditedPensionBasis = 0;
  let naiveBook = irp + isa + personalPension + taxable + corp;
  let naiveBasis = naiveBook;
  let prevNaiveExtraFin = 0;

  // 1-c: 퇴직소득 과세 계층 — D-Day 퇴직금의 법정 퇴직소득세(인별 근속연수·환산급여 공제)를 본인·배우자 각자 산출하고,
  //      IRP 잔액을 "이연퇴직소득 원금"(기존 IRP 잔액 + 이전 퇴직금)과 "운용수익"(연금소득세 대상)으로 분리 추적
  const selfSeveranceGross = Math.max(0, Math.round(inputs.transition.expectedSeverancePay || 0));
  const spouseSeveranceGross = hasSpouse
    ? Math.max(0, Math.round(inputs.transition.spouseExpectedSeverancePay || 0))
    : 0;
  const severanceGross = selfSeveranceGross + spouseSeveranceGross;
  const selfServiceYears = Math.max(
    1,
    Math.min(40, Math.round(inputs.transition.serviceYears ?? targetRetirementAgeSelf - 27))
  );
  const spouseAgeAtRetirement =
    currentAgeSpouse + Math.max(0, targetRetirementAgeSelf - currentAgeSelf);
  const spouseServiceYears = Math.max(
    1,
    Math.min(40, Math.round(inputs.transition.spouseServiceYears ?? spouseAgeAtRetirement - 27))
  );
  const selfSeveranceTaxInfo = calculateRetirementIncomeTax(selfSeveranceGross, selfServiceYears);
  const spouseSeveranceTaxInfo = calculateRetirementIncomeTax(
    spouseSeveranceGross,
    spouseServiceYears
  );
  const totalSeveranceTax = selfSeveranceTaxInfo.tax + spouseSeveranceTaxInfo.tax;
  const deferredSeveranceEffRate =
    severanceGross > 0 ? totalSeveranceTax / severanceGross : BASE_SEVERANCE_EFFECTIVE_TAX_RATE;
  let irpDeferredRemaining = irp; // 기존 IRP 잔액은 이전 직장 퇴직급여(이연퇴직소득)로 간주
  let irpSelfContrib = Math.max(0, Math.round(acc.selfRetirementPensionBalance || 0));
  let irpSpouseContrib = hasSpouse
    ? Math.max(0, Math.round(acc.spouseRetirementPensionBalance || 0))
    : 0;
  const irpSelfShare = () => {
    const tot = irpSelfContrib + irpSpouseContrib;
    return tot > 0 ? irpSelfContrib / tot : 1;
  };

  let blueprintSnapshot: DayOneBlueprint | null = null;
  const rows: CanonicalYearRow[] = [];

  for (let idx = 0; idx < horizonYears; idx++) {
    const yearIndex = idx + 1;
    const ageSelf = currentAgeSelf + idx;
    const ageSpouse = currentAgeSpouse + idx;
    const isEmployed = ageSelf < targetRetirementAgeSelf;
    const yearsSinceRetirement = ageSelf - targetRetirementAgeSelf;
    const discountFactor = isRealView ? 1 / Math.pow(1 + inflationRate, idx) : 1;

    // 은퇴 D-Day 원장 진입 시점: 퇴직금 유입 및 D-Day 청사진 스냅샷 기록 (3-A & 4-A)
    let dDaySeveranceInflow = 0;
    let dDaySeveranceLumpTax = 0; // 일시 수령 시 D-Day에 즉시 원천징수하는 퇴직소득세
    let dDayNetSeveranceAdded = 0;
    let dDayCorpTransferGross = 0;
    let dDayCorpTransferOvTax = 0;
    let dDayCorpTransferKrxTax = 0;
    let dDayOvRealizedGain = 0;
    let dDayKrxRealizedGain = 0;
    if (ageSelf === targetRetirementAgeSelf) {
      if (corpDeferred && cRatio > 0 && taxable > 0) {
        const gross = Math.round(taxable * (cRatio / 100));
        const gainRatio = Math.max(0, (taxable - taxableBasis) / taxable);
        const gain = Math.round(gross * gainRatio);
        dDayOvRealizedGain = Math.round(gain * overseasRatio);
        dDayKrxRealizedGain = Math.round(gain * krxTaxableGainRatio);
        dDayCorpTransferOvTax = calculateOverseasCapitalGainsTax(
          dDayOvRealizedGain,
          hasSpouse,
          explicitSelfShare
        );
        dDayCorpTransferKrxTax = Math.round(
          dDayKrxRealizedGain * DIVIDEND_WITHHOLDING_TAX_RATE
        );
        const net = gross - dDayCorpTransferOvTax - dDayCorpTransferKrxTax;
        const basisRemoved = Math.round((taxableBasis * gross) / taxable);
        taxable -= gross;
        taxableBasis = taxable > 0 ? Math.max(0, taxableBasis - basisRemoved) : 0;
        corp += net;
        corpPaidInCapital += net;
        corpBasis += net;
        dDayCorpTransferGross = gross;
      }
      dDaySeveranceInflow = severanceGross;
      if (dDaySeveranceInflow > 0) {
        if (inputs.transition.severanceTransferToIrp) {
          irp += dDaySeveranceInflow;
          irpDeferredRemaining += dDaySeveranceInflow;
          irpSelfContrib += selfSeveranceGross;
          irpSpouseContrib += spouseSeveranceGross;
          dDayNetSeveranceAdded = dDaySeveranceInflow;
        } else {
          // [Defect #5] 비-IRP 일시금 수령 시 D-Day 진입 시점에 인별 퇴직소득세를 원천징수 차감한 세후 금액(netSeverance)만 일반과세계좌에 산입
          dDaySeveranceLumpTax = totalSeveranceTax;
          dDayNetSeveranceAdded = Math.max(0, dDaySeveranceInflow - dDaySeveranceLumpTax);
          taxable += dDayNetSeveranceAdded;
          taxableBasis += dDayNetSeveranceAdded;
        }
      }

      const dDayTotal = irp + isa + personalPension + taxable + corp;
      blueprintSnapshot = {
        retirementAgeSelf: targetRetirementAgeSelf,
        yearsToRetirement: Math.max(0, targetRetirementAgeSelf - currentAgeSelf),
        currentLiquidCapital,
        totalCapitalAtRetirement: dDayTotal,
        personalRatio: pRatio,
        corporateRatio: cRatio,
        allocIrp: irp,
        allocIsa: isa,
        allocPersonalPension: personalPension,
        allocTaxable: taxable,
        allocCorporate: corp,
        corporatePaidInCapital: corpPaidInCapital,
        isaStrategySummary: '3년 의무보유 후 30년 만기 연장 (100세 영구 비과세/9.9% 분리과세 & 건보료 0원)',
      };
    }

    // D-Day 퇴직금 유입 전 기초 잔액 기록 (회계 항등식에서 dDaySeveranceInflow는 유입항에, dDaySeveranceLumpTax는 세금항에 계상)
    const startIrp =
      ageSelf === targetRetirementAgeSelf
        ? irp - (inputs.transition.severanceTransferToIrp ? dDayNetSeveranceAdded : 0)
        : irp;
    const startIsa = isa;
    const startPersonalPension = personalPension;
    const dDayCorpTransferTax = dDayCorpTransferOvTax + dDayCorpTransferKrxTax;
    const startTaxable =
      (ageSelf === targetRetirementAgeSelf
        ? taxable - (!inputs.transition.severanceTransferToIrp ? dDayNetSeveranceAdded : 0)
        : taxable) + dDayCorpTransferGross;
    const startCorp = corp - dDayCorpTransferGross + dDayCorpTransferTax;
    const startBookTotal = startIrp + startIsa + startPersonalPension + startTaxable + startCorp;

    let yearCapitalRegTax = 0;
    if (idx === 0 && isCapitalStockMode && corp > 0) {
      const r = applyCorpCapitalRegTax(corp);
      yearCapitalRegTax += r;
    }
    if (ageSelf === targetRetirementAgeSelf && dDayCorpTransferGross > 0) {
      const net = dDayCorpTransferGross - dDayCorpTransferOvTax - dDayCorpTransferKrxTax;
      if (net > 0) {
        const r = applyCorpCapitalRegTax(net);
        yearCapitalRegTax += r;
      }
    }

    // 1. 연간 투자수익 산출 (완전 대칭 공정 비교 기본값 적용)
    //    몬테카를로 연도별 충격(returnPathPct[idx], %p)은 시나리오 시프트와 동일하게 5대 계좌 수익률에 가산
    const yearShock = inputs.asset.returnPathPct?.[idx] ?? 0;
    const stressedRawGrowth = getStressAdjustedGrowthRate(
      inputs.transition.marketStressScenario,
      yearsSinceRetirement,
      rawPortfolioGrowth
    );
    const stressGrowthDelta = stressedRawGrowth - rawPortfolioGrowth;
    const activeGrowthRate = stressedRawGrowth + returnShift + yearShock;
    const portfolioTotalRate = (activeGrowthRate + baseDivYield) / 100;

    let isaRate: number;
    let pensionRate: number;
    let irpRate: number;
    if (useCustomAccountRates) {
      const irpStressScale = acc.applyIrpRiskAssetCap === false ? 1.0 : 0.7;
      isaRate = ((acc.isaExpectedReturnRate ?? 5.4) + stressGrowthDelta + returnShift + yearShock) / 100;
      pensionRate = ((acc.personalPensionReturnRate ?? 5.4) + stressGrowthDelta + returnShift + yearShock) / 100;
      irpRate = ((acc.irpExpectedReturnRate ?? acc.personalPensionReturnRate ?? 5.4) + stressGrowthDelta * irpStressScale + returnShift + yearShock) / 100;
    } else if (shelteredPortfolio !== null) {
      const irpStressScale = acc.applyIrpRiskAssetCap === false ? 1.0 : 0.7;
      const shTotal = shelteredPortfolio.effectiveTotalReturn;
      isaRate = (shTotal + stressGrowthDelta + returnShift + yearShock) / 100;
      pensionRate = (shTotal + stressGrowthDelta + returnShift + yearShock) / 100;
      const irpBase = acc.applyIrpRiskAssetCap === false ? shTotal : shTotal * 0.7 + 3.2 * 0.3;
      irpRate = (irpBase + stressGrowthDelta * irpStressScale + returnShift + yearShock) / 100;
    } else {
      isaRate = portfolioTotalRate;
      pensionRate = portfolioTotalRate;
      irpRate = portfolioTotalRate;
    }

    const irpReturn = Math.round(irp * irpRate);
    const isaReturn = Math.round(isa * isaRate);
    const personalPensionReturn = Math.round(personalPension * pensionRate);
    const taxableGrowthReturn = Math.round(taxable * (activeGrowthRate / 100));
    const taxableDivReturn = Math.round(taxable * (baseDivYield / 100));
    const taxableReturn = taxableGrowthReturn + taxableDivReturn;
    const corpGrowthReturn = Math.round(corp * (activeGrowthRate / 100));
    const corpDivReturn = Math.round(corp * (baseDivYield / 100));
    const corpReturn = corpGrowthReturn + corpDivReturn;

    irp = Math.max(0, irp + irpReturn);
    isa = Math.max(0, isa + isaReturn);
    personalPension = Math.max(0, personalPension + personalPensionReturn);
    taxable = Math.max(0, taxable + taxableReturn);
    // 결함 #4 교정: 배당 재투자분은 원가에 가산하되, 하락장 평가손실(Underwater: taxable < taxableBasis) 구간에서도 취득원가(taxableBasis)를 강제 삭감(Math.min)하지 않고 보존 (단, 잔고 0원 시 원가 0원)
    taxableBasis = taxable > 0 ? taxableBasis + Math.max(0, taxableDivReturn) : 0;
    corp = Math.max(0, corp + corpReturn);
    // A1: 실현주의는 수령 배당만 원가에 가산(성장분은 미실현), 매년 평가 과세(yearly)는 전체 수익을 인식해 원가 = 장부가 유지
    corpBasis =
      corp > 0 ? corpBasis + (isCorpYearlyRecognition ? corpReturn : Math.max(0, corpDivReturn)) : 0;
    corpDividendCash = Math.min(corp, Math.max(0, corpDivReturn));
    const carriedCorpRealizedGain = isCorpYearlyRecognition ? 0 : corpPendingRealizedGain;
    corpPendingRealizedGain = 0;

    const grossInvestmentReturn =
      irpReturn + isaReturn + personalPensionReturn + taxableReturn + corpReturn;

    // 2. 외부 현금 유입 (재직기 저축, 은퇴 해 퇴직급여, 부동산 전환, 국민연금, 주택연금)
    let annualEmploymentSavings = 0;
    if (isEmployed) {
      annualEmploymentSavings = Math.max(
        0,
        Math.round((inputs.transition.preRetirementMonthlySavings || 0) * 12)
      );

      // 3-A & 4-A: 1인당 누적 납입원금 1억 원 한도 내 ISA 우선 적립 ➔ 연금저축 적립 ➔ 잔여 저축액 pRatio:cRatio 배분
      const selfIsaRoom = Math.max(0, ISA_LIFETIME_CAP_PER_PERSON - selfIsaPrincipal);
      const spouseIsaRoom = hasSpouse
        ? Math.max(0, ISA_LIFETIME_CAP_PER_PERSON - spouseIsaPrincipal)
        : 0;
      const desiredSelfIsa = Math.min(
        selfIsaRoom,
        Math.max(0, Math.round(acc.selfIsaAnnualAddition || 0))
      );
      const desiredSpouseIsa = hasSpouse
        ? Math.min(spouseIsaRoom, Math.max(0, Math.round(acc.spouseIsaAnnualAddition || 0)))
        : 0;
      const toIsa = Math.min(annualEmploymentSavings, desiredSelfIsa + desiredSpouseIsa);
      const addSelfIsa = Math.min(toIsa, desiredSelfIsa);
      const addSpouseIsa = Math.max(0, toIsa - addSelfIsa);
      selfIsaPrincipal += addSelfIsa;
      spouseIsaPrincipal += addSpouseIsa;
      isa += toIsa;
      isaBasis += toIsa;

      const remAfterIsa = annualEmploymentSavings - toIsa;
      const desiredPenAdd =
        Math.min(
          PERSONAL_PENSION_ANNUAL_CAP_PER_PERSON,
          Math.max(0, Math.round(acc.selfPersonalPensionAnnualAddition || 0))
        ) +
        (hasSpouse
          ? Math.min(
              PERSONAL_PENSION_ANNUAL_CAP_PER_PERSON,
              Math.max(0, Math.round(acc.spousePersonalPensionAnnualAddition || 0))
            )
          : 0);
      const toPension = Math.min(remAfterIsa, desiredPenAdd);
      personalPension += toPension;
      {
        const selfDesired = Math.min(
          PERSONAL_PENSION_ANNUAL_CAP_PER_PERSON,
          Math.max(0, Math.round(acc.selfPersonalPensionAnnualAddition || 0))
        );
        const selfAdd = Math.min(toPension, selfDesired);
        const spouseAdd = toPension - selfAdd;
        selfPensionContrib += selfAdd;
        spousePensionContrib += spouseAdd;
        const selfUncredited = Math.max(
          0,
          selfAdd - PERSONAL_PENSION_SAVINGS_CREDIT_CAP_PER_PERSON
        );
        const spouseUncredited = Math.max(
          0,
          spouseAdd - PERSONAL_PENSION_SAVINGS_CREDIT_CAP_PER_PERSON
        );
        uncreditedPensionBasis += selfUncredited + spouseUncredited;
      }

      const remFree = remAfterIsa - toPension;
      const toTaxable = Math.round(remFree * (preRetPRatio / 100));
      const toCorp = remFree - toTaxable;
      taxable += toTaxable;
      taxableBasis += toTaxable;
      corp += toCorp;
      corpPaidInCapital += toCorp;
      corpBasis += toCorp;
      if (toCorp > 0) {
        const r = applyCorpCapitalRegTax(toCorp);
        yearCapitalRegTax += r;
      }
    }

    const savingsAndSeveranceInflow = annualEmploymentSavings + dDaySeveranceInflow;

    const reEval = evaluateRealEstateForYear(
      ageSelf,
      inputs.realEstate,
      isEmployed && corpDeferred ? 0 : cRatio
    );
    const realEstateCashInflow =
      reEval.downsizingPersonalCashInflow + reEval.downsizingCorpCashInflow;
    if (reEval.downsizingPersonalCashInflow > 0) {
      taxable += reEval.downsizingPersonalCashInflow;
      taxableBasis += reEval.downsizingPersonalCashInflow;
    }
    if (reEval.downsizingCorpCashInflow > 0) {
      corp += reEval.downsizingCorpCashInflow;
      corpPaidInCapital += reEval.downsizingCorpCashInflow;
      corpBasis += reEval.downsizingCorpCashInflow;
      const r = applyCorpCapitalRegTax(reEval.downsizingCorpCashInflow);
      yearCapitalRegTax += r;
    }

    // 1-b: 은퇴 후 법인 임원 재직 시 보수월액 사전 산출 (국민연금 재직자 감액 §63조의2 판정용)
    let execSelfGrossMonthly = 0;
    let execSpouseGrossMonthly = 0;
    if (!isEmployed && cRatio > 0 && corp > 0) {
      const targetMaint = Math.max(0, Math.round(inputs.corporate.annualFixedMaintenanceFee || 0));
      const availForPayroll = Math.max(0, corp - Math.min(corp, targetMaint));
      const peekPayroll = solveHouseholdExecutivePayroll(
        targetMonthlyNetPerExec,
        effectiveExecCount,
        ageSelf,
        ageSpouse,
        idx
      );
      if (availForPayroll >= peekPayroll.annualTotalCorporatePayrollCost) {
        execSelfGrossMonthly = peekPayroll.selfMonthlyGrossPerPerson ?? peekPayroll.monthlyGrossPerPerson;
        execSpouseGrossMonthly = peekPayroll.spouseMonthlyGrossPerPerson ?? peekPayroll.monthlyGrossPerPerson;
      }
    }

    // 2-A: 물가상승률 CPI 기산 시점을 현재 나이(50세 = idx 0)로 통일
    // E-5b: 노령연금 수급권(수급개시 연령 도달)은 재직 여부와 무관 — 본인 재직 중에도 본인·배우자 연금 유입
    const pubPen = calculateAnnualPublicPension({
      ageSelf,
      ageSpouse,
      elapsedYears: idx,
      inflationRatePercent: inputs.transition.inflationRate ?? 2.5,
      pension: inputs.pension,
      isPreRetirementEmployed: isEmployed,
      selfMonthlyWorkIncome: execSelfGrossMonthly,
      spouseMonthlyWorkIncome: effectiveExecCount === 2 ? execSpouseGrossMonthly : 0,
    });
    const publicPensionInflow = pubPen.totalAnnual;
    const housingPensionInflow = isEmployed ? 0 : reEval.annualHousingPensionInflow;

    const cpiLivingMultiplier = Math.pow(1 + inflationRate, idx);
    let lumpSumEventInflow = 0;
    let lumpSumEventOutflow = 0;
    const lumpSumEventLabels: string[] = [];
    const lumpSumInflowLabels: string[] = [];
    const lumpSumOutflowLabels: string[] = [];
    for (const evt of inputs.cashflow.lumpSumEvents || []) {
      if (Math.round(evt.ageSelf) === ageSelf && evt.amount > 0) {
        const nominalAmt = Math.round(evt.amount * cpiLivingMultiplier);
        if (evt.type === 'inflow') {
          lumpSumEventInflow += nominalAmt;
          const toTaxable = Math.round(nominalAmt * ((isEmployed ? preRetPRatio : pRatio) / 100));
          const toCorp = nominalAmt - toTaxable;
          taxable += toTaxable;
          taxableBasis += toTaxable;
          corp += toCorp;
          corpPaidInCapital += toCorp;
          corpBasis += toCorp;
          if (toCorp > 0) {
            const r = applyCorpCapitalRegTax(toCorp);
            yearCapitalRegTax += r;
          }
          if (evt.label) lumpSumInflowLabels.push(evt.label);
        } else {
          lumpSumEventOutflow += nominalAmt;
          if (evt.label) lumpSumOutflowLabels.push(evt.label);
        }
        if (evt.label) {
          lumpSumEventLabels.push(evt.label);
        }
      }
    }

    const totalExternalInflow =
      savingsAndSeveranceInflow +
      realEstateCashInflow +
      publicPensionInflow +
      housingPensionInflow +
      lumpSumEventInflow;

    // 3. 법인 운영: 유지비, 임원 보수 지급(5-A: 재직기 중 임원급여·건보료·법인유지비 0원), 법인세(6-A: realized 모드 통일)
    let corpMaintenanceAndFixedCost = 0;
    let stage2CorpNetSalary = 0;
    let corpPayrollTaxAndInsurance = 0;
    let corpCorporateTax = 0;
    let corpTaxUnpaidByCorp = 0; // E-1: 법인 잔고 부족분 → 주주(가계) 부담
    let corpRealizedSaleGain = 0; // 관측 전용: 성실신고 매출 판정용 과세 대상 실현 매매차익
    let isWorkplaceSubscriber = false;
    let execEarnedTaxableBase = 0; // 1-b: 임원 급여 과표 위에 배당·연금 소득을 누진 적층
    let spouseExecEarnedTaxableBase = 0; // E-3: 배우자 임원 과표(나이별 국민연금 공제 차이 반영)

    while (corpNolBuckets.length > 0 && idx - corpNolBuckets[0].idx > CORPORATE_NOL_CARRYFORWARD_YEARS) {
      corpNolBuckets.shift();
    }

    if (cRatio > 0 && (corp > 0 || carriedCorpRealizedGain !== 0)) {
      let corpRealizedGainThisYear = 0;
      if (corp > 0) {
        const targetMaint = Math.max(0, Math.round(inputs.corporate.annualFixedMaintenanceFee || 0));
        const baseMaint = isEmployed ? 0 : Math.min(corp, targetMaint);
        corpRealizedGainThisYear += realizeCorpOutflow(baseMaint);
        corp -= baseMaint;
        corpMaintenanceAndFixedCost = baseMaint + yearCapitalRegTax;

        if (!isEmployed) {
          const payroll = solveHouseholdExecutivePayroll(
            targetMonthlyNetPerExec,
            effectiveExecCount,
            ageSelf,
            ageSpouse,
            idx
          );
          if (corp >= payroll.annualTotalCorporatePayrollCost) {
            corpRealizedGainThisYear += realizeCorpOutflow(payroll.annualTotalCorporatePayrollCost);
            corp -= payroll.annualTotalCorporatePayrollCost;
            stage2CorpNetSalary = payroll.annualTotalNetSalary;
            corpPayrollTaxAndInsurance =
              payroll.annualTotalCorporatePayrollCost - payroll.annualTotalNetSalary;
            isWorkplaceSubscriber = true;
            execEarnedTaxableBase = payroll.earnedIncomeTaxableBasePerPerson;
            spouseExecEarnedTaxableBase = payroll.spouseEarnedIncomeTaxableBase;
          }
        }
      } else {
        corpMaintenanceAndFixedCost = yearCapitalRegTax;
      }

      const deductible =
        corpMaintenanceAndFixedCost + stage2CorpNetSalary + corpPayrollTaxAndInsurance;
      // A1: 실현주의 과세소득 = 수령 배당 + 당해 유지비·급여 매도 실현차익 + 전년도 유출(배당·가수금·법인세) 매도 실현차익
      const signedRealizedCorpIncome = isCorpYearlyRecognition
        ? corpReturn
        : Math.max(0, corpDivReturn) + corpRealizedGainThisYear + carriedCorpRealizedGain;
      corpRealizedSaleGain = isCorpYearlyRecognition ? 0 : corpRealizedGainThisYear + carriedCorpRealizedGain;

      const netCorpBeforeNol = signedRealizedCorpIncome - deductible;
      let taxableCorpIncome = 0;
      if (netCorpBeforeNol < 0) {
        corpNolBuckets.push({ idx, amount: -netCorpBeforeNol });
        taxableCorpIncome = 0;
      } else if (netCorpBeforeNol > 0) {
        const maxOffset = Math.floor(netCorpBeforeNol * CORPORATE_NOL_DEDUCTION_CAP_RATIO);
        let offsetRemaining = maxOffset;
        let totalOffsetUsed = 0;
        for (const bucket of corpNolBuckets) {
          if (offsetRemaining <= 0) break;
          const use = Math.min(bucket.amount, offsetRemaining);
          bucket.amount -= use;
          offsetRemaining -= use;
          totalOffsetUsed += use;
        }
        while (corpNolBuckets.length > 0 && corpNolBuckets[0].amount <= 0) {
          corpNolBuckets.shift();
        }
        taxableCorpIncome = netCorpBeforeNol - totalOffsetUsed;
      }

      if (corp === 0 && carriedCorpRealizedGain > 0) {
        taxableCorpIncome = Math.max(taxableCorpIncome, carriedCorpRealizedGain);
      }

      const rawCorpTax = calculateCorporateTax(taxableCorpIncome, inputs.corporate.taxType);
      corpCorporateTax = Math.min(corp, rawCorpTax);
      corpTaxUnpaidByCorp = rawCorpTax - corpCorporateTax;
      const taxPaymentGain = realizeCorpOutflow(corpCorporateTax);
      if (!isCorpYearlyRecognition) corpPendingRealizedGain += taxPaymentGain;
      corp -= corpCorporateTax;
    }
    corpCorporateTax += corpTaxUnpaidByCorp;

    // 4. 개인 상시 세금(일반계좌 배당세 + 국민연금 소득세) 및 건강보험료
    //    (상세 ETF 모드에서 KRX 커버드콜 포함 시 옵션프리미엄 비과세 차감 비율 taxableDivRatio 반영)
    const taxableDivIncome = Math.round(Math.max(0, taxableDivReturn) * taxableDivRatio);
    // B4-E3: 소득세는 개인 단위 — 본인·배우자 각자의 공적연금·임원 근로소득 과표 위에 가구 배당을 지분 균등 귀속
    const spouseExecTaxableBase = effectiveExecCount === 2 ? spouseExecEarnedTaxableBase : 0;
    let krxRealizedGainThisYear = dDayKrxRealizedGain;
    const yearGrossUpRate = idx >= 1 ? CORPORATE_DIVIDEND_GROSS_UP_RATE_2027 : undefined;
    const householdIndTax = (corpDividend: number, extraTaxableDividend = 0) =>
      calculateHouseholdCombinedTax({
        taxableDividend: taxableDivIncome + extraTaxableDividend,
        corpDividend,
        selfPublicPension: pubPen.selfAnnual,
        spousePublicPension: pubPen.spouseAnnual,
        selfOtherBase: execEarnedTaxableBase,
        spouseOtherBase: spouseExecTaxableBase,
        hasSpouse,
        dividendSelfShare: generalSelfShare,
        grossUpRate: yearGrossUpRate,
      });
    const combinedIndTax = householdIndTax(0);
    let taxPublicAndDiv = combinedIndTax.totalTax + dDayCorpTransferKrxTax;
    let taxPrivatePensionAndIrp = 0;
    let taxOverseasCapGains = dDayCorpTransferOvTax;
    let taxIsaAndSeveranceLump = dDaySeveranceLumpTax;
    const dDayPrepaidTax = dDaySeveranceLumpTax + dDayCorpTransferTax;
    let personalIncomeAndDivTax = combinedIndTax.totalTax + dDayPrepaidTax;
    const nonWithdrawalTaxBaseline = personalIncomeAndDivTax;
    // 가구 연금소득세(연금저축 + IRP 운용수익분): 인별 1,500만 한도를 각자 적용하되,
    // 부부 각자 IRP 계좌를 보유한 경우(0 < iShare < 1) 잔여 저율 한도(1,500만)가 남은 배우자 계좌에서 우선 인출
    const hhPensionTax = (pensionGross: number, irpPensionGross: number) => {
      const pShare = pensionSelfShare();
      const iShare = irpSelfShare();
      const selfPen = pensionGross * pShare;
      const spousePen = pensionGross - selfPen;
      let selfIrp = irpPensionGross * iShare;
      let spouseIrp = irpPensionGross - selfIrp;
      if (irpPensionGross > 0 && iShare > 0 && iShare < 1) {
        const remSelf = Math.max(0, PERSONAL_PENSION_LOW_TAX_THRESHOLD - selfPen);
        const remSpouse = Math.max(0, PERSONAL_PENSION_LOW_TAX_THRESHOLD - spousePen);
        const totalRem = remSelf + remSpouse;
        if (irpPensionGross <= totalRem) {
          selfIrp = Math.min(remSelf, Math.round(irpPensionGross * iShare));
          spouseIrp = irpPensionGross - selfIrp;
          if (spouseIrp > remSpouse) {
            spouseIrp = remSpouse;
            selfIrp = irpPensionGross - spouseIrp;
          }
        } else {
          const excess = irpPensionGross - totalRem;
          selfIrp = remSelf + Math.round(excess * iShare);
          spouseIrp = irpPensionGross - selfIrp;
        }
      }
      return calculateHouseholdPersonalPensionTaxByPerson(
        selfPen + selfIrp,
        spousePen + spouseIrp,
        ageSelf,
        ageSpouse,
        combinedIndTax.selfComprehensiveBase,
        combinedIndTax.spouseComprehensiveBase,
        pubPen.selfAnnual,
        pubPen.spouseAnnual
      );
    };
    let irpPensionTaxablePartThisYear = 0;

    // 1-a: 전년도 법인 과세배당 및 국내기타ETF 매매차익은 금융소득으로 건보 소득 베이스에 합산
    //      이자·배당 금융소득은 인별 연 1,000만 원 이하면 건보 부과소득 제외(0원), 초과 시 전액 합산 (B4-E3: 인별 판정)
    const rawFinancialIncomeForHealth = taxableDivIncome + prevYearExtraFinancialIncome;
    const assessableFinancialForHealth = householdHealthFinancialIncome(
      rawFinancialIncomeForHealth,
      hasSpouse,
      generalSelfShare
    );
    const assessableNonSalaryIncome =
      assessableFinancialForHealth + Math.round(publicPensionInflow * 0.5);
    const regionalHealthEval = calculateRegionalHealthInsurance({
      assessedPropertyValue: reEval.effectiveAssessedValue,
      leaseDeposit: reEval.effectiveLeaseDeposit,
      ownership: inputs.realEstate.ownership,
      fairMarketValueRatio: inputs.realEstate.fairMarketValueRatio,
      apply2024Reform: inputs.realEstate.apply2024HealthReform ?? true,
      assessableAnnualIncome: assessableNonSalaryIncome,
      hasSpouse,
    });
    // B4-E4: 피부양자 인별 판정 — 재산은 인별 명의 재산세 과표(공동명의 50%, 단독명의는 본인), 소득은 인별 합산소득,
    //        부부는 둘 다 소득요건을 충족해야 함(한 명 초과 시 동반 탈락). 헤드룸 = 인별 여유 중 최솟값
    const selfFinancialShare = hasSpouse
      ? Math.round(rawFinancialIncomeForHealth * generalSelfShare)
      : rawFinancialIncomeForHealth;
    const personFinancial = (x: number) => (x > HEALTH_INSURANCE_FINANCIAL_INCOME_CLIFF ? x : 0);
    const dependentPropertyBase =
      reEval.effectiveAssessedValue * ((inputs.realEstate.fairMarketValueRatio || 60) / 100);
    const isJointOwnership = hasSpouse && inputs.realEstate.ownership === 'joint';
    const selfDependent = evaluateDependentEligibility(
      isJointOwnership ? dependentPropertyBase / 2 : dependentPropertyBase,
      pubPen.selfAnnual + personFinancial(selfFinancialShare)
    );
    const spouseDependent = hasSpouse
      ? evaluateDependentEligibility(
          isJointOwnership ? dependentPropertyBase / 2 : 0,
          pubPen.spouseAnnual + personFinancial(rawFinancialIncomeForHealth - selfFinancialShare)
        )
      : selfDependent;
    const isHealthDependentEligible =
      isEmployed || isWorkplaceSubscriber || (selfDependent.eligible && spouseDependent.eligible);
    const dependentIncomeHeadroom =
      selfDependent.eligible && spouseDependent.eligible
        ? Math.min(selfDependent.headroom, spouseDependent.headroom)
        : 0;
    let personalHealthInsurance = 0;
    if (isWorkplaceSubscriber) {
      // 직장가입자 보수외소득 월액보험료는 임원 인별로 연 2,000만 초과분에 부과
      const selfNonSalary = personFinancial(selfFinancialShare) + Math.round(pubPen.selfAnnual * 0.5);
      const spouseNonSalary =
        personFinancial(rawFinancialIncomeForHealth - selfFinancialShare) + Math.round(pubPen.spouseAnnual * 0.5);
      personalHealthInsurance =
        calculateWorkplaceNonSalaryHealthInsurance(selfNonSalary) +
        (effectiveExecCount === 2 ? calculateWorkplaceNonSalaryHealthInsurance(spouseNonSalary) : 0);
      // B5-①: 임원 1인이면 배우자는 본인의 피부양자 — 배우자 자신의 요건 미충족 시 별도 지역가입자(지분 재산 + 본인 소득)
      if (effectiveExecCount === 1 && hasSpouse && !spouseDependent.eligible) {
        personalHealthInsurance += calculateRegionalHealthInsurance({
          assessedPropertyValue: isJointOwnership ? reEval.effectiveAssessedValue / 2 : 0,
          ownership: 'single',
          fairMarketValueRatio: inputs.realEstate.fairMarketValueRatio,
          apply2024Reform: inputs.realEstate.apply2024HealthReform ?? true,
          assessableAnnualIncome: spouseNonSalary,
          hasSpouse: false,
        }).annualTotal;
      }
    } else if (!isEmployed) {
      personalHealthInsurance = regionalHealthEval.annualTotal;
    }

    const includePropTax = inputs.realEstate.includePropertyTax ?? true;
    const personalPropertyTax =
      !isEmployed && includePropTax && reEval.effectiveAssessedValue > 0
        ? calculateAnnualPropertyHoldingTax({
            assessedPropertyValue: reEval.effectiveAssessedValue,
            ownership: inputs.realEstate.ownership,
            hasSpouse,
            ageSelf,
            holdingYears: 10 + Math.max(0, idx),
          }).totalHoldingTax
        : 0;

    // 5. 목표 지출(생활비 + 고정지출 + 임대료 + 일시 목돈 지출) 산출 (2-A: 현재 나이부터 물가연동 idx 적용, 재직기는 일시 지출만 반영)
    let requiredLivingOutflow = lumpSumEventOutflow;
    let stageLabel = '재직 적립기';
    if (!isEmployed) {
      const baseRealMonthly = getMonthlyLivingExpenseForAge(
        ageSelf,
        inputs.cashflow.targetNetMonthlyLivingExpense,
        inputs.cashflow.activeSeniorConfig
      );
      const annualLivingNominal = Math.round(baseRealMonthly * 12 * cpiLivingMultiplier);
      const annualFixedNominal = Math.round(
        (inputs.cashflow.monthlyFixedExpense || 0) * 12 * cpiLivingMultiplier
      );
      const annualRentNominal = Math.round(reEval.annualRentOutflow * cpiLivingMultiplier);
      requiredLivingOutflow =
        annualLivingNominal + annualFixedNominal + annualRentNominal + lumpSumEventOutflow;

      if (inputs.cashflow.spendingMode === 'active_senior') {
        const cfg = inputs.cashflow.activeSeniorConfig;
        if (ageSelf <= (cfg?.activeAgeEnd ?? 64)) stageLabel = '액티브기';
        else if (ageSelf <= (cfg?.stableAgeEnd ?? 77)) stageLabel = '안정기';
        else stageLabel = '케어기';
      } else {
        stageLabel = ageSelf < 65 ? '은퇴 크레바스' : '은퇴 연금기';
      }
    }

    // 6. 가계 현금 수지 및 8단계 절세 인출 워터폴 (7-A)
    // D-Day 일시수령 퇴직소득세(dDaySeveranceLumpTax)는 입금 시점에 이미 원천징수 차감되었으므로 워터폴 현금 의무에서 제외
    const stage1PublicAndHousingPension = publicPensionInflow + housingPensionInflow;
    const householdCashInflow = stage1PublicAndHousingPension + stage2CorpNetSalary;
    const baseCashObligation =
      requiredLivingOutflow +
      Math.max(0, personalIncomeAndDivTax - dDayPrepaidTax) +
      personalHealthInsurance +
      personalPropertyTax +
      corpTaxUnpaidByCorp;

    // [GAP-02] 국민연금 추납(applyAdditionalPensionSelf/Spouse) 일시 납입 원금 차감
    // (은퇴 전환 연차 또는 이미 은퇴 상태일 경우 첫 시뮬레이션 연차에 정산하되, 당해 가계 현금 잉여분 우선 충당 후 일반과세계좌 차감)
    let additionalPensionContribution = 0;
    let remAdditionalPensionObligation = 0;
    const addPensionSettleAge = Math.max(currentAgeSelf, targetRetirementAgeSelf);
    if (ageSelf === addPensionSettleAge) {
      const selfAddCost = inputs.pension.applyAdditionalPensionSelf
        ? Math.max(0, Math.round(inputs.pension.additionalMonthsSelf || 0)) *
          Math.max(0, Math.round(inputs.pension.monthlyContributionSelf || 0))
        : 0;
      const spouseAddCost =
        hasSpouse && inputs.pension.applyAdditionalPensionSpouse
          ? Math.max(0, Math.round(inputs.pension.additionalMonthsSpouse || 0)) *
            Math.max(0, Math.round(inputs.pension.monthlyContributionSpouse || 0))
          : 0;
      const targetAddCost = selfAddCost + spouseAddCost;
      if (targetAddCost > 0) {
        const coveredByCashSurplus = Math.min(
          targetAddCost,
          Math.max(0, householdCashInflow - baseCashObligation)
        );
        const uncoveredAddCost = targetAddCost - coveredByCashSurplus;
        const fromTaxable = Math.min(taxable, uncoveredAddCost);
        if (fromTaxable > 0) {
          const basisRemoved =
            taxable > 0 ? Math.round((taxableBasis * fromTaxable) / taxable) : 0;
          taxable -= fromTaxable;
          taxableBasis = taxable > 0 ? Math.max(0, taxableBasis - basisRemoved) : 0;
        }
        remAdditionalPensionObligation = coveredByCashSurplus + (uncoveredAddCost - fromTaxable);
        additionalPensionContribution = targetAddCost;
      }
    }

    const initialCashObligation = baseCashObligation + remAdditionalPensionObligation;

    let stage3IrpWithdrawal = 0;
    let stage4IsaWithdrawal = 0;
    let stage5PersonalPensionWithdrawal = 0;
    let stage6OverseasTaxableWithdrawal = 0;
    let stage7DomesticTaxableWithdrawal = 0;
    let stage8CorpFallbackDividend = 0;
    let corpTaxableDividendThisYear = 0; // 가수금 비과세 회수를 제외한 과세 배당 (다음 해 건보 베이스)
    let unmetSpendingNeed = 0;

    if (householdCashInflow >= initialCashObligation) {
      // 잉여 현금(예: 연금/급여 초과분)은 일반 과세계좌에 원금으로 재투자 (증발 0원)
      const cashSurplus = householdCashInflow - initialCashObligation;
      taxable += cashSurplus;
      taxableBasis += cashSurplus;
    } else {
      let remNeed = initialCashObligation - householdCashInflow;

      // ② 세후배당 및 배당원천징수세 자체 정산: 당해 일반과세계좌에서 발생한 배당금 범위 내에서는 매도 양도세 없이 현금 정산
      if (remNeed > 0 && taxable > 0 && taxableDivIncome > 0) {
        const useDivCash = Math.min(taxable, taxableDivIncome, remNeed);
        taxable -= useDivCash;
        taxableBasis = taxable > 0 ? Math.max(0, taxableBasis - useDivCash) : 0;
        stage7DomesticTaxableWithdrawal += useDivCash;
        remNeed -= useDivCash;
      }

      if (isEmployed) {
        // 재직기 중 일시 목돈 지출 발생 시: 연금계좌(IRP·연금저축) 중도해지는 차단하고,
        // ① 일반과세계좌(해외양도세·국내기타ETF 매매차익 배당세 Gross-Up 반영) → ② 법인 출자원금(가수금 비과세 한도 내) → ③ ISA → ④ 법인 과세배당 순으로 정산
        if (remNeed > 0 && taxable > 0) {
          const gainRatio = taxable > 0 ? Math.max(0, (taxable - taxableBasis) / taxable) : 0;
          let grossNeeded = Math.min(taxable, remNeed);
          for (let iter = 0; iter < 8; iter++) {
            const ovPortion = Math.round(grossNeeded * overseasRatio);
            const ovGain = Math.round(ovPortion * gainRatio);
            const capTax = calculateOverseasCapitalGainsTax(ovGain, hasSpouse, explicitSelfShare);
            const krxPortion = Math.round(grossNeeded * krxTaxableGainRatio);
            const krxGain = Math.round(krxPortion * gainRatio);
            const krxDivTax = Math.max(
              0,
              householdIndTax(corpTaxableDividendThisYear, krxRealizedGainThisYear + krxGain).totalTax -
                householdIndTax(corpTaxableDividendThisYear, krxRealizedGainThisYear).totalTax
            );
            const shortfall = remNeed - (grossNeeded - capTax - krxDivTax);
            if (shortfall <= 0 || grossNeeded >= taxable) break;
            grossNeeded = Math.min(
              taxable,
              grossNeeded + Math.max(1, Math.ceil(shortfall / (1 - 0.22)))
            );
          }
          const overseasPortion = Math.round(grossNeeded * overseasRatio);
          const domesticPortion = grossNeeded - overseasPortion;
          const overseasRealizedGain = Math.round(overseasPortion * gainRatio);
          const capitalGainsTax = calculateOverseasCapitalGainsTax(
            overseasRealizedGain,
            hasSpouse,
            explicitSelfShare
          );
          const krxTaxablePortion = Math.round(grossNeeded * krxTaxableGainRatio);
          const krxRealizedGain = Math.round(krxTaxablePortion * gainRatio);
          const krxSaleGainTax = Math.max(
            0,
            householdIndTax(corpTaxableDividendThisYear, krxRealizedGainThisYear + krxRealizedGain).totalTax -
              householdIndTax(corpTaxableDividendThisYear, krxRealizedGainThisYear).totalTax
          );
          krxRealizedGainThisYear += krxRealizedGain;
          const netDeliver = grossNeeded - capitalGainsTax - krxSaleGainTax;
          const basisRemoved =
            taxable > 0 ? Math.round((taxableBasis * grossNeeded) / taxable) : 0;
          taxable -= grossNeeded;
          taxableBasis = taxable > 0 ? Math.max(0, taxableBasis - basisRemoved) : 0;
          stage6OverseasTaxableWithdrawal += overseasPortion;
          stage7DomesticTaxableWithdrawal += domesticPortion;
          personalIncomeAndDivTax += capitalGainsTax + krxSaleGainTax;
          taxOverseasCapGains += capitalGainsTax;
          taxPublicAndDiv += krxSaleGainTax;
          remNeed = Math.max(0, remNeed - netDeliver);
        }
        if (remNeed > 0 && corp > 0 && liquidationMode === 'capital_return_exempt') {
          const exemptRoom = Math.min(corp, corpPaidInCapital);
          const fromCapitalReturn = Math.min(exemptRoom, remNeed);
          corpPendingRealizedGain += realizeCorpOutflow(fromCapitalReturn);
          corp -= fromCapitalReturn;
          corpPaidInCapital = Math.max(0, corpPaidInCapital - fromCapitalReturn);
          stage8CorpFallbackDividend += fromCapitalReturn;
          remNeed -= fromCapitalReturn;
        }
        if (remNeed > 0 && isa > 0) {
          const gainRatio = isa > 0 ? Math.max(0, (isa - isaBasis) / isa) : 0;
          const approxEffRate = gainRatio * 0.099;
          const grossNeeded = Math.min(
            isa,
            Math.ceil(remNeed / Math.max(0.85, 1 - approxEffRate))
          );
          const realizedGain = Math.round(grossNeeded * gainRatio);
          const usedIsaExempt = Math.min(isaRemainingExemptGain, Math.max(0, realizedGain));
          const tax = calculateIsaTax(realizedGain, false, usedIsaExempt);
          isaRemainingExemptGain = Math.max(0, isaRemainingExemptGain - usedIsaExempt);
          const netDeliver = grossNeeded - tax;
          const basisRemoved = isa > 0 ? Math.round((isaBasis * grossNeeded) / isa) : 0;
          isa -= grossNeeded;
          isaBasis = Math.max(0, isaBasis - basisRemoved);
          stage4IsaWithdrawal += grossNeeded;
          personalIncomeAndDivTax += tax;
          taxIsaAndSeveranceLump += tax;
          remNeed = Math.max(0, remNeed - netDeliver);
        }
        if (remNeed > 0 && corp > 0) {
          let divRateGuess = DIVIDEND_WITHHOLDING_TAX_RATE;
          for (let iter = 0; iter < 4 && remNeed > 0 && corp > 0; iter++) {
            const grossDivNeeded = Math.min(corp, Math.ceil(remNeed / (1 - divRateGuess)));
            const taxBefore = householdIndTax(corpTaxableDividendThisYear).totalTax;
            const taxAfter = householdIndTax(corpTaxableDividendThisYear + grossDivNeeded).totalTax;
            const divTax = Math.max(0, taxAfter - taxBefore);
            const netDiv = grossDivNeeded - divTax;
            corpPendingRealizedGain += realizeCorpOutflow(grossDivNeeded);
            corp -= grossDivNeeded;
            corpTaxableDividendThisYear += grossDivNeeded;
            stage8CorpFallbackDividend += grossDivNeeded;
            personalIncomeAndDivTax += divTax;
            taxPublicAndDiv += divTax;
            remNeed = Math.max(0, remNeed - netDiv);
            divRateGuess = Math.min(
              0.495,
              Math.max(DIVIDEND_WITHHOLDING_TAX_RATE, divTax / Math.max(1, grossDivNeeded))
            );
          }
        }
      } else {
        const personalPensionStartAge = Math.max(
          PENSION_ELIGIBLE_AGE,
          Math.round(acc.selfPersonalPensionStartAge || PENSION_ELIGIBLE_AGE)
        );
        const irpStartAge = Math.max(
          PENSION_ELIGIBLE_AGE,
          Math.round(acc.selfRetirementPensionStartAge || PENSION_ELIGIBLE_AGE)
        );

        // ⑤-1 사적연금 개시연령(기본 만 55세) 이상 개인연금저축 (비세액공제 원금 0% 비과세 선인출 + 인당 1,500만 / 부부 합산 최대 3,000만 저율 3.3~5.5%, 건보료 0원)
        let taxableStage5Withdrawal = 0;
        if (remNeed > 0 && ageSelf >= personalPensionStartAge && personalPension > 0) {
          const exemptPrincipalDraw = Math.min(personalPension, uncreditedPensionBasis, remNeed);
          if (exemptPrincipalDraw > 0) {
            personalPension -= exemptPrincipalDraw;
            uncreditedPensionBasis -= exemptPrincipalDraw;
            remNeed -= exemptPrincipalDraw;
            stage5PersonalPensionWithdrawal += exemptPrincipalDraw;
          }

          if (remNeed > 0 && personalPension > 0) {
            // 1-d: 인별 1,500만 한도 — 합산 인출액 × 지분이 각각 1,500만 이하가 되는 최대 합산액
            const selfShare = pensionSelfShare();
            const spouseShare = 1 - selfShare;
            const lowTaxCap = Math.floor(
              Math.min(
                selfShare > 0 ? PERSONAL_PENSION_LOW_TAX_THRESHOLD / selfShare : Infinity,
                spouseShare > 0 ? PERSONAL_PENSION_LOW_TAX_THRESHOLD / spouseShare : Infinity
              )
            );
            const lowRate =
              ageSelf >= 80
                ? PERSONAL_PENSION_RATE_80_PLUS
                : ageSelf >= 70
                  ? PERSONAL_PENSION_RATE_70_TO_79
                  : PERSONAL_PENSION_RATE_UNDER_70;
            const grossTry = Math.min(
              personalPension,
              lowTaxCap,
              Math.ceil(remNeed / (1 - lowRate))
            );
            const tax = hhPensionTax(grossTry, 0);
            const netDeliver = grossTry - tax;
            personalPension -= grossTry;
            stage5PersonalPensionWithdrawal += grossTry;
            taxableStage5Withdrawal += grossTry;
            personalIncomeAndDivTax += tax;
            taxPrivatePensionAndIrp += tax;
            remNeed = Math.max(0, remNeed - netDeliver);
          }
        }

        // ⑤-2 사적연금 개시연령(기본 만 55세) 이상 IRP 인출 (이연퇴직소득세 1~10년차 70% / 11~20년차 60% / 21년차+ 50% + 운용수익분 저율한도 내 인출, 건보료 0원)
        const irpAnnuityYear = Math.max(1, ageSelf - irpStartAge + 1);
        const deferredDiscount = getDeferredSeveranceTaxMultiplier(irpAnnuityYear);
        const deferredRate = deferredSeveranceEffRate * deferredDiscount;
        if (remNeed > 0 && ageSelf >= irpStartAge && irp > 0) {
          // 1-c: 인출 순서는 이연퇴직소득 → 운용수익. 이연퇴직소득은 퇴직소득세 × (10년 이하 70% / 초과 60%)로 한도 제한이 없으나,
          //      운용수익분(pensionPart)은 연금저축과 합산해 인별 1,500만 저율(3.3~5.5%) 구간 내에서만 1차 인출하여
          //      세율 0%인 법인 가수금(⑥)보다 먼저 16.5% 과세를 맞는 역전을 방지
          const pShare = pensionSelfShare();
          const usedSelf = taxableStage5Withdrawal * pShare;
          const usedSpouse = taxableStage5Withdrawal * (1 - pShare);
          const remSelfRoom = Math.max(0, PERSONAL_PENSION_LOW_TAX_THRESHOLD - usedSelf);
          const remSpouseRoom = hasSpouse
            ? Math.max(0, PERSONAL_PENSION_LOW_TAX_THRESHOLD - usedSpouse)
            : 0;
          const iShare = irpSelfShare();
          const iSpouseShare = 1 - iShare;
          const maxLowTaxIrpPensionPart = Math.floor(
            (iShare > 0 ? remSelfRoom : 0) + (iSpouseShare > 0 ? remSpouseRoom : 0)
          );
          // 소득세법 시행령 §40의2 연금수령한도(10년 분할)를 반영해 이연퇴직소득 원금(irpDeferredRemaining)이
          // 개시 직후 3~4년 만에 과도 인출된 뒤 단절되는 현상을 방지하고 10년에 걸쳐 평탄화
          const annualDeferredPacingCap =
            irpAnnuityYear <= 10
              ? Math.ceil(irpDeferredRemaining / Math.max(1, 11 - irpAnnuityYear))
              : irpDeferredRemaining;
          const irpLowTaxCap = Math.min(
            irp,
            annualDeferredPacingCap + maxLowTaxIrpPensionPart
          );
          if (irpLowTaxCap > 0) {
            const taxForGross = (g: number) => {
              const deferredPart = Math.min(g, annualDeferredPacingCap, irpDeferredRemaining, irp);
              const pensionPart = g - deferredPart;
              const defTax = Math.round(deferredPart * deferredRate);
              const penTax =
                pensionPart > 0
                  ? hhPensionTax(taxableStage5Withdrawal, pensionPart) -
                    hhPensionTax(taxableStage5Withdrawal, 0)
                  : 0;
              return { tax: defTax + penTax, deferredPart };
            };
            let grossWithdraw = Math.min(
              irpLowTaxCap,
              Math.ceil(remNeed / (1 - Math.min(0.9, deferredRate)))
            );
            for (let iter = 0; iter < 6; iter++) {
              const { tax } = taxForGross(grossWithdraw);
              const shortfall = remNeed - (grossWithdraw - tax);
              if (shortfall <= 0 || grossWithdraw >= irpLowTaxCap) break;
              grossWithdraw = Math.min(
                irpLowTaxCap,
                grossWithdraw + Math.max(1, Math.ceil(shortfall / (1 - 0.055)))
              );
            }
            const { tax, deferredPart } = taxForGross(grossWithdraw);
            irpDeferredRemaining = Math.max(0, irpDeferredRemaining - deferredPart);
            irpPensionTaxablePartThisYear = grossWithdraw - deferredPart;
            const netDeliver = grossWithdraw - tax;
            irp -= grossWithdraw;
            stage3IrpWithdrawal = grossWithdraw;
            personalIncomeAndDivTax += tax;
            taxPrivatePensionAndIrp += tax;
            remNeed = Math.max(0, remNeed - netDeliver);
          }
        }

        // ④ 부부 ISA 인출 (55세 미만 크레바스에서는 ⑤-1/⑤-2가 스킵되어 1순위 인출, 55세 이상에서는 연금 저율한도 소진 후 잔여 필요액을 9.9% 분리과세로 인출하여 ISA 비과세 복리 보존)
        if (remNeed > 0 && isa > 0) {
          const gainRatio = isa > 0 ? Math.max(0, (isa - isaBasis) / isa) : 0;
          const approxEffRate = gainRatio * 0.099;
          const grossNeeded = Math.min(
            isa,
            Math.ceil(remNeed / Math.max(0.85, 1 - approxEffRate))
          );
          const realizedGain = Math.round(grossNeeded * gainRatio);
          const usedIsaExempt = Math.min(isaRemainingExemptGain, Math.max(0, realizedGain));
          const tax = calculateIsaTax(realizedGain, false, usedIsaExempt);
          isaRemainingExemptGain = Math.max(0, isaRemainingExemptGain - usedIsaExempt);
          const netDeliver = grossNeeded - tax;
          const basisRemoved = isa > 0 ? Math.round((isaBasis * grossNeeded) / isa) : 0;
          isa -= grossNeeded;
          isaBasis = Math.max(0, isaBasis - basisRemoved);
          stage4IsaWithdrawal = grossNeeded;
          personalIncomeAndDivTax += tax;
          taxIsaAndSeveranceLump += tax;
          remNeed = Math.max(0, remNeed - netDeliver);
        }

        // ⑥ 법인 출자원금(가수금 corpPaidInCapital) 비과세 선회수 (7-A: 세금 0%인 법인 가수금을 양도세 22%인 일반계좌보다 먼저 인출)
        if (remNeed > 0 && corp > 0 && liquidationMode === 'capital_return_exempt') {
          const exemptRoom = Math.min(corp, corpPaidInCapital);
          const fromCapitalReturn = Math.min(exemptRoom, remNeed);
          corpPendingRealizedGain += realizeCorpOutflow(fromCapitalReturn);
          corp -= fromCapitalReturn;
          corpPaidInCapital = Math.max(0, corpPaidInCapital - fromCapitalReturn);
          remNeed -= fromCapitalReturn;
          stage8CorpFallbackDividend += fromCapitalReturn;
        }

        // ⑦ 일반 과세계좌 인출 (해외직투 1인 250만 / 부부 합산 최대 500만 공제 + 22% 양도세 / 국내기타ETF 매매차익 15.4% 배당세 / 국내주식 비과세, 반복 수렴 Gross-Up)
        if (remNeed > 0 && taxable > 0) {
          const gainRatio = taxable > 0 ? Math.max(0, (taxable - taxableBasis) / taxable) : 0;
          let grossNeeded = Math.min(taxable, remNeed);
          for (let iter = 0; iter < 8; iter++) {
            const ovPortion = Math.round(grossNeeded * overseasRatio);
            const ovGain = Math.round(ovPortion * gainRatio);
            const capTax = Math.max(
              0,
              calculateOverseasCapitalGainsTax(
                dDayOvRealizedGain + ovGain,
                hasSpouse,
                explicitSelfShare
              ) - dDayCorpTransferOvTax
            );
            const krxPortion = Math.round(grossNeeded * krxTaxableGainRatio);
            const krxGain = Math.round(krxPortion * gainRatio);
            const krxDivTax = Math.max(
              0,
              householdIndTax(corpTaxableDividendThisYear, krxRealizedGainThisYear + krxGain).totalTax -
                householdIndTax(corpTaxableDividendThisYear, krxRealizedGainThisYear).totalTax
            );
            const shortfall = remNeed - (grossNeeded - capTax - krxDivTax);
            if (shortfall <= 0 || grossNeeded >= taxable) break;
            grossNeeded = Math.min(
              taxable,
              grossNeeded + Math.max(1, Math.ceil(shortfall / (1 - 0.22)))
            );
          }
          const overseasPortion = Math.round(grossNeeded * overseasRatio);
          const domesticPortion = grossNeeded - overseasPortion;
          const overseasRealizedGain = Math.round(overseasPortion * gainRatio);
          const capitalGainsTax = Math.max(
            0,
            calculateOverseasCapitalGainsTax(
              dDayOvRealizedGain + overseasRealizedGain,
              hasSpouse,
              explicitSelfShare
            ) - dDayCorpTransferOvTax
          );
          const krxTaxablePortion = Math.round(grossNeeded * krxTaxableGainRatio);
          const krxRealizedGain = Math.round(krxTaxablePortion * gainRatio);
          const krxSaleGainTax = Math.max(
            0,
            householdIndTax(corpTaxableDividendThisYear, krxRealizedGainThisYear + krxRealizedGain).totalTax -
              householdIndTax(corpTaxableDividendThisYear, krxRealizedGainThisYear).totalTax
          );
          const netDeliver = grossNeeded - capitalGainsTax - krxSaleGainTax;
          const basisRemoved =
            taxable > 0 ? Math.round((taxableBasis * grossNeeded) / taxable) : 0;
          taxable -= grossNeeded;
          taxableBasis = taxable > 0 ? Math.max(0, taxableBasis - basisRemoved) : 0;
          stage6OverseasTaxableWithdrawal += overseasPortion;
          stage7DomesticTaxableWithdrawal += domesticPortion;
          personalIncomeAndDivTax += capitalGainsTax + krxSaleGainTax;
          taxOverseasCapGains += capitalGainsTax;
          taxPublicAndDiv += krxSaleGainTax;
          krxRealizedGainThisYear += krxRealizedGain;
          remNeed = Math.max(0, remNeed - netDeliver);
        }

        // ⑧ 연금저축·IRP 저율한도 초과분 & 법인 과세배당(15.4%) 안전 폴백
        if (remNeed > 0 && ageSelf >= personalPensionStartAge && personalPension > 0) {
          const exemptExtra = Math.min(personalPension, uncreditedPensionBasis, remNeed);
          if (exemptExtra > 0) {
            personalPension -= exemptExtra;
            uncreditedPensionBasis -= exemptExtra;
            remNeed -= exemptExtra;
            stage5PersonalPensionWithdrawal += exemptExtra;
          }
          if (remNeed > 0 && personalPension > 0) {
            const prevPenTax = hhPensionTax(
              taxableStage5Withdrawal,
              irpPensionTaxablePartThisYear
            );
            const extraGross = Math.min(personalPension, Math.ceil(remNeed / (1 - 0.165)));
            const newPenTax = hhPensionTax(
              taxableStage5Withdrawal + extraGross,
              irpPensionTaxablePartThisYear
            );
            const addPenTax = Math.max(0, newPenTax - prevPenTax);
            const netExtra = extraGross - addPenTax;
            personalPension -= extraGross;
            stage5PersonalPensionWithdrawal += extraGross;
            taxableStage5Withdrawal += extraGross;
            personalIncomeAndDivTax += addPenTax;
            taxPrivatePensionAndIrp += addPenTax;
            remNeed = Math.max(0, remNeed - netExtra);
          }
        }

        if (remNeed > 0 && ageSelf >= irpStartAge && irp > 0) {
          const prevPenTax = hhPensionTax(
            taxableStage5Withdrawal,
            irpPensionTaxablePartThisYear
          );
          const extraIrpGross = Math.min(irp, Math.ceil(remNeed / (1 - 0.165)));
          const extraDeferred = Math.min(extraIrpGross, irpDeferredRemaining, irp);
          const extraPensionPart = extraIrpGross - extraDeferred;
          const extraDefTax = Math.round(extraDeferred * deferredRate);
          const newPenTax = hhPensionTax(
            taxableStage5Withdrawal,
            irpPensionTaxablePartThisYear + extraPensionPart
          );
          const addIrpTax = extraDefTax + Math.max(0, newPenTax - prevPenTax);
          const netExtraIrp = extraIrpGross - addIrpTax;
          irpDeferredRemaining = Math.max(0, irpDeferredRemaining - extraDeferred);
          irpPensionTaxablePartThisYear += extraPensionPart;
          irp -= extraIrpGross;
          stage3IrpWithdrawal += extraIrpGross;
          personalIncomeAndDivTax += addIrpTax;
          taxPrivatePensionAndIrp += addIrpTax;
          remNeed = Math.max(0, remNeed - netExtraIrp);
        }

        if (remNeed > 0 && corp > 0) {
          const exemptRoom =
            liquidationMode === 'capital_return_exempt' ? Math.min(corp, corpPaidInCapital) : 0;
          const fromCapitalReturn = Math.min(exemptRoom, remNeed);
          corpPendingRealizedGain += realizeCorpOutflow(fromCapitalReturn);
          corp -= fromCapitalReturn;
          corpPaidInCapital = Math.max(0, corpPaidInCapital - fromCapitalReturn);
          remNeed -= fromCapitalReturn;
          stage8CorpFallbackDividend += fromCapitalReturn;

          // 1-a: 법인 배당은 일반계좌 배당과 합산해 금융소득종합과세(2,000만 초과 누진, 14% 원천징수 하한, 법인배당 Gross-Up 10%)를 적용
          //      실효세율이 누진에 따라 달라지므로 Gross-Up을 최대 4회 반복 수렴
          let divRateGuess = DIVIDEND_WITHHOLDING_TAX_RATE;
          for (let iter = 0; iter < 4 && remNeed > 0 && corp > 0; iter++) {
            const grossDivNeeded = Math.min(corp, Math.ceil(remNeed / (1 - divRateGuess)));
            const taxBefore = householdIndTax(corpTaxableDividendThisYear, krxRealizedGainThisYear).totalTax;
            const taxAfter = householdIndTax(corpTaxableDividendThisYear + grossDivNeeded, krxRealizedGainThisYear).totalTax;
            const divTax = Math.max(0, taxAfter - taxBefore);
            const netDiv = grossDivNeeded - divTax;
            corpPendingRealizedGain += realizeCorpOutflow(grossDivNeeded);
            corp -= grossDivNeeded;
            corpTaxableDividendThisYear += grossDivNeeded;
            stage8CorpFallbackDividend += grossDivNeeded;
            personalIncomeAndDivTax += divTax;
            taxPublicAndDiv += divTax;
            remNeed = Math.max(0, remNeed - netDiv);
            divRateGuess = Math.min(0.495, Math.max(DIVIDEND_WITHHOLDING_TAX_RATE, divTax / Math.max(1, grossDivNeeded)));
          }
        }
      }

      // 반올림으로 인해 발생할 수 있는 초과 인출 잔여 현금(수 원)은 과세계좌로 환입하고, 미달분은 미충당 결손으로 계상
      const totalGrossWithdrawn =
        stage3IrpWithdrawal +
        stage4IsaWithdrawal +
        stage5PersonalPensionWithdrawal +
        stage6OverseasTaxableWithdrawal +
        stage7DomesticTaxableWithdrawal +
        stage8CorpFallbackDividend;
      const totalWithdrawalTaxAdded = personalIncomeAndDivTax - nonWithdrawalTaxBaseline;
      const actualNetDelivered = totalGrossWithdrawn - totalWithdrawalTaxAdded;
      const initialDeficit = initialCashObligation - householdCashInflow;
      if (actualNetDelivered > initialDeficit) {
        const roundingSurplus = actualNetDelivered - initialDeficit;
        taxable += roundingSurplus;
        taxableBasis += roundingSurplus;
        remNeed = 0;
      } else {
        remNeed = initialDeficit - actualNetDelivered;
      }
      unmetSpendingNeed = remNeed;
    }

    const totalTaxHealthAndFees =
      personalIncomeAndDivTax +
      personalPropertyTax +
      personalHealthInsurance +
      corpCorporateTax +
      corpPayrollTaxAndInsurance +
      corpMaintenanceAndFixedCost +
      additionalPensionContribution;

    // 무지성 단순 일반계좌 보유 기준선 대비 절세·건보 방어액 산출
    const totalEndAssetsForNaive = irp + isa + personalPension + taxable + corp;
    let naiveLumpTax = 0;
    if (ageSelf === targetRetirementAgeSelf && severanceGross > 0) {
      naiveLumpTax = totalSeveranceTax;
      const naiveNetSev = Math.max(0, severanceGross - naiveLumpTax);
      naiveBook += naiveNetSev;
      naiveBasis += naiveNetSev;
    }
    const naiveGrowth = Math.round(naiveBook * (activeGrowthRate / 100));
    const naiveDiv = Math.round(naiveBook * (baseDivYield / 100));
    naiveBook = Math.max(
      0,
      naiveBook + naiveGrowth + naiveDiv + annualEmploymentSavings + realEstateCashInflow + lumpSumEventInflow
    );
    naiveBasis =
      naiveBook > 0
        ? naiveBasis + Math.max(0, naiveDiv) + annualEmploymentSavings + realEstateCashInflow + lumpSumEventInflow
        : 0;
    const naiveTaxableDiv = Math.round(Math.max(0, naiveDiv) * taxableDivRatio);
    const naiveBaseTax =
      calculateHouseholdCombinedTax({
        taxableDividend: naiveTaxableDiv,
        corpDividend: 0,
        selfPublicPension: pubPen.selfAnnual,
        spousePublicPension: pubPen.spouseAnnual,
        selfOtherBase: 0,
        spouseOtherBase: 0,
        hasSpouse,
      }).totalTax + naiveLumpTax;
    const naiveHealth = isEmployed
      ? 0
      : calculateRegionalHealthInsurance({
          assessedPropertyValue: reEval.effectiveAssessedValue,
          leaseDeposit: reEval.effectiveLeaseDeposit,
          ownership: inputs.realEstate.ownership,
          fairMarketValueRatio: inputs.realEstate.fairMarketValueRatio,
          apply2024Reform: inputs.realEstate.apply2024HealthReform ?? true,
          assessableAnnualIncome:
            householdHealthFinancialIncome(naiveTaxableDiv + prevNaiveExtraFin, hasSpouse) +
            Math.round(publicPensionInflow * 0.5),
          hasSpouse,
        }).annualTotal;
    const naiveDivCashUsed = Math.min(
      naiveBook,
      naiveTaxableDiv,
      Math.max(
        0,
        requiredLivingOutflow +
          naiveBaseTax +
          personalPropertyTax +
          naiveHealth +
          additionalPensionContribution -
          publicPensionInflow -
          housingPensionInflow
      )
    );
    naiveBook -= naiveDivCashUsed;
    naiveBasis = naiveBook > 0 ? Math.max(0, naiveBasis - naiveDivCashUsed) : 0;
    const naiveRemNeed = Math.max(
      0,
      requiredLivingOutflow +
        naiveBaseTax +
        personalPropertyTax +
        naiveHealth +
        additionalPensionContribution -
        publicPensionInflow -
        housingPensionInflow -
        naiveDivCashUsed
    );
    let naiveCapTax = 0;
    let naiveKrxTax = 0;
    if (naiveRemNeed > 0 && naiveBook > 0) {
      const naiveGainRatio = Math.max(0, (naiveBook - naiveBasis) / naiveBook);
      const naiveGrossSell = Math.min(
        naiveBook,
        Math.ceil(
          naiveRemNeed /
            Math.max(0.75, 1 - naiveGainRatio * (overseasRatio * 0.22 + krxTaxableGainRatio * 0.154))
        )
      );
      const naiveOvGain = Math.round(naiveGrossSell * overseasRatio * naiveGainRatio);
      naiveCapTax = calculateOverseasCapitalGainsTax(naiveOvGain, hasSpouse, explicitSelfShare);
      const naiveKrxGain = Math.round(naiveGrossSell * krxTaxableGainRatio * naiveGainRatio);
      naiveKrxTax =
        naiveKrxGain > 0
          ? Math.max(
              0,
              calculateHouseholdCombinedTax({
                taxableDividend: naiveTaxableDiv + naiveKrxGain,
                corpDividend: 0,
                selfPublicPension: pubPen.selfAnnual,
                spousePublicPension: pubPen.spouseAnnual,
                selfOtherBase: 0,
                spouseOtherBase: 0,
                hasSpouse,
              }).totalTax - (naiveBaseTax - naiveLumpTax)
            )
          : 0;
      const naiveBasisRemoved = naiveBook > 0 ? Math.round((naiveBasis * naiveGrossSell) / naiveBook) : 0;
      naiveBook -= naiveGrossSell;
      naiveBasis = naiveBook > 0 ? Math.max(0, naiveBasis - naiveBasisRemoved) : 0;
      prevNaiveExtraFin = naiveKrxGain;
    } else {
      prevNaiveExtraFin = 0;
    }
    const naiveBaselineTaxAndHealth =
      naiveBook > 0 || totalEndAssetsForNaive > 0
        ? naiveBaseTax + naiveCapTax + naiveKrxTax + naiveHealth + personalPropertyTax
        : totalTaxHealthAndFees;
    const annualTaxAndHealthSaved = naiveBaselineTaxAndHealth - totalTaxHealthAndFees;

    const endIrp = irp;
    const endIsa = isa;
    const endPersonalPension = personalPension;
    const endTaxable = taxable;
    const endCorp = corp;
    const endBookTotal = endIrp + endIsa + endPersonalPension + endTaxable + endCorp;
    const endCorpPendingRealizedGain = isCorpYearlyRecognition ? 0 : corpPendingRealizedGain;
    const endCorpCarryforwardLoss = corpNolBuckets.reduce((s, b) => s + b.amount, 0);
    const endCorpLiquidationNetValue = resolveCorporateExitBreakdown({
      corpBalance: endCorp,
      costBasis: corpBasis,
      paidInCapital: corpPaidInCapital,
      pendingRealizedGain: endCorpPendingRealizedGain,
      taxType: inputs.corporate.taxType,
      liquidationTaxMode: liquidationMode,
      shareholderCount: corpShareholderCount,
      distributionYears: corpExitYears,
      carryforwardLoss: endCorpCarryforwardLoss,
    }).netValue;
    const endPensionBal = Math.max(0, endIrp) + Math.max(0, endPersonalPension);
    const endPersonalLiquidationNetValue = resolvePersonalExitNetWorth(
      endTaxable,
      taxableBasis,
      overseasRatio,
      endIrp,
      endPersonalPension,
      hasSpouse,
      {
        pensionSelfShare:
          endPensionBal > 0
            ? (Math.max(0, endIrp) * irpSelfShare() +
                Math.max(0, endPersonalPension) * pensionSelfShare()) /
              endPensionBal
            : 1,
        distributionYears: corpExitYears,
        uncreditedPensionBasis,
        krxTaxableGainRatio,
      }
    );
    // E-1: 고갈된 법인의 미납 이월 실현차익 법인세는 익년 가계가 부담할 부채이므로 순자산에서 차감
    const depletedCorpTaxLiability =
      endCorp === 0 && endCorpPendingRealizedGain > 0
        ? calculateCorporateTax(endCorpPendingRealizedGain, inputs.corporate.taxType)
        : 0;
    const endDisposableNetWorth =
      endIsa +
      endPersonalLiquidationNetValue +
      endCorpLiquidationNetValue -
      depletedCorpTaxLiability;

    const accountingResidual =
      startBookTotal +
      grossInvestmentReturn +
      totalExternalInflow -
      requiredLivingOutflow +
      unmetSpendingNeed -
      totalTaxHealthAndFees -
      endBookTotal;

    prevYearExtraFinancialIncome = corpTaxableDividendThisYear + krxRealizedGainThisYear;

    rows.push({
      yearIndex,
      ageSelf,
      ageSpouse,
      isEmployed,
      stageLabel,
      discountFactor,
      startIrp,
      startIsa,
      startPersonalPension,
      startTaxable,
      startCorp,
      startBookTotal,
      grossInvestmentReturn,
      savingsAndSeveranceInflow,
      realEstateCashInflow,
      publicPensionInflow,
      housingPensionInflow,
      lumpSumEventInflow,
      totalExternalInflow,
      requiredLivingOutflow,
      lumpSumEventOutflow,
      lumpSumEventLabels,
      lumpSumInflowLabels,
      lumpSumOutflowLabels,
      stage1PublicAndHousingPension,
      stage2CorpNetSalary,
      stage3IrpWithdrawal,
      stage4IsaWithdrawal,
      stage5PersonalPensionWithdrawal,
      stage6OverseasTaxableWithdrawal,
      stage7DomesticTaxableWithdrawal,
      stage8CorpFallbackDividend,
      unmetSpendingNeed,
      personalIncomeAndDivTax,
      taxPublicAndDiv,
      taxPrivatePensionAndIrp,
      taxOverseasCapGains,
      taxIsaAndSeveranceLump,
      additionalPensionContribution,
      personalHealthInsurance,
      personalPropertyTax,
      isHealthDependentEligible,
      dependentIncomeHeadroom,
      corpCorporateTax,
      corpPayrollTaxAndInsurance,
      corpMaintenanceAndFixedCost,
      corpDividendIncome: cRatio > 0 ? Math.max(0, corpDivReturn) : 0,
      corpRealizedSaleGain,
      totalTaxHealthAndFees,
      naiveBaselineTaxAndHealth,
      annualTaxAndHealthSaved,
      endIrp,
      endIsa,
      endPersonalPension,
      endTaxable,
      endCorp,
      endCorpPaidInCapital: corpPaidInCapital,
      endCorpCostBasis: corpBasis,
      endCorpPendingRealizedGain,
      endCorpCarryforwardLoss,
      endCorpLiquidationNetValue,
      endBookTotal,
      endDisposableNetWorth,
      accountingResidual,
    });
  }

  const lastRow = rows[rows.length - 1];
  const retiredRows = rows.filter((r) => !r.isEmployed);
  let minDisposableNetWorthDuringRetirement = lastRow.endDisposableNetWorth;
  let minAssetAgeSelf = lastRow.ageSelf;
  let depletionAgeSelf: number | null = null;

  for (const r of retiredRows) {
    const viewVal = Math.round(r.endDisposableNetWorth * r.discountFactor);
    if (viewVal < minDisposableNetWorthDuringRetirement) {
      minDisposableNetWorthDuringRetirement = viewVal;
      minAssetAgeSelf = r.ageSelf;
    }
    if (depletionAgeSelf === null && (r.endBookTotal <= 0 || r.unmetSpendingNeed > 10_000)) {
      depletionAgeSelf = r.ageSelf;
    }
  }

  const finalBookNetWorth = Math.round(lastRow.endBookTotal * lastRow.discountFactor);
  const finalDisposableNetWorth = Math.round(
    lastRow.endDisposableNetWorth * lastRow.discountFactor
  );
  const basePrincipal = Math.max(1, currentLiquidCapital);
  const preservationRatioPercent = Math.round(
    (minDisposableNetWorthDuringRetirement / basePrincipal) * 100
  );
  const finalAssetMultiple =
    Math.round((finalDisposableNetWorth / basePrincipal) * 10) / 10;

  let totalLifetimeTaxPaid = 0;
  let totalLifetimeHealthInsPaid = 0;
  let totalLifetimeTaxAndHealthCost = 0;
  let totalLifetimeTaxAndHealthSaved = 0;
  let totalUnmetSpendingNeed = 0;
  let maxAccountingResidualAbs = 0;

  for (const r of rows) {
    totalLifetimeTaxPaid += Math.round(
      (r.personalIncomeAndDivTax + r.personalPropertyTax + r.corpCorporateTax) * r.discountFactor
    );
    totalLifetimeHealthInsPaid += Math.round(
      (r.personalHealthInsurance + r.corpPayrollTaxAndInsurance) * r.discountFactor
    );
    totalLifetimeTaxAndHealthCost += Math.round(r.totalTaxHealthAndFees * r.discountFactor);
    totalLifetimeTaxAndHealthSaved += Math.round(r.annualTaxAndHealthSaved * r.discountFactor);
    totalUnmetSpendingNeed += Math.round(r.unmetSpendingNeed * r.discountFactor);
    maxAccountingResidualAbs = Math.max(maxAccountingResidualAbs, Math.abs(r.accountingResidual));
  }

  const total30YearTaxAndHealthSaved = retiredRows
    .slice(0, 30)
    .reduce((acc, r) => acc + Math.round(r.annualTaxAndHealthSaved * r.discountFactor), 0);

  const blueprint: DayOneBlueprint = blueprintSnapshot ?? {
    retirementAgeSelf: targetRetirementAgeSelf,
    yearsToRetirement: 0,
    currentLiquidCapital,
    totalCapitalAtRetirement: currentLiquidCapital,
    personalRatio: pRatio,
    corporateRatio: cRatio,
    allocIrp: rows[0]?.startIrp ?? 0,
    allocIsa: rows[0]?.startIsa ?? 0,
    allocPersonalPension: rows[0]?.startPersonalPension ?? 0,
    allocTaxable: rows[0]?.startTaxable ?? 0,
    allocCorporate: rows[0]?.startCorp ?? 0,
    corporatePaidInCapital: rows[0]?.startCorp ?? 0,
    isaStrategySummary: '3년 의무보유 후 30년 만기 연장 (100세 영구 비과세/9.9% 분리과세 & 건보료 0원)',
  };

  return {
    personalRatio: pRatio,
    corporateRatio: cRatio,
    blueprint,
    rows,
    finalBookNetWorth,
    finalDisposableNetWorth,
    minDisposableNetWorthDuringRetirement,
    minAssetAgeSelf,
    preservationRatioPercent,
    finalAssetMultiple,
    depletionAgeSelf,
    totalLifetimeTaxPaid,
    totalLifetimeHealthInsPaid,
    totalLifetimeTaxAndHealthCost,
    total30YearTaxAndHealthSaved,
    totalLifetimeTaxAndHealthSaved,
    totalUnmetSpendingNeed,
    maxAccountingResidualAbs,
  };
}
