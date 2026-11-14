import {
  DEFAULT_ACTIVE_SENIOR_CONFIG,
  normalizeCashflow,
  type EtfHolding,
  type SimulationInputs,
} from './types';

/** Deep-copies holdings so presets / default inputs never share mutable array references. */
export function cloneHoldings(holdings: EtfHolding[] | undefined): EtfHolding[] | undefined {
  return holdings ? holdings.map((h) => ({ ...h })) : holdings;
}

export const STARTER_ETF_HOLDINGS: EtfHolding[] = [
  {
    ticker: 'VOO',
    name: 'Vanguard S&P 500 ETF',
    market: 'US',
    amount: 400_000_000,
    ratio: 40,
    category: 'US_INDEX',
    expenseRatio: 0.03,
    actualExpenseRatio: 0.03,
    dividendYield: 1.4,
    dividendCycle: 'Quarterly',
    expectedGrowthRate: 8.5,
    productType: 'overseas_direct',
  },
  {
    ticker: 'SCHD',
    name: 'Schwab US Dividend Equity ETF',
    market: 'US',
    amount: 300_000_000,
    ratio: 30,
    category: 'DIVIDEND',
    expenseRatio: 0.06,
    actualExpenseRatio: 0.06,
    dividendYield: 3.6,
    dividendCycle: 'Quarterly',
    expectedGrowthRate: 6.4,
    productType: 'overseas_direct',
  },
  {
    ticker: '360750',
    name: 'TIGER 미국S&P500',
    market: 'KRX',
    amount: 300_000_000,
    ratio: 30,
    category: 'US_INDEX',
    expenseRatio: 0.07,
    actualExpenseRatio: 0.17,
    dividendYield: 1.3,
    dividendCycle: 'Quarterly',
    expectedGrowthRate: 8.4,
    productType: 'domestic_listed',
  },
];

export const STARTER_SHELTERED_ETF_HOLDINGS: EtfHolding[] = [
  {
    ticker: '360750',
    name: 'TIGER 미국S&P500',
    market: 'KRX',
    amount: 116_000_000,
    ratio: 40,
    category: 'US_INDEX',
    expenseRatio: 0.07,
    actualExpenseRatio: 0.17,
    dividendYield: 1.35,
    dividendCycle: 'Quarterly',
    expectedGrowthRate: 8.5,
    productType: 'domestic_listed',
  },
  {
    ticker: '458730',
    name: 'TIGER 미국배당다우존스',
    market: 'KRX',
    amount: 87_000_000,
    ratio: 30,
    category: 'DIVIDEND',
    expenseRatio: 0.01,
    actualExpenseRatio: 0.25,
    dividendYield: 3.5,
    dividendCycle: 'Monthly',
    expectedGrowthRate: 6.5,
    productType: 'domestic_listed',
  },
  {
    ticker: '273130',
    name: 'KODEX 종합채권(AA-이상)액티브',
    market: 'KRX',
    amount: 87_000_000,
    ratio: 30,
    category: 'BOND',
    expenseRatio: 0.045,
    actualExpenseRatio: 0.07,
    dividendYield: 3.4,
    dividendCycle: 'Quarterly',
    expectedGrowthRate: 0.8,
    productType: 'domestic_listed',
  },
];

