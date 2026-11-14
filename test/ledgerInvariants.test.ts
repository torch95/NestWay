import {
  resolveCorporateExitBreakdown,
  resolvePersonalExitNetWorth,
  runCanonicalLedger,
} from '../src/engine/ledgerKernel';
import { solveOptimizationMasterPlan } from '../src/engine/optimizer';
import {
  DEFAULT_SIMULATION_INPUTS,
  defineInputs,
  PRESET_SCENARIOS,
} from '../src/engine/presets';
import {
  calculateCorporateTax,
  calculateIndividualCombinedTax,
  calculateOverseasCapitalGainsTax,
  calculateRegionalHealthInsurance,
  calculateRetirementIncomeTax,
  solveExecutivePayroll,
} from '../src/engine/taxAndHealth';
import { calculateAnnualPublicPension } from '../src/engine/pensionAndEtf';
import { WORKPLACE_MIN_MONTHLY_SALARY_PER_EXEC } from '../src/engine/constants';
import { getMonthlyLivingExpenseForAge } from '../src/engine/types';

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

let totalCheckedYears = 0;

// 1. 6대 연령별 대표 프리셋 × 5개 개인비중(0%, 25%, 50%, 75%, 100%) 전 연차 1원 보존 항등식 검증
check(PRESET_SCENARIOS.length === 6, '연령대별 6대 대표 프리셋이 정의되어야 함');
for (const preset of PRESET_SCENARIOS) {
  for (const pRatio of [0, 25, 50, 75, 100]) {
    const res = runCanonicalLedger(preset.inputs, pRatio);
    check(
      res.maxAccountingResidualAbs === 0,
      `[${preset.id} p=${pRatio}%] 회계 보존 잔차는 0원이어야 함 (실측: ${res.maxAccountingResidualAbs})`
    );
    for (let i = 0; i < res.rows.length; i++) {
      const row = res.rows[i];
      totalCheckedYears++;
      check(
        row.accountingResidual === 0,
        `[${preset.id} p=${pRatio}% yr=${row.yearIndex}] 잔차 0원 위반`
      );
      const sumStart =
        row.startIrp + row.startIsa + row.startPersonalPension + row.startTaxable + row.startCorp;
      const sumEnd =
        row.endIrp + row.endIsa + row.endPersonalPension + row.endTaxable + row.endCorp;
      check(sumStart === row.startBookTotal, '기초 5대 바스켓 합 일치');
      check(sumEnd === row.endBookTotal, '기말 5대 바스켓 합 일치');
    }
  }
}

// 1-b. 법인 과세배당(1-a)은 15.4% 원천징수 하한 이상 누진 과세되고, 다음 해 건보 소득 베이스에 반영되어야 함
const largeCorpInputs = defineInputs({
  asset: { ...DEFAULT_SIMULATION_INPUTS.asset, totalInvestment: 3_000_000_000 },
  pension: { ...DEFAULT_SIMULATION_INPUTS.pension, currentAgeSelf: 60, currentAgeSpouse: 58 },
  transition: {
    ...DEFAULT_SIMULATION_INPUTS.transition,
    targetRetirementAgeSelf: 60,
    preRetirementMonthlySavings: 0,
  },
  cashflow: {
    ...DEFAULT_SIMULATION_INPUTS.cashflow,
    targetNetMonthlyLivingExpense: 8_000_000,
  },
});
const corp100 = runCanonicalLedger(largeCorpInputs, 0);
const divRows = corp100.rows.filter(
  (r, i) => r.stage8CorpFallbackDividend > 100_000_000 && i + 1 < corp100.rows.length
);
check(divRows.length > 0, '법인 100% 고액자산 시나리오에서 1억 초과 법인 배당 연도가 존재');
{
  const r = divRows.reduce((a, b) =>
    b.stage8CorpFallbackDividend > a.stage8CorpFallbackDividend ? b : a
  );
  const next = corp100.rows[corp100.rows.indexOf(r) + 1];
  check(
    r.personalIncomeAndDivTax >= Math.round(r.stage8CorpFallbackDividend * 0.154) - 1,
    `[yr=${r.yearIndex}] 법인 배당 ${r.stage8CorpFallbackDividend}원에 대한 세금 ${r.personalIncomeAndDivTax}원은 15.4% 하한 이상`
  );
  check(
    next.personalHealthInsurance > r.personalHealthInsurance && next.personalHealthInsurance > 20_160 * 12,
    `[yr=${r.yearIndex + 1}] 전년도 법인 배당 증가가 다음 해 건보료에 반영 (${r.personalHealthInsurance} → ${next.personalHealthInsurance})`
  );
}

// 1-c. 퇴직소득 과세 계층: 3억/20년 퇴직금을 일시 수령하면 D-Day에 퇴직소득세 19,844,000원이 즉시 과세되고,
//      IRP 이연 시에는 D-Day 세금이 그만큼 적어야 함 (두 경로 모두 잔차 0)
const bigSevBase = {
  ...DEFAULT_SIMULATION_INPUTS.transition,
  expectedSeverancePay: 300_000_000,
  serviceYears: 20,
};
const lumpRes = runCanonicalLedger(
  defineInputs({ transition: { ...bigSevBase, severanceTransferToIrp: false } }),
  100
);
const irpRes = runCanonicalLedger(
  defineInputs({ transition: { ...bigSevBase, severanceTransferToIrp: true } }),
  100
);
check(lumpRes.maxAccountingResidualAbs === 0 && irpRes.maxAccountingResidualAbs === 0, '퇴직금 3억 일시/이연 경로 잔차 0');
{
  const dAge = DEFAULT_SIMULATION_INPUTS.transition.targetRetirementAgeSelf;
  const lumpRow = lumpRes.rows.find((r) => r.ageSelf === dAge)!;
  const irpRow = irpRes.rows.find((r) => r.ageSelf === dAge)!;
  check(
    lumpRow.personalIncomeAndDivTax - irpRow.personalIncomeAndDivTax >= 19_844_000 - 2,
    `D-Day 일시수령 세금(${lumpRow.personalIncomeAndDivTax}) − IRP 이연 세금(${irpRow.personalIncomeAndDivTax}) ≥ 퇴직소득세 19,844,000`
  );
  // IRP 이연 경로: 이연퇴직소득 인출분은 퇴직소득세의 70%(10년 이하)만 부담하므로 전 생애 세금이 일시수령보다 적어야 함
  check(
    irpRes.totalLifetimeTaxAndHealthCost < lumpRes.totalLifetimeTaxAndHealthCost,
    `IRP 이연 생애 세금·건보(${irpRes.totalLifetimeTaxAndHealthCost}) < 일시수령(${lumpRes.totalLifetimeTaxAndHealthCost})`
  );
}

// 2. 만 55세 미만 조기은퇴(40->45세 파이어족 및 45->50세 이른 은퇴) 시 55세 미만 IRP/연금저축 인출 금지 & ISA 크레바스 방어 검증
for (const earlyPreset of [PRESET_SCENARIOS[0], PRESET_SCENARIOS[1]]) {
  const earlyFireRes = runCanonicalLedger(earlyPreset.inputs, 100);
  for (const r of earlyFireRes.rows) {
    if (r.ageSelf < 55) {
      check(r.stage3IrpWithdrawal === 0, `[${earlyPreset.id}] 55세 미만(${r.ageSelf}세) IRP 인출 0원 가드`);
      check(
        r.stage5PersonalPensionWithdrawal === 0,
        `[${earlyPreset.id}] 55세 미만(${r.ageSelf}세) 연금저축 인출 0원 가드`
      );
    }
  }
}

// 3. 다운사이징 + 하락장 스트레스(gfc_2008) + 액티브시니어 복합 시나리오 1원 보존 검증
const stressDownsizeInputs = defineInputs({
  realEstate: {
    ...DEFAULT_SIMULATION_INPUTS.realEstate,
    transition: {
      ...DEFAULT_SIMULATION_INPUTS.realEstate.transition!,
      strategy: 'downsize',
      downsizingAge: 63,
      downsizingActualSurplusCash: 600_000_000,
    },
  },
  cashflow: {
    ...DEFAULT_SIMULATION_INPUTS.cashflow,
    spendingMode: 'active_senior',
  },
  transition: {
    ...DEFAULT_SIMULATION_INPUTS.transition,
    marketStressScenario: 'gfc_2008',
  },
});

for (const pRatio of [0, 50, 100]) {
  const res = runCanonicalLedger(stressDownsizeInputs, pRatio);
  check(
    res.maxAccountingResidualAbs === 0,
    `복합 스트레스·다운사이징(p=${pRatio}%) 회계 잔차 0원`
  );
  totalCheckedYears += res.rows.length;
}

// 4. 3개 은퇴 앱 통합 표준 19개 조건(1-A ~ 7-A) 정밀 정합성 및 보존 항등식 검증
const benchmark19Inputs = defineInputs({
  asset: {
    ...DEFAULT_SIMULATION_INPUTS.asset,
    inputMode: 'macro',
    totalInvestment: 1_000_000_000,
    growthRate: 6.0,
    dividendYield: 4.0,
    growthEtfRatio: 70,
    dividendEtfRatio: 30,
    overseasEtfRatio: 70,
  },
  accounts: {
    ...DEFAULT_SIMULATION_INPUTS.accounts,
    selfIsaBalance: 40_000_000,
    spouseIsaBalance: 0,
    selfPersonalPensionBalance: 80_000_000,
    spousePersonalPensionBalance: 0,
    selfRetirementPensionBalance: 120_000_000,
    spouseRetirementPensionBalance: 30_000_000,
    selfIsaAnnualAddition: 20_000_000,
    spouseIsaAnnualAddition: 20_000_000,
    selfPersonalPensionAnnualAddition: 18_000_000,
    spousePersonalPensionAnnualAddition: 0,
    isaExpectedReturnRate: 5.4,
    personalPensionReturnRate: 5.4,
    overrideSymmetricAccountReturns: false,
  },
  pension: {
    ...DEFAULT_SIMULATION_INPUTS.pension,
    hasSpouse: true,
    currentAgeSelf: 50,
    currentAgeSpouse: 50,
    expectedMonthlyPensionSelf: 1_800_000,
    expectedMonthlyPensionSpouse: 1_100_000,
    claimTimingSelf: 'normal',
    claimTimingSpouse: 'normal',
    applyAdditionalPensionSelf: true,
    additionalMonthsSelf: 50,
    monthlyContributionSelf: 200_000,
    applyAdditionalPensionSpouse: true,
    additionalMonthsSpouse: 12,
    monthlyContributionSpouse: 200_000,
  },
  realEstate: {
    ...DEFAULT_SIMULATION_INPUTS.realEstate,
    housingType: 'own',
    officiallyAssessedValue: 2_000_000_000,
    ownership: 'joint',
    fairMarketValueRatio: 60,
    apply2024HealthReform: true,
    transition: {
      ...DEFAULT_SIMULATION_INPUTS.realEstate.transition!,
      strategy: 'keep',
    },
  },
  cashflow: {
    ...DEFAULT_SIMULATION_INPUTS.cashflow,
    targetNetMonthlyLivingExpense: 5_000_000,
    monthlyFixedExpense: 0,
    spendingMode: 'flat',
  },
  corporate: {
    ...DEFAULT_SIMULATION_INPUTS.corporate,
    executiveCount: 2,
    executiveSalaryMonthly: 1_000_000,
    annualFixedMaintenanceFee: 2_000_000,
    taxType: 'transparent',
    customCorporateTaxRate: 22,
    taxRecognitionMode: 'realized',
    liquidationTaxMode: 'capital_return_exempt',
  },
  transition: {
    ...DEFAULT_SIMULATION_INPUTS.transition,
    targetRetirementAgeSelf: 53,
    preRetirementMonthlySavings: 5_000_000,
    expectedSeverancePay: 55_000_000,
    severanceTransferToIrp: true,
    inflationRate: 2.5,
    marketStressScenario: 'none',
    viewMode: 'nominal',
  },
});

