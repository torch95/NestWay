export type OwnershipType = 'single' | 'joint';
export type CorporateTaxType = 'transparent' | 'normal';
export type TaxRecognitionMode = 'yearly' | 'realized';
export type PensionClaimTiming = 'early' | 'normal' | 'deferred';
export type EtfProductType = 'overseas_direct' | 'domestic_listed' | 'covered_call' | 'other';
export type RealEstateStrategyType = 'keep' | 'downsize' | 'housing_pension' | 'sell_rent';
export type HousingType = 'own' | 'rent';
export type SeveranceSystemType = 'pension' | 'severance_pay';
export type MarketStressScenarioType =
  | 'none'
  | 'early_drop_20'
  | 'early_drop_30'
  | 'dotcom_crash'
  | 'gfc_2008'
  | 'stagflation';

export interface EtfHolding {
  ticker: string;
  name: string;
  market: 'KRX' | 'US';
  amount: number;
  ratio?: number;
  category: string;
  expenseRatio: number;
  actualExpenseRatio: number;
  dividendYield: number;
  dividendCycle: 'Monthly' | 'Quarterly' | 'Annual' | 'None';
  expectedGrowthRate: number;
  productType: EtfProductType;
  /** 과세표준비율 (0~1, 미지정 시 KRX 커버드콜 0.3 / 기타 1.0 자동 추론) */
  taxStandardRatio?: number;
}

export interface BasicAssetInputs {
  totalInvestment: number;
  growthEtfRatio: number;
  dividendEtfRatio: number;
  growthRate: number;
  dividendYield: number;
  investmentHorizon: number;
  overseasEtfRatio: number;
  inputMode?: 'macro' | 'detailed';
  holdings?: EtfHolding[];
  /** 부부 일반금융자산 본인 명의 비중(%, 0~100, 기본 50). 해외주식 250만 인별 공제 및 배당·건보 인별 귀속에 반영 */
  selfOwnershipPercent?: number;
  /** 수익률 시나리오 시프트(%p). 커널이 5대 계좌 연 수익률에 동일 가산. UI 선택지 −3 / 0 / +3, 기본 0 */
  returnShiftPct?: number;
  /** 연도별 수익률 충격 경로(%p, index 0 = 현재 연도). 몬테카를로 전용(UI 미노출) — returnShiftPct 위에 해당 연도에만 가산 */
  returnPathPct?: number[];
}

export interface RealEstateTransitionConfig {
  strategy: RealEstateStrategyType;
  downsizingAge?: number;
  downsizedAssessedValue?: number;
  downsizingActualSurplusCash?: number;
  downsizingCorpAllocationRatio?: number;
  targetHousingType?: HousingType;
  targetLeaseDeposit?: number;
  targetMonthlyRent?: number;
  housingPensionStartAge?: number;
  housingPensionMonthlyPayout?: number;
  monthlyRentExpense?: number;
}

export interface RealEstateInputs {
  housingType?: HousingType;
  officiallyAssessedValue: number;
  leaseDeposit?: number;
  monthlyRent?: number;
  ownership: OwnershipType;
  fairMarketValueRatio: number;
  basicDeduction: number;
  apply2024HealthReform?: boolean;
  /** 은퇴기 주택 보유세(재산세 + 종합부동산세) 연차 반영 여부 (기본 true) */
  includePropertyTax?: boolean;
  transition?: RealEstateTransitionConfig;
}

export interface ActiveSeniorConfig {
  spendingMode: 'flat' | 'active_senior';
  activeSeniorDelta: number;
  activeAgeEnd: number;
  stableAgeEnd: number;
  applyCareShock?: boolean;
  careShockMonthlyExpense?: number;
}

export interface LumpSumCashflowEvent {
  id: string;
  ageSelf: number;
  type: 'outflow' | 'inflow';
  amount: number; // 원 (현재 가치 기준, 연차별 CPI 연동)
  label: string;
}

