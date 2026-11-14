import {
  ADULT_CHILD_GIFT_EXEMPTION_10Y,
  INHERITANCE_FINANCIAL_ASSET_DEDUCTION_CAP,
  INHERITANCE_LUMP_SUM_DEDUCTION,
  SIMULATION_BASE_YEAR,
  WORKPLACE_MIN_MONTHLY_SALARY_PER_EXEC,
} from './constants';
import { formatKRW } from './presets';
import { shiftInputsReturn } from './sensitivityBand';
import { sincereFilingStatusLine, summarizeSincereFiling } from './sincereFiling';
import {
  getCorporateExitDistributionYears,
  resolveCorporateExitBreakdown,
  runCanonicalLedger,
  solveHouseholdExecutivePayroll,
} from './ledgerKernel';
import {
  calculateAdditionalPensionIncrease,
  evaluatePortfolio,
  evaluateRealEstateForYear,
  getPensionClaimStartAge,
} from './pensionAndEtf';
import {
  calculateCorporateTax,
  calculateGiftOrInheritanceTax,
  calculateIndividualCombinedTax,
  calculateRegionalHealthInsurance,
  solveExecutivePayroll,
} from './taxAndHealth';
import {
  calculateCurrentLiquidAssets,
  normalizeCashflow,
  type ActionChecklistItem,
  type AllocationRecommendation,
  type AllocationCurvePoint,
  type CanonicalLedgerRunResult,
  type CorporateBreakEvenDiagnostic,
  type CorporateExitComparison,
  type CorporateExitStrategyOption,
  type EstateAndGiftDiagnostic,
  type EstateTaxStrategyMetric,
  type ExecutiveStructureComparison,
  type OptimizationMasterPlan,
  type PensionClaimTiming,
  type PensionTimingComparison,
  type SimulationInputs,
  type StrategySummaryCard,
} from './types';