const bench50 = runCanonicalLedger(benchmark19Inputs, 50);
check(bench50.maxAccountingResidualAbs === 0, '19개 표준 조건 회계 보존 잔차 0원');
check(
  // 2026 법인세(성실신고 소규모 22%, 종전 20.9%) 반영: 재직 3년간 법인 배당소득 과세 +1.1%p → −219,298원
  bench50.blueprint.totalCapitalAtRetirement === 1_724_468_682,
  `D-Day(53세) 총자본 1,724,468,682원 일치 (실측: ${bench50.blueprint.totalCapitalAtRetirement})`
);
check(
  bench50.blueprint.allocIsa === 173_432_859,
  `D-Day(53세) 인별 1억 한도 적용 ISA 잔액 173,432_859원 일치 (실측: ${bench50.blueprint.allocIsa})`
);
check(
  bench50.rows[3].requiredLivingOutflow === 64_613_437,
  `53세 은퇴 첫해 생활비(2-A, 50세 기산 3년 물가연동) 64,613,437원 일치`
);
check(
  bench50.rows[15].publicPensionInflow === 51_586_063,
  `65세 국민연금(2-A, 추납 포함 15년 물가연동) 51,586,063원 일치`
);
check(
  bench50.rows[0].corpMaintenanceAndFixedCost === 0 && bench50.rows[0].stage2CorpNetSalary === 0,
  '5-A 재직기 중 법인 유지비 및 임원 급여 0원 가드'
);
totalCheckedYears += bench50.rows.length;

// 4. [결함 #4] 하락장(early_drop_30, S09) 언더워터(taxable < taxableBasis) 구간에서 취득원가(taxableBasis) 보존 및 원금 회복분 허위 양도세(22%) 과세 방지 검증
const underwaterRecoveryInputs = defineInputs({
  asset: {
    ...DEFAULT_SIMULATION_INPUTS.asset,
    totalInvestment: 1_000_000_000,
    growthEtfRatio: 100,
    dividendEtfRatio: 0,
    growthRate: 6.0,
    dividendYield: 0,
    overseasEtfRatio: 100,
    investmentHorizon: 10,
  },
  pension: {
    ...DEFAULT_SIMULATION_INPUTS.pension,
    hasSpouse: false,
    currentAgeSelf: 60,
    expectedMonthlyPensionSelf: 0,
  },
  accounts: {
    ...DEFAULT_SIMULATION_INPUTS.accounts,
    selfIsaBalance: 0,
    selfIsaAnnualAddition: 0,
    spouseIsaBalance: 0,
    spouseIsaAnnualAddition: 0,
    selfPersonalPensionBalance: 0,
    selfPersonalPensionAnnualAddition: 0,
    spousePersonalPensionBalance: 0,
    spousePersonalPensionAnnualAddition: 0,
    selfRetirementPensionBalance: 0,
    spouseRetirementPensionBalance: 0,
  },
  realEstate: {
    ...DEFAULT_SIMULATION_INPUTS.realEstate,
    officiallyAssessedValue: 100_000_000,
  },
  cashflow: {
    ...DEFAULT_SIMULATION_INPUTS.cashflow,
    targetNetMonthlyLivingExpense: 2_000_000,
    monthlyFixedExpense: 0,
  },
  transition: {
    ...DEFAULT_SIMULATION_INPUTS.transition,
    targetRetirementAgeSelf: 60,
    expectedSeverancePay: 0,
    preRetirementMonthlySavings: 0,
    inflationRate: 0,
    marketStressScenario: 'early_drop_30',
    viewMode: 'nominal',
  },
});

const underwaterRes = runCanonicalLedger(underwaterRecoveryInputs, 100);
check(underwaterRes.maxAccountingResidualAbs === 0, '언더워터 회복 시나리오 회계 잔차 0원');
// 은퇴 첫해 -30% 폭락 후 1~5년차(+6% 회복 중이나 원금 대비 언더워터 상태)에서 매도 시 허위 양도세가 0원이어야 함
for (let yr = 0; yr <= 5; yr++) {
  check(
    underwaterRes.rows[yr].personalIncomeAndDivTax === 0,
    `언더워터 원금 회복 구간(yr=${yr}) 허위 양도소득세 0원 보장 (실측: ${underwaterRes.rows[yr].personalIncomeAndDivTax})`
  );
}
totalCheckedYears += underwaterRes.rows.length;

// 4-b. S09 표준 시나리오 (은퇴 직후 -30% 폭락장 + 실질가치 viewMode: 'real') 검증
const s09Inputs = defineInputs({
  asset: {
    totalInvestment: 1_000_000_000,
    growthEtfRatio: 70,
    dividendEtfRatio: 30,
    growthRate: 6.0,
    dividendYield: 4.0,
    investmentHorizon: 50,
    overseasEtfRatio: 70,
    inputMode: 'macro',
    holdings: [],
  },
  realEstate: {
    housingType: 'own',
    officiallyAssessedValue: 900_000_000,
    leaseDeposit: 0,
    monthlyRent: 0,
    ownership: 'joint',
    fairMarketValueRatio: 60,
    basicDeduction: 100_000_000,
    apply2024HealthReform: true,
    transition: {
      strategy: 'keep',
      downsizingAge: 70,
      downsizedAssessedValue: 500_000_000,
      downsizingActualSurplusCash: 0,
      downsizingCorpAllocationRatio: 50,
      housingPensionStartAge: 65,
      housingPensionMonthlyPayout: 0,
      monthlyRentExpense: 0,
    },
  },
  cashflow: {
    targetNetMonthlyLivingExpense: 5_000_000,
    monthlyFixedExpense: 500_000,
    spendingMode: 'flat',
    activeSeniorConfig: {
      spendingMode: 'flat',
      activeSeniorDelta: 0.25,
      activeAgeEnd: 64,
      stableAgeEnd: 77,
      applyCareShock: false,
      careShockMonthlyExpense: 1_500_000,
    },
  },
  corporate: {
    executiveCount: 2,
    executiveSalaryMonthly: 1_000_000,
    annualFixedMaintenanceFee: 3_200_000,
    taxType: 'normal',
    customCorporateTaxRate: 9.0,
    taxRecognitionMode: 'realized',
    liquidationTaxMode: 'capital_return_exempt',
    exitStrategy: 'lump_sum_liquidation',
    phasedExitDurationYears: 10,
    usePrecisionSolver: true,
  },
  pension: {
    hasSpouse: true,
    currentAgeSelf: 50,
    currentAgeSpouse: 48,
    expectedMonthlyPensionSelf: 1_500_000,
    expectedMonthlyPensionSpouse: 800_000,
    claimTimingSelf: 'normal',
    claimTimingSpouse: 'normal',
    applyAdditionalPensionSelf: false,
    additionalMonthsSelf: 0,
    monthlyContributionSelf: 200_000,
    applyAdditionalPensionSpouse: false,
    additionalMonthsSpouse: 0,
    monthlyContributionSpouse: 180_000,
  },
  accounts: {
    selfIsaBalance: 40_000_000,
    selfIsaAnnualAddition: 20_000_000,
    spouseIsaBalance: 20_000_000,
    spouseIsaAnnualAddition: 20_000_000,
    isaExpectedReturnRate: 5.4,
    selfPersonalPensionBalance: 50_000_000,
    selfPersonalPensionAnnualAddition: 6_000_000,
    selfPersonalPensionStartAge: 60,
    selfPersonalPensionMonthlyWithdrawal: 1_000_000,
    spousePersonalPensionBalance: 30_000_000,
    spousePersonalPensionAnnualAddition: 6_000_000,
    spousePersonalPensionStartAge: 60,
    spousePersonalPensionMonthlyWithdrawal: 500_000,
    personalPensionReturnRate: 5.4,
    selfRetirementPensionBalance: 150_000_000,
    selfRetirementTransferToIrp: true,
    selfRetirementPensionStartAge: 60,
    selfRetirementPensionMonthlyWithdrawal: 800_000,
    spouseRetirementPensionBalance: 0,
    spouseRetirementTransferToIrp: true,
    spouseRetirementPensionStartAge: 60,
    spouseRetirementPensionMonthlyWithdrawal: 0,
  },
  transition: {
    targetRetirementAgeSelf: 60,
    expectedSeverancePay: 300_000_000,
    severanceTransferToIrp: true,
    serviceYears: 25,
    preRetirementMonthlySavings: 5_000_000,
    inflationRate: 2.5,
    viewMode: 'real',
    marketStressScenario: 'early_drop_30',
  },
  hybrid: {
    useAutoOptimalRatio: true,
    personalRatio: 70,
    corporateRatio: 30,
  },
});

const s09Res50 = runCanonicalLedger(s09Inputs, 50);
const s09Res100 = runCanonicalLedger(s09Inputs, 100);
const s09Plan = solveOptimizationMasterPlan(s09Inputs);
check(s09Res50.maxAccountingResidualAbs === 0, 'S09 50:50 회계 보존 잔차 0원');
check(s09Res100.maxAccountingResidualAbs === 0, 'S09 100:0 회계 보존 잔차 0원');
check(s09Plan.optimalHybrid.maxAccountingResidualAbs === 0, 'S09 최적(r*) 회계 보존 잔차 0원');
check(
  // 2026 법인세: 레거시 커스텀 9.0% 무시 → 일반법인 2억 이하 11% 적용(재직 10년 법인 배당과세 증가) → −2,065,334원
  // B4-E3: 일반계좌 배당 15.4%를 부부 인별(50:50)로 원 단위 반올림 → −2원
  s09Res50.blueprint.totalCapitalAtRetirement === 3_224_273_784,
  `S09 D-Day 총자본 3,224,273,784원 일치 (실측: ${s09Res50.blueprint.totalCapitalAtRetirement})`
);
totalCheckedYears += s09Res50.rows.length + s09Res100.rows.length;
console.log(
  `📊 [S09 After Fix] D-Day=${(s09Res50.blueprint.totalCapitalAtRetirement / 1e8).toFixed(2)}억 | 50:50 100세 실질순자산=${(s09Res50.finalDisposableNetWorth / 1e8).toFixed(2)}억, 총세금=${(s09Res50.totalLifetimeTaxPaid / 1e8).toFixed(2)}억, 총건보=${(s09Res50.totalLifetimeHealthInsPaid / 1e8).toFixed(2)}억 | 100:0 총세금=${(s09Res100.totalLifetimeTaxPaid / 1e8).toFixed(2)}억 | r*=${s09Plan.optimalHybrid.personalRatio}%:${s09Plan.optimalHybrid.corporateRatio}% 100세 실질순자산=${(s09Plan.optimalHybrid.finalDisposableNetWorth / 1e8).toFixed(2)}억`
);