export interface CashflowInputs {
  targetNetMonthlyLivingExpense: number;
  monthlyFixedExpense: number;
  spendingMode?: 'flat' | 'active_senior';
  activeSeniorConfig?: ActiveSeniorConfig;
  lumpSumEvents?: LumpSumCashflowEvent[];
}

export interface CorporateInputs {
  executiveCount: 1 | 2;
  executiveSalaryMonthly?: number;
  annualFixedMaintenanceFee: number;
  taxType: CorporateTaxType;
  customCorporateTaxRate: number;
  taxRecognitionMode: TaxRecognitionMode;
  liquidationTaxMode?: 'simple_gross' | 'capital_return_exempt';
  usePrecisionSolver?: boolean;
  /** 가족법인 투입 시점: 'now'(기본, 현재부터) | 'retirement'(은퇴 D-Day에 일반계좌 일부 매도·이전) */
  injectionTiming?: 'now' | 'retirement';
  exitStrategy?: 'lump_sum_liquidation' | 'phased_dividend_reduction' | 'family_share_transfer';
  phasedExitDurationYears?: number;
  /** 법인 자금 투입 방식: 'shareholder_loan'(주주 차입 가수금, 등록면허세 0원) | 'capital_stock'(납입자본금, 증자 등록면허세 0.48% + 유상감자) */
  fundingStructure?: 'shareholder_loan' | 'capital_stock';
  /** 100세 기말 평가 기준: 'liquidation'(청산 소득세·건보 차감 가처분 순자산, 기본) | 'inheritance'(100세 상속세 차감 후 순상속가치) */
  terminalValuationMode?: 'liquidation' | 'inheritance';
}

export interface PensionInputs {
  hasSpouse?: boolean;
  currentAgeSelf: number;
  currentAgeSpouse: number;
  expectedMonthlyPensionSelf: number;
  expectedMonthlyPensionSpouse: number;
  claimTimingSelf: PensionClaimTiming;
  claimTimingSpouse: PensionClaimTiming;
  applyAdditionalPensionSelf: boolean;
  additionalMonthsSelf: number;
  monthlyContributionSelf: number;
  applyAdditionalPensionSpouse: boolean;
  additionalMonthsSpouse: number;
  monthlyContributionSpouse: number;
}

export interface AccountAssetInputs {
  selfIsaBalance: number;
  selfIsaAnnualAddition: number;
  spouseIsaBalance: number;
  spouseIsaAnnualAddition: number;
  isaExpectedReturnRate: number;
  selfPersonalPensionBalance: number;
  selfPersonalPensionAnnualAddition: number;
  selfPersonalPensionStartAge: number;
  selfPersonalPensionMonthlyWithdrawal: number;
  spousePersonalPensionBalance: number;
  spousePersonalPensionAnnualAddition: number;
  spousePersonalPensionStartAge: number;
  spousePersonalPensionMonthlyWithdrawal: number;
  personalPensionReturnRate: number;
  selfSeveranceType?: SeveranceSystemType;
  selfRetirementPensionBalance: number;
  selfRetirementTransferToIrp?: boolean;
  selfRetirementPensionStartAge: number;
  selfRetirementPensionMonthlyWithdrawal: number;
  spouseSeveranceType?: SeveranceSystemType;
  spouseRetirementPensionBalance: number;
  spouseRetirementTransferToIrp?: boolean;
  spouseRetirementPensionStartAge: number;
  spouseRetirementPensionMonthlyWithdrawal: number;
  irpExpectedReturnRate?: number;
  overrideSymmetricAccountReturns?: boolean; // Fair Comparison: false = use unified portfolio return
  shelteredInputMode?: 'macro' | 'detailed';
  shelteredHoldings?: EtfHolding[];
  applyIrpRiskAssetCap?: boolean;
}