export function solveSustainableMonthlyLiving(
  inputs: SimulationInputs,
  personalRatio: number,
  initialHint?: number,
  steps = 12
): number {
  const baseTarget = inputs.cashflow.targetNetMonthlyLivingExpense;
  let low = initialHint ? Math.max(1_000_000, initialHint - 3_000_000) : 1_500_000;
  let high = initialHint
    ? Math.min(45_000_000, initialHint + 3_000_000)
    : Math.min(45_000_000, Math.max(20_000_000, baseTarget * 3.0));
  for (let iter = 0; iter < steps; iter++) {
    const mid = Math.round((low + high) / 2);
    const trialInputs: SimulationInputs = {
      ...inputs,
      cashflow: {
        ...inputs.cashflow,
        targetNetMonthlyLivingExpense: mid,
      },
    };
    const sim = runCanonicalLedger(trialInputs, personalRatio);
    if (sim.depletionAgeSelf === null && sim.totalUnmetSpendingNeed <= 10_000) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return Math.round(low / 10_000) * 10_000;
}

export function evaluateEstateForSim(
  sim: CanonicalLedgerRunResult,
  inputs: SimulationInputs
): EstateTaxStrategyMetric {
  const lastRow = sim.rows[sim.rows.length - 1];
  const discount = lastRow?.discountFactor ?? 1;
  const v = (n: number) => Math.round(n * discount);

  const reEval = evaluateRealEstateForYear(
    lastRow?.ageSelf ?? 100,
    inputs.realEstate,
    sim.corporateRatio
  );
  const realEstateValue = v(reEval.effectiveAssessedValue);

  // 개인 순금융자산 (IRP + ISA + 개인연금 + 일반과세계좌)
  const personalFinNominal =
    (lastRow?.endIrp ?? 0) +
    (lastRow?.endIsa ?? 0) +
    (lastRow?.endPersonalPension ?? 0) +
    (lastRow?.endTaxable ?? 0);
  const personalFin = v(personalFinNominal);

  // 법인 순자산 (청산가치 기준)
  const corpNetNominal = lastRow?.endCorpLiquidationNetValue ?? 0;
  const corpNet = v(corpNetNominal);

  const grossEstateValue = realEstateValue + personalFin + corpNet;

  // 상증세법 §22 금융재산상속공제: 순금융재산의 20% (최대 2억 원 한도, 최대주주 비상장주식 제외)
  const financialAssetDeduction = Math.min(
    INHERITANCE_FINANCIAL_ASSET_DEDUCTION_CAP,
    Math.round(personalFin * 0.20)
  );

  // 상증세법 §21 일괄공제 5억 원
  const lumpSumAndSpouseDeduction = INHERITANCE_LUMP_SUM_DEDUCTION;

  const inheritanceTaxableBase = Math.max(
    0,
    grossEstateValue - lumpSumAndSpouseDeduction - financialAssetDeduction
  );

  const estimatedInheritanceTax = calculateGiftOrInheritanceTax(inheritanceTaxableBase, true);

  // 부동산 제외 순금융·법인 기준 세후 상속가치 (가처분 순자산과 직접 비교용)
  const netFinAndCorp = personalFin + corpNet;
  const netAfterInheritanceValue = Math.max(
    0,
    netFinAndCorp - Math.min(netFinAndCorp, estimatedInheritanceTax)
  );

  // 부동산 포함 세후 총상속재산
  const totalNetEstateAfterTax = Math.max(0, grossEstateValue - estimatedInheritanceTax);

  return {
    grossEstateValue,
    realEstateValue,
    financialAssetDeduction,
    lumpSumAndSpouseDeduction,
    inheritanceTaxableBase,
    estimatedInheritanceTax,
    netAfterInheritanceValue,
    totalNetEstateAfterTax,
  };
}

export function evaluateCorporateBreakEven(
  inputs: SimulationInputs,
  precomputedPersonal100?: CanonicalLedgerRunResult,
  precomputedOptimalHybrid?: CanonicalLedgerRunResult,
  precomputedCorporate100?: CanonicalLedgerRunResult,
  /** E-4: B7 강건성 권고 비율 — 100이면 손익분기 판정·문구를 개인 기준으로 */
  recommendedPersonalRatio?: number
): CorporateBreakEvenDiagnostic {
  const hasSpouse = inputs.pension.hasSpouse ?? true;
  const portfolio = evaluatePortfolio(inputs.asset);
  const currentLiquid = calculateCurrentLiquidAssets(inputs);
  const estAnnualDiv = Math.round(
    inputs.asset.totalInvestment * (portfolio.effectiveDividendYield / 100)
  );

  const regHealth = calculateRegionalHealthInsurance({
    assessedPropertyValue:
      inputs.realEstate.housingType === 'rent'
        ? 0
        : inputs.realEstate.officiallyAssessedValue,
    leaseDeposit:
      inputs.realEstate.housingType === 'rent' ? inputs.realEstate.leaseDeposit : 0,
    ownership: inputs.realEstate.ownership,
    fairMarketValueRatio: inputs.realEstate.fairMarketValueRatio,
    apply2024Reform: inputs.realEstate.apply2024HealthReform ?? true,
    assessableAnnualIncome: estAnnualDiv,
    hasSpouse,
  });

  const p100 = precomputedPersonal100 ?? runCanonicalLedger(inputs, 100);
  const c100 = precomputedCorporate100 ?? runCanonicalLedger(inputs, 0);
  const opt =
    precomputedOptimalHybrid ??
    (c100.finalDisposableNetWorth > p100.finalDisposableNetWorth ? c100 : p100);
  const corpCandidate = opt.corporateRatio > 0 ? opt : c100;

  const pRetRows = p100.rows.filter((r) => !r.isEmployed);
  const cRetRows = corpCandidate.rows.filter((r) => !r.isEmployed);
  const retYears = Math.max(1, pRetRows.length);

  let totalHealthDiff = 0;
  let totalTaxDiff = 0;
  for (let i = 0; i < pRetRows.length; i++) {
    const pRow = pRetRows[i];
    const cRow = cRetRows[i] ?? pRow;
    totalHealthDiff += Math.max(
      0,
      Math.round((pRow.personalHealthInsurance - cRow.personalHealthInsurance) * pRow.discountFactor)
    );
    const pTax = pRow.personalIncomeAndDivTax + pRow.corpCorporateTax;
    const cTax = cRow.personalIncomeAndDivTax + cRow.corpCorporateTax;
    totalTaxDiff += Math.round((pTax - cTax) * pRow.discountFactor);
  }

  const ledgerAvgHealthShield = Math.round(totalHealthDiff / retYears);
  const annualRegionalHealthInsShield = Math.max(regHealth.annualTotal, ledgerAvgHealthShield);

  const execCount: 1 | 2 = hasSpouse ? inputs.corporate.executiveCount : 1;
  // G2: 임원 보수 노사 비용은 원장 첫 은퇴연도와 같은 기준(임원별 만 나이·국민연금 요율 스케줄)으로 산출
  const retIdx = Math.max(0, inputs.transition.targetRetirementAgeSelf - inputs.pension.currentAgeSelf);
  const minPayroll = solveHouseholdExecutivePayroll(
    Math.max(
      WORKPLACE_MIN_MONTHLY_SALARY_PER_EXEC,
      inputs.corporate.executiveSalaryMonthly || WORKPLACE_MIN_MONTHLY_SALARY_PER_EXEC
    ),
    execCount,
    inputs.pension.currentAgeSelf + retIdx,
    inputs.pension.currentAgeSpouse + retIdx,
    retIdx
  );
  const payrollFriction =
    minPayroll.annualTotalCorporatePayrollCost - minPayroll.annualTotalNetSalary;
  const annualCorporateFixedCost =
    Math.max(0, inputs.corporate.annualFixedMaintenanceFee || 0) + payrollFriction;

  const indDivTax = calculateIndividualCombinedTax(estAnnualDiv, 0).dividendTax;
  const corpTax = calculateCorporateTax(estAnnualDiv, inputs.corporate.taxType);
  const staticTaxShield = Math.max(0, indDivTax - corpTax);
  const ledgerAvgTaxShield = Math.max(0, Math.round(totalTaxDiff / retYears));

  const lifetimeNetWorthDiff = opt.finalDisposableNetWorth - p100.finalDisposableNetWorth;
  const corpWinsInLedger = opt.corporateRatio > 0 && lifetimeNetWorthDiff > 0;
  const annualizedNetWorthGain = corpWinsInLedger
    ? Math.max(100_000, Math.round(lifetimeNetWorthDiff / retYears))
    : 0;

  const annualTaxShield = corpWinsInLedger
    ? Math.max(
        staticTaxShield,
        ledgerAvgTaxShield,
        Math.max(0, annualCorporateFixedCost - annualRegionalHealthInsShield + annualizedNetWorthGain)
      )
    : Math.min(
        Math.max(staticTaxShield, ledgerAvgTaxShield),
        Math.max(0, annualCorporateFixedCost - annualRegionalHealthInsShield)
      );

  const annualTotalBenefit = annualRegionalHealthInsShield + annualTaxShield;
  const netAnnualAdvantage = annualTotalBenefit - annualCorporateFixedCost;

  const effectiveYield = Math.max(
    0.02,
    (portfolio.effectiveTotalReturn + (inputs.asset.returnShiftPct ?? 0)) / 100
  );
  const neededForFixedAfterHealth = Math.max(
    0,
    annualCorporateFixedCost - annualRegionalHealthInsShield
  );
  const breakEvenLiquidAssetThreshold = Math.round(
    Math.max(150_000_000, neededForFixedAfterHealth / (effectiveYield * 0.06))
  );
  // E-4: 강건성 게이트(B7)가 법인안을 기각해 권고가 개인 100%면 손익분기 판정도 개인으로 동기화
  const robustRejected = recommendedPersonalRatio === 100 && opt.corporateRatio > 0;
  const isAboveBreakEven =
    !robustRejected &&
    (corpWinsInLedger ||
      (currentLiquid >= breakEvenLiquidAssetThreshold && netAnnualAdvantage > 0 && opt.corporateRatio > 0));

  const recommendedStrategy: 'personal' | 'corporate' | 'hybrid' = !isAboveBreakEven
    ? 'personal'
    : opt.personalRatio === 0
      ? 'corporate'
      : 'hybrid';

  const verdictSummary = robustRejected
    ? `수학적 최적안(개인 ${opt.personalRatio}% : 법인 ${opt.corporateRatio}%)은 개인 단독보다 100세 가처분 순자산이 ${formatKRW(Math.max(0, lifetimeNetWorthDiff))} 많지만, 법인 유지비 1.5배 또는 수익률 −0.5%p 스트레스에서 우위가 유지되지 않아 강건성 기준으로 법인 미설립(개인 100%)을 권고합니다.`
    : isAboveBreakEven
    ? `최적 하이브리드(개인 ${opt.personalRatio}% : 법인 ${opt.corporateRatio}%) 적용 시 연간 건보·절세·과세이연 실익(${formatKRW(annualTotalBenefit)}/년)이 법인 유지·보수 비용(${formatKRW(annualCorporateFixedCost)}/년)을 상회하여, 개인 단독 대비 100세 가처분 순자산이 +${formatKRW(lifetimeNetWorthDiff)} 증가합니다.${
        netAnnualAdvantage < 10_000_000
          ? ` (※ 단, 초기 정적 순실익이 연 +${formatKRW(netAnnualAdvantage)} 수준이며 주된 격차는 ${retYears}년 장기 과세이연·가수금 비과세 복리에서 발생하므로, 법인 설립·기장 및 상근 세무 소명 등 행정 비용 대비 실익을 함께 고려하세요.)`
          : ''
      }`
    : `법인 고정 유지비 대비 절세·건보 방어 실익이 부족하므로 개인 절세계좌(ISA·연금저축·IRP) 중심 운용이 유리합니다.`;

  return {
    annualRegionalHealthInsShield,
    annualTaxShield,
    annualTotalBenefit,
    annualCorporateFixedCost,
    netAnnualAdvantage,
    breakEvenLiquidAssetThreshold,
    isAboveBreakEven,
    recommendedStrategy,
    verdictSummary,
  };
}

export function evaluateCorporateExitStrategies(
  ledger: CanonicalLedgerRunResult,
  inputs: SimulationInputs
): CorporateExitComparison {
  const lastRow = ledger.rows[ledger.rows.length - 1];
  const discount = lastRow?.discountFactor ?? 1;
  const hasSpouse = inputs.pension.hasSpouse ?? true;
  const personCount = hasSpouse ? 2 : 1;
  // A1: 원장 청산가치와 같은 함수(resolveCorporateExitBreakdown)로 명목 세액을 산출한 뒤 뷰 할인율 적용
  const exitBase = {
    corpBalance: lastRow?.endCorp ?? 0,
    costBasis: lastRow?.endCorpCostBasis ?? lastRow?.endCorp ?? 0,
    paidInCapital: lastRow?.endCorpPaidInCapital ?? 0,
    pendingRealizedGain: lastRow?.endCorpPendingRealizedGain ?? 0,
    taxType: inputs.corporate.taxType,
    shareholderCount: personCount as 1 | 2,
    carryforwardLoss: lastRow?.endCorpCarryforwardLoss ?? 0,
  };
  const v = (n: number) => Math.round(n * discount);
  const finalCorpBookAssets = v(exitBase.corpBalance);
  const rate = (tax: number, health: number) =>
    finalCorpBookAssets > 0 ? Number((((tax + health) / finalCorpBookAssets) * 100).toFixed(1)) : 0;

  // 1~3안 세금·건보료는 원장 청산가치와 같은 resolveCorporateExitBreakdown 산출값(건보: 인별 1,000만 컷·월 상한)
  // 1. 단순 일괄 청산 (출자금 미분리, 1년 일시 의제배당)
  const b1 = resolveCorporateExitBreakdown({ ...exitBase, liquidationTaxMode: 'simple_gross', distributionYears: 1 });
  const grossTax1 = v(b1.latentCorporateTax + b1.dividendTax);
  const grossHealth1 = v(b1.extraHealthInsurance);
  const net1 = v(b1.netValue);
  const lumpSumGross: CorporateExitStrategyOption = {
    strategyType: 'lump_sum_gross',
    title: '단순 일괄 청산 (원금 미분리)',
    finalCorpBookAssets,
    paidInCapitalExempt: 0,
    taxableDistribution: v(b1.deemedDividend),
    exitTaxPaid: grossTax1,
    corporateLevelTax: v(b1.latentCorporateTax),
    extraHealthInsPaid: grossHealth1,
    netPocketedValue: net1,
    effectiveExitTaxRatePercent: rate(grossTax1, grossHealth1),
    description: '출자원금 분리 없이 법인 잔고 전액을 일시 청산 배당할 때의 기준선 (미실현이익 법인세 포함)',
  };

  // 2. 출자원금 비과세 환원 + 잔여 유보금 일시 청산 (소득세법 §17②: 의제배당 = 분배액 − 취득가액)
  const b2 = resolveCorporateExitBreakdown({
    ...exitBase,
    liquidationTaxMode: 'capital_return_exempt',
    distributionYears: 1,
  });
  const tax2 = v(b2.latentCorporateTax + b2.dividendTax);
  const health2 = v(b2.extraHealthInsurance);
  const net2 = v(b2.netValue);
  const lumpSumCapitalExempt: CorporateExitStrategyOption = {
    strategyType: 'lump_sum_capital_exempt',
    title: '출자원금 비과세 + 일시 청산',
    finalCorpBookAssets,
    paidInCapitalExempt: v(b2.capitalReturn),
    taxableDistribution: v(b2.deemedDividend),
    exitTaxPaid: tax2,
    corporateLevelTax: v(b2.latentCorporateTax),
    extraHealthInsPaid: health2,
    netPocketedValue: net2,
    effectiveExitTaxRatePercent: rate(tax2, health2),
    description: '납입자본금(가수금)을 세금 0원으로 선회수한 후 유보이익만 의제배당 과세 (미실현이익 법인세 포함)',
  };

  // 3. 유상감자 비과세 + N년 분할 배당 출구 (원장 기본 출구 가정과 동일 연수)
  const years = getCorporateExitDistributionYears({ ...inputs.corporate, exitStrategy: 'phased_dividend_reduction' });
  const b3 = resolveCorporateExitBreakdown({
    ...exitBase,
    liquidationTaxMode: inputs.corporate.liquidationTaxMode ?? 'capital_return_exempt',
    distributionYears: years,
  });
  const tax3 = v(b3.latentCorporateTax + b3.dividendTax);
  const health3 = v(b3.extraHealthInsurance);
  const net3 = v(b3.netValue);
  const phasedExit: CorporateExitStrategyOption = {
    strategyType: 'phased_dividend_reduction',
    title: `유상감자 비과세 + ${years}년 분할 배당`,
    finalCorpBookAssets,
    paidInCapitalExempt: v(b3.capitalReturn),
    taxableDistribution: v(b3.deemedDividend),
    exitTaxPaid: tax3,
    corporateLevelTax: v(b3.latentCorporateTax),
    extraHealthInsPaid: health3,
    netPocketedValue: net3,
    effectiveExitTaxRatePercent: rate(tax3, health3),
    description: `인당 연 2,000만 원 분리과세 한도를 ${years}년간 활용해 종소세 누진을 완화 (분배 연도 기타 종합소득 0 가정, 인별 연 1,000만 초과 시 건보료 부과)`,
  };

  // 4. 자녀 지분(50%) 참여 및 사전증여 지분승계 (※ 금융투자법인은 상증세법상 가업상속공제 제외, §45의5 특정법인 증여의제 유의)
  const retainedAfterCorpTax = Math.max(0, b2.deemedDividend);
  const childCount = 2;
  const exemptionPerChild = ADULT_CHILD_GIFT_EXEMPTION_10Y * 2; // 성년 자녀 2인 각 1억 원 (10년 주기 증여재산공제 5,000만 원 × 2회 활용)
  const perChildBase = Math.max(0, Math.round(retainedAfterCorpTax / childCount) - exemptionPerChild);
  const giftTaxPerChild = calculateGiftOrInheritanceTax(perChildBase, true);
  const totalGiftTax = giftTaxPerChild * childCount;
  const tax4 = v(b2.latentCorporateTax + totalGiftTax);
  const net4 = Math.max(0, finalCorpBookAssets - tax4);
  const familySuccession: CorporateExitStrategyOption = {
    strategyType: 'family_share_transfer',
    title: '자녀 지분 참여 · 가족법인 지분승계',
    finalCorpBookAssets,
    paidInCapitalExempt: v(b2.capitalReturn),
    taxableDistribution: v(retainedAfterCorpTax),
    exitTaxPaid: tax4,
    corporateLevelTax: v(b2.latentCorporateTax),
    extraHealthInsPaid: 0,
    netPocketedValue: net4,
    effectiveExitTaxRatePercent: rate(tax4, 0),
    description:
      '설립 시 자녀 지분 참여 및 10년 주기 증여공제를 결합해 청산·상속 이중과세 차단 (※ 금융투자법인은 가업상속공제 제외 · 무이자 가수금 대여 시 상증세법 §45의5 증여의제 유의)',
  };

  const candidates = [lumpSumGross, lumpSumCapitalExempt, phasedExit, familySuccession];
  candidates.sort((a, b) => b.netPocketedValue - a.netPocketedValue);
  const best = candidates[0];

  return {
    lumpSumGross,
    lumpSumCapitalExempt,
    phasedExit,
    familySuccession,
    recommendedExit: best.strategyType,
    maxTaxSavedVsSimpleGross: Math.max(0, best.netPocketedValue - lumpSumGross.netPocketedValue),
  };
}

function buildStrategyCard(
  strategyType: 'personal' | 'corporate' | 'hybrid',
  strategyName: string,
  sim: CanonicalLedgerRunResult,
  sustainableMonthlyLivingExpense: number,
  inputs: SimulationInputs
): StrategySummaryCard {
  const targetLiving = inputs.cashflow.targetNetMonthlyLivingExpense;
  return {
    strategyType,
    strategyName,
    personalRatio: sim.personalRatio,
    corporateRatio: sim.corporateRatio,
    finalDisposableNetWorth: sim.finalDisposableNetWorth,
    finalBookNetWorth: sim.finalBookNetWorth,
    totalLifetimeTaxAndHealthCost: sim.totalLifetimeTaxAndHealthCost,
    totalLifetimeTaxAndHealthSaved: sim.totalLifetimeTaxAndHealthSaved,
    sustainableMonthlyLivingExpense,
    monthlyBuffer: sustainableMonthlyLivingExpense - targetLiving,
    isSustainable: sim.depletionAgeSelf === null && sim.totalUnmetSpendingNeed === 0,
    preservationRatioPercent: sim.preservationRatioPercent,
    finalAssetMultiple: sim.finalAssetMultiple,
    minDisposableNetWorthDuringRetirement: sim.minDisposableNetWorthDuringRetirement,
    minAssetAgeSelf: sim.minAssetAgeSelf,
    depletionAgeSelf: sim.depletionAgeSelf,
    realEstateHealthInsShielded: sim.corporateRatio > 0 && sim.finalBookNetWorth > 0,
  };
}

/**
 * B7 실익 임계: 수학적 r*(법인 포함)를 그대로 권고할지, 개인 100%로 보수 권고할지 결정
 * 법인 포함 권고 = r* < 100 && [강건성: 유지비 ×1.5(미반영 기장·세무·증빙 비용 대리)·수익률 −0.5%p 두 섭동 모두에서 r* > 개인100%]
 *                 && [지속가능 월생활비 ≥ 개인100% − 5만원(이분탐색 1만원 정밀도·보간 노이즈)]
 *                 || 고갈 구제(개인100%만 고갈) || 고갈 연령 +3년 이상 개선
 */
export function recommendAllocation(p: {
  bestRatio: number;
  optimalFinal: number;
  personalFinal: number;
  optimalDepletionAge: number | null;
  personalDepletionAge: number | null;
  sustainableHybrid: number;
  sustainablePersonal: number;
  robustToMaintenance: boolean;
  robustToReturn: boolean;
}): AllocationRecommendation {
  const gainKrw = p.optimalFinal - p.personalFinal;
  const gainPct = Math.round((gainKrw / Math.max(1, Math.abs(p.personalFinal))) * 1000) / 10;
  const monthlyDelta = p.sustainableHybrid - p.sustainablePersonal;
  const mathOptimum = (reason: string, robustnessFailure?: AllocationRecommendation['robustnessFailure']) => ({
    personalRatio: p.bestRatio,
    corporateRatio: 100 - p.bestRatio,
    isMathematicalOptimum: true,
    netWorthGainPct: gainPct,
    netWorthGainKrw: gainKrw,
    sustainableMonthlyDelta: monthlyDelta,
    ...(robustnessFailure ? { robustnessFailure } : {}),
    reason,
  });
  if (p.bestRatio >= 100) return mathOptimum('개인 100%가 수학적 최적 배분입니다.');

  const robustnessFailure: AllocationRecommendation['robustnessFailure'] =
    !p.robustToMaintenance && !p.robustToReturn
      ? 'maintenance_and_return'
      : !p.robustToMaintenance
        ? 'maintenance'
        : !p.robustToReturn
          ? 'return'
          : undefined;
  const corpLabel = `개인 ${p.bestRatio}% : 법인 ${100 - p.bestRatio}%`;
  const gainText = `100세 순자산 ${gainKrw >= 0 ? '+' : ''}${formatKRW(gainKrw)}(${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%)`;
  const monthlyText = `지속가능 월생활비 ${monthlyDelta >= 0 ? '+' : '−'}${formatKRW(Math.abs(monthlyDelta))}`;

  if (p.personalDepletionAge !== null && p.optimalDepletionAge === null) {
    return mathOptimum(
      `개인 100%는 ${p.personalDepletionAge}세에 금융자산이 고갈되지만 ${corpLabel}는 100세까지 유지되어 법인 포함 배분을 권고합니다.`,
      robustnessFailure
    );
  }
  if (
    p.personalDepletionAge !== null &&
    p.optimalDepletionAge !== null &&
    p.optimalDepletionAge - p.personalDepletionAge >= 3
  ) {
    return mathOptimum(
      `${corpLabel} 배분 시 고갈 연령이 ${p.personalDepletionAge}세 → ${p.optimalDepletionAge}세로 늦춰져 법인 포함 배분을 권고합니다.`,
      robustnessFailure
    );
  }
  const monthlyOk = monthlyDelta >= -50_000;
  if (!robustnessFailure && monthlyOk) {
    return mathOptimum(
      `${corpLabel}: ${gainText}, ${monthlyText}. 법인 유지비 50% 증가·수익률 −0.5%p에서도 개인 100%보다 우위라 수학적 최적 배분을 권고합니다.`
    );
  }
  if (p.personalDepletionAge !== null && p.optimalDepletionAge !== null) {
    return {
      personalRatio: 100,
      corporateRatio: 0,
      isMathematicalOptimum: false,
      netWorthGainPct: gainPct,
      netWorthGainKrw: gainKrw,
      sustainableMonthlyDelta: monthlyDelta,
      ...(robustnessFailure ? { robustnessFailure } : {}),
      reason: `수학적 최적(${corpLabel})도 ${p.optimalDepletionAge}세에 고갈되어 개인 100%(${p.personalDepletionAge}세 고갈) 대비 고갈 연령 개선이 3년 미만이므로 개인 100%를 권고합니다.`,
    };
  }
  const causes: string[] = [];
  if (robustnessFailure) {
    const what =
      robustnessFailure === 'maintenance_and_return'
        ? '법인 유지비 50% 증가 또는 수익률 −0.5%p'
        : robustnessFailure === 'maintenance'
          ? '법인 유지비 50% 증가'
          : '수익률 −0.5%p';
    causes.push(`${what} 시 개인 100%가 우위로 뒤집힘`);
  }
  if (!monthlyOk) causes.push(`지속가능 월생활비가 개인 100%보다 ${formatKRW(-monthlyDelta)} 낮음`);
  return {
    personalRatio: 100,
    corporateRatio: 0,
    isMathematicalOptimum: false,
    netWorthGainPct: gainPct,
    netWorthGainKrw: gainKrw,
    sustainableMonthlyDelta: monthlyDelta,
    ...(robustnessFailure ? { robustnessFailure } : {}),
    reason: `수학적 최적(${corpLabel})의 ${gainText}, ${monthlyText}이지만 ${causes.join(' · ')} → 실익이 불확실해 개인 100%를 권고합니다.`,
  };
}

export function solveNestWaySlider(
  rawInputs: SimulationInputs
): OptimizationMasterPlan {
  const t0 = performance.now();
  const inputs: SimulationInputs = {
    ...rawInputs,
    cashflow: normalizeCashflow(rawInputs.cashflow),
  };

  const portfolio = evaluatePortfolio(inputs.asset);
  const simCache = new Map<number, CanonicalLedgerRunResult>();
  const getSim = (pRatio: number): CanonicalLedgerRunResult => {
    const clamped = Math.min(100, Math.max(0, Math.round(pRatio)));
    const cached = simCache.get(clamped);
    if (cached) return cached;
    const computed = runCanonicalLedger(inputs, clamped);
    simCache.set(clamped, computed);
    return computed;
  };

  // 1. 0%~100% (10% 간격) 그리드 탐색 + 국소 정밀 탐색으로 전역 최적 배분(r*) 도출
  //    비교 기준: ① 최종 가처분 순자산(또는 상속세 후 총상속재산) ↑ ② (동률 시) 고갈 연령 ↓늦게 ③ (동률 시) 미충족 생활비 ↓
  //    → 모든 후보가 고갈되어 순자산이 0으로 동률일 때 첫 후보(r=0, 법인 100%)가 승자로 고정되는 결함 차단
  const isInheritanceTerminal = inputs.corporate.terminalValuationMode === 'inheritance';
  const isBetter = (cand: CanonicalLedgerRunResult, incumbent: CanonicalLedgerRunResult | null) => {
    if (!incumbent) return true;
    if (isInheritanceTerminal) {
      const candEstate = evaluateEstateForSim(cand, inputs).totalNetEstateAfterTax;
      const incEstate = evaluateEstateForSim(incumbent, inputs).totalNetEstateAfterTax;
      if (candEstate !== incEstate) return candEstate > incEstate;
    } else {
      if (cand.finalDisposableNetWorth !== incumbent.finalDisposableNetWorth) {
        return cand.finalDisposableNetWorth > incumbent.finalDisposableNetWorth;
      }
    }
    const candDep = cand.depletionAgeSelf ?? Number.POSITIVE_INFINITY;
    const incDep = incumbent.depletionAgeSelf ?? Number.POSITIVE_INFINITY;
    if (candDep !== incDep) return candDep > incDep;
    return cand.totalUnmetSpendingNeed < incumbent.totalUnmetSpendingNeed;
  };
  const gridRatios = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  let bestRatio = 50;
  let bestSim: CanonicalLedgerRunResult | null = null;

  for (const r of gridRatios) {
    const sim = getSim(r);
    if (isBetter(sim, bestSim)) {
      bestSim = sim;
      bestRatio = r;
    }
  }

  // 2단계 정밀 탐색: ±5 → ±3 → ±2 → ±1 수축 후, ±1 언덕오르기(hill-climb)로 개선이 없을 때까지 수렴
  for (const step of [5, 3, 2, 1]) {
    for (const c of [Math.max(0, bestRatio - step), Math.min(100, bestRatio + step)]) {
      const sim = getSim(c);
      if (isBetter(sim, bestSim)) {
        bestSim = sim;
        bestRatio = c;
      }
    }
  }
  for (let guard = 0; guard < 100; guard += 1) {
    let improved = false;
    for (const c of [Math.max(0, bestRatio - 1), Math.min(100, bestRatio + 1)]) {
      const sim = getSim(c);
      if (isBetter(sim, bestSim)) {
        bestSim = sim;
        bestRatio = c;
        improved = true;
      }
    }
    if (!improved) break;
  }
  const allocationStatus: OptimizationMasterPlan['allocationStatus'] = gridRatios.every(
    (r) => getSim(r).depletionAgeSelf !== null
  )
    ? 'ALL_DEPLETE'
    : 'OK';

  const personal100 = getSim(100);
  const corporate100 = getSim(0);
  const optimalHybrid = getSim(bestRatio);

  // 지속가능 한계 월생활비 산출 (12-step 이분탐색, 1만원 단위 정밀도)
  const sustHybrid = solveSustainableMonthlyLiving(inputs, bestRatio, undefined, 12);
  const sustPersonal =
    bestRatio === 100
      ? sustHybrid
      : solveSustainableMonthlyLiving(inputs, 100, undefined, 12);
  const sustCorporate =
    bestRatio === 0
      ? sustHybrid
      : solveSustainableMonthlyLiving(inputs, 0, undefined, 12);

  // B7: r*의 개인 100% 대비 우위가 모델 오차 섭동(유지비 ×1.5, 수익률 −0.5%p)에서도 유지되는지 확인 (원장 +4회)
  const beatsPersonalUnder = (perturbed: SimulationInputs) =>
    runCanonicalLedger(perturbed, bestRatio).finalDisposableNetWorth >
    runCanonicalLedger(perturbed, 100).finalDisposableNetWorth;
  const recommendation = recommendAllocation({
    bestRatio,
    optimalFinal: optimalHybrid.finalDisposableNetWorth,
    personalFinal: personal100.finalDisposableNetWorth,
    optimalDepletionAge: optimalHybrid.depletionAgeSelf,
    personalDepletionAge: personal100.depletionAgeSelf,
    sustainableHybrid: sustHybrid,
    sustainablePersonal: sustPersonal,
    robustToMaintenance:
      bestRatio >= 100 ||
      beatsPersonalUnder({
        ...inputs,
        corporate: {
          ...inputs.corporate,
          annualFixedMaintenanceFee: Math.round((inputs.corporate.annualFixedMaintenanceFee || 0) * 1.5),
        },
      }),
    robustToReturn: bestRatio >= 100 || beatsPersonalUnder(shiftInputsReturn(inputs, -0.5)),
  });
  const recommendedRatio = recommendation.personalRatio;
  const recommendedSim = getSim(recommendedRatio);
  const activePersonalRatio =
    inputs.hybrid.useAutoOptimalRatio ?? true ? recommendedRatio : inputs.hybrid.personalRatio;
  const activeLedger = getSim(activePersonalRatio);

  const curveRatioSet = new Set<number>([...gridRatios, bestRatio]);
  const sortedCurveRatios = Array.from(curveRatioSet).sort((a, b) => a - b);
  const allocationCurve: AllocationCurvePoint[] = sortedCurveRatios.map((r) => {
    const s = getSim(r);
    const interpSust = Math.round(
      (sustCorporate * (100 - r) + sustPersonal * r) / 100 / 10_000
    ) * 10_000;
    return {
      personalRatio: r,
      corporateRatio: 100 - r,
      finalDisposableNetWorth: s.finalDisposableNetWorth,
      totalLifetimeTaxAndHealthCost: s.totalLifetimeTaxAndHealthCost,
      sustainableMonthlyLivingExpense: r === bestRatio ? sustHybrid : interpSust,
      sustainableIsInterpolated: r !== bestRatio,
      depletionAgeSelf: s.depletionAgeSelf,
    };
  });

  const cards = {
    personal: buildStrategyCard('personal', '개인 100% (절세계좌+일반)', personal100, sustPersonal, inputs),
    corporate: buildStrategyCard('corporate', '법인 100% (가족법인 집중)', corporate100, sustCorporate, inputs),
    hybrid: buildStrategyCard(
      'hybrid',
      `최적 하이브리드 (개인 ${bestRatio}% : 법인 ${100 - bestRatio}%)`,
      optimalHybrid,
      sustHybrid,
      inputs
    ),
  };

  // U-1: 활성 비율(auto=권고, 수동=사용자) 카드 — r*·0·100이면 기존 카드 재사용, 그 외 수동 비율은 이분탐색 실계산
  const activeCard =
    activePersonalRatio === 100
      ? cards.personal
      : activePersonalRatio === 0
        ? cards.corporate
        : activePersonalRatio === bestRatio
          ? cards.hybrid
          : buildStrategyCard(
              'hybrid',
              `하이브리드 (개인 ${activePersonalRatio}% : 법인 ${100 - activePersonalRatio}%)`,
              activeLedger,
              solveSustainableMonthlyLiving(inputs, activePersonalRatio, undefined, 12),
              inputs
            );

  // A안: 승자·제목·우위는 권고 배분 기준 (수학적 r*는 cards.hybrid / optimalHybrid)
  let winner: 'personal' | 'corporate' | 'hybrid' = 'hybrid';
  if (recommendedRatio === 100) winner = 'personal';
  else if (recommendedRatio === 0) winner = 'corporate';

  const winnerAdvantageOverRunnerUp = Math.max(
    0,
    winner === 'hybrid'
      ? recommendedSim.finalDisposableNetWorth -
          Math.max(personal100.finalDisposableNetWorth, corporate100.finalDisposableNetWorth)
      : winner === 'personal'
        ? personal100.finalDisposableNetWorth - corporate100.finalDisposableNetWorth
        : corporate100.finalDisposableNetWorth - personal100.finalDisposableNetWorth
  );

  const winnerTitle =
    allocationStatus === 'ALL_DEPLETE'
      ? `현 조건 지속 불가 (권고: 개인 ${recommendedRatio}% · ${recommendedSim.depletionAgeSelf}세 고갈)`
      : winner === 'personal'
        ? '개인 100% (3대 절세계좌 중심)'
        : winner === 'corporate'
          ? '가족법인 100% 집중 운용'
          : `개인 ${recommendedRatio}% : 법인 ${100 - recommendedRatio}% 하이브리드`;

  const breakEven = evaluateCorporateBreakEven(
    inputs,
    personal100,
    optimalHybrid,
    corporate100,
    recommendedRatio
  );
  const corporateExit = evaluateCorporateExitStrategies(
    activeLedger.corporateRatio > 0 ? activeLedger : corporate100,
    inputs
  );
  const recommendedExitOption = {
    lump_sum_gross: corporateExit.lumpSumGross,
    lump_sum_capital_exempt: corporateExit.lumpSumCapitalExempt,
    phased_dividend_reduction: corporateExit.phasedExit,
    family_share_transfer: corporateExit.familySuccession,
  }[corporateExit.recommendedExit];

  // 국민연금 수령시기(조기/정상/연기) 3종 비교 (viewMode === 'real' 시 개시 시점 물가할인계수 적용해 슬라이드/표 간 1원 단위 일치 보장)
  const isRealView = inputs.transition.viewMode === 'real';
  const buildPensionOption = (timing: PensionClaimTiming, label: string) => {
    const isCurrentTiming =
      inputs.pension.claimTimingSelf === timing && inputs.pension.claimTimingSpouse === timing;
    const sim = isCurrentTiming
      ? activeLedger
      : runCanonicalLedger(
          {
            ...inputs,
            pension: {
              ...inputs.pension,
              claimTimingSelf: timing,
              claimTimingSpouse: timing,
            },
          },
          activePersonalRatio
        );
    const claimAge = getPensionClaimStartAge(timing, SIMULATION_BASE_YEAR - inputs.pension.currentAgeSelf);
    const firstActiveRow = sim.rows.find((r) => r.publicPensionInflow > 0);
    const firstDf = isRealView ? (firstActiveRow?.discountFactor ?? 1) : 1;
    const cumulativePayoutTo100 = sim.rows.reduce(
      (acc, r) => acc + Math.round(r.publicPensionInflow * (isRealView ? r.discountFactor : 1)),
      0
    );
    return {
      metric: {
        timing,
        label,
        claimAgeSelf: claimAge,
        monthlyPayoutInitial: Math.round(((firstActiveRow?.publicPensionInflow ?? 0) * firstDf) / 12),
        cumulativePayoutTo100,
        finalDisposableNetWorth: sim.finalDisposableNetWorth,
        crossoverAgeVsNormal: null as number | null,
      },
      rows: sim.rows,
    };
  };

  const findCrossoverAge = (
    laterRows: typeof activeLedger.rows,
    earlierRows: typeof activeLedger.rows,
    minAge: number
  ): number | null => {
    let cumLater = 0;
    let cumEarlier = 0;
    const len = Math.min(laterRows.length, earlierRows.length);
    for (let i = 0; i < len; i++) {
      const rLater = laterRows[i];
      const rEarlier = earlierRows[i];
      cumLater += Math.round(rLater.publicPensionInflow * (isRealView ? rLater.discountFactor : 1));
      cumEarlier += Math.round(
        rEarlier.publicPensionInflow * (isRealView ? rEarlier.discountFactor : 1)
      );
      if (rLater.ageSelf >= minAge && cumLater > 0 && cumLater >= cumEarlier) {
        return rLater.ageSelf;
      }
    }
    return null;
  };

  // 출생연도별 법정 수급개시연령(1965~68년생 64세 등) 기준 라벨
  const birthYearSelf = SIMULATION_BASE_YEAR - inputs.pension.currentAgeSelf;
  const ageLabel = (t: PensionClaimTiming) => getPensionClaimStartAge(t, birthYearSelf);
  const builtEarly = buildPensionOption('early', `조기수령 (${ageLabel('early')}세 · 70%)`);
  const builtNormal = buildPensionOption('normal', `정상수령 (${ageLabel('normal')}세 · 100%)`);
  const builtDeferred = buildPensionOption('deferred', `연기수령 (${ageLabel('deferred')}세 · 136%)`);

  builtEarly.metric.crossoverAgeVsNormal = findCrossoverAge(
    builtNormal.rows,
    builtEarly.rows,
    builtNormal.metric.claimAgeSelf
  );
  builtDeferred.metric.crossoverAgeVsNormal = findCrossoverAge(
    builtDeferred.rows,
    builtNormal.rows,
    builtDeferred.metric.claimAgeSelf
  );

  const pEarly = builtEarly.metric;
  const pNormal = builtNormal.metric;
  const pDeferred = builtDeferred.metric;
  const pOptions = [pEarly, pNormal, pDeferred].sort(
    (a, b) => b.finalDisposableNetWorth - a.finalDisposableNetWorth
  );

  const addSelf = calculateAdditionalPensionIncrease(
    true,
    inputs.pension.additionalMonthsSelf || 60,
    inputs.pension.monthlyContributionSelf || 360_000
  );
  const addSpouse =
    inputs.pension.hasSpouse ?? true
      ? calculateAdditionalPensionIncrease(
          true,
          inputs.pension.additionalMonthsSpouse || 60,
          inputs.pension.monthlyContributionSpouse || 180_000
        )
      : 0;
  const addCost =
    (inputs.pension.additionalMonthsSelf || 60) *
      (inputs.pension.monthlyContributionSelf || 360_000) +
    ((inputs.pension.hasSpouse ?? true)
      ? (inputs.pension.additionalMonthsSpouse || 60) *
        (inputs.pension.monthlyContributionSpouse || 180_000)
      : 0);
  const addRoi =
    addCost > 0 ? Number((((addSelf + addSpouse) * 12 * 30) / addCost).toFixed(1)) : 0;

  const pensionComparison: PensionTimingComparison = {
    early: pEarly,
    normal: pNormal,
    deferred: pDeferred,
    additionalPensionMonthlyIncreaseSelf: addSelf,
    additionalPensionMonthlyIncreaseSpouse: addSpouse,
    additionalPensionTotalCost: addCost,
    additionalPensionRoiMultiple: addRoi,
    recommendedTiming: pOptions[0].timing,
  };

  // 임원 1인 vs 부부 공동임원(2인) 비교
  const currentEffectiveExec: 1 | 2 = (inputs.pension.hasSpouse ?? true)
    ? inputs.corporate.executiveCount
    : 1;
  const targetExecRatio = activePersonalRatio < 100 ? activePersonalRatio : 50;
  const buildExecOption = (execCount: 1 | 2, label: string) => {
    const effectiveCount: 1 | 2 = (inputs.pension.hasSpouse ?? true) ? execCount : 1;
    // G2: 원장 첫 은퇴연도와 같은 기준(임원별 만 나이·국민연금 요율 스케줄)
    const execRetIdx = Math.max(
      0,
      inputs.transition.targetRetirementAgeSelf - inputs.pension.currentAgeSelf
    );
    const payroll = solveHouseholdExecutivePayroll(
      Math.max(
        WORKPLACE_MIN_MONTHLY_SALARY_PER_EXEC,
        inputs.corporate.executiveSalaryMonthly || WORKPLACE_MIN_MONTHLY_SALARY_PER_EXEC
      ),
      effectiveCount,
      inputs.pension.currentAgeSelf + execRetIdx,
      inputs.pension.currentAgeSpouse + execRetIdx,
      execRetIdx
    );
    const sim =
      effectiveCount === currentEffectiveExec
        ? getSim(targetExecRatio)
        : runCanonicalLedger(
            {
              ...inputs,
              corporate: { ...inputs.corporate, executiveCount: effectiveCount },
            },
            targetExecRatio
          );
    return {
      executiveCount: effectiveCount,
      label,
      annualTotalPayrollCost: payroll.annualTotalCorporatePayrollCost,
      annualNetSalaryReceived: payroll.annualTotalNetSalary,
      annualTaxAnd4InsCost:
        payroll.annualTotalCorporatePayrollCost - payroll.annualTotalNetSalary,
      finalDisposableNetWorth: sim.finalDisposableNetWorth,
    };
  };

  const singleExec = buildExecOption(1, '1인 단독 대표 (배우자 피부양자)');
  const jointExec = buildExecOption(2, '부부 2인 공동 임원 (소득 분산)');
  const executiveComparison: ExecutiveStructureComparison = {
    singleExec,
    jointExec,
    recommendedCount:
      jointExec.finalDisposableNetWorth >= singleExec.finalDisposableNetWorth ? 2 : 1,
    netWorthAdvantage: Math.abs(
      jointExec.finalDisposableNetWorth - singleExec.finalDisposableNetWorth
    ),
  };

  // 권고안(B7)이 개인 100%면 법인 관련 권고(출자·가수금·임원보수·출구·승계)를 내지 않음
  const noCorporation = recommendedRatio === 100;
  const personal100FirstRet = personal100.rows.find((r) => !r.isEmployed);
  const personal100FirstRetHealth = personal100FirstRet
    ? Math.round(personal100FirstRet.personalHealthInsurance * personal100FirstRet.discountFactor)
    : 0;
  const capitalPlacement = noCorporation
    ? '개인 계좌(ISA·연금·일반과세)에 배치합니다.'
    : '최적 비중으로 법인 출자(가수금)와 개인 계좌에 배분합니다.';
  const actionChecklist: ActionChecklistItem[] = [
    {
      id: 'act-1-isa',
      targetAge: inputs.pension.currentAgeSelf,
      phaseLabel: '즉시 실행',
      category: 'ISA · 절세계좌',
      title: `${(inputs.pension.hasSpouse ?? true) ? '부부' : '본인'} ISA 한도 채우기 및 만기 30년 장기 연장 설정`,
      impactSummary: '배당·매매차익 9.9% 분리과세 & 지역건보료 100% 제외',
      description:
        '조특법 §91의18에 따라 3년 의무가입 후 해지하지 않고 만기를 30년으로 연장하여 은퇴 크레바스 1순위 비과세 인출 바스켓으로 확보합니다.',
    },
    {
      id: 'act-2-dday',
      targetAge: inputs.transition.targetRetirementAgeSelf,
      phaseLabel: `은퇴 D-Day (${inputs.transition.targetRetirementAgeSelf}세)`,
      category: '5대 계좌 재배치',
      title: noCorporation
        ? '개인 100% 자본 배치 (법인 미설립)'
        : `개인 ${recommendedRatio}% : 가족법인 ${100 - recommendedRatio}% 황금비율 자본 배치`,
      impactSummary: `생애 세금·건보·유지비 최소화 (최적 가처분 순자산 달성)`,
      description: inputs.transition.severanceTransferToIrp
        ? `퇴직급여는 전액 IRP로 이연(퇴직소득세 30~40% 감면)하고, 일반 과세자본을 ${capitalPlacement}`
        : `퇴직급여는 일시 수령(퇴직소득세 즉시 납부) 후 일반 과세자본과 합산하여 ${capitalPlacement} IRP 이연 시 퇴직소득세 30~40% 감면이 가능하므로 비교를 권장합니다.`,
    },
    {
      id: 'act-3-health',
      targetAge: inputs.transition.targetRetirementAgeSelf,
      phaseLabel: '은퇴 직후',
      category: '건강보험 방어',
      title: breakEven.isAboveBreakEven && !noCorporation
        ? '가족법인 임원 보수월액 설정으로 주택 재산건보료 면제'
        : '2024 개정 건보법 재산 1억 공제 및 피부양자 요건 관리',
      impactSummary: noCorporation
        ? `은퇴 첫해 지역건보료 약 ${formatKRW(personal100FirstRetHealth)}/년 (법인 미설립 — 임원 직장가입 방어 해당 없음)`
        : `연간 건보료 방어 약 ${formatKRW(breakEven.annualRegionalHealthInsShield)}`,
      description: breakEven.isAboveBreakEven && !noCorporation
        ? `${breakEven.verdictSummary} (※ 무매출 투자법인의 가공 인건비 부인 예방을 위해 정관 임원보수규정·주총 결의서·월별 투자운용보고서 등 상시 경영 증빙을 반드시 구비하세요.)`
        : breakEven.verdictSummary,
    },
    {
      id: 'act-4-exit',
      targetAge: Math.max(70, inputs.transition.targetRetirementAgeSelf + 10),
      phaseLabel: '은퇴 중·후기',
      category: '법인 출구 · 승계',
      title: noCorporation ? '법인 미설립 — 출구전략 해당 없음' : `${recommendedExitOption.title} 실행`,
      impactSummary: noCorporation
        ? '현재 최적안은 가족법인을 설립하지 않으므로 청산·승계 절차가 없습니다'
        : corporateExit.recommendedExit === 'lump_sum_gross' || corporateExit.maxTaxSavedVsSimpleGross <= 0
          ? '단순 일괄 청산 대비 추가 절세 효과 없음'
          : `단순 일괄 청산 대비 세후 +${formatKRW(corporateExit.maxTaxSavedVsSimpleGross)} 보존`,
      description: noCorporation
        ? '개인 계좌(ISA·연금·일반)만으로 운용하므로 법인 출구 단계가 필요 없습니다.'
        : '소득세법 §17②3 출자원금 비과세 선회수 후 인당 연 2,000만 원 분리과세 배당 한도 내에서 단계적 출구를 실행합니다. (※ 금융투자법인은 가업상속공제 대상이 아니며, 자녀 지분 법인에 무이자 가수금 대여 시 상증세법 §45의5 특정법인 증여의제 과세 여부를 세무사와 사전 점검하세요.)',
    },
  ];

  const sincereFilingSummary = summarizeSincereFiling(
    activeLedger.rows,
    inputs.corporate.taxRecognitionMode === 'yearly'
  );
  const sincereStatus = sincereFilingStatusLine(sincereFilingSummary);
  if (sincereStatus) {
    actionChecklist.push({
      id: 'act-5-sincere',
      targetAge: sincereFilingSummary.firstLikelyAgeSelf ?? inputs.transition.targetRetirementAgeSelf,
      phaseLabel: '매년 12월',
      category: '법인세율 점검',
      title: '연말 가결산: 배당·이자가 매출의 50% 미만인지 확인',
      impactSummary: sincereStatus,
      description:
        '가족법인(지분 50% 초과·상시근로자 5인 미만)은 (임대+이자+배당)이 매출의 50% 이상이면 성실신고확인대상 소규모법인으로 2억 이하 11% 구간이 배제되고 22%가 적용됩니다. 투자업(기타 금융업 659902)을 목적사업·업종에 등록하면 ETF 매매차익을 매출로 계상할 수 있으니, 결산 전 이익실현 규모를 세무대리인과 확인하세요. (사업연도별 판정 · 형식적 매매는 실질과세로 부인될 수 있음)',
    });
  }

  const hasSpouse = inputs.pension.hasSpouse ?? true;
  const spousalGiftCarryoverNote =
    hasSpouse &&
    inputs.asset.selfOwnershipPercent !== undefined &&
    inputs.asset.selfOwnershipPercent !== 50
      ? '배우자 증여재산공제(10년 6억 원)를 활용해 사전증여 시, 양도소득세 이월과세(소득세법 §97의2, 10년 보유 요건)를 준수해야 취득가액 승계로 인한 양도세 회피 추징을 방지할 수 있습니다.'
      : null;

  const shareholderLoanSafeHarborNote =
    inputs.corporate.fundingStructure === 'shareholder_loan'
      ? '가족법인 주주 무이자·저리 대여금(가수금)은 상증세법 §45의5에 따라 연 4.6% 당좌대출이자율 기준 연간 이자 상당액이 1,000만 원 이상(대여 원금 약 2.17억 원 초과)일 경우 증여세가 과세될 수 있으므로 분할 대여 또는 적정이자 수수가 필요합니다.'
      : null;

  const estateDiagnostic: EstateAndGiftDiagnostic = {
    terminalValuationMode: inputs.corporate.terminalValuationMode ?? 'liquidation',
    personal100Estate: evaluateEstateForSim(personal100, inputs),
    corporate100Estate: evaluateEstateForSim(corporate100, inputs),
    activeEstate: evaluateEstateForSim(activeLedger, inputs),
    spousalGiftCarryoverNote,
    shareholderLoanSafeHarborNote,
  };

  return {
    inputs,
    portfolio,
    personal100,
    corporate100,
    optimalHybrid,
    activeLedger,
    cards,
    activeCard,
    winner,
    winnerTitle,
    winnerAdvantageOverRunnerUp,
    allocationStatus,
    allocationCurve,
    breakEven,
    corporateExit,
    pensionComparison,
    executiveComparison,
    actionChecklist,
    sincereFilingSummary,
    recommendation,
    estateDiagnostic,
    computeTimeMs: Number((performance.now() - t0).toFixed(2)),
  };
}

export const solveOptimizationMasterPlan = solveNestWaySlider;