// 5. [Defect #4 & #5] S04 무주택 월세 물가연동(cpiLivingMultiplier) 및 S05 비-IRP 일시금 퇴직소득세 D-Day 원천징수 즉시 차감 검증
const s04RentInflationInputs = defineInputs({
  asset: {
    ...DEFAULT_SIMULATION_INPUTS.asset,
    totalInvestment: 600_000_000,
    growthEtfRatio: 80,
    dividendEtfRatio: 20,
    growthRate: 7.0,
    dividendYield: 3.0,
    overseasEtfRatio: 80,
    investmentHorizon: 60,
  },
  realEstate: {
    ...DEFAULT_SIMULATION_INPUTS.realEstate,
    housingType: 'own',
    officiallyAssessedValue: 0,
    leaseDeposit: 200_000_000,
    monthlyRent: 1_500_000,
    ownership: 'single',
  },
  cashflow: {
    ...DEFAULT_SIMULATION_INPUTS.cashflow,
    targetNetMonthlyLivingExpense: 3_000_000,
    monthlyFixedExpense: 300_000,
    spendingMode: 'flat',
  },
  corporate: {
    ...DEFAULT_SIMULATION_INPUTS.corporate,
    executiveCount: 1,
    executiveSalaryMonthly: 1_000_000,
    annualFixedMaintenanceFee: 2_400_000,
  },
  pension: {
    ...DEFAULT_SIMULATION_INPUTS.pension,
    hasSpouse: false,
    currentAgeSelf: 40,
    currentAgeSpouse: 40,
    expectedMonthlyPensionSelf: 1_100_000,
    expectedMonthlyPensionSpouse: 0,
  },
  accounts: {
    ...DEFAULT_SIMULATION_INPUTS.accounts,
    selfIsaBalance: 40_000_000,
    selfIsaAnnualAddition: 20_000_000,
    spouseIsaBalance: 0,
    spouseIsaAnnualAddition: 0,
    selfPersonalPensionBalance: 40_000_000,
    selfPersonalPensionAnnualAddition: 6_000_000,
    spousePersonalPensionBalance: 0,
    spousePersonalPensionAnnualAddition: 0,
    selfRetirementPensionBalance: 20_000_000,
    spouseRetirementPensionBalance: 0,
  },
  transition: {
    ...DEFAULT_SIMULATION_INPUTS.transition,
    targetRetirementAgeSelf: 45,
    expectedSeverancePay: 80_000_000,
    severanceTransferToIrp: true,
    serviceYears: 15,
    preRetirementMonthlySavings: 3_000_000,
    inflationRate: 2.5,
    viewMode: 'nominal',
    marketStressScenario: 'none',
  },
});

const s04RentInputs = defineInputs({
  ...s04RentInflationInputs,
  realEstate: {
    ...s04RentInflationInputs.realEstate,
    housingType: 'rent',
  },
});

const s04Res = runCanonicalLedger(s04RentInputs, 50);
check(s04Res.maxAccountingResidualAbs === 0, 'S04 무주택 월세 물가연동 회계 보존 잔차 0원');
{
  // 은퇴 첫해(45세, idx=5): 생활비(300만)+고정지출(30만)+월세(150만) 모두 1.025^5 물가연동 적용 확인
  const cpi5 = Math.pow(1.025, 5);
  const expectedOutflowAt45 =
    Math.round(3_000_000 * 12 * cpi5) +
    Math.round(300_000 * 12 * cpi5) +
    Math.round(1_500_000 * 12 * cpi5);
  check(
    s04Res.rows[5].requiredLivingOutflow === expectedOutflowAt45,
    `S04 45세 은퇴 첫해 지출(월세 물가연동 포함) ${expectedOutflowAt45}원 일치 (실측: ${s04Res.rows[5].requiredLivingOutflow})`
  );
}
totalCheckedYears += s04Res.rows.length;

const s05Inputs = defineInputs({
  asset: {
    ...DEFAULT_SIMULATION_INPUTS.asset,
    totalInvestment: 800_000_000,
    growthEtfRatio: 60,
    dividendEtfRatio: 40,
    growthRate: 6.0,
    dividendYield: 4.0,
    overseasEtfRatio: 60,
    investmentHorizon: 45,
  },
  realEstate: {
    ...DEFAULT_SIMULATION_INPUTS.realEstate,
    housingType: 'own',
    officiallyAssessedValue: 800_000_000,
    ownership: 'joint',
  },
  cashflow: {
    ...DEFAULT_SIMULATION_INPUTS.cashflow,
    targetNetMonthlyLivingExpense: 4_500_000,
    monthlyFixedExpense: 400_000,
    spendingMode: 'flat',
  },
  corporate: {
    ...DEFAULT_SIMULATION_INPUTS.corporate,
    executiveCount: 2,
    executiveSalaryMonthly: 1_000_000,
    annualFixedMaintenanceFee: 3_200_000,
  },
  pension: {
    ...DEFAULT_SIMULATION_INPUTS.pension,
    hasSpouse: true,
    currentAgeSelf: 55,
    currentAgeSpouse: 53,
    expectedMonthlyPensionSelf: 1_600_000,
    expectedMonthlyPensionSpouse: 700_000,
  },
  accounts: {
    ...DEFAULT_SIMULATION_INPUTS.accounts,
    selfIsaBalance: 50_000_000,
    selfIsaAnnualAddition: 0,
    spouseIsaBalance: 50_000_000,
    spouseIsaAnnualAddition: 0,
    selfPersonalPensionBalance: 50_000_000,
    selfPersonalPensionAnnualAddition: 0,
    spousePersonalPensionBalance: 50_000_000,
    spousePersonalPensionAnnualAddition: 0,
    selfRetirementPensionBalance: 0,
    selfRetirementTransferToIrp: false,
    spouseRetirementPensionBalance: 0,
    spouseRetirementTransferToIrp: false,
  },
  transition: {
    ...DEFAULT_SIMULATION_INPUTS.transition,
    targetRetirementAgeSelf: 55,
    expectedSeverancePay: 500_000_000,
    severanceTransferToIrp: false,
    serviceYears: 28,
    preRetirementMonthlySavings: 0,
    inflationRate: 2.5,
    viewMode: 'nominal',
    marketStressScenario: 'none',
  },
});

const s05Res50 = runCanonicalLedger(s05Inputs, 50);
check(s05Res50.maxAccountingResidualAbs === 0, 'S05 비-IRP 일시금 수령 전 연차 회계 잔차 0원');
check(
  s05Res50.blueprint.totalCapitalAtRetirement === 1_461_764_000,
  `S05 D-Day 총자본(퇴직금 5억/28년 근속 퇴직소득세 38,236,000원 원천징수 후) 1,461,764,000원 일치 (실측: ${s05Res50.blueprint.totalCapitalAtRetirement})`
);
totalCheckedYears += s05Res50.rows.length;

// 6. [Tab 2 §7.2 & §8.1] 계좌별 개별 수익률(irpExpectedReturnRate 분리) 및 activeSeniorDelta 정규화 검증
const customIrpRateInputs = defineInputs({
  accounts: {
    ...DEFAULT_SIMULATION_INPUTS.accounts,
    overrideSymmetricAccountReturns: true,
    isaExpectedReturnRate: 6.0,
    personalPensionReturnRate: 5.5,
    irpExpectedReturnRate: 4.5,
  },
  transition: {
    ...DEFAULT_SIMULATION_INPUTS.transition,
    viewMode: 'nominal',
  },
});
const symRateInputs = defineInputs({
  accounts: {
    ...DEFAULT_SIMULATION_INPUTS.accounts,
    overrideSymmetricAccountReturns: true,
    isaExpectedReturnRate: 6.0,
    personalPensionReturnRate: 5.5,
    irpExpectedReturnRate: 5.5,
  },
  transition: {
    ...DEFAULT_SIMULATION_INPUTS.transition,
    viewMode: 'nominal',
  },
});
const customIrpRes = runCanonicalLedger(customIrpRateInputs, 50);
const symIrpRes = runCanonicalLedger(symRateInputs, 50);
check(customIrpRes.maxAccountingResidualAbs === 0, 'IRP 개별 수익률(4.5%) 분리 시 회계 보존 잔차 0원');
check(
  customIrpRes.blueprint.allocIrp < symIrpRes.blueprint.allocIrp,
  `IRP 4.5% 수익률 D-Day 잔액(${customIrpRes.blueprint.allocIrp}) < IRP 5.5% 수익률 D-Day 잔액(${symIrpRes.blueprint.allocIrp})`
);
totalCheckedYears += customIrpRes.rows.length + symIrpRes.rows.length;

// activeSeniorDelta가 소수(0.25)로 들어오든 백분율(25)로 들어오든 동일하게 1.25배(6,250,000원)로 정규화되는지 검증
const activeSeniorDecimal = getMonthlyLivingExpenseForAge(60, 5_000_000, {
  spendingMode: 'active_senior',
  activeSeniorDelta: 0.25,
  activeAgeEnd: 64,
  stableAgeEnd: 77,
});
const activeSeniorPercent = getMonthlyLivingExpenseForAge(60, 5_000_000, {
  spendingMode: 'active_senior',
  activeSeniorDelta: 25,
  activeAgeEnd: 64,
  stableAgeEnd: 77,
});
check(
  activeSeniorDecimal === 6_250_000 && activeSeniorPercent === 6_250_000,
  `activeSeniorDelta 0.25 및 25 모두 6,250,000원으로 정규화 (실측: ${activeSeniorDecimal}, ${activeSeniorPercent})`
);

const careShockApplied = getMonthlyLivingExpenseForAge(80, 5_000_000, {
  spendingMode: 'active_senior',
  activeSeniorDelta: 0.25,
  activeAgeEnd: 64,
  stableAgeEnd: 77,
  applyCareShock: false,
  careShockMonthlyExpense: 1_500_000,
});
const careShockZero = getMonthlyLivingExpenseForAge(80, 5_000_000, {
  spendingMode: 'active_senior',
  activeSeniorDelta: 0.25,
  activeAgeEnd: 64,
  stableAgeEnd: 77,
  applyCareShock: false,
  careShockMonthlyExpense: 0,
});
check(
  careShockApplied === 5_250_000 && careShockZero === 3_750_000,
  `케어기(80세) 간병·의료 추가비 150만원 반영(5,250,000원) 및 0원 미반영(3,750,000원) 검증 (실측: ${careShockApplied}, ${careShockZero})`
);