export interface TransitionInputs {
  targetRetirementAgeSelf: number;
  expectedSeverancePay: number;
  /** 배우자 은퇴 시 추가 수령할 예상 일시 퇴직금 (부부 각자 인별 근속연수공제·누진세율 및 IRP 지분 산정) */
  spouseExpectedSeverancePay?: number;
  severanceTransferToIrp: boolean;
  /** 퇴직소득세 근속연수 (미지정 시 은퇴나이 − 27세, 1~40년 클램프) */
  serviceYears?: number;
  /** 배우자 퇴직소득세 근속연수 (미지정 시 배우자 은퇴나이 − 27세, 1~40년 클램프 — 본인 serviceYears 재사용 안 함) */
  spouseServiceYears?: number;
  preRetirementMonthlySavings: number;
  inflationRate: number;
  viewMode: 'nominal' | 'real';
  marketStressScenario: MarketStressScenarioType;
}

export interface HybridInputs {
  personalRatio: number;
  corporateRatio: number;
  useAutoOptimalRatio?: boolean;
}

export interface SimulationInputs {
  asset: BasicAssetInputs;
  realEstate: RealEstateInputs;
  cashflow: CashflowInputs;
  corporate: CorporateInputs;
  pension: PensionInputs;
  accounts: AccountAssetInputs;
  transition: TransitionInputs;
  hybrid: HybridInputs;
}

export const DEFAULT_ACTIVE_SENIOR_CONFIG: ActiveSeniorConfig = {
  spendingMode: 'active_senior',
  activeSeniorDelta: 0.25,
  activeAgeEnd: 64,
  stableAgeEnd: 77,
  applyCareShock: true,
  careShockMonthlyExpense: 1_500_000,
};

export function normalizeCashflow(cashflow: CashflowInputs): CashflowInputs {
  const mode = cashflow.spendingMode ?? 'flat';
  const normalizedEvents = Array.isArray(cashflow.lumpSumEvents)
    ? cashflow.lumpSumEvents
        .slice(0, 5)
        .map((e, i) => ({
          id: String(e.id || `evt-${i + 1}`),
          ageSelf: Math.min(100, Math.max(20, Math.round(Number(e.ageSelf) || 60))),
          type: (e.type === 'inflow' ? 'inflow' : 'outflow') as 'inflow' | 'outflow',
          amount: Math.max(0, Math.round(Number(e.amount) || 0)),
          label: String(e.label || (e.type === 'inflow' ? '일시 유입' : '일시 지출')).slice(0, 40),
        }))
    : [];
  const rawActiveSenior = cashflow.activeSeniorConfig ?? DEFAULT_ACTIVE_SENIOR_CONFIG;
  const shockAmt = Math.max(0, rawActiveSenior.careShockMonthlyExpense ?? 1_500_000);
  const nextActiveSenior =
    mode === 'flat' && !cashflow.activeSeniorConfig
      ? undefined
      : {
          ...rawActiveSenior,
          spendingMode: mode,
          applyCareShock: shockAmt > 0,
          careShockMonthlyExpense: shockAmt,
        };
  return {
    ...cashflow,
    ...(nextActiveSenior ? { activeSeniorConfig: nextActiveSenior } : {}),
    lumpSumEvents: normalizedEvents,
  };
}

export function getMonthlyLivingExpenseForAge(
  ageSelf: number,
  baseExpense: number,
  config?: ActiveSeniorConfig
): number {
  if (!config || config.spendingMode !== 'active_senior') {
    return baseExpense;
  }
  const activeAgeEnd = config.activeAgeEnd ?? 64;
  const stableAgeEnd = config.stableAgeEnd ?? 77;
  const rawDelta = config.activeSeniorDelta ?? 0.25;
  const delta = rawDelta > 1 ? rawDelta / 100 : rawDelta;

  if (ageSelf <= activeAgeEnd) {
    return Math.round(baseExpense * (1 + delta));
  }
  if (ageSelf <= stableAgeEnd) {
    return baseExpense;
  }
  let careExpense = Math.round(baseExpense * (1 - delta));
  const careShock =
    config.careShockMonthlyExpense !== undefined
      ? Math.max(0, config.careShockMonthlyExpense)
      : config.applyCareShock
        ? 1_500_000
        : 0;
  if (careShock > 0) {
    careExpense += careShock;
  }
  return careExpense;
}