export const DEFAULT_SIMULATION_INPUTS: SimulationInputs = {
  asset: {
    totalInvestment: 1_000_000_000, // 일반 금융자산 10.0억
    selfOwnershipPercent: 50,
    growthEtfRatio: 70,
    dividendEtfRatio: 30,
    growthRate: 6.0,
    dividendYield: 4.0,
    investmentHorizon: 50,
    overseasEtfRatio: 70,
    inputMode: 'macro',
    holdings: cloneHoldings(STARTER_ETF_HOLDINGS),
  },
  realEstate: {
    housingType: 'own',
    officiallyAssessedValue: 1_200_000_000, // 공시가격 12.0억
    leaseDeposit: 0,
    monthlyRent: 0,
    ownership: 'joint',
    fairMarketValueRatio: 60,
    basicDeduction: 100_000_000,
    apply2024HealthReform: true,
    includePropertyTax: true,
    transition: {
      strategy: 'keep',
      downsizingAge: 65,
      downsizedAssessedValue: 700_000_000,
      downsizingActualSurplusCash: 500_000_000,
      downsizingCorpAllocationRatio: 50,
      targetHousingType: 'own',
      targetLeaseDeposit: 500_000_000,
      targetMonthlyRent: 0,
      housingPensionStartAge: 65,
      housingPensionMonthlyPayout: 2_200_000,
      monthlyRentExpense: 0,
    },
  },
  cashflow: {
    targetNetMonthlyLivingExpense: 5_000_000, // 목표 월생활비 500만원
    monthlyFixedExpense: 0,
    spendingMode: 'flat',
    activeSeniorConfig: { ...DEFAULT_ACTIVE_SENIOR_CONFIG, spendingMode: 'flat' },
    lumpSumEvents: [],
  },
  corporate: {
    executiveCount: 2,
    executiveSalaryMonthly: 1_000_000,
    annualFixedMaintenanceFee: 3_600_000,
    taxType: 'transparent', // 투자법인 = 성실신고확인 소규모법인(지배주주 50% 초과·이자배당 50% 이상·상시근로자 5인 미만) 22%
    customCorporateTaxRate: 22,
    taxRecognitionMode: 'realized',
    liquidationTaxMode: 'capital_return_exempt',
    fundingStructure: 'shareholder_loan',
    terminalValuationMode: 'liquidation',
    usePrecisionSolver: true,
    exitStrategy: 'phased_dividend_reduction',
    phasedExitDurationYears: 10,
  },
  pension: {
    hasSpouse: true,
    currentAgeSelf: 50,
    currentAgeSpouse: 48,
    expectedMonthlyPensionSelf: 1_800_000,
    expectedMonthlyPensionSpouse: 800_000,
    claimTimingSelf: 'normal',
    claimTimingSpouse: 'normal',
    applyAdditionalPensionSelf: false,
    additionalMonthsSelf: 60,
    monthlyContributionSelf: 360_000,
    applyAdditionalPensionSpouse: false,
    additionalMonthsSpouse: 60,
    monthlyContributionSpouse: 180_000,
  },
  accounts: {
    selfIsaBalance: 40_000_000,
    selfIsaAnnualAddition: 10_000_000,
    spouseIsaBalance: 20_000_000,
    spouseIsaAnnualAddition: 10_000_000,
    isaExpectedReturnRate: 5.4,
    selfPersonalPensionBalance: 50_000_000,
    selfPersonalPensionAnnualAddition: 6_000_000,
    selfPersonalPensionStartAge: 55,
    selfPersonalPensionMonthlyWithdrawal: 1_200_000,
    spousePersonalPensionBalance: 30_000_000,
    spousePersonalPensionAnnualAddition: 6_000_000,
    spousePersonalPensionStartAge: 55,
    spousePersonalPensionMonthlyWithdrawal: 1_000_000,
    personalPensionReturnRate: 5.4,
    selfSeveranceType: 'pension',
    selfRetirementPensionBalance: 150_000_000,
    selfRetirementTransferToIrp: true,
    selfRetirementPensionStartAge: 55,
    selfRetirementPensionMonthlyWithdrawal: 1_500_000,
    spouseSeveranceType: 'pension',
    spouseRetirementPensionBalance: 0,
    spouseRetirementTransferToIrp: true,
    spouseRetirementPensionStartAge: 55,
    spouseRetirementPensionMonthlyWithdrawal: 1_000_000,
    irpExpectedReturnRate: 4.8,
    overrideSymmetricAccountReturns: false,
    shelteredInputMode: 'macro',
    shelteredHoldings: cloneHoldings(STARTER_SHELTERED_ETF_HOLDINGS),
    applyIrpRiskAssetCap: true,
  },
  transition: {
    targetRetirementAgeSelf: 60,
    expectedSeverancePay: 0,
    spouseExpectedSeverancePay: 0,
    severanceTransferToIrp: true,
    preRetirementMonthlySavings: 5_000_000, // 재직 월저축 500만
    inflationRate: 2.5,
    viewMode: 'real',
    marketStressScenario: 'none',
  },
  hybrid: {
    personalRatio: 50,
    corporateRatio: 50,
    useAutoOptimalRatio: true,
  },
};