// 7. [Tab 3 §1] 사적연금 수령 개시 연령(selfPersonalPensionStartAge / selfRetirementPensionStartAge) 연동 및 IRP 운용수익 저율한도 캡 검증
const delayedPensionStartInputs = defineInputs({
  pension: {
    ...DEFAULT_SIMULATION_INPUTS.pension,
    currentAgeSelf: 55,
    currentAgeSpouse: 55,
  },
  transition: {
    ...DEFAULT_SIMULATION_INPUTS.transition,
    targetRetirementAgeSelf: 55,
    preRetirementMonthlySavings: 0,
  },
  accounts: {
    ...DEFAULT_SIMULATION_INPUTS.accounts,
    selfPersonalPensionStartAge: 62,
    spousePersonalPensionStartAge: 62,
    selfRetirementPensionStartAge: 62,
    spouseRetirementPensionStartAge: 62,
  },
});
const delayedPensionRes = runCanonicalLedger(delayedPensionStartInputs, 50);
check(delayedPensionRes.maxAccountingResidualAbs === 0, '사적연금 62세 개시 지연 시나리오 회계 잔차 0원');
for (const r of delayedPensionRes.rows) {
  if (r.ageSelf < 62) {
    check(
      r.stage5PersonalPensionWithdrawal === 0 && r.stage3IrpWithdrawal === 0,
      `사적연금 개시연령(62세) 이전(${r.ageSelf}세)에는 타 자산이 충분할 때 연금저축/IRP가 조기 인출되지 않아야 함`
    );
  }
}
totalCheckedYears += delayedPensionRes.rows.length;

// 8. 배우자 예상 일시 퇴직금(spouseExpectedSeverancePay) 인별 분리 퇴직소득세 및 IRP 지분 반영 검증
const concentratedSeveranceInputs = defineInputs({
  pension: {
    ...DEFAULT_SIMULATION_INPUTS.pension,
    hasSpouse: true,
    currentAgeSelf: 52,
    currentAgeSpouse: 52,
  },
  accounts: {
    ...DEFAULT_SIMULATION_INPUTS.accounts,
    selfRetirementPensionBalance: 0,
    spouseRetirementPensionBalance: 0,
  },
  transition: {
    ...DEFAULT_SIMULATION_INPUTS.transition,
    targetRetirementAgeSelf: 55,
    expectedSeverancePay: 500_000_000,
    spouseExpectedSeverancePay: 0,
    severanceTransferToIrp: false,
  },
});
const splitSeveranceInputs = defineInputs({
  ...concentratedSeveranceInputs,
  transition: {
    ...concentratedSeveranceInputs.transition,
    expectedSeverancePay: 300_000_000,
    spouseExpectedSeverancePay: 200_000_000,
    severanceTransferToIrp: false,
  },
});
const splitSeveranceIrpInputs = defineInputs({
  ...splitSeveranceInputs,
  transition: {
    ...splitSeveranceInputs.transition,
    severanceTransferToIrp: true,
  },
});

const concRes = runCanonicalLedger(concentratedSeveranceInputs, 50);
const splitRes = runCanonicalLedger(splitSeveranceInputs, 50);
const splitIrpRes = runCanonicalLedger(splitSeveranceIrpInputs, 50);

check(concRes.maxAccountingResidualAbs === 0, '단독 5억 퇴직금 일시수령 시나리오 회계 잔차 0원');
check(splitRes.maxAccountingResidualAbs === 0, '본인 3억 + 배우자 2억 분리 퇴직금 일시수령 시나리오 회계 잔차 0원');
check(splitIrpRes.maxAccountingResidualAbs === 0, '본인 3억 + 배우자 2억 분리 퇴직금 IRP 이연 시나리오 회계 잔차 0원');
check(
  splitRes.blueprint.totalCapitalAtRetirement > concRes.blueprint.totalCapitalAtRetirement,
  `부부 퇴직금 인별 분리 산출 시 누진 퇴직소득세 절감으로 D-Day 세후 자본이 단독 합산보다 커야 함 (분리: ${splitRes.blueprint.totalCapitalAtRetirement}, 단독합산: ${concRes.blueprint.totalCapitalAtRetirement})`
);
check(
  splitIrpRes.blueprint.allocIrp === 500_000_000,
  `부부 퇴직금(3억+2억) 전액 IRP 이연 시 D-Day IRP 잔액은 5억 원이어야 함 (실측: ${splitIrpRes.blueprint.allocIrp})`
);
totalCheckedYears += concRes.rows.length + splitRes.rows.length + splitIrpRes.rows.length;

// 9. [Phase A] GAP-02 국민연금 추납 원금 차감, GAP-03 개인 청산세 대칭화, 부부 해외양도세 500만 공제 및 4대 세부 세목 합산 불변식 검증
check(
  bench50.rows[3].additionalPensionContribution === 12_400_000,
  `GAP-02: 은퇴 전환 연차(53세)에 국민연금 추납 일시납 원금 12,400,000원이 정확히 정산되어야 함 (실측: ${bench50.rows[3].additionalPensionContribution})`
);
check(
  calculateOverseasCapitalGainsTax(5_000_000, false) === 550_000 &&
    calculateOverseasCapitalGainsTax(5_000_000, true) === 0,
  '부부 합산(hasSpouse=true) 시 해외주식 양도차익 500만 원까지 기본공제(250만×2인)로 세액 0원'
);
check(
  resolvePersonalExitNetWorth(500_000_000, 300_000_000, 1.0, 100_000_000, 100_000_000, true) <
    500_000_000 + 200_000_000,
  'GAP-03: resolvePersonalExitNetWorth는 기말 개인 일반계좌 미실현 양도세 및 잔여 연금 잠재 청산세(3.3%)를 차감해야 함'
);
for (const r of bench50.rows) {
  const sumGranular =
    r.taxPublicAndDiv +
    r.taxPrivatePensionAndIrp +
    r.taxOverseasCapGains +
    r.taxIsaAndSeveranceLump;
  check(
    sumGranular === r.personalIncomeAndDivTax,
    `[${r.ageSelf}세] 4대 세부 개인세목 합계(${sumGranular}) === personalIncomeAndDivTax(${r.personalIncomeAndDivTax})`
  );
  check(
    typeof r.isHealthDependentEligible === 'boolean',
    `[${r.ageSelf}세] isHealthDependentEligible 불리언 필드 포함`
  );
}

// 10. [Phase B] 생애 일시 목돈 현금흐름 이벤트(lumpSumEvents: 자녀 결혼·교육 지출, 상속·증여 유입) 1원 보존 항등식 검증
const baseNoEvents = defineInputs();
const withOutflowEvent = defineInputs({
  cashflow: {
    ...DEFAULT_SIMULATION_INPUTS.cashflow,
    lumpSumEvents: [
      {
        id: 'evt-wedding',
        ageSelf: 65,
        type: 'outflow',
        amount: 150_000_000,
        label: '자녀 결혼 지원',
      },
      {
        id: 'evt-edu',
        ageSelf: 55,
        type: 'outflow',
        amount: 50_000_000,
        label: '자녀 유학 지원',
      },
    ],
  },
});
const withInflowEvent = defineInputs({
  cashflow: {
    ...DEFAULT_SIMULATION_INPUTS.cashflow,
    lumpSumEvents: [
      {
        id: 'evt-inherit',
        ageSelf: 68,
        type: 'inflow',
        amount: 200_000_000,
        label: '상속·증여 유입',
      },
    ],
  },
});

for (const ratio of [0, 50, 100]) {
  const rBase = runCanonicalLedger(baseNoEvents, ratio);
  const rOut = runCanonicalLedger(withOutflowEvent, ratio);
  const rIn = runCanonicalLedger(withInflowEvent, ratio);
  check(
    rOut.maxAccountingResidualAbs === 0,
    `일시 지출 이벤트(재직 55세 5천만 + 은퇴 65세 1.5억, 개인 ${ratio}%) 회계 잔차 0원`
  );
  check(
    rIn.maxAccountingResidualAbs === 0,
    `일시 유입 이벤트(은퇴 68세 2억, 개인 ${ratio}%) 회계 잔차 0원`
  );
  check(
    rOut.finalDisposableNetWorth < rBase.finalDisposableNetWorth,
    `일시 목돈 지출 시 100세 기말 순자산이 기본값보다 감소해야 함 (개인 ${ratio}%)`
  );
  check(
    rIn.finalDisposableNetWorth > rBase.finalDisposableNetWorth,
    `일시 목돈 유입 시 100세 기말 순자산이 기본값보다 증가해야 함 (개인 ${ratio}%)`
  );
  const row65Out = rOut.rows.find((row) => row.ageSelf === 65)!;
  check(
    row65Out.lumpSumEventOutflow > 150_000_000 &&
      row65Out.lumpSumEventLabels.includes('자녀 결혼 지원'),
    `65세 일시 지출 이벤트 물가연동 금액(${row65Out.lumpSumEventOutflow}) 및 라벨 기록 확인`
  );
  const row68In = rIn.rows.find((row) => row.ageSelf === 68)!;
  check(
    row68In.lumpSumEventInflow > 200_000_000 &&
      row68In.lumpSumEventLabels.includes('상속·증여 유입'),
    `68세 일시 유입 이벤트 물가연동 금액(${row68In.lumpSumEventInflow}) 및 라벨 기록 확인`
  );
  totalCheckedYears += rOut.rows.length + rIn.rows.length;
}

// 11. [Adversarial Edge Cases]
//     - 11a: 이미 은퇴한 연령(currentAgeSelf=62 > targetRetirementAgeSelf=60)에서 국민연금 추납 활성화 시 첫 연차(62세)에 추납 원금이 누락 없이 정산되어야 함
const alreadyRetiredAddPensionInputs = defineInputs({
  pension: {
    ...DEFAULT_SIMULATION_INPUTS.pension,
    currentAgeSelf: 62,
    currentAgeSpouse: 60,
    applyAdditionalPensionSelf: true,
    additionalMonthsSelf: 60,
    monthlyContributionSelf: 200_000,
  },
  transition: {
    ...DEFAULT_SIMULATION_INPUTS.transition,
    targetRetirementAgeSelf: 60,
  },
});
const alreadyRetiredRes = runCanonicalLedger(alreadyRetiredAddPensionInputs, 50);
check(
  alreadyRetiredRes.maxAccountingResidualAbs === 0 &&
    alreadyRetiredRes.rows[0].additionalPensionContribution === 12_000_000,
  `이미 은퇴한 사용자(62세 > 은퇴연령 60세)도 첫 연차에 추납 원금 12,000,000원이 차감되고 잔차 0원이어야 함 (실측: ${alreadyRetiredRes.rows[0].additionalPensionContribution})`
);
totalCheckedYears += alreadyRetiredRes.rows.length;