export function calculateCurrentLiquidAssets(inputs: SimulationInputs): number {
  const hasSpouse = inputs.pension?.hasSpouse ?? true;
  const a = inputs.accounts;
  const self =
    (a?.selfIsaBalance || 0) +
    (a?.selfPersonalPensionBalance || 0) +
    (a?.selfRetirementPensionBalance || 0);
  const spouse = hasSpouse
    ? (a?.spouseIsaBalance || 0) +
      (a?.spousePersonalPensionBalance || 0) +
      (a?.spouseRetirementPensionBalance || 0)
    : 0;
  return (inputs.asset?.totalInvestment || 0) + self + spouse;
}

// ============================================================================
// Single Canonical 5-Basket Ledger & Optimization Output Schema
// ============================================================================

export interface DayOneBlueprint {
  retirementAgeSelf: number;
  yearsToRetirement: number;
  currentLiquidCapital: number;
  totalCapitalAtRetirement: number;
  personalRatio: number;
  corporateRatio: number;
  allocIrp: number;
  allocIsa: number;
  allocPersonalPension: number;
  allocTaxable: number;
  allocCorporate: number;
  corporatePaidInCapital: number;
  isaStrategySummary: string;
}

export interface CanonicalYearRow {
  yearIndex: number; // 1-based
  ageSelf: number;
  ageSpouse: number;
  isEmployed: boolean;
  stageLabel: string;
  discountFactor: number;

  // Starting Balances (5 Baskets)
  startIrp: number;
  startIsa: number;
  startPersonalPension: number;
  startTaxable: number;
  startCorp: number;
  startBookTotal: number;

  // Investment Returns & External Cash Inflows
  grossInvestmentReturn: number;
  savingsAndSeveranceInflow: number;
  realEstateCashInflow: number;
  publicPensionInflow: number;
  housingPensionInflow: number;
  lumpSumEventInflow: number;
  totalExternalInflow: number;

  // Spending Target & 8-Stage Decumulation Waterfall
  requiredLivingOutflow: number;
  lumpSumEventOutflow: number;
  lumpSumEventLabels: string[];
  lumpSumInflowLabels: string[];
  lumpSumOutflowLabels: string[];
  stage1PublicAndHousingPension: number;
  stage2CorpNetSalary: number;
  stage3IrpWithdrawal: number;
  stage4IsaWithdrawal: number;
  stage5PersonalPensionWithdrawal: number;
  stage6OverseasTaxableWithdrawal: number;
  stage7DomesticTaxableWithdrawal: number;
  stage8CorpFallbackDividend: number;
  unmetSpendingNeed: number;

  // Tax, Health Insurance & Corporate Friction
  personalIncomeAndDivTax: number;
  taxPublicAndDiv: number;
  taxPrivatePensionAndIrp: number;
  taxOverseasCapGains: number;
  taxIsaAndSeveranceLump: number;
  additionalPensionContribution: number;
  personalHealthInsurance: number;
  /** 은퇴기 주택 보유세(재산세 + 종합부동산세, 재직기 0원) — B4 불변식 보존을 위해 taxPublicAndDiv와 분리 계상 */
  personalPropertyTax: number;
  isHealthDependentEligible: boolean;
  /** 피부양자 자격 유지를 위한 잔여 소득 한도 (초과 시 음수 또는 0) */
  dependentIncomeHeadroom?: number;
  corpCorporateTax: number;
  corpPayrollTaxAndInsurance: number;
  corpMaintenanceAndFixedCost: number;
  /** 관측 전용: 당해 법인 수령 배당(분배금) — 성실신고 수동소득 비중 판정 분자 */
  corpDividendIncome: number;
  /** 관측 전용: 당해 법인세 과세 대상 실현 매매차익(유지비·급여 매도분 + 전년 이월분) */
  corpRealizedSaleGain: number;
  totalTaxHealthAndFees: number;
  naiveBaselineTaxAndHealth: number;
  annualTaxAndHealthSaved: number;