export interface PresetScenarioItem {
  id: string;
  label: string;
  subtitle: string;
  inputs: SimulationInputs;
}

export function defineInputs(partial?: Partial<SimulationInputs>): SimulationInputs {
  const base = DEFAULT_SIMULATION_INPUTS;
  if (!partial) return structuredClone(base);
  const merged: SimulationInputs = {
    asset: {
      ...base.asset,
      ...(partial.asset || {}),
      holdings: cloneHoldings(partial.asset?.holdings ?? base.asset.holdings),
    },
    realEstate: {
      ...base.realEstate,
      ...(partial.realEstate || {}),
      transition: {
        ...base.realEstate.transition!,
        ...(partial.realEstate?.transition || {}),
      },
    },
    cashflow: normalizeCashflow({
      ...base.cashflow,
      ...(partial.cashflow || {}),
      activeSeniorConfig: {
        ...DEFAULT_ACTIVE_SENIOR_CONFIG,
        ...(base.cashflow.activeSeniorConfig || {}),
        ...(partial.cashflow?.activeSeniorConfig || {}),
      },
      lumpSumEvents: (partial.cashflow?.lumpSumEvents ?? base.cashflow.lumpSumEvents ?? []).map(
        (e) => ({ ...e })
      ),
    }),
    corporate: { ...base.corporate, ...(partial.corporate || {}) },
    pension: { ...base.pension, ...(partial.pension || {}) },
    accounts: {
      ...base.accounts,
      ...(partial.accounts || {}),
      shelteredHoldings: cloneHoldings(
        partial.accounts?.shelteredHoldings ?? base.accounts.shelteredHoldings
      ),
    },
    transition: { ...base.transition, ...(partial.transition || {}) },
    hybrid: { ...base.hybrid, ...(partial.hybrid || {}) },
  };
  return merged;
}