//     - 11b: 동일 연차(65세)에 일시 유입("상속·증여 유입")과 일시 지출("자녀 결혼 지원")이 동시에 발생할 때 유입/지출 라벨이 섞이지 않고 분리되어야 함
const sameYearMixedEventsInputs = defineInputs({
  cashflow: {
    ...DEFAULT_SIMULATION_INPUTS.cashflow,
    lumpSumEvents: [
      {
        id: 'evt-in-65',
        ageSelf: 65,
        type: 'inflow',
        amount: 200_000_000,
        label: '상속·증여 유입',
      },
      {
        id: 'evt-out-65',
        ageSelf: 65,
        type: 'outflow',
        amount: 150_000_000,
        label: '자녀 결혼 지원',
      },
    ],
  },
});
const sameYearMixedRes = runCanonicalLedger(sameYearMixedEventsInputs, 50);
const row65Mixed = sameYearMixedRes.rows.find((r) => r.ageSelf === 65)!;
check(
  sameYearMixedRes.maxAccountingResidualAbs === 0 &&
    row65Mixed.lumpSumInflowLabels.length === 1 &&
    row65Mixed.lumpSumInflowLabels[0] === '상속·증여 유입' &&
    row65Mixed.lumpSumOutflowLabels.length === 1 &&
    row65Mixed.lumpSumOutflowLabels[0] === '자녀 결혼 지원',
  '동일 연차 유입·지출 동시 발생 시 lumpSumInflowLabels와 lumpSumOutflowLabels가 정확히 분리되어야 함'
);
totalCheckedYears += sameYearMixedRes.rows.length;

//     - 11c: 재직기(isEmployed=true) 대규모 일시 목돈 지출 시 일반과세계좌 해외양도세 Gross-Up 및 ISA 폴백 정합성 검증
const preRetireLargeOutflowInputs = defineInputs({
  asset: {
    ...DEFAULT_SIMULATION_INPUTS.asset,
    totalInvestment: 100_000_000,
    growthEtfRatio: 100,
    dividendEtfRatio: 0,
    growthRate: 10.0,
    dividendYield: 0,
    overseasEtfRatio: 100,
  },
  accounts: {
    ...DEFAULT_SIMULATION_INPUTS.accounts,
    selfIsaBalance: 80_000_000,
    spouseIsaBalance: 80_000_000,
  },
  transition: {
    ...DEFAULT_SIMULATION_INPUTS.transition,
    preRetirementMonthlySavings: 0,
  },
  cashflow: {
    ...DEFAULT_SIMULATION_INPUTS.cashflow,
    lumpSumEvents: [
      {
        id: 'evt-pre-big',
        ageSelf: 55,
        type: 'outflow',
        amount: 250_000_000,
        label: '재직중 대형 지출',
      },
    ],
  },
});
const preRetireLargeRes = runCanonicalLedger(preRetireLargeOutflowInputs, 100);
const row55Pre = preRetireLargeRes.rows.find((r) => r.ageSelf === 55)!;
check(
  preRetireLargeRes.maxAccountingResidualAbs === 0 &&
    row55Pre.stage6OverseasTaxableWithdrawal > 0 &&
    row55Pre.taxOverseasCapGains > 0 &&
    row55Pre.stage4IsaWithdrawal > 0 &&
    row55Pre.unmetSpendingNeed === 0,
  `재직기 대규모 일시 지출 시 일반계좌 해외양도세(${row55Pre.taxOverseasCapGains}) 및 ISA 폴백(${row55Pre.stage4IsaWithdrawal})이 정상 작동하고 회계 잔차 0원이어야 함`
);
totalCheckedYears += preRetireLargeRes.rows.length;

// 12. v1.2.14 T5: 수익률 시나리오(returnShiftPct)는 커널 한 곳에서 5대 계좌(IRP·ISA·연금저축·일반·법인) 연 수익률에 동일하게 가산
//     - 계좌 하나만 1억으로 채운 격리 시나리오의 1년차 투자수익이 시프트 −3/+3에서 정확히 ∓300만(±1원 반올림) 이동해야 함
//     - Step 7 계좌별 지정 수익률(overrideSymmetricAccountReturns)에도 동일 적용
{
  const B = 100_000_000;
  const zeroAcc = {
    ...DEFAULT_SIMULATION_INPUTS.accounts,
    selfRetirementPensionBalance: 0,
    spouseRetirementPensionBalance: 0,
    selfIsaBalance: 0,
    spouseIsaBalance: 0,
    selfPersonalPensionBalance: 0,
    spousePersonalPensionBalance: 0,
    isaExpectedReturnRate: 6.1,
    personalPensionReturnRate: 4.7,
    irpExpectedReturnRate: 3.9,
  };
  const baskets: { id: string; acc: Partial<typeof zeroAcc>; invest: number; pRatio: number }[] = [
    { id: 'IRP', acc: { selfRetirementPensionBalance: B }, invest: 0, pRatio: 100 },
    { id: 'ISA', acc: { selfIsaBalance: B }, invest: 0, pRatio: 100 },
    { id: '연금저축', acc: { selfPersonalPensionBalance: B }, invest: 0, pRatio: 100 },
    { id: '일반', acc: {}, invest: B, pRatio: 100 },
    { id: '법인', acc: {}, invest: B, pRatio: 0 },
  ];
  for (const custom of [false, true]) {
    for (const b of baskets) {
      const runFor = (shift: number) =>
        runCanonicalLedger(
          defineInputs({
            asset: { ...DEFAULT_SIMULATION_INPUTS.asset, totalInvestment: b.invest, returnShiftPct: shift },
            accounts: { ...zeroAcc, ...b.acc, overrideSymmetricAccountReturns: custom },
          }),
          b.pRatio
        );
      const base = runFor(0);
      check(base.rows[0].startBookTotal === B, `[T5 ${b.id}] 격리 시나리오 기초잔액 1억`);
      for (const shift of [-3, 3]) {
        const res = runFor(shift);
        const delta = res.rows[0].grossInvestmentReturn - base.rows[0].grossInvestmentReturn;
        check(
          Math.abs(delta - (B * shift) / 100) <= 1,
          `[T5 ${b.id} custom=${custom} shift=${shift}] 1년차 수익률이 정확히 ${shift}%p 이동해야 함 (Δ=${delta})`
        );
        check(res.maxAccountingResidualAbs === 0, `[T5 ${b.id} shift=${shift}] 회계 잔차 0원`);
      }
    }
  }
  for (const preset of PRESET_SCENARIOS) {
    for (const shift of [-3, 3]) {
      for (const pRatio of [0, 50, 100]) {
        const res = runCanonicalLedger(
          defineInputs({ ...preset.inputs, asset: { ...preset.inputs.asset, returnShiftPct: shift } }),
          pRatio
        );
        check(
          res.rows.every((r) => r.accountingResidual === 0),
          `[T5 ${preset.id} shift=${shift} p=${pRatio}] 전 연차 잔차 0원`
        );
        totalCheckedYears += res.rows.length;
      }
    }
  }
}