  // Ending Balances (5 Baskets + After-Tax Disposable Liquidation Net Worth)
  endIrp: number;
  endIsa: number;
  endPersonalPension: number;
  endTaxable: number;
  endCorp: number;
  endCorpPaidInCapital: number;
  /** A1: 법인 투자자산 취득원가(실현주의) — 청산 시 미실현이익 = endCorp − endCorpCostBasis */
  endCorpCostBasis: number;
  /** A1: 당해 유출 매도 실현차익 중 다음 해 법인세 신고분(미납) */
  endCorpPendingRealizedGain: number;
  /** 당해 말 법인 잔여 이월결손금 (법인세법 §13① 15년 한도) */
  endCorpCarryforwardLoss?: number;
  endCorpLiquidationNetValue: number;
  endBookTotal: number;
  endDisposableNetWorth: number;

  // 1-Won Conservation Identity Residual (Must equal 0)
  accountingResidual: number;
}

export interface CanonicalLedgerRunResult {
  personalRatio: number;
  corporateRatio: number;
  blueprint: DayOneBlueprint;
  rows: CanonicalYearRow[];
  finalBookNetWorth: number;
  finalDisposableNetWorth: number;
  minDisposableNetWorthDuringRetirement: number;
  minAssetAgeSelf: number;
  preservationRatioPercent: number;
  finalAssetMultiple: number;
  depletionAgeSelf: number | null;
  totalLifetimeTaxPaid: number;
  totalLifetimeHealthInsPaid: number;
  totalLifetimeTaxAndHealthCost: number;
  total30YearTaxAndHealthSaved: number;
  totalLifetimeTaxAndHealthSaved: number;
  totalUnmetSpendingNeed: number;
  maxAccountingResidualAbs: number;
}

export interface AllocationCurvePoint {
  personalRatio: number;
  corporateRatio: number;
  finalDisposableNetWorth: number;
  totalLifetimeTaxAndHealthCost: number;
  sustainableMonthlyLivingExpense: number;
  /** true면 r* 이외 포인트의 선형 보간값(법인 100% ↔ 개인 100%), false면 이분탐색 실계산값 */
  sustainableIsInterpolated: boolean;
  depletionAgeSelf: number | null;
}

export interface StrategySummaryCard {
  strategyType: 'personal' | 'corporate' | 'hybrid';
  strategyName: string;
  personalRatio: number;
  corporateRatio: number;
  finalDisposableNetWorth: number;
  finalBookNetWorth: number;
  totalLifetimeTaxAndHealthCost: number;
  totalLifetimeTaxAndHealthSaved: number;
  sustainableMonthlyLivingExpense: number;
  monthlyBuffer: number;
  isSustainable: boolean;
  preservationRatioPercent: number;
  finalAssetMultiple: number;
  minDisposableNetWorthDuringRetirement: number;
  minAssetAgeSelf: number;
  depletionAgeSelf: number | null;
  realEstateHealthInsShielded: boolean;
}

export interface CorporateBreakEvenDiagnostic {
  annualRegionalHealthInsShield: number;
  annualTaxShield: number;
  annualTotalBenefit: number;
  annualCorporateFixedCost: number;
  netAnnualAdvantage: number;
  breakEvenLiquidAssetThreshold: number;
  isAboveBreakEven: boolean;
  recommendedStrategy: 'personal' | 'corporate' | 'hybrid';
  verdictSummary: string;
}

export interface CorporateExitStrategyOption {
  strategyType:
    | 'lump_sum_gross'
    | 'lump_sum_capital_exempt'
    | 'phased_dividend_reduction'
    | 'family_share_transfer';
  title: string;
  finalCorpBookAssets: number;
  paidInCapitalExempt: number;
  taxableDistribution: number;
  exitTaxPaid: number;
  /** exitTaxPaid 중 법인 단계 잠재 법인세(미실현이익·미납 실현이익) */
  corporateLevelTax?: number;
  extraHealthInsPaid: number;
  netPocketedValue: number;
  effectiveExitTaxRatePercent: number;
  description: string;
}