export const PRESET_SCENARIOS: PresetScenarioItem[] = [
  {
    id: 'fire-40-45-single',
    label: '40세 -> 45세 은퇴 (파이어족, 싱글)',
    subtitle: '1인 단독 · 일반 5억 + 절세 1.2억 · 자가 6억 · 월저축 400만 · 월생활비 300만',
    inputs: defineInputs({
      asset: { ...DEFAULT_SIMULATION_INPUTS.asset, totalInvestment: 500_000_000 },
      realEstate: {
        ...DEFAULT_SIMULATION_INPUTS.realEstate,
        officiallyAssessedValue: 600_000_000,
        ownership: 'single',
      },
      corporate: {
        ...DEFAULT_SIMULATION_INPUTS.corporate,
        executiveCount: 1,
      },
      pension: {
        ...DEFAULT_SIMULATION_INPUTS.pension,
        hasSpouse: false,
        currentAgeSelf: 40,
        currentAgeSpouse: 40,
        expectedMonthlyPensionSelf: 1_200_000,
        expectedMonthlyPensionSpouse: 0,
      },
      accounts: {
        ...DEFAULT_SIMULATION_INPUTS.accounts,
        selfIsaBalance: 30_000_000,
        selfIsaAnnualAddition: 10_000_000,
        spouseIsaBalance: 0,
        spouseIsaAnnualAddition: 0,
        selfPersonalPensionBalance: 40_000_000,
        selfPersonalPensionAnnualAddition: 6_000_000,
        spousePersonalPensionBalance: 0,
        spousePersonalPensionAnnualAddition: 0,
        selfRetirementPensionBalance: 50_000_000,
        spouseRetirementPensionBalance: 0,
      },
      transition: {
        ...DEFAULT_SIMULATION_INPUTS.transition,
        targetRetirementAgeSelf: 45,
        preRetirementMonthlySavings: 4_000_000,
      },
      cashflow: {
        ...DEFAULT_SIMULATION_INPUTS.cashflow,
        targetNetMonthlyLivingExpense: 3_000_000,
      },
    }),
  },
  {
    id: 'early-45-50',
    label: '45세 -> 50세 은퇴 (이른 은퇴)',
    subtitle: '부부 2인 · 일반 7억 + 절세 2.0억 · 자가 9억 · 월저축 450만 · 월생활비 400만',
    inputs: defineInputs({
      asset: { ...DEFAULT_SIMULATION_INPUTS.asset, totalInvestment: 700_000_000 },
      realEstate: {
        ...DEFAULT_SIMULATION_INPUTS.realEstate,
        officiallyAssessedValue: 900_000_000,
        ownership: 'joint',
      },
      pension: {
        ...DEFAULT_SIMULATION_INPUTS.pension,
        hasSpouse: true,
        currentAgeSelf: 45,
        currentAgeSpouse: 43,
        expectedMonthlyPensionSelf: 1_500_000,
        expectedMonthlyPensionSpouse: 700_000,
      },
      accounts: {
        ...DEFAULT_SIMULATION_INPUTS.accounts,
        selfIsaBalance: 40_000_000,
        spouseIsaBalance: 20_000_000,
        selfPersonalPensionBalance: 40_000_000,
        spousePersonalPensionBalance: 20_000_000,
        selfRetirementPensionBalance: 80_000_000,
        spouseRetirementPensionBalance: 0,
      },
      transition: {
        ...DEFAULT_SIMULATION_INPUTS.transition,
        targetRetirementAgeSelf: 50,
        preRetirementMonthlySavings: 4_500_000,
      },
      cashflow: {
        ...DEFAULT_SIMULATION_INPUTS.cashflow,
        targetNetMonthlyLivingExpense: 4_000_000,
      },
    }),
  },
  {
    id: 'hybrid-50-55-corp50',
    label: '50세 -> 55세 은퇴 (법인 50% 균형)',
    subtitle: '부부 2인 · 일반 12억(배당 70%) + 절세 3.5억 · 자가 18억 · 월저축 500만 · 월생활비 500만',
    inputs: defineInputs({
      asset: {
        ...DEFAULT_SIMULATION_INPUTS.asset,
        totalInvestment: 1_200_000_000,
        growthEtfRatio: 30,
        dividendEtfRatio: 70,
        growthRate: 5.4,
        dividendYield: 5.5,
        overseasEtfRatio: 30,
      },
      realEstate: {
        ...DEFAULT_SIMULATION_INPUTS.realEstate,
        officiallyAssessedValue: 1_800_000_000,
        ownership: 'joint',
      },
      corporate: {
        ...DEFAULT_SIMULATION_INPUTS.corporate,
        executiveCount: 2,
        executiveSalaryMonthly: 1_500_000,
      },
      pension: {
        ...DEFAULT_SIMULATION_INPUTS.pension,
        hasSpouse: true,
        currentAgeSelf: 50,
        currentAgeSpouse: 48,
        expectedMonthlyPensionSelf: 1_900_000,
        expectedMonthlyPensionSpouse: 850_000,
      },
      accounts: {
        ...DEFAULT_SIMULATION_INPUTS.accounts,
        selfIsaBalance: 50_000_000,
        spouseIsaBalance: 30_000_000,
        selfPersonalPensionBalance: 60_000_000,
        spousePersonalPensionBalance: 30_000_000,
        selfRetirementPensionBalance: 180_000_000,
        spouseRetirementPensionBalance: 0,
      },
      transition: {
        ...DEFAULT_SIMULATION_INPUTS.transition,
        targetRetirementAgeSelf: 55,
        preRetirementMonthlySavings: 5_000_000,
      },
      cashflow: {
        ...DEFAULT_SIMULATION_INPUTS.cashflow,
        targetNetMonthlyLivingExpense: 5_000_000,
      },
    }),
  },
  {
    id: 'standard-50-60',
    label: '50세 -> 60세 은퇴',
    subtitle: '부부 2인 · 일반 10억 + 절세 2.9억 · 자가 12억 · 월저축 500만 · 월생활비 500만',
    inputs: defineInputs(),
  },
  {
    id: 'corp-100-focus',
    label: '55세 -> 55세 은퇴 (법인 100% 집중)',
    subtitle: '부부 2인 · 일반 15억(고배당) + 절세 3.5억 · 자가 18억 · 즉시 은퇴 · 월생활비 450만',
    inputs: defineInputs({
      asset: {
        ...DEFAULT_SIMULATION_INPUTS.asset,
        totalInvestment: 1_500_000_000,
        growthEtfRatio: 0,
        dividendEtfRatio: 100,
        growthRate: 3.0,
        dividendYield: 7.0,
        overseasEtfRatio: 0,
      },
      realEstate: {
        ...DEFAULT_SIMULATION_INPUTS.realEstate,
        officiallyAssessedValue: 1_800_000_000,
        ownership: 'joint',
      },
      corporate: {
        ...DEFAULT_SIMULATION_INPUTS.corporate,
        executiveCount: 2,
        executiveSalaryMonthly: 3_000_000,
      },
      pension: {
        ...DEFAULT_SIMULATION_INPUTS.pension,
        hasSpouse: true,
        currentAgeSelf: 55,
        currentAgeSpouse: 53,
        expectedMonthlyPensionSelf: 1_900_000,
        expectedMonthlyPensionSpouse: 850_000,
      },
      accounts: {
        ...DEFAULT_SIMULATION_INPUTS.accounts,
        selfIsaBalance: 50_000_000,
        spouseIsaBalance: 30_000_000,
        selfPersonalPensionBalance: 60_000_000,
        spousePersonalPensionBalance: 30_000_000,
        selfRetirementPensionBalance: 180_000_000,
        spouseRetirementPensionBalance: 0,
      },
      transition: {
        ...DEFAULT_SIMULATION_INPUTS.transition,
        targetRetirementAgeSelf: 55,
        preRetirementMonthlySavings: 0,
      },
      cashflow: {
        ...DEFAULT_SIMULATION_INPUTS.cashflow,
        targetNetMonthlyLivingExpense: 4_500_000,
      },
    }),
  },
  {
    id: 'immediate-60-60',
    label: '60세 -> 60세 은퇴',
    subtitle: '부부 2인 · 일반 20억 + 절세 4.0억 · 자가 15억 · 즉시 은퇴 · 월생활비 650만',
    inputs: defineInputs({
      asset: { ...DEFAULT_SIMULATION_INPUTS.asset, totalInvestment: 2_000_000_000 },
      realEstate: {
        ...DEFAULT_SIMULATION_INPUTS.realEstate,
        officiallyAssessedValue: 1_500_000_000,
        ownership: 'joint',
      },
      pension: {
        ...DEFAULT_SIMULATION_INPUTS.pension,
        hasSpouse: true,
        currentAgeSelf: 60,
        currentAgeSpouse: 58,
        expectedMonthlyPensionSelf: 2_000_000,
        expectedMonthlyPensionSpouse: 900_000,
      },
      accounts: {
        ...DEFAULT_SIMULATION_INPUTS.accounts,
        selfIsaBalance: 60_000_000,
        spouseIsaBalance: 40_000_000,
        selfPersonalPensionBalance: 60_000_000,
        spousePersonalPensionBalance: 40_000_000,
        selfRetirementPensionBalance: 200_000_000,
        spouseRetirementPensionBalance: 0,
      },
      transition: {
        ...DEFAULT_SIMULATION_INPUTS.transition,
        targetRetirementAgeSelf: 60,
        preRetirementMonthlySavings: 0,
      },
      cashflow: {
        ...DEFAULT_SIMULATION_INPUTS.cashflow,
        targetNetMonthlyLivingExpense: 6_500_000,
      },
    }),
  },
];

export function formatKRW(amount: number, exactWon = false): string {
  const n = Math.round(amount || 0);
  if (exactWon) {
    return `${n.toLocaleString('ko-KR')}원`;
  }
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 100_000_000) {
    const eok = Math.floor(abs / 100_000_000);
    const man = Math.round((abs % 100_000_000) / 10_000);
    if (man === 0) return `${sign}${eok.toLocaleString('ko-KR')}억`;
    if (man === 10_000) return `${sign}${(eok + 1).toLocaleString('ko-KR')}억`;
    return `${sign}${eok.toLocaleString('ko-KR')}억 ${man.toLocaleString('ko-KR')}만`;
  }
  if (abs >= 10_000) {
    return `${sign}${Math.round(abs / 10_000).toLocaleString('ko-KR')}만원`;
  }
  return `${n.toLocaleString('ko-KR')}원`;
}