// 13. v1.2.14: 은퇴 D-Day 법인 설립·일괄 이전(injectionTiming: 'retirement') & 동년 해외주식 250만/500만 공제 중복 차단 & 만 60세 미만 임원 국민연금 연차별 인상 검증
{
  for (const preset of PRESET_SCENARIOS) {
    for (const timing of ['now', 'retirement'] as const) {
      for (const sevIrp of [true, false]) {
        for (const pRatio of [0, 25, 50, 75, 100]) {
          const inp = defineInputs({
            ...preset.inputs,
            corporate: { ...preset.inputs.corporate, injectionTiming: timing },
            transition: { ...preset.inputs.transition, severanceTransferToIrp: sevIrp },
          });
          const res = runCanonicalLedger(inp, pRatio);
          check(
            res.maxAccountingResidualAbs === 0,
            `[injectionTiming=${timing} ${preset.id} sevIrp=${sevIrp} p=${pRatio}] 전 연차 잔차 0원`
          );
          const b = res.blueprint;
          const bSum = b.allocIrp + b.allocIsa + b.allocPersonalPension + b.allocTaxable + b.allocCorporate;
          check(
            bSum === b.totalCapitalAtRetirement,
            `[injectionTiming=${timing} ${preset.id}] D-Day 5대 바스켓 합계(${bSum}) === totalCapitalAtRetirement(${b.totalCapitalAtRetirement})`
          );
          if (
            timing === 'retirement' &&
            inp.transition.targetRetirementAgeSelf > inp.pension.currentAgeSelf
          ) {
            for (const r of res.rows) {
              if (r.isEmployed) {
                check(
                  r.startCorp === 0 && r.endCorp === 0 && r.corpCorporateTax === 0,
                  `[injectionTiming=retirement ${preset.id} ${r.ageSelf}세] 재직기 중 법인 잔액 및 법인세는 0원이어야 함`
                );
              }
            }
          }
          totalCheckedYears += res.rows.length;
        }
      }
    }
  }

  // 동년(D-Day) 법인 이전 매도 + Stage 7 일반계좌 인출 동시 발생 시 해외양도세 기본공제(부부 500만) 중복 적용 차단 검증
  const dDaySameYearInputs = defineInputs({
    pension: { ...DEFAULT_SIMULATION_INPUTS.pension, hasSpouse: true, currentAgeSelf: 55, currentAgeSpouse: 55 },
    transition: {
      ...DEFAULT_SIMULATION_INPUTS.transition,
      targetRetirementAgeSelf: 56,
      preRetirementMonthlySavings: 0,
      expectedSeverancePay: 0,
    },
    accounts: {
      ...DEFAULT_SIMULATION_INPUTS.accounts,
      selfRetirementPensionBalance: 0,
      spouseRetirementPensionBalance: 0,
      selfIsaBalance: 0,
      spouseIsaBalance: 0,
      selfPersonalPensionBalance: 0,
      spousePersonalPensionBalance: 0,
    },
    asset: {
      ...DEFAULT_SIMULATION_INPUTS.asset,
      totalInvestment: 500_000_000,
      growthEtfRatio: 100,
      dividendEtfRatio: 0,
      growthRate: 10,
      dividendYield: 0,
      overseasEtfRatio: 100,
    },
    corporate: {
      ...DEFAULT_SIMULATION_INPUTS.corporate,
      injectionTiming: 'retirement',
      liquidationTaxMode: 'simple_gross', // Stage 6 비과세 선회수를 끄고 Stage 7 일반계좌 인출이 당해 즉시 일어나도록 유도
    },
    cashflow: {
      ...DEFAULT_SIMULATION_INPUTS.cashflow,
      targetNetMonthlyLivingExpense: 8_000_000,
    },
  });
  const dDaySameYearRes = runCanonicalLedger(dDaySameYearInputs, 50);
  const dDayRow = dDaySameYearRes.rows.find((r) => r.ageSelf === 56)!;
  check(
    dDaySameYearRes.maxAccountingResidualAbs === 0 &&
      dDayRow.stage6OverseasTaxableWithdrawal > 0 &&
      dDayRow.taxOverseasCapGains > 0,
    `D-Day 법인 이전 및 Stage 7 일반계좌 동시 매도 시 회계 잔차 0원 및 양도세 정상 부과 (taxOverseasCapGains=${dDayRow.taxOverseasCapGains})`
  );
  totalCheckedYears += dDaySameYearRes.rows.length;

  // 만 60세 미만 은퇴 임원의 연차별 국민연금 보험료율 인상(idx=0 9.5% → idx=5 12.0%) 반영 검증
  const earlyRetireCorpInputs = defineInputs({
    pension: { ...DEFAULT_SIMULATION_INPUTS.pension, currentAgeSelf: 52, currentAgeSpouse: 52 },
    transition: { ...DEFAULT_SIMULATION_INPUTS.transition, targetRetirementAgeSelf: 52, preRetirementMonthlySavings: 0 },
  });
  const earlyRetireCorpRes = runCanonicalLedger(earlyRetireCorpInputs, 0);
  check(
    earlyRetireCorpRes.maxAccountingResidualAbs === 0 &&
      earlyRetireCorpRes.rows[0].corpPayrollTaxAndInsurance <
        earlyRetireCorpRes.rows[5].corpPayrollTaxAndInsurance,
    `만 60세 미만 은퇴 임원의 4대보험·근로소득세는 국민연금 요율 인상(52세 idx=0 9.5% → 57세 idx=5 12.0%)에 따라 증가해야 함`
  );
  totalCheckedYears += earlyRetireCorpRes.rows.length;

  // Edge Case A: injectionTiming='retirement' + 부동산 다운사이징(재직 중 53세 및 은퇴 당일 55세) 결합 시 1원 무결성 검증
  for (const downsizeAge of [53, 55]) {
    const downsizeDeferredInputs = defineInputs({
      pension: { ...DEFAULT_SIMULATION_INPUTS.pension, currentAgeSelf: 50, currentAgeSpouse: 50 },
      transition: { ...DEFAULT_SIMULATION_INPUTS.transition, targetRetirementAgeSelf: 55 },
      corporate: { ...DEFAULT_SIMULATION_INPUTS.corporate, injectionTiming: 'retirement' },
      realEstate: {
        ...DEFAULT_SIMULATION_INPUTS.realEstate,
        transition: {
          strategy: 'downsize',
          downsizingAge: downsizeAge,
          downsizedAssessedValue: 600_000_000,
          downsizingActualSurplusCash: 400_000_000,
          downsizingCorpAllocationRatio: 50,
        },
      },
    });
    const downsizeDeferredRes = runCanonicalLedger(downsizeDeferredInputs, 50);
    check(
      downsizeDeferredRes.maxAccountingResidualAbs === 0 &&
        downsizeDeferredRes.rows.filter((r) => r.isEmployed).every((r) => r.startCorp === 0 && r.endCorp === 0) &&
        downsizeDeferredRes.rows.find((r) => r.ageSelf === 55)!.endCorp > 0,
      `[injectionTiming=retirement + downsize@${downsizeAge}세] 재직기 법인 잔액 0원, 은퇴 당일 법인 잔액 양수 및 전 연차 회계 잔차 0원`
    );
    totalCheckedYears += downsizeDeferredRes.rows.length;
  }

  // Edge Case B: 이미 은퇴한 상태(currentAgeSelf >= targetRetirementAgeSelf)에서 injectionTiming='retirement' 설정 시 즉시 분할 폴백 및 잔차 0원 검증
  const alreadyRetiredDeferredInputs = defineInputs({
    pension: { ...DEFAULT_SIMULATION_INPUTS.pension, currentAgeSelf: 60, currentAgeSpouse: 58 },
    transition: { ...DEFAULT_SIMULATION_INPUTS.transition, targetRetirementAgeSelf: 58 },
    corporate: { ...DEFAULT_SIMULATION_INPUTS.corporate, injectionTiming: 'retirement' },
  });
  const alreadyRetiredDeferredRes = runCanonicalLedger(alreadyRetiredDeferredInputs, 40);
  check(
    alreadyRetiredDeferredRes.maxAccountingResidualAbs === 0 &&
      alreadyRetiredDeferredRes.blueprint.allocCorporate > 0 &&
      alreadyRetiredDeferredRes.rows[0].startCorp > 0,
    '이미 은퇴한 상태에서 injectionTiming=retirement 선택 시 첫 해부터 법인 배분이 정상 적용되고 잔차 0원이어야 함'
  );
  totalCheckedYears += alreadyRetiredDeferredRes.rows.length;

  // Edge Case C: 상세 ETF 모드에서 KR_INDEX(국내주식형 비과세) vs US_INDEX(국내상장 해외지수 15.4% 배당과세) D-Day 법인 일괄 이전 시 세후 출자원금 차이 검증
  const makeDetailedDeferredInputs = (category: string) =>
    defineInputs({
      pension: { ...DEFAULT_SIMULATION_INPUTS.pension, currentAgeSelf: 50, currentAgeSpouse: 50 },
      transition: {
        ...DEFAULT_SIMULATION_INPUTS.transition,
        targetRetirementAgeSelf: 55,
        preRetirementMonthlySavings: 0,
        expectedSeverancePay: 0,
      },
      corporate: { ...DEFAULT_SIMULATION_INPUTS.corporate, injectionTiming: 'retirement' },
      asset: {
        ...DEFAULT_SIMULATION_INPUTS.asset,
        totalInvestment: 600_000_000,
        inputMode: 'detailed',
        holdings: [
          {
            ticker: category === 'KR_INDEX' ? '069500' : '360750',
            name: category === 'KR_INDEX' ? 'KODEX 200' : 'TIGER 미국S&P500',
            market: 'KRX',
            amount: 600_000_000,
            category,
            expenseRatio: 0.15,
            actualExpenseRatio: 0.2,
            dividendYield: 0,
            dividendCycle: 'Quarterly',
            expectedGrowthRate: 8.0,
            productType: 'domestic_listed',
          },
        ],
      },
    });
  const krIndexDeferredRes = runCanonicalLedger(makeDetailedDeferredInputs('KR_INDEX'), 50);
  const usIndexDeferredRes = runCanonicalLedger(makeDetailedDeferredInputs('US_INDEX'), 50);
  check(
    krIndexDeferredRes.maxAccountingResidualAbs === 0 &&
      usIndexDeferredRes.maxAccountingResidualAbs === 0 &&
      krIndexDeferredRes.blueprint.corporatePaidInCapital >
        usIndexDeferredRes.blueprint.corporatePaidInCapital,
    `D-Day 법인 일괄 이전 시 국내주식형(KR_INDEX) 매도차익 비과세로 인해 세후 법인 출자원금(${krIndexDeferredRes.blueprint.corporatePaidInCapital})이 국내상장 해외ETF(${usIndexDeferredRes.blueprint.corporatePaidInCapital})보다 커야 함`
  );
  totalCheckedYears += krIndexDeferredRes.rows.length + usIndexDeferredRes.rows.length;
}

// E5. 연도별 수익률 경로(asset.returnPathPct, %p 가산): 0 경로 ≡ 경로 없음, 상수 경로 ≡ returnShiftPct, 같은 충격도 순서에 따라 결과가 달라야 함(순서위험)
{
  const base = DEFAULT_SIMULATION_INPUTS;
  const withPath = (path: number[]) => ({ ...base, asset: { ...base.asset, returnPathPct: path } });
  const n = 51;
  const plain = runCanonicalLedger(base, 50);
  const zero = runCanonicalLedger(withPath(new Array(n).fill(0)), 50);
  check(zero.finalDisposableNetWorth === plain.finalDisposableNetWorth, 'E5 0 경로 = 경로 없음');
  const constPath = runCanonicalLedger(withPath(new Array(n).fill(1.5)), 50);
  const shifted = runCanonicalLedger({ ...base, asset: { ...base.asset, returnShiftPct: 1.5 } }, 50);
  check(
    constPath.finalDisposableNetWorth === shifted.finalDisposableNetWorth,
    `E5 상수 +1.5%p 경로 = returnShiftPct 1.5 (${constPath.finalDisposableNetWorth} vs ${shifted.finalDisposableNetWorth})`
  );
  const earlyCrash = new Array(n).fill(0);
  earlyCrash[10] = -30; // 60세 은퇴 첫해 폭락
  earlyCrash[40] = 30;
  const lateCrash = new Array(n).fill(0);
  lateCrash[10] = 30;
  lateCrash[40] = -30;
  const early = runCanonicalLedger(withPath(earlyCrash), 50);
  const late = runCanonicalLedger(withPath(lateCrash), 50);
  check(
    early.maxAccountingResidualAbs === 0 && late.maxAccountingResidualAbs === 0,
    'E5 경로 적용 시 회계 보존 잔차 0원'
  );
  check(
    early.finalDisposableNetWorth < late.finalDisposableNetWorth,
    `E5 순서위험: 같은 ±30%p 충격이라도 은퇴 초기 폭락이 더 나쁨 (${early.finalDisposableNetWorth} < ${late.finalDisposableNetWorth})`
  );
  totalCheckedYears += early.rows.length + late.rows.length;
}