export interface CorporateExitComparison {
  lumpSumGross: CorporateExitStrategyOption;
  lumpSumCapitalExempt: CorporateExitStrategyOption;
  phasedExit: CorporateExitStrategyOption;
  familySuccession: CorporateExitStrategyOption;
  recommendedExit: CorporateExitStrategyOption['strategyType'];
  maxTaxSavedVsSimpleGross: number;
}

export interface PensionTimingOptionMetric {
  timing: PensionClaimTiming;
  label: string;
  claimAgeSelf: number;
  monthlyPayoutInitial: number;
  cumulativePayoutTo100: number;
  finalDisposableNetWorth: number;
  /** 정상수령(65세) 대비 누적 수령액이 역전(교차)되는 본인 연령 (정상수령 자체 또는 미교차 시 null) */
  crossoverAgeVsNormal?: number | null;
}

export interface PensionTimingComparison {
  early: PensionTimingOptionMetric;
  normal: PensionTimingOptionMetric;
  deferred: PensionTimingOptionMetric;
  additionalPensionMonthlyIncreaseSelf: number;
  additionalPensionMonthlyIncreaseSpouse: number;
  additionalPensionTotalCost: number;
  additionalPensionRoiMultiple: number;
  recommendedTiming: PensionClaimTiming;
}

export interface ExecutiveStructureOptionMetric {
  executiveCount: 1 | 2;
  label: string;
  annualTotalPayrollCost: number;
  annualNetSalaryReceived: number;
  annualTaxAnd4InsCost: number;
  finalDisposableNetWorth: number;
}

export interface ExecutiveStructureComparison {
  singleExec: ExecutiveStructureOptionMetric;
  jointExec: ExecutiveStructureOptionMetric;
  recommendedCount: 1 | 2;
  netWorthAdvantage: number;
}

export interface ActionChecklistItem {
  id: string;
  targetAge: number;
  phaseLabel: string;
  category: string;
  title: string;
  impactSummary: string;
  description: string;
}

export interface SincereFilingSummary {
  /** 법인 배당 또는 실현 매매차익이 있는 연도 수 */
  corpYears: number;
  /** (배당+이자) ÷ 매출 ≥ 50%로 성실신고확인대상 가능성이 있는 연도 수 (투자업 등록·매매차익 매출 계상 전제) */
  likelyYears: number;
  firstLikelyAgeSelf: number | null;
  /** 해당 연도를 50% 미만으로 낮추기 위해 추가로 필요한 연말 매매차익의 최댓값(원) */
  maxAdditionalSaleGain: number;
  maxAdditionalSaleGainAgeSelf: number | null;
  /** 매년 평가 인식(yearly) 모드: 실현 매매차익이 거의 생기지 않아 근사치 */
  isApproximate: boolean;
}

export interface PortfolioEvaluationSummary {
  effectiveGrowthRate: number;
  effectiveDividendYield: number;
  effectiveTotalReturn: number;
  weightedExpenseRatio: number;
  overseasDirectRatio: number;
  estimatedFirstYearMonthlyDividend: number;
  /** 분배금 중 실제 배당소득세 과세 대상 비중 (0~1, 기본 1.0, KRX 커버드콜 포함 시 옵션프리미엄 비과세 차감 반영) */
  taxableDividendRatio?: number;
  /** 국내 상장(KRX) 비중 중 국내주식이 아닌 기타(해외지수·채권·파생·리츠) ETF 비중 (0~1, 일반계좌 매도 시 15.4% 배당소득세 대상) */
  krxTaxableGainRatio?: number;
}