// A1. 법인 실현주의 원가 추적 + 청산가치(잠재 법인세 + 의제배당 인별·연도별 종합과세)
{
  const t = (d: number) => calculateIndividualCombinedTax(d, 0, 0, d).dividendTax;
  const lump = resolveCorporateExitBreakdown({
    corpBalance: 1_000_000_000,
    costBasis: 600_000_000,
    paidInCapital: 500_000_000,
    pendingRealizedGain: 0,
    taxType: 'transparent',
    liquidationTaxMode: 'capital_return_exempt',
    shareholderCount: 2,
    distributionYears: 1,
  });
  // B5-②: 의제배당 분배 연도 지역 소득보험료(인별 금융소득 1,000만 초과 시 전액, 월 상한 4,591,740원, 장기요양 가산)
  const lumpHealth = Math.round(Math.min(4_591_740 * 12, 412_000_000 * 0.0719) * (1 + 0.1314));
  check(
    lump.latentCorporateTax === 88_000_000 &&
      lump.capitalReturn === 500_000_000 &&
      lump.deemedDividend === 412_000_000 &&
      lump.dividendTax === 2 * t(206_000_000) &&
      lump.extraHealthInsurance === lumpHealth &&
      lump.netValue === 912_000_000 - 2 * t(206_000_000) - lumpHealth,
    `A1 청산: 미실현 4억×22% = 8,800만, 출자금 5억 비과세, 의제배당 4.12억 인별 2.06억 종합과세 + 건보 ${lumpHealth} (실측 ${JSON.stringify(lump)})`
  );
  const capped = resolveCorporateExitBreakdown({
    corpBalance: 10_000_000_000,
    costBasis: 10_000_000_000,
    paidInCapital: 0,
    pendingRealizedGain: 0,
    taxType: 'transparent',
    liquidationTaxMode: 'capital_return_exempt',
    shareholderCount: 2,
    distributionYears: 1,
  });
  check(
    capped.extraHealthInsurance === Math.round(4_591_740 * 12 * (1 + 0.1314)),
    `B5-② 100억 일시 의제배당 건보료는 월 상한 적용 (실측 ${capped.extraHealthInsurance})`
  );
  const smallPhased = resolveCorporateExitBreakdown({
    corpBalance: 300_000_000,
    costBasis: 300_000_000,
    paidInCapital: 100_000_000,
    pendingRealizedGain: 0,
    taxType: 'transparent',
    liquidationTaxMode: 'capital_return_exempt',
    shareholderCount: 2,
    distributionYears: 10,
  });
  check(smallPhased.extraHealthInsurance === 0, 'B5-② 10년 분할 시 인당 연 1,000만 이하 의제배당은 건보 부과 제외');
  const phasedNormal = resolveCorporateExitBreakdown({
    corpBalance: 1_000_000_000,
    costBasis: 600_000_000,
    paidInCapital: 500_000_000,
    pendingRealizedGain: 0,
    taxType: 'normal',
    liquidationTaxMode: 'capital_return_exempt',
    shareholderCount: 2,
    distributionYears: 10,
  });
  check(
    phasedNormal.latentCorporateTax === 44_000_000,
    `A1 10년 분할 실현: 연 4,000만 × 11% × 10년 = 4,400만 (실측 ${phasedNormal.latentCorporateTax})`
  );
  const grossMode = resolveCorporateExitBreakdown({
    corpBalance: 1_000_000_000,
    costBasis: 1_000_000_000,
    paidInCapital: 500_000_000,
    pendingRealizedGain: 0,
    taxType: 'transparent',
    liquidationTaxMode: 'simple_gross',
    shareholderCount: 1,
    distributionYears: 1,
  });
  check(
    grossMode.latentCorporateTax === 0 && grossMode.capitalReturn === 0 && grossMode.deemedDividend === 1_000_000_000,
    'A1 단순 일괄과세 모드는 출자금 비과세 환급 없음, 미실현이익 0이면 잠재 법인세 0'
  );

  // 성장형(배당 0) 법인 100%: 종전에는 매도 실현차익이 영구 비과세(법인세 0원)였음
  const growthOnly = defineInputs({
    ...DEFAULT_SIMULATION_INPUTS,
    asset: { ...DEFAULT_SIMULATION_INPUTS.asset, dividendYield: 0 },
  });
  const c100 = runCanonicalLedger(growthOnly, 0);
  const lifetimeCorpTax = c100.rows.reduce((s, r) => s + r.corpCorporateTax, 0);
  check(c100.maxAccountingResidualAbs === 0, 'A1 성장형 법인 100% 회계 보존 잔차 0원');
  check(lifetimeCorpTax > 0, `A1 실현주의: 급여·배당·가수금 지급을 위한 매도 차익에 법인세 부과 (생애 ${lifetimeCorpTax})`);
  const last = c100.rows[c100.rows.length - 1];
  const exitArgs = {
    corpBalance: last.endCorp,
    costBasis: last.endCorpCostBasis,
    paidInCapital: last.endCorpPaidInCapital,
    pendingRealizedGain: last.endCorpPendingRealizedGain,
    taxType: growthOnly.corporate.taxType,
    liquidationTaxMode: growthOnly.corporate.liquidationTaxMode ?? 'capital_return_exempt',
    shareholderCount: 2 as const,
    distributionYears: growthOnly.corporate.phasedExitDurationYears ?? 10,
  };
  check(
    last.endCorpLiquidationNetValue === resolveCorporateExitBreakdown(exitArgs).netValue,
    'A1 원장 청산가치 = resolveCorporateExitBreakdown(행 종료 원가·출자금·미납 실현이익)'
  );
  check(
    last.endCorpLiquidationNetValue <
      resolveCorporateExitBreakdown({ ...exitArgs, costBasis: last.endCorp, pendingRealizedGain: 0 }).netValue,
    'A1 청산가치 < 법인 단계 과세 0원 가정치 (미실현이익 잠재 법인세 반영)'
  );
  totalCheckedYears += c100.rows.length;
}

// B4. 부부 인별 소득 귀속(E3) + 피부양자 인별 판정(E4): 물가 0%, 배당 0, 개인 100%, 66세 행
{
  const persona = defineInputs({
    ...DEFAULT_SIMULATION_INPUTS,
    asset: { ...DEFAULT_SIMULATION_INPUTS.asset, dividendYield: 0 },
    realEstate: { ...DEFAULT_SIMULATION_INPUTS.realEstate, officiallyAssessedValue: 500_000_000, ownership: 'joint' },
    pension: {
      ...DEFAULT_SIMULATION_INPUTS.pension,
      hasSpouse: true,
      currentAgeSelf: 60,
      currentAgeSpouse: 60,
      expectedMonthlyPensionSelf: 1_000_000,
      expectedMonthlyPensionSpouse: 800_000,
      claimTimingSelf: 'normal',
      claimTimingSpouse: 'normal',
    },
    transition: { ...DEFAULT_SIMULATION_INPUTS.transition, targetRetirementAgeSelf: 60, inflationRate: 0 },
  });
  const run = runCanonicalLedger(persona, 100);
  const r66 = run.rows.find((r) => r.ageSelf === 66)!;
  const expectedPensionTax =
    calculateIndividualCombinedTax(0, 12_000_000).pensionTax + calculateIndividualCombinedTax(0, 9_600_000).pensionTax;
  check(run.maxAccountingResidualAbs === 0, 'B4 인별 귀속 페르소나 잔차 0원');
  check(
    r66.publicPensionInflow === 21_600_000 && r66.taxPublicAndDiv === expectedPensionTax,
    `E3 66세 공적연금 소득세 = 본인 1,200만 + 배우자 960만 인별 합 ${expectedPensionTax} (실측 ${r66.taxPublicAndDiv})`
  );
  check(
    r66.isHealthDependentEligible && r66.dependentIncomeHeadroom === 8_000_000,
    `E4 인별 소득 1,200만/960만(각 ≤2,000만) → 피부양자 충족, 여유 = min(800만, 1,040만) (실측 ${r66.isHealthDependentEligible}/${r66.dependentIncomeHeadroom})`
  );
  const richSpouse = runCanonicalLedger(
    defineInputs({ ...persona, pension: { ...persona.pension, expectedMonthlyPensionSpouse: 1_800_000 } }),
    100
  ).rows.find((r) => r.ageSelf === 66)!;
  check(
    !richSpouse.isHealthDependentEligible && richSpouse.dependentIncomeHeadroom === 0,
    'E4 배우자 소득 2,160만 > 2,000만 → 부부 동반 탈락'
  );
  totalCheckedYears += run.rows.length;
}

// B5-①: 임원 1인(본인 직장가입자) + 배우자 피부양자 탈락 → 배우자 본인 지역보험료(지분 재산 + 본인 소득) 부과
{
  const mk = (spouseMonthlyPension: number) =>
    defineInputs({
      ...DEFAULT_SIMULATION_INPUTS,
      asset: { ...DEFAULT_SIMULATION_INPUTS.asset, dividendYield: 0 },
      realEstate: { ...DEFAULT_SIMULATION_INPUTS.realEstate, officiallyAssessedValue: 800_000_000, ownership: 'joint' },
      corporate: { ...DEFAULT_SIMULATION_INPUTS.corporate, executiveCount: 1 },
      pension: {
        ...DEFAULT_SIMULATION_INPUTS.pension,
        hasSpouse: true,
        currentAgeSelf: 60,
        currentAgeSpouse: 60,
        expectedMonthlyPensionSelf: 1_000_000,
        expectedMonthlyPensionSpouse: spouseMonthlyPension,
      },
      transition: { ...DEFAULT_SIMULATION_INPUTS.transition, targetRetirementAgeSelf: 60, inflationRate: 0 },
    });
  const hi = runCanonicalLedger(mk(1_800_000), 0).rows.find((r) => r.ageSelf === 66)!;
  const lo = runCanonicalLedger(mk(800_000), 0).rows.find((r) => r.ageSelf === 66)!;
  const spouseRegional = calculateRegionalHealthInsurance({
    assessedPropertyValue: 400_000_000, // 공동명의 지분 50%
    ownership: 'single',
    fairMarketValueRatio: 60,
    apply2024Reform: true,
    assessableAnnualIncome: Math.round(21_600_000 * 0.5),
    hasSpouse: false,
  }).annualTotal;
  check(
    hi.stage2CorpNetSalary > 0 && lo.stage2CorpNetSalary > 0,
    'B5-① 페르소나: 본인 임원 급여로 직장가입자'
  );
  check(
    hi.personalHealthInsurance >= spouseRegional && lo.personalHealthInsurance < spouseRegional,
    `B5-① 배우자 연금 2,160만(>2,000만) → 배우자 지역보험료 ${spouseRegional} 포함 (실측 ${hi.personalHealthInsurance}), 960만이면 피부양자 (실측 ${lo.personalHealthInsurance})`
  );
}

// B5-⑤: 배우자 근속연수는 본인 serviceYears를 재사용하지 않고 transition.spouseServiceYears(미지정 시 배우자 은퇴나이 − 27)
{
  const inp = defineInputs({
    ...DEFAULT_SIMULATION_INPUTS,
    transition: {
      ...DEFAULT_SIMULATION_INPUTS.transition,
      targetRetirementAgeSelf: 60,
      expectedSeverancePay: 300_000_000,
      spouseExpectedSeverancePay: 100_000_000,
      severanceTransferToIrp: false,
      serviceYears: 30,
      spouseServiceYears: 5,
    },
    // ISA 인출세가 같은 칸(taxIsaAndSeveranceLump)에 합산되지 않도록 ISA 0원
    accounts: {
      ...DEFAULT_SIMULATION_INPUTS.accounts,
      selfIsaBalance: 0,
      spouseIsaBalance: 0,
      selfIsaAnnualAddition: 0,
      spouseIsaAnnualAddition: 0,
    },
  });
  const dday = runCanonicalLedger(inp, 100).rows.find((r) => r.ageSelf === 60)!;
  const expected =
    calculateRetirementIncomeTax(300_000_000, 30).tax + calculateRetirementIncomeTax(100_000_000, 5).tax;
  check(
    dday.taxIsaAndSeveranceLump === expected,
    `B5-⑤ D-Day 퇴직소득세 = 본인 3억/30년 + 배우자 1억/5년 = ${expected} (실측 ${dday.taxIsaAndSeveranceLump})`
  );
}

// ── v2 B1: 엔진 커널 법령·청산 정밀화 (E-3, E-5b/G1, E-1, E-2) ──
{
  const std = PRESET_SCENARIOS.find((p) => p.id === 'standard-50-60')!.inputs;
  const target = Math.max(
    WORKPLACE_MIN_MONTHLY_SALARY_PER_EXEC,
    Math.round(std.corporate.executiveSalaryMonthly || WORKPLACE_MIN_MONTHLY_SALARY_PER_EXEC)
  );
  const execCost = (age: number, idx: number) => {
    const p = solveExecutivePayroll(target, 1, age, idx);
    return p.annualTotalCorporatePayrollCost - p.annualTotalNetSalary;
  };

  // E-3: 부부 공동임원은 임원별 만 나이로 국민연금(60세 미만) 판정 — 본인 60·61세, 배우자 58·59세
  const stdRows = runCanonicalLedger(std, 76).rows;
  for (const age of [60, 61]) {
    const row = stdRows.find((r) => r.ageSelf === age)!;
    const idx = age - std.pension.currentAgeSelf;
    const expected = execCost(age, idx) + execCost(row.ageSpouse, idx);
    check(
      row.corpPayrollTaxAndInsurance === expected,
      `E-3 본인 ${age}·배우자 ${row.ageSpouse}세 4대보험 = 임원별 합산 ${expected} (실측 ${row.corpPayrollTaxAndInsurance})`
    );
  }
  // E-3 역방향: 본인 58세(<60)·배우자 61세(≥60) — 배우자분 국민연금 과다 부과 금지
  const olderSpouse = defineInputs({
    ...std,
    pension: { ...std.pension, currentAgeSelf: 55, currentAgeSpouse: 58 },
    transition: { ...std.transition, targetRetirementAgeSelf: 55, preRetirementMonthlySavings: 0 },
  });
  const os58 = runCanonicalLedger(olderSpouse, 50).rows.find((r) => r.ageSelf === 58)!;
  const osExpected = execCost(58, 3) + execCost(61, 3);
  check(
    os58.corpPayrollTaxAndInsurance === osExpected,
    `E-3 역방향 본인 58·배우자 61세 = ${osExpected} (실측 ${os58.corpPayrollTaxAndInsurance})`
  );

  // E-5b/G1: 65세 수급권자는 재직 중에도 공적연금 수령 — 은퇴 67세 입력 시 65·66세 연금 0원 금지
  const lateRetire = defineInputs({
    ...std,
    transition: { ...std.transition, targetRetirementAgeSelf: 67 },
  });
  const ungated = (inp: typeof std, ageSelf: number, ageSpouse: number) =>
    calculateAnnualPublicPension({
      ageSelf,
      ageSpouse,
      elapsedYears: ageSelf - inp.pension.currentAgeSelf,
      inflationRatePercent: inp.transition.inflationRate ?? 2.5,
      pension: inp.pension,
    });
  const lrRows = runCanonicalLedger(lateRetire, 76).rows;
  for (const age of [65, 66]) {
    const row = lrRows.find((r) => r.ageSelf === age)!;
    const exp = ungated(lateRetire, age, row.ageSpouse).totalAnnual;
    check(
      exp > 0 && row.publicPensionInflow === exp,
      `E-5b 재직 중 ${age}세 공적연금 = ${exp} (실측 ${row.publicPensionInflow})`
    );
  }
  const olderSpouseEmployed = defineInputs({
    ...std,
    pension: { ...std.pension, currentAgeSpouse: 56 },
  });
  const ose59 = runCanonicalLedger(olderSpouseEmployed, 76).rows.find((r) => r.ageSelf === 59)!;
  const oseExp = ungated(olderSpouseEmployed, 59, ose59.ageSpouse);
  check(
    oseExp.spouseAnnual > 0 && oseExp.selfAnnual === 0 && ose59.publicPensionInflow === oseExp.totalAnnual,
    `E-5b 본인 재직(59세) 중 연상 배우자(65세) 연금 = ${oseExp.totalAnnual} (실측 ${ose59.publicPensionInflow})`
  );

  // E-1: 법인 고갈로 납부 못 한 이월 실현차익 법인세는 증발하지 않고 다음 해 가계(2차 납세의무)가 부담
  let depletionCases = 0;
  for (const preset of PRESET_SCENARIOS) {
    for (let pRatio = 0; pRatio <= 100; pRatio += 5) {
      const rows = runCanonicalLedger(preset.inputs, pRatio).rows;
      for (let i = 0; i + 1 < rows.length; i++) {
        const cur = rows[i];
        if (cur.endCorp !== 0 || cur.endCorpPendingRealizedGain <= 0) continue;
        depletionCases++;
        const owed = calculateCorporateTax(cur.endCorpPendingRealizedGain, preset.inputs.corporate.taxType);
        check(
          rows[i + 1].corpCorporateTax >= owed && owed > 0,
          `E-1 [${preset.id} p=${pRatio}% ${cur.ageSelf}세 고갈] 익년 법인세 ≥ 이월차익 세액 ${owed} (실측 ${rows[i + 1].corpCorporateTax})`
        );
      }
    }
  }
  check(depletionCases > 0, 'E-1 고갈 케이스가 1건 이상 검증되어야 함');

  // E-2: 100세 연금계좌 잔고 청산세 — 옵션 없으면 기존 일괄 3.3%(하위호환), 옵션 시 분할연수·인별 1,500만 저율한도·초과 16.5%
  check(
    resolvePersonalExitNetWorth(0, 0, 0, 1e9, 1e9, true) === 1_934_000_000,
    'E-2 6-인자 호출은 기존 값(20억 × 96.7%) 유지'
  );
  const irp1804 = 1_804_000_000;
  const exitNet = resolvePersonalExitNetWorth(0, 0, 0, irp1804, 0, true, {
    pensionSelfShare: 0.5,
    distributionYears: 10,
  });
  const perYear = irp1804 / 2 / 10; // 9,020만/인/년
  const expectedTax = Math.round(
    2 * 10 * (15_000_000 * 0.033 + (perYear - 15_000_000) * 0.165)
  );
  check(
    irp1804 - exitNet === expectedTax && Math.abs(expectedTax - 258_000_000) < 1_000_000,
    `E-2 18.04억 부부 균분 10년 청산세 = ${expectedTax} (실측 ${irp1804 - exitNet})`
  );
  check(
    resolvePersonalExitNetWorth(0, 0, 0, 0, 0, true, { pensionSelfShare: 0.5, distributionYears: 10 }) === 0,
    'E-2 연금잔고 0이면 0'
  );

  // E-3: 1-A 55세 이후 인출 순서(연금저축/IRP 저율한도 우선 인출 -> ISA) 및 55세 이전 ISA 우선 인출 검증
  {
    const stdPreset = PRESET_SCENARIOS.find((p) => p.id === 'standard-50-60')!;
    const ledgerStd = runCanonicalLedger(stdPreset.inputs, 100);
    // 은퇴 시점(60세): 55세 이상이므로 비과세/저율 연금 바스켓(stage5PersonalPensionWithdrawal 또는 stage3IrpWithdrawal)이 먼저 가동
    const r60 = ledgerStd.rows.find((r) => r.ageSelf === 60);
    check(
      Boolean(r60 && (r60.stage5PersonalPensionWithdrawal > 0 || r60.stage3IrpWithdrawal > 0)),
      '60세 은퇴 첫해에는 55세 이상이므로 비과세/저율 연금 바스켓 우선 인출이 가동되어야 함'
    );

    const firePreset = PRESET_SCENARIOS.find((p) => p.id === 'fire-40-45-single')!;
    const ledgerFire = runCanonicalLedger(firePreset.inputs, 100);
    // 45세 은퇴 시점: 55세 미만이므로 연금/IRP는 인출 불가(0원), ISA가 먼저 가동
    const r45 = ledgerFire.rows.find((r) => r.ageSelf === 45);
    check(
      Boolean(
        r45 &&
          r45.stage5PersonalPensionWithdrawal === 0 &&
          r45.stage3IrpWithdrawal === 0 &&
          r45.stage4IsaWithdrawal > 0
      ),
      '45세 은퇴 시점에는 55세 미만이므로 연금/IRP 인출 0원, ISA에서 생활비 충당'
    );
  }

  // E-4: 스트레스 시나리오 계좌 대칭성(overrideSymmetricAccountReturns) 및 은퇴 첫해 하락장 검증
  {
    const stressInputs = defineInputs({
      accounts: {
        ...DEFAULT_SIMULATION_INPUTS.accounts,
        overrideSymmetricAccountReturns: true,
      },
      pension: {
        ...DEFAULT_SIMULATION_INPUTS.pension,
        currentAgeSelf: 60,
      },
      transition: {
        ...DEFAULT_SIMULATION_INPUTS.transition,
        marketStressScenario: 'early_drop_30',
        targetRetirementAgeSelf: 60,
      },
    });
    const stressLedger = runCanonicalLedger(stressInputs, 50);
    const r0 = stressLedger.rows[0];
    check(
      r0.grossInvestmentReturn < 0,
      `early_drop_30 스트레스 하에서 은퇴 첫해 총 운용수익은 음수여야 함 (실측: ${r0.grossInvestmentReturn})`
    );
  }

  // E-5: KRX 과세대상 차익비율(krxTaxableGainRatio) 및 미공제 연금원금(uncreditedPensionBasis) 청산가치 반영 검증
  {
    const exitNetKrx0 = resolvePersonalExitNetWorth(1_000_000_000, 500_000_000, 0, 0, 0, false, {
      pensionSelfShare: 1.0,
      distributionYears: 10,
      krxTaxableGainRatio: 0,
    });
    const exitNetKrx1 = resolvePersonalExitNetWorth(1_000_000_000, 500_000_000, 0, 0, 0, false, {
      pensionSelfShare: 1.0,
      distributionYears: 10,
      krxTaxableGainRatio: 1,
    });
    check(
      exitNetKrx0 > exitNetKrx1,
      `krxTaxableGainRatio=1일 때 잠재 매매차익 과세로 청산가치가 낮아야 함 (${exitNetKrx0} vs ${exitNetKrx1})`
    );

    const exitWithUncredited = resolvePersonalExitNetWorth(0, 0, 0, 0, 20_000_000, false, {
      pensionSelfShare: 1.0,
      distributionYears: 10,
      uncreditedPensionBasis: 12_000_000,
    });
    const exitWithoutUncredited = resolvePersonalExitNetWorth(0, 0, 0, 0, 20_000_000, false, {
      pensionSelfShare: 1.0,
      distributionYears: 10,
      uncreditedPensionBasis: 0,
    });
    check(
      exitWithUncredited > exitWithoutUncredited,
      `세액공제 한도 초과 불공제 원금(1,200만 원)은 비과세 반환되므로 청산 실수령액이 커야 함 (${exitWithUncredited} vs ${exitWithoutUncredited})`
    );
  }
}

console.log(
  `✅ PASS: ledgerInvariants.test.ts (${totalCheckedYears} scenario-years verified with 0 Won accounting residual)`
);