export interface OptimizationMasterPlan {
  inputs: SimulationInputs;
  portfolio: PortfolioEvaluationSummary;
  personal100: CanonicalLedgerRunResult;
  corporate100: CanonicalLedgerRunResult;
  optimalHybrid: CanonicalLedgerRunResult;
  activeLedger: CanonicalLedgerRunResult;
  cards: {
    personal: StrategySummaryCard;
    corporate: StrategySummaryCard;
    hybrid: StrategySummaryCard;
  };
  /** U-1: activeLedger 비율의 전략 카드(지속가능 월생활비 실계산) — 모든 화면의 비율·월생활비·여유분 단일 정본 */
  activeCard: StrategySummaryCard;
  winner: 'personal' | 'corporate' | 'hybrid';
  winnerTitle: string;
  winnerAdvantageOverRunnerUp: number;
  /** 'ALL_DEPLETE': 0~100% 모든 배분 후보가 100세 이전 고갈 → r*는 "최장 보존" 의미만 가짐 */
  allocationStatus: 'OK' | 'ALL_DEPLETE';
  allocationCurve: AllocationCurvePoint[];
  breakEven: CorporateBreakEvenDiagnostic;
  corporateExit: CorporateExitComparison;
  pensionComparison: PensionTimingComparison;
  executiveComparison: ExecutiveStructureComparison;
  actionChecklist: ActionChecklistItem[];
  /** activeLedger 기준 성실신고확인대상(수동소득 ≥ 50%) 연도별 판정 요약 — 정보 제공용 */
  sincereFilingSummary: SincereFilingSummary;
  /** B7: 실익 임계를 통과한 권고 배분 (수학적 r*는 optimalHybrid에 보존). auto 모드의 activeLedger·winner·체크리스트 기준 */
  recommendation: AllocationRecommendation;
  /** 상속세 및 가업·지분승계 진단 (상증세법 §21·§22·§26·§53) */
  estateDiagnostic: EstateAndGiftDiagnostic;
  computeTimeMs: number;
}

export interface EstateTaxStrategyMetric {
  grossEstateValue: number; // 부동산 평가액 + 세전 금융/법인 평가액
  realEstateValue: number;
  financialAssetDeduction: number; // 상증세법 §22 순금융재산 20%(최대 2억, 가족법인 지배주주 주식 제외)
  lumpSumAndSpouseDeduction: number; // 일괄공제 5억 (100세 시점 기준; 배우자 생존 가정 시 추가 안내)
  inheritanceTaxableBase: number;
  estimatedInheritanceTax: number; // 상증세법 §26 10~50% 누진 (신고세액공제 3% 반영)
  netAfterInheritanceValue: number; // 부동산 제외 순금융·법인 기준 세후 상속가치 (가처분 순자산과 직접 비교용)
  totalNetEstateAfterTax: number; // 부동산 포함 세후 총상속재산
}

export interface EstateAndGiftDiagnostic {
  terminalValuationMode: 'liquidation' | 'inheritance';
  personal100Estate: EstateTaxStrategyMetric;
  corporate100Estate: EstateTaxStrategyMetric;
  activeEstate: EstateTaxStrategyMetric;
  spousalGiftCarryoverNote: string | null; // 소득세법 §97의2 & 상증세법 §53 안내 (명의 편중 시)
  shareholderLoanSafeHarborNote: string | null; // 상증세법 §45의5 적정이자 증여의제 안내
}

export interface AllocationRecommendation {
  personalRatio: number;
  corporateRatio: number;
  /** 권고 비율 === 수학적 최적 r* */
  isMathematicalOptimum: boolean;
  /** (r* − 개인100%) / 개인100% 100세 가처분 순자산 이득률(%) */
  netWorthGainPct: number;
  netWorthGainKrw: number;
  /** r* 지속가능 월생활비 − 개인100% 지속가능 월생활비 */
  sustainableMonthlyDelta: number;
  /** r*의 개인100% 대비 우위가 뒤집히는 섭동 (유지비×1.5 / 수익률 −0.5%p) */
  robustnessFailure?: 'maintenance' | 'return' | 'maintenance_and_return';
  reason: string;
}
