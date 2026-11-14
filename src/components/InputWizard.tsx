import React, { useEffect, useRef, useState } from 'react';
import {
  calculateCurrentLiquidAssets,
  calculateCurrentShelteredTotal,
  DEFAULT_SIMULATION_INPUTS,
  defineInputs,
  evaluatePortfolio,
  evaluateShelteredPortfolio,
  formatKRW,
  getMonthlyLivingExpenseForAge,
  normalizeCashflow,
  PRESET_SCENARIOS,
  rebalanceHoldingsToTotal,
  type AccountAssetInputs,
  type MarketStressScenarioType,
  type OptimizationMasterPlan,
  type OwnershipType,
  type PensionClaimTiming,
  type RealEstateStrategyType,
  type SimulationInputs,
} from '../engine';
import { CORP_TAX_PCT, FIELD_HELP_CATALOG, FieldHelpBadge, NumericInput } from './ControlDock';
import { EtfPortfolioBuilder } from './EtfPortfolioBuilder';
import { PrecisionTuners } from './PrecisionTuners';
import { claimStartAge, claimTimingLabel, formatDdayAmount } from './planVerdict';
import { WizardLiveChip } from './WizardLiveChip';

export interface InputWizardProps {
  inputs: SimulationInputs;
  plan: OptimizationMasterPlan;
  step?: number;
  onStepChange?: (step: number) => void;
  onChange: (next: SimulationInputs) => void;
  onCompleteToGuide: () => void;
}

const STRESS_LABELS: Record<MarketStressScenarioType, string> = {
  none: '정상 시장 (스트레스 없음)',
  early_drop_20: '은퇴 직후 -20% 하락장',
  early_drop_30: '은퇴 직후 -30% 급락장',
  dotcom_crash: '닷컴버블형 3년 연속 하락',
  gfc_2008: '2008 금융위기형 (-35%)',
  stagflation: '스태그플레이션 (5년 저성장)',
};

const RE_STRATEGY_LABELS: Record<RealEstateStrategyType, string> = {
  keep: '현 주택 계속 거주',
  downsize: '다운사이징 (차액 금융자산 편입)',
  housing_pension: '주택연금 가입 (종신 수령)',
  sell_rent: '매각 후 반전세·월세 전환',
};

interface WizardStepMeta {
  step: number;
  shortLabel: string;
  category: string;
  questionTitle: string;
  questionSub: string;
  helpKey: keyof typeof FIELD_HELP_CATALOG;
  detailLabel: string;
}

const WIZARD_STEPS: WizardStepMeta[] = [
  {
    step: 1,
    shortLabel: '1. 은퇴시점',
    category: '항목 01 / 10 · 은퇴 연령 및 가계 구성',
    questionTitle: '몇 세에 은퇴하실 계획인가요?',
    questionSub: '본인·배우자 현재 나이와 목표 은퇴 나이(D-Day), 가구 형태를 설정합니다.',
    helpKey: 'targetRetirementAge',
    detailLabel: '가구 형태 및 배우자 연령은 기본 카드에 통합되었습니다',
  },
  {
    step: 2,
    shortLabel: '2. 목표생활비',
    category: '항목 02 / 10 · 은퇴 후 월 소비 목표',
    questionTitle: '은퇴 후 매월 얼마의 생활비를 쓰실 계획인가요?',
    questionSub: '세금·건보료를 제외한 순수 실수령 월 소비액(현재 물가 기준)을 입력합니다.',
    helpKey: 'targetMonthlyLiving',
    detailLabel: '별도 고정관리비 · 연령대별 액티브시니어(Go/Slow/No-Go) 지출 곡선 · 일시 목돈 이벤트',
  },
  {
    step: 3,
    shortLabel: '3. 일반금융자산',
    category: '항목 03 / 10 · 현재 보유 일반 금융자본',
    questionTitle: '현재 보유 중인 일반 금융자산은 얼마인가요?',
    questionSub: '연금·절세계좌 외에 현재 시점에 예금, 주식, ETF 등으로 보유 중인 일반 금융자산 총액입니다.',
    helpKey: 'totalInvestment',
    detailLabel: '투자 비중 및 해외상장 ETF 비중은 6. 일반·법인 수익률 단계에서 설정합니다',
  },
  {
    step: 4,
    shortLabel: '4. 절세·연금계좌',
    category: '항목 04 / 10 · 현재 보유 절세계좌 잔액 및 퇴직금',
    questionTitle: '현재 보유 중인 ISA · 연금저축 · 퇴직연금(IRP) 잔액과 예상 퇴직금은 얼마인가요?',
    questionSub: '본인 및 배우자(부부 가구 시)의 현재 적립된 절세계좌 잔액과 은퇴 시점에 추가로 유입될 예상 퇴직금을 입력합니다.',
    helpKey: 'shelteredAccounts',
    detailLabel: '본인·배우자 절세계좌 잔액 및 예상 퇴직금이 기본 카드에 통합되었습니다',
  },
  {
    step: 5,
    shortLabel: '5. 은퇴전저축',
    category: '항목 05 / 10 · 은퇴 전 월 저축 및 절세계좌 추가납입',
    questionTitle: '은퇴 전까지 매월 얼마를 더 저축할 수 있나요?',
    questionSub:
      '재직 기간 동안 적립할 일반계좌 월 저축액과 절세계좌(ISA·연금저축) 연간 추가납입액을 분리하여 한 화면에서 설정합니다.',
    helpKey: 'preRetirementSavings',
    detailLabel: '일반계좌 월 저축액 및 부부 ISA·연금저축 연간 추가납입액이 기본 카드에 통합되었습니다',
  },
  {
    step: 6,
    shortLabel: '6. 일반·법인 수익률',
    category: '항목 06 / 10 · 일반·법인 금융계좌 기대수익률 및 비중',
    questionTitle: '일반·법인 금융자산의 목표 수익률 입력 방식을 선택해 주세요.',
    questionSub:
      '[🎚️ 간편 슬라이더 입력]과 [🧩 ETF 포트폴리오 입력(추천 4종 & 한·미 1,274종)] 중 원하는 방식 하나를 선택하여 설정합니다.',
    helpKey: 'portfolioReturn',
    detailLabel: '간편 슬라이더 입력 및 ETF 포트폴리오 입력이 상단 탭으로 통합되었습니다',
  },
  {
    step: 7,
    shortLabel: '7. 절세·연금 수익률',
    category: '항목 07 / 10 · 절세·연금계좌(ISA·연금저축·IRP) 기대수익률',
    questionTitle: '절세·연금계좌(ISA·연금저축·IRP)의 목표 수익률은 어떻게 설정할까요?',
    questionSub:
      '1차로 [일반·법인 계좌 동일 적용(IRP 70% 위험자산 한도 자동 적용)]과 [절세·연금계좌 수익률 별도 적용] 중 선택하며, 별도 적용 시 간편 입력 또는 KRX ETF 포트폴리오(추천 5종)를 선택합니다.',
    helpKey: 'shelteredPortfolioReturn',
    detailLabel: '절세·연금계좌 수익률 및 KRX ETF 포트폴리오 입력이 상단 탭으로 통합되었습니다',
  },
  {
    step: 8,
    shortLabel: '8. 물가·시장환경',
    category: '항목 08 / 10 · 물가상승률 · 화폐기준 · 하락장 시나리오',
    questionTitle: '장기 물가상승률, 화폐가치 기준, 은퇴 직후 시장 시나리오를 선택해 주세요.',
    questionSub: '생활비·국민연금 물가연동률(CPI), 결과 화면 실질/명목 표시 기준, 은퇴 직후 시장 하락장 스트레스 시나리오를 한 화면에서 설정합니다.',
    helpKey: 'inflationAndViewMode',
    detailLabel: '은퇴 직후 시장 하락장 스트레스 시나리오가 기본 카드에 통합되었습니다',
  },
  {
    step: 9,
    shortLabel: '9. 부동산·국민연금',
    category: '항목 09 / 10 · 거주 주택 및 공적연금',
    questionTitle: '거주 중인 주택 공시가격과 부부 예상 국민연금은 얼마인가요?',
    questionSub: '지역건보료 재산 과표 기준인 주택 공시가격(소유 명의 포함)과 정상수령(출생연도별 법정 개시연령) 기준 본인·배우자 예상 국민연금 월액입니다.',
    helpKey: 'realEstateAndPension',
    detailLabel: '다운사이징/반전세·월세 전환/주택연금 · 국민연금 수령시기 및 추납(추가납부) 설정',
  },
  {
    step: 10,
    shortLabel: '10. 법인·배분전략',
    category: '항목 10 / 10 · 개인 vs 가족법인 운용 조건 및 배분 전략',
    questionTitle: '가족법인 운용 조건과 개인 : 법인 배분 방식을 설정해 주세요.',
    questionSub: '황금분할 최적 비율(r*) 자동 적용(권장) 또는 수동 비율 지정을 선택하고, 최적해 산출의 기준이 되는 법인 임원 수·세율·유지비·청산 과세를 설정합니다.',
    helpKey: 'corporateAllocation',
    detailLabel: '법인 임원수·세율·유지비·청산과세 설정이 기본 카드로 승격되었습니다',
  },
];

/** 프리셋 라벨의 개발자 표기('60세 -> 60세 은퇴')를 사용자 문구로 표시 (엔진 presets 원문은 유지). */
export const presetDisplayLabel = (label: string): string =>
  label.replace(/(\d+)세 -> \1세 은퇴/, '$1세 즉시 은퇴').replace(/\s*->\s*/g, ' → ');

export const InputWizard: React.FC<InputWizardProps> = ({
  inputs,
  plan,
  step: stepProp,
  onStepChange,
  onChange,
  onCompleteToGuide,
}) => {
  // currentStep: 1 ~ 10 (단일 항목 입력), 11 (전체 입력 요약 확인 화면)
  const [internalStep, setInternalStep] = useState<number>(1);
  const [returnToSummary, setReturnToSummary] = useState<boolean>(false);
  const currentStep = stepProp !== undefined ? stepProp : internalStep;

  // 좁은 화면(가로 스크롤 스텝바)에서 현재 스텝이 항상 보이도록 스텝바 안에서만 가로 스크롤 (페이지 세로 이동 없음)
  const stepperRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = stepperRef.current;
    const btn = bar?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!bar || !btn || bar.scrollWidth <= bar.clientWidth) return;
    bar.scrollTo({ left: btn.offsetLeft - (bar.clientWidth - btn.offsetWidth) / 2, behavior: 'smooth' });
  }, [currentStep]);
  const setCurrentStep = (next: number | ((prev: number) => number)) => {
    const resolved = typeof next === 'function' ? next(currentStep) : next;
    if (resolved === 11) setReturnToSummary(false);
    if (onStepChange) {
      onStepChange(resolved);
    } else {
      setInternalStep(resolved);
    }
  };
  const [openDetails, setOpenDetails] = useState<Record<number, boolean>>({});
  const [hoveredPresetId, setHoveredPresetId] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  // U-4: 새로고침·리마운트 후에도 저장된 계좌 수익률 모드로 탭 복원 (연동 탭의 IRP 70% 한도 체크는 '연동' 유지)
  const [step7SeparateMode, setStep7SeparateMode] = useState<boolean>(() => {
    const a = inputs.accounts;
    if (!a.overrideSymmetricAccountReturns) return false;
    const isSymmetricWithIrpCap =
      (a.applyIrpRiskAssetCap ?? true) &&
      a.isaExpectedReturnRate === a.personalPensionReturnRate &&
      a.irpExpectedReturnRate === Number(((a.isaExpectedReturnRate ?? 0) * 0.7 + 3.5 * 0.3).toFixed(2));
    return !isSymmetricWithIrpCap;
  });

  const toggleDetail = (step: number) =>
    setOpenDetails((prev) => ({ ...prev, [step]: !prev[step] }));

  const hasSpouse = inputs.pension.hasSpouse ?? true;
  const portfolioEval = evaluatePortfolio(inputs.asset);
  const returnShift = inputs.asset.returnShiftPct ?? 0;
  const shelteredEval = evaluateShelteredPortfolio(inputs.accounts, portfolioEval);
  const growthRatio = Math.round(inputs.asset.growthEtfRatio ?? 70);
  const divRatio = Math.max(0, 100 - growthRatio);
  const isDetailedPortfolio =
    inputs.asset.inputMode === 'detailed' && (inputs.asset.holdings?.length ?? 0) > 0;
  const isDetailedSheltered =
    inputs.accounts.shelteredInputMode === 'detailed' &&
    (inputs.accounts.shelteredHoldings?.length ?? 0) > 0;
  const currentLiquid = calculateCurrentLiquidAssets(inputs);
  const optimalPersonalRatio = plan.optimalHybrid.personalRatio;
  // U-1: auto 모드 활성 비율은 B7 강건성 권고(plan.activeLedger) — 수학적 r*와 다를 수 있음
  // U-4: 엔진은 overrideSymmetricAccountReturns일 때만 계좌별(IRP 70% 한도 포함) 수익률을 사용
  const irpCapActive = Boolean(
    inputs.accounts.overrideSymmetricAccountReturns && (inputs.accounts.applyIrpRiskAssetCap ?? true)
  );
  const recommendedPersonalRatio = plan.recommendation.personalRatio;
  const activePersonalRatio = plan.activeLedger.personalRatio;
  const isRecommendationDifferent = recommendedPersonalRatio !== optimalPersonalRatio;

  const updateShelteredAccountsWithSync = (patch: Partial<AccountAssetInputs>) => {
    const nextAccounts: AccountAssetInputs = {
      ...inputs.accounts,
      ...patch,
    };
    if (nextAccounts.shelteredInputMode === 'detailed' && nextAccounts.shelteredHoldings?.length) {
      const nextShelteredTotal = calculateCurrentShelteredTotal(nextAccounts, hasSpouse);
      nextAccounts.shelteredHoldings = rebalanceHoldingsToTotal(
        nextAccounts.shelteredHoldings,
        nextShelteredTotal
      );
    }
    onChange({
      ...inputs,
      accounts: nextAccounts,
    });
  };

  // Step 5: 일반계좌 월 저축액과 절세계좌(ISA·연금저축) 월 환산 납입액 분리 계산 (사용자 승인 A2)
  const annualShelteredAddition =
    (inputs.accounts.selfIsaAnnualAddition || 0) +
    (hasSpouse ? inputs.accounts.spouseIsaAnnualAddition || 0 : 0) +
    (inputs.accounts.selfPersonalPensionAnnualAddition || 0) +
    (hasSpouse ? inputs.accounts.spousePersonalPensionAnnualAddition || 0 : 0);
  const shelteredMonthlyEquiv = Math.round(annualShelteredAddition / 12);
  const totalMonthlySavings = inputs.transition.preRetirementMonthlySavings || 0;
  const generalMonthlySavings = Math.max(0, totalMonthlySavings - shelteredMonthlyEquiv);

  const stepMeta = WIZARD_STEPS[currentStep - 1] ?? WIZARD_STEPS[0];
  const isDetailOpen = Boolean(openDetails[currentStep]);
  const hoveredPreset = PRESET_SCENARIOS.find((p) => p.id === hoveredPresetId) ?? null;

  // 각 단계별 기본값 복원 함수 (1~10단계 분리 구성)
  const resetStepToDefault = (step: number) => {
    const def = DEFAULT_SIMULATION_INPUTS;
    if (step === 1) {
      onChange({
        ...inputs,
        pension: {
          ...inputs.pension,
          hasSpouse: def.pension.hasSpouse,
          currentAgeSelf: def.pension.currentAgeSelf,
          currentAgeSpouse: def.pension.currentAgeSpouse,
        },
        transition: {
          ...inputs.transition,
          targetRetirementAgeSelf: def.transition.targetRetirementAgeSelf,
        },
      });
    } else if (step === 2) {
      onChange({
        ...inputs,
        cashflow: structuredClone(def.cashflow),
      });
    } else if (step === 3) {
      onChange({
        ...inputs,
        asset: {
          ...inputs.asset,
          totalInvestment: def.asset.totalInvestment,
          holdings: isDetailedPortfolio
            ? rebalanceHoldingsToTotal(inputs.asset.holdings ?? [], def.asset.totalInvestment)
            : inputs.asset.holdings,
        },
      });
    } else if (step === 4) {
      onChange({
        ...inputs,
        transition: {
          ...inputs.transition,
          expectedSeverancePay: def.transition.expectedSeverancePay,
          spouseExpectedSeverancePay: def.transition.spouseExpectedSeverancePay ?? 0,
          severanceTransferToIrp: def.transition.severanceTransferToIrp,
        },
        accounts: {
          ...inputs.accounts,
          selfIsaBalance: def.accounts.selfIsaBalance,
          spouseIsaBalance: def.accounts.spouseIsaBalance,
          selfPersonalPensionBalance: def.accounts.selfPersonalPensionBalance,
          spousePersonalPensionBalance: def.accounts.spousePersonalPensionBalance,
          selfRetirementPensionBalance: def.accounts.selfRetirementPensionBalance,
          spouseRetirementPensionBalance: def.accounts.spouseRetirementPensionBalance,
          selfPersonalPensionStartAge: def.accounts.selfPersonalPensionStartAge,
          selfRetirementPensionStartAge: def.accounts.selfRetirementPensionStartAge,
          shelteredHoldings: structuredClone(def.accounts.shelteredHoldings),
        },
      });
    } else if (step === 5) {
      onChange({
        ...inputs,
        transition: {
          ...inputs.transition,
          preRetirementMonthlySavings: def.transition.preRetirementMonthlySavings,
        },
        accounts: {
          ...inputs.accounts,
          selfIsaAnnualAddition: def.accounts.selfIsaAnnualAddition,
          spouseIsaAnnualAddition: def.accounts.spouseIsaAnnualAddition,
          selfPersonalPensionAnnualAddition: def.accounts.selfPersonalPensionAnnualAddition,
          spousePersonalPensionAnnualAddition: def.accounts.spousePersonalPensionAnnualAddition,
        },
      });
    } else if (step === 6) {
      onChange({
        ...inputs,
        asset: {
          ...inputs.asset,
          inputMode: 'macro',
          growthRate: def.asset.growthRate,
          dividendYield: def.asset.dividendYield,
          growthEtfRatio: def.asset.growthEtfRatio,
          dividendEtfRatio: def.asset.dividendEtfRatio,
          overseasEtfRatio: def.asset.overseasEtfRatio,
          holdings: structuredClone(def.asset.holdings),
        },
      });
    } else if (step === 7) {
      onChange({
        ...inputs,
        accounts: {
          ...inputs.accounts,
          overrideSymmetricAccountReturns: false,
          shelteredInputMode: 'macro',
          shelteredHoldings: structuredClone(def.accounts.shelteredHoldings),
          applyIrpRiskAssetCap: true,
          isaExpectedReturnRate: def.accounts.isaExpectedReturnRate,
          personalPensionReturnRate: def.accounts.personalPensionReturnRate,
          irpExpectedReturnRate: def.accounts.irpExpectedReturnRate,
        },
      });
    } else if (step === 8) {
      onChange({
        ...inputs,
        transition: {
          ...inputs.transition,
          inflationRate: def.transition.inflationRate,
          viewMode: def.transition.viewMode,
          marketStressScenario: def.transition.marketStressScenario,
        },
      });
    } else if (step === 9) {
      onChange({
        ...inputs,
        realEstate: structuredClone(def.realEstate),
        pension: {
          ...inputs.pension,
          expectedMonthlyPensionSelf: def.pension.expectedMonthlyPensionSelf,
          expectedMonthlyPensionSpouse: def.pension.expectedMonthlyPensionSpouse,
          claimTimingSelf: def.pension.claimTimingSelf,
          claimTimingSpouse: def.pension.claimTimingSpouse,
          applyAdditionalPensionSelf: def.pension.applyAdditionalPensionSelf,
          additionalMonthsSelf: def.pension.additionalMonthsSelf,
          monthlyContributionSelf: def.pension.monthlyContributionSelf,
          applyAdditionalPensionSpouse: def.pension.applyAdditionalPensionSpouse,
          additionalMonthsSpouse: def.pension.additionalMonthsSpouse,
          monthlyContributionSpouse: def.pension.monthlyContributionSpouse,
        },
      });
    } else if (step === 10) {
      onChange({
        ...inputs,
        hybrid: structuredClone(def.hybrid),
        corporate: structuredClone(def.corporate),
      });
    }
  };

  // Step 11 요약 화면용 10개 항목 요약 배열
  const summaryItems = [
    {
      step: 1,
      title: '1. 은퇴 시점 및 가계 연령',
      primaryValue: `현재 ${inputs.pension.currentAgeSelf}세 → ${inputs.transition.targetRetirementAgeSelf}세 은퇴`,
      detailText: hasSpouse
        ? `부부 2인 가구 (배우자 현재 ${inputs.pension.currentAgeSpouse}세 · 은퇴까지 ${Math.max(0, inputs.transition.targetRetirementAgeSelf - inputs.pension.currentAgeSelf)}년)`
        : `1인 단독 가구 (은퇴까지 ${Math.max(0, inputs.transition.targetRetirementAgeSelf - inputs.pension.currentAgeSelf)}년)`,
      isDefault:
        inputs.pension.currentAgeSelf === DEFAULT_SIMULATION_INPUTS.pension.currentAgeSelf &&
        inputs.transition.targetRetirementAgeSelf ===
          DEFAULT_SIMULATION_INPUTS.transition.targetRetirementAgeSelf,
    },
    {
      step: 2,
      title: '2. 은퇴 후 목표 월 생활비',
      primaryValue: `월 ${Math.round(inputs.cashflow.targetNetMonthlyLivingExpense / 10_000).toLocaleString()}만원 (실질)`,
      detailText: `${
        inputs.cashflow.spendingMode === 'active_senior'
          ? `액티브 시니어 3단계 지출 곡선 적용${
              (inputs.cashflow.activeSeniorConfig?.careShockMonthlyExpense ?? 1_500_000) > 0
                ? `(케어기 간병비 +${Math.round((inputs.cashflow.activeSeniorConfig?.careShockMonthlyExpense ?? 1_500_000) / 10_000)}만)`
                : ''
            } · 고정관리비 월 ${Math.round((inputs.cashflow.monthlyFixedExpense || 0) / 10_000)}만원`
          : `100세까지 정액 실질구매력 유지 · 고정관리비 월 ${Math.round((inputs.cashflow.monthlyFixedExpense || 0) / 10_000)}만원`
      }${
        (inputs.cashflow.lumpSumEvents?.length ?? 0) > 0
          ? ` · 일시 목돈 이벤트 ${inputs.cashflow.lumpSumEvents!.length}건`
          : ''
      }`,
      isDefault:
        inputs.cashflow.targetNetMonthlyLivingExpense ===
          DEFAULT_SIMULATION_INPUTS.cashflow.targetNetMonthlyLivingExpense &&
        (inputs.cashflow.spendingMode ?? 'flat') === 'flat' &&
        (inputs.cashflow.lumpSumEvents?.length ?? 0) === 0,
    },
    {
      step: 3,
      title: '3. 현재 보유 일반 금융자산 규모',
      primaryValue: `${formatKRW(inputs.asset.totalInvestment)}`,
      detailText: `절세계좌 포함 현재 보유 전체 금융자산: ${formatKRW(currentLiquid)}`,
      isDefault:
        inputs.asset.totalInvestment === DEFAULT_SIMULATION_INPUTS.asset.totalInvestment,
    },
    {
      step: 4,
      title: '4. 절세·퇴직연금 현재 보유액 및 예상 퇴직금',
      primaryValue: `부부 합산 ${formatKRW(currentLiquid - inputs.asset.totalInvestment)} (+퇴직금 ${formatKRW((inputs.transition.expectedSeverancePay || 0) + (hasSpouse ? inputs.transition.spouseExpectedSeverancePay || 0 : 0))})`,
      detailText: `본인 (IRP ${formatKRW(inputs.accounts.selfRetirementPensionBalance)} · 연금저축 ${formatKRW(inputs.accounts.selfPersonalPensionBalance)} · ISA ${formatKRW(inputs.accounts.selfIsaBalance)} · 퇴직금 ${formatKRW(inputs.transition.expectedSeverancePay || 0)}) / 배우자 (IRP ${formatKRW(hasSpouse ? inputs.accounts.spouseRetirementPensionBalance : 0)} · 연금저축 ${formatKRW(hasSpouse ? inputs.accounts.spousePersonalPensionBalance : 0)} · ISA ${formatKRW(hasSpouse ? inputs.accounts.spouseIsaBalance : 0)} · 퇴직금 ${formatKRW(hasSpouse ? inputs.transition.spouseExpectedSeverancePay || 0 : 0)})`,
      isDefault:
        inputs.accounts.selfIsaBalance === DEFAULT_SIMULATION_INPUTS.accounts.selfIsaBalance &&
        inputs.accounts.selfPersonalPensionBalance ===
          DEFAULT_SIMULATION_INPUTS.accounts.selfPersonalPensionBalance &&
        inputs.accounts.selfRetirementPensionBalance ===
          DEFAULT_SIMULATION_INPUTS.accounts.selfRetirementPensionBalance &&
        (inputs.transition.expectedSeverancePay || 0) === 0 &&
        (inputs.transition.spouseExpectedSeverancePay || 0) === 0,
    },
    {
      step: 5,
      title: '5. 은퇴 전 월 저축 및 절세계좌 추가납입',
      primaryValue: `총 월 ${Math.round((inputs.transition.preRetirementMonthlySavings || 0) / 10_000).toLocaleString()}만원 저축`,
      detailText: `일반계좌 월 ${Math.round(generalMonthlySavings / 10_000).toLocaleString()}만원 + 절세계좌 월 환산 ${Math.round(shelteredMonthlyEquiv / 10_000).toLocaleString()}만원 (연간 ISA ${formatKRW((inputs.accounts.selfIsaAnnualAddition || 0) + (hasSpouse ? inputs.accounts.spouseIsaAnnualAddition || 0 : 0))} · 연금저축 ${formatKRW((inputs.accounts.selfPersonalPensionAnnualAddition || 0) + (hasSpouse ? inputs.accounts.spousePersonalPensionAnnualAddition || 0 : 0))})`,
      isDefault:
        inputs.transition.preRetirementMonthlySavings ===
          DEFAULT_SIMULATION_INPUTS.transition.preRetirementMonthlySavings,
    },
    {
      step: 6,
      title: '6. 일반·법인 금융 수익률 및 투자 비중',
      primaryValue: `연 ${portfolioEval.effectiveTotalReturn.toFixed(2)}% (해외직투 ${isDetailedPortfolio ? portfolioEval.overseasDirectRatio.toFixed(0) : inputs.asset.overseasEtfRatio}%)${inputs.asset.returnShiftPct ? ` · 시나리오 ${inputs.asset.returnShiftPct > 0 ? '+' : '−'}${Math.abs(inputs.asset.returnShiftPct)}%p` : ''}`,
      detailText: isDetailedPortfolio
        ? `일반·법인 ETF ${inputs.asset.holdings?.length ?? 0}종 직접 구성 (성장 +${portfolioEval.effectiveGrowthRate.toFixed(2)}% · 배당 +${portfolioEval.effectiveDividendYield.toFixed(2)}% · 보수 -${portfolioEval.weightedExpenseRatio.toFixed(3)}%)`
        : `성장 ${inputs.asset.growthRate}% (비중 ${growthRatio}%) + 배당 ${inputs.asset.dividendYield}% (비중 ${divRatio}%) · 해외상장 직접투자 ${inputs.asset.overseasEtfRatio}%`,
      isDefault:
        !isDetailedPortfolio &&
        (inputs.asset.returnShiftPct ?? 0) === 0 &&
        inputs.asset.growthRate === DEFAULT_SIMULATION_INPUTS.asset.growthRate &&
        inputs.asset.dividendYield === DEFAULT_SIMULATION_INPUTS.asset.dividendYield &&
        growthRatio === DEFAULT_SIMULATION_INPUTS.asset.growthEtfRatio &&
        inputs.asset.overseasEtfRatio === DEFAULT_SIMULATION_INPUTS.asset.overseasEtfRatio,
    },
    {
      step: 7,
      title: '7. 절세·연금계좌(ISA·연금저축·IRP) 수익률',
      primaryValue: inputs.accounts.overrideSymmetricAccountReturns
        ? `ISA/연금 ${inputs.accounts.isaExpectedReturnRate.toFixed(2)}% · IRP ${(inputs.accounts.irpExpectedReturnRate ?? inputs.accounts.personalPensionReturnRate).toFixed(2)}%${returnShift ? ` → 시나리오 적용 ISA/연금 ${(inputs.accounts.isaExpectedReturnRate + returnShift).toFixed(2)}% · IRP ${((inputs.accounts.irpExpectedReturnRate ?? inputs.accounts.personalPensionReturnRate) + returnShift).toFixed(2)}%` : ''}`
        : `일반·법인 동일 대칭 적용 (연 ${portfolioEval.effectiveTotalReturn.toFixed(2)}%${returnShift ? ` → 시나리오 적용 연 ${(portfolioEval.effectiveTotalReturn + returnShift).toFixed(2)}%` : ''})`,
      detailText: isDetailedSheltered
        ? `절세·연금 KRX ETF ${inputs.accounts.shelteredHoldings?.length ?? 0}종 직접 구성 (성장 +${shelteredEval.effectiveGrowthRate.toFixed(2)}% · 배당 +${shelteredEval.effectiveDividendYield.toFixed(2)}% · 보수 -${shelteredEval.weightedExpenseRatio.toFixed(3)}%)`
        : inputs.accounts.overrideSymmetricAccountReturns
          ? `계좌별 별도 지정 (ISA ${inputs.accounts.isaExpectedReturnRate}% · 연금저축 ${inputs.accounts.personalPensionReturnRate}% · IRP ${inputs.accounts.irpExpectedReturnRate ?? inputs.accounts.personalPensionReturnRate}%)`
          : '일반·법인 계좌 기대수익률과 동일하게 대칭 적용',
      isDefault: !isDetailedSheltered && !inputs.accounts.overrideSymmetricAccountReturns,
    },
    {
      step: 8,
      title: '8. 물가상승률 및 시장 환경',
      primaryValue: `물가 연 ${inputs.transition.inflationRate}% · ${inputs.transition.viewMode === 'real' ? '실질 구매력' : '명목 가치'}`,
      detailText: `시장 시나리오: ${STRESS_LABELS[inputs.transition.marketStressScenario]}`,
      isDefault:
        inputs.transition.inflationRate === DEFAULT_SIMULATION_INPUTS.transition.inflationRate &&
        inputs.transition.marketStressScenario === 'none',
    },
    {
      step: 9,
      title: '9. 거주 부동산 및 국민연금',
      primaryValue: `공시가 ${formatKRW(inputs.realEstate.officiallyAssessedValue)} · 연금 월 ${Math.round(((inputs.pension.expectedMonthlyPensionSelf || 0) + (hasSpouse ? inputs.pension.expectedMonthlyPensionSpouse || 0 : 0)) / 10_000).toLocaleString()}만원`,
      detailText: `${inputs.realEstate.ownership === 'joint' ? '공동명의(50:50)' : '단독명의'} · ${RE_STRATEGY_LABELS[inputs.realEstate.transition?.strategy ?? 'keep']} · ${claimTimingLabel(inputs.pension.claimTimingSelf, inputs.pension.currentAgeSelf)}${inputs.pension.applyAdditionalPensionSelf || inputs.pension.applyAdditionalPensionSpouse ? ` · 추납 반영(본인 ${inputs.pension.applyAdditionalPensionSelf ? inputs.pension.additionalMonthsSelf : 0}개월/배우자 ${inputs.pension.applyAdditionalPensionSpouse ? inputs.pension.additionalMonthsSpouse : 0}개월)` : ''}`,
      isDefault:
        inputs.realEstate.officiallyAssessedValue ===
          DEFAULT_SIMULATION_INPUTS.realEstate.officiallyAssessedValue &&
        inputs.pension.expectedMonthlyPensionSelf ===
          DEFAULT_SIMULATION_INPUTS.pension.expectedMonthlyPensionSelf &&
        !inputs.pension.applyAdditionalPensionSelf,
    },
    {
      step: 10,
      title: '10. 개인 vs 가족법인 운용 조건',
      primaryValue:
        inputs.hybrid.useAutoOptimalRatio ?? true
          ? `자동 권고 (개인 ${recommendedPersonalRatio}% : 법인 ${100 - recommendedPersonalRatio}%)${isRecommendationDifferent ? ` · 수학적 r* 개인 ${optimalPersonalRatio}% 참고` : ''}`
          : `수동 배분 (개인 ${inputs.hybrid.personalRatio}% : 법인 ${inputs.hybrid.corporateRatio}%)`,
      detailText: `${inputs.corporate.injectionTiming === 'retirement' ? '은퇴 D-Day 법인 설립·일괄 이전' : '지금부터 분할 적립'} · 등기임원 ${inputs.corporate.executiveCount}인 · 유지비 연 ${Math.round((inputs.corporate.annualFixedMaintenanceFee || 0) / 10_000)}만원 · ${inputs.corporate.taxType === 'transparent' ? `소규모 성실신고 법인(${CORP_TAX_PCT.transparent}%)` : `일반 법인(2억 이하 ${CORP_TAX_PCT.normalLow}%)`} · ${inputs.corporate.liquidationTaxMode === 'capital_return_exempt' ? '출자원금 비과세 선회수' : '단순 일괄과세'}`,
      isDefault:
        (inputs.hybrid.useAutoOptimalRatio ?? true) &&
        (inputs.corporate.injectionTiming ?? 'now') === 'now' &&
        inputs.corporate.executiveCount === DEFAULT_SIMULATION_INPUTS.corporate.executiveCount &&
        inputs.corporate.annualFixedMaintenanceFee ===
          DEFAULT_SIMULATION_INPUTS.corporate.annualFixedMaintenanceFee,
    },
  ];

  const showDetailToggle = currentStep === 2 || currentStep === 9;

  return (
    <section className="wizard-container" aria-label="NestWay Slider 단계별 은퇴 조건 입력 위저드">
      {/* 상단 기본 설정값 프리셋 바 & 빠른 요약 이동 */}
      <div className="wizard-top-strip">
        <div className="wizard-preset-group" onMouseLeave={() => setHoveredPresetId(null)}>
          <span className="wizard-preset-label">빠른 시작 예시</span>
          <div className="wizard-preset-pills">
            {PRESET_SCENARIOS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`wizard-preset-btn ${activePresetId === preset.id ? 'is-active-preset' : ''}`.trim()}
                aria-pressed={activePresetId === preset.id}
                onMouseEnter={() => setHoveredPresetId(preset.id)}
                onFocus={() => setHoveredPresetId(preset.id)}
                onBlur={() => setHoveredPresetId(null)}
                onClick={() => {
                  setStep7SeparateMode(false);
                  setActivePresetId(preset.id);
                  onChange({
                    ...preset.inputs,
                    transition: {
                      ...preset.inputs.transition,
                      viewMode: inputs.transition.viewMode,
                    },
                  });
                }}
              >
                {presetDisplayLabel(preset.label)}
              </button>
            ))}
          </div>

          {activePresetId && (
            <button
              type="button"
              className="btn-primary-sm preset-instant-briefing-btn"
              onClick={onCompleteToGuide}
            >
              예시 적용됨 · 바로 결과 브리핑 보기 →
            </button>
          )}

          {hoveredPreset && (
            <div className="preset-popover" role="tooltip" style={{ maxWidth: 420 }}>
              <div className="preset-popover-header">
                <strong>{presetDisplayLabel(hoveredPreset.label)}</strong>
                <span className="preset-popover-hint">클릭 시 기본값으로 즉시 채움</span>
              </div>
              <p className="preset-popover-desc">{hoveredPreset.subtitle}</p>
            </div>
          )}
        </div>

        <div className="wizard-quick-actions">
          <button
            type="button"
            className="wizard-reset-btn"
            onClick={() => {
              if (window.confirm('모든 입력 항목을 처음 기본 설정값으로 초기화하시겠습니까?')) {
                setStep7SeparateMode(false);
                setActivePresetId(null);
                onChange(defineInputs());
              }
            }}
          >
            전체 기본값 초기화
          </button>
          <button
            type="button"
            className={`btn-secondary ${currentStep === 11 ? 'active-summary-btn' : ''}`}
            onClick={() => setCurrentStep(11)}
          >
            📋 입력 요약 화면 (Step 11)
          </button>
        </div>
      </div>

      {/* 상단 1~10단계 + 11.요약 스텝 네비게이션 바 */}
      <nav className="wizard-stepper-bar" aria-label="입력 항목 단계 선택" ref={stepperRef}>
        {WIZARD_STEPS.map((s) => {
          const isCurrent = currentStep === s.step;
          const isCompleted = currentStep > s.step;
          return (
            <button
              key={s.step}
              type="button"
              className={`wizard-step-pill ${isCurrent ? 'current' : ''} ${isCompleted ? 'completed' : ''}`}
              aria-current={isCurrent ? 'step' : undefined}
              title={s.shortLabel}
              onClick={() => setCurrentStep(s.step)}
            >
              <span className="wizard-step-num num">{s.step}</span>
              <span className="wizard-step-text">{s.shortLabel.replace(/^\d+\.\s*/, '')}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={`wizard-step-pill wizard-step-pill-summary ${currentStep === 11 ? 'current' : ''}`}
          aria-current={currentStep === 11 ? 'step' : undefined}
          onClick={() => setCurrentStep(11)}
        >
          <span className="wizard-step-num">✓</span>
          <span className="wizard-step-text">입력 요약</span>
        </button>
      </nav>

      {/* Step 1 ~ 10: 한 번에 하나의 항목 집중 입력 카드 */}
      {currentStep <= 10 ? (
        <div className="wizard-focus-card" key={currentStep}>
          {/* 카드 상단 헤더: 현재 항목 카테고리 + 기본값 복원 */}
          <div className="wizard-card-top">
            <div className="wizard-card-meta">
              <span className="wizard-category-badge">{stepMeta.category}</span>
              <span className="wizard-default-note">
                {summaryItems[currentStep - 1]?.isDefault ?? true
                  ? '기본 설정값이 적용되어 있습니다'
                  : '맞춤 입력값이 적용되어 있습니다'}
              </span>
            </div>

            <div className="wizard-card-top-Controls">
              <button
                type="button"
                className="step-reset-btn"
                onClick={() => {
                  if (
                    window.confirm(
                      `현재 단계(${stepMeta.shortLabel})의 입력값을 기본 설정값으로 복원하시겠습니까?`
                    )
                  ) {
                    if (currentStep === 7) setStep7SeparateMode(false);
                    resetStepToDefault(currentStep);
                  }
                }}
                title="이 항목을 기본 설정값으로 되돌립니다"
              >
                기본값 복원
              </button>
            </div>
          </div>

          {/* 질문 타이틀 + 마우스 오버 설명 팝업 트리거 (요건 3) */}
          <div className="wizard-question-header">
            <div className="wizard-question-title-row">
              <h2 className="wizard-question-title">{stepMeta.questionTitle}</h2>
              <FieldHelpBadge helpKey={stepMeta.helpKey} />
            </div>
            <p className="wizard-question-sub">{stepMeta.questionSub}</p>
          </div>

          {/* 핵심 단일 항목 입력 영역 (요건 1 & 2) */}
          <div className="wizard-primary-input-box">
            {currentStep === 1 && (
              <div className="wizard-single-topic-body">
                <div className="wizard-hero-value-row">
                  <span className="wizard-hero-caption">현재 나이 → 은퇴 목표 나이 (D-Day)</span>
                  <strong className="wizard-hero-readout num">
                    {inputs.pension.currentAgeSelf}세 → {inputs.transition.targetRetirementAgeSelf}세 은퇴
                    <span className="wizard-hero-tag">
                      (은퇴까지{' '}
                      {Math.max(
                        0,
                        inputs.transition.targetRetirementAgeSelf - inputs.pension.currentAgeSelf
                      )}
                      년)
                    </span>
                  </strong>
                </div>

                <input
                  type="range"
                  className="wizard-range-slider"
                  min={inputs.pension.currentAgeSelf}
                  max={80}
                  step={1}
                  value={inputs.transition.targetRetirementAgeSelf}
                  onChange={(e) =>
                    onChange({
                      ...inputs,
                      transition: {
                        ...inputs.transition,
                        targetRetirementAgeSelf: Number(e.target.value),
                      },
                    })
                  }
                />

                <div className="dock-row-2col" style={{ marginTop: 12 }}>
                  <label className="dock-field">
                    <div className="dock-label-row">
                      <span className="dock-label">은퇴 목표 연령 (D-Day)</span>
                      <FieldHelpBadge helpKey="targetRetirementAge" />
                    </div>
                    <div className="dock-input-unit">
                      <NumericInput
                        min={inputs.pension.currentAgeSelf}
                        max={85}
                        fallback={inputs.pension.currentAgeSelf}
                        value={inputs.transition.targetRetirementAgeSelf}
                        onChange={(retAge) =>
                          onChange({
                            ...inputs,
                            transition: { ...inputs.transition, targetRetirementAgeSelf: retAge },
                          })
                        }
                      />
                      <span>세</span>
                    </div>
                  </label>

                  <label className="dock-field">
                    <div className="dock-label-row">
                      <span className="dock-label">본인 현재 연령</span>
                      <FieldHelpBadge helpKey="currentAgeSelf" />
                    </div>
                    <div className="dock-input-unit">
                      <NumericInput
                        min={30}
                        max={80}
                        fallback={50}
                        value={inputs.pension.currentAgeSelf}
                        onChange={(nextAge) =>
                          onChange({
                            ...inputs,
                            pension: { ...inputs.pension, currentAgeSelf: nextAge },
                            transition: {
                              ...inputs.transition,
                              targetRetirementAgeSelf: Math.max(
                                nextAge,
                                inputs.transition.targetRetirementAgeSelf
                              ),
                            },
                          })
                        }
                      />
                      <span>세</span>
                    </div>
                  </label>
                </div>

                <div className="dock-row-2col" style={{ marginTop: 12 }}>
                  <label className="dock-field">
                    <span className="dock-label">가구 형태 (부부 2인 / 1인 단독)</span>
                    <select
                      value={hasSpouse ? 'couple' : 'single'}
                      onChange={(e) =>
                        onChange({
                          ...inputs,
                          pension: { ...inputs.pension, hasSpouse: e.target.value === 'couple' },
                        })
                      }
                    >
                      <option value="couple">부부 2인 가구 (부부 합산 절세·연금 적용)</option>
                      <option value="single">1인 단독 가구</option>
                    </select>
                  </label>

                  {hasSpouse && (
                    <label className="dock-field">
                      <span className="dock-label">배우자 현재 연령</span>
                      <div className="dock-input-unit">
                        <NumericInput
                          min={25}
                          max={85}
                          fallback={48}
                          value={inputs.pension.currentAgeSpouse}
                          onChange={(nextAge) =>
                            onChange({
                              ...inputs,
                              pension: { ...inputs.pension, currentAgeSpouse: nextAge },
                            })
                          }
                        />
                        <span>세</span>
                      </div>
                    </label>
                  )}
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="wizard-single-topic-body">
                <div className="wizard-hero-value-row">
                  <span className="wizard-hero-caption">은퇴 후 목표 순월생활비 (현재가치 기준)</span>
                  <strong className="wizard-hero-readout num">
                    월 {Math.round(inputs.cashflow.targetNetMonthlyLivingExpense / 10_000).toLocaleString()}만 원
                    <span className="wizard-hero-tag">
                      (연간 {formatKRW(inputs.cashflow.targetNetMonthlyLivingExpense * 12)})
                    </span>
                  </strong>
                </div>

                <input
                  type="range"
                  className="wizard-range-slider"
                  min={1_500_000}
                  max={20_000_000}
                  step={100_000}
                  value={inputs.cashflow.targetNetMonthlyLivingExpense}
                  onChange={(e) =>
                    onChange({
                      ...inputs,
                      cashflow: {
                        ...inputs.cashflow,
                        targetNetMonthlyLivingExpense: Number(e.target.value),
                      },
                    })
                  }
                />

                <div className="dock-row-2col" style={{ marginTop: 12 }}>
                  <label className="dock-field">
                    <div className="dock-label-row">
                      <span className="dock-label">목표 월 생활비 직접 입력</span>
                      <FieldHelpBadge helpKey="targetMonthlyLiving" />
                    </div>
                    <div className="dock-input-unit">
                      <NumericInput
                        readoutWon={10_000}
                        step={10}
                        min={100}
                        max={5000}
                        fallback={500}
                        value={Math.round(inputs.cashflow.targetNetMonthlyLivingExpense / 10_000)}
                        onChange={(valMan) =>
                          onChange({
                            ...inputs,
                            cashflow: {
                              ...inputs.cashflow,
                              targetNetMonthlyLivingExpense: valMan * 10_000,
                            },
                          })
                        }
                      />
                      <span>만원/월</span>
                    </div>
                  </label>

                  <div className="wizard-Context-pill-box num">
                    <span>연간 목표 순생활비 & 은퇴 후 소비 기간 (현재가치 기준)</span>
                    <strong className="text-positive">
                      연간 {formatKRW(inputs.cashflow.targetNetMonthlyLivingExpense * 12)} · 은퇴(
                      {inputs.transition.targetRetirementAgeSelf}세) 후{' '}
                      {Math.max(0, 100 - inputs.transition.targetRetirementAgeSelf)}년간 지출
                    </strong>
                    <span>
                      은퇴 첫해({inputs.transition.targetRetirementAgeSelf}세) 약 월{' '}
                      {Math.round(
                        (getMonthlyLivingExpenseForAge(
                          inputs.transition.targetRetirementAgeSelf,
                          inputs.cashflow.targetNetMonthlyLivingExpense,
                          normalizeCashflow(inputs.cashflow).activeSeniorConfig
                        ) *
                          Math.pow(1 + inputs.transition.inflationRate / 100, Math.max(0, inputs.transition.targetRetirementAgeSelf - inputs.pension.currentAgeSelf))) /
                          10_000
                      ).toLocaleString()}
                      만 원 · 물가 {inputs.transition.inflationRate}% 반영 (명목)
                    </span>
                  </div>
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="wizard-single-topic-body">
                <div className="wizard-hero-value-row">
                  <span className="wizard-hero-caption">
                    현재 보유 중인 일반 금융자산 (예금·주식·일반계좌 현재 잔액)
                  </span>
                  <strong className="wizard-hero-readout num">
                    {formatKRW(inputs.asset.totalInvestment)}
                    <span className="wizard-hero-tag">
                      (절세계좌 포함 현재 보유 전체 금융자산: {formatKRW(currentLiquid)})
                    </span>
                  </strong>
                </div>

                <input
                  type="range"
                  className="wizard-range-slider"
                  min={0}
                  max={5_000_000_000}
                  step={50_000_000}
                  value={Math.min(5_000_000_000, inputs.asset.totalInvestment)}
                  onChange={(e) => {
                    const nextTotal = Number(e.target.value);
                    onChange({
                      ...inputs,
                      asset: {
                        ...inputs.asset,
                        totalInvestment: nextTotal,
                        holdings: isDetailedPortfolio
                          ? rebalanceHoldingsToTotal(inputs.asset.holdings ?? [], nextTotal)
                          : inputs.asset.holdings,
                      },
                    });
                  }}
                />

                {isDetailedPortfolio && (
                  <div className="dock-mode-banner" role="note">
                    ETF 직접 구성 모드 — 보유 ETF {inputs.asset.holdings?.length ?? 0}종이 이 총액에 비례 배분됩니다 (해외직투{' '}
                    {portfolioEval.overseasDirectRatio.toFixed(0)}%). 투자 비중 및 ETF 포트폴리오 구성은{' '}
                    <strong>[6. 일반·법인 수익률]</strong> 단계에서 설정합니다.
                  </div>
                )}

                <div className="dock-row-2col" style={{ marginTop: 12 }}>
                  <label className="dock-field">
                    <div className="dock-label-row">
                      <span className="dock-label">현재 보유 중인 일반 금융자산 금액 입력 (만원 단위)</span>
                      <FieldHelpBadge helpKey="totalInvestment" />
                    </div>
                    <div className="dock-input-unit">
                      <NumericInput
                        readoutWon={10_000}
                        step={1000}
                        min={0}
                        fallback={100000}
                        value={Math.round(inputs.asset.totalInvestment / 10_000)}
                        onChange={(valMan) => {
                          const nextTotal = valMan * 10_000;
                          onChange({
                            ...inputs,
                            asset: {
                              ...inputs.asset,
                              totalInvestment: nextTotal,
                              holdings: isDetailedPortfolio
                                ? rebalanceHoldingsToTotal(inputs.asset.holdings ?? [], nextTotal)
                                : inputs.asset.holdings,
                            },
                          });
                        }}
                      />
                      <span>만원</span>
                    </div>
                  </label>

                  <div className="wizard-Context-pill-box num">
                    <span>현재 보유 일반 금융자산 (억원 환산)</span>
                    <strong>{(inputs.asset.totalInvestment / 100_000_000).toFixed(2)}억 원</strong>
                  </div>
                </div>

                {hasSpouse && (
                  <div className="dock-subgrid" style={{ marginTop: 14 }}>
                    <div className="dock-label-row">
                      <span className="dock-label">
                        부부 일반금융자산 명의 비중 (본인 {inputs.asset.selfOwnershipPercent ?? 50}% : 배우자 {100 - (inputs.asset.selfOwnershipPercent ?? 50)}%)
                      </span>
                    </div>
                    <div className="wizard-preset-pills" style={{ marginTop: 6, marginBottom: 8 }}>
                      {[
                        { label: '50:50 공동균분(권장)', val: 50 },
                        { label: '80:20', val: 80 },
                        { label: '100:0 본인단독', val: 100 },
                      ].map((opt) => (
                        <button
                          key={opt.val}
                          type="button"
                          className={`wizard-preset-btn ${(inputs.asset.selfOwnershipPercent ?? 50) === opt.val ? 'is-active-preset' : ''}`}
                          onClick={() =>
                            onChange({
                              ...inputs,
                              asset: {
                                ...inputs.asset,
                                selfOwnershipPercent: opt.val,
                              },
                            })
                          }
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="range"
                      className="wizard-range-slider"
                      min={0}
                      max={100}
                      step={5}
                      value={inputs.asset.selfOwnershipPercent ?? 50}
                      onChange={(e) =>
                        onChange({
                          ...inputs,
                          asset: {
                            ...inputs.asset,
                            selfOwnershipPercent: Number(e.target.value),
                          },
                        })
                      }
                    />
                    {plan.estateDiagnostic?.spousalGiftCarryoverNote && (
                      <div className="wizard-default-note" style={{ marginTop: 8 }}>
                        💡 {plan.estateDiagnostic.spousalGiftCarryoverNote}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {currentStep === 4 && (
              <div className="wizard-single-topic-body">
                <div className="wizard-hero-value-row">
                  <span className="wizard-hero-caption">
                    절세·퇴직연금 3대 계좌 현재 보유 잔액 및 은퇴 시 추가 수령 퇴직금
                  </span>
                  <strong className="wizard-hero-readout num">
                    본인 현재 합계{' '}
                    {formatKRW(
                      (inputs.accounts.selfRetirementPensionBalance || 0) +
                        (inputs.accounts.selfPersonalPensionBalance || 0) +
                        (inputs.accounts.selfIsaBalance || 0)
                    )}
                    <span className="wizard-hero-tag">
                      (부부 절세계좌 현재 총합: {formatKRW(currentLiquid - inputs.asset.totalInvestment)}
                      {(inputs.transition.expectedSeverancePay || 0) +
                        (hasSpouse ? inputs.transition.spouseExpectedSeverancePay || 0 : 0) >
                      0
                        ? ` · 은퇴 시 예상 퇴직금 합계: ${formatKRW(
                            (inputs.transition.expectedSeverancePay || 0) +
                              (hasSpouse ? inputs.transition.spouseExpectedSeverancePay || 0 : 0)
                          )}`
                        : ''}
                      )
                    </span>
                  </strong>
                </div>

                <div className="dock-mode-banner" role="note" style={{ marginTop: 6 }}>
                  💡 <strong>①~③번</strong>에는 현재 계좌에 이미 쌓여 있는 적립금만 입력하고, 은퇴 시점까지 회사가 추가로 납입할 퇴직연금(DC) 적립액이나 은퇴 시 받을 법정 퇴직금·명예퇴직금은 아래{' '}
                  <strong>[은퇴 시 추가 수령할 예상 퇴직금]</strong>에 입력해 주세요
                  {hasSpouse
                    ? ' (배우자 계좌 잔액 및 배우자 예상 퇴직금을 분리 입력하면 인별 근속연수공제·누진세율 및 연 1,500만원 저율 분리과세 한도가 각각 적용됩니다).'
                    : '.'}
                </div>

                {isDetailedSheltered && (
                  <div className="dock-mode-banner" role="note" style={{ marginTop: 6 }}>
                    절세·연금계좌 KRX ETF 직접 구성 모드 — 보유 ETF {inputs.accounts.shelteredHoldings?.length ?? 0}종이 부부 절세계좌 총합(
                    {formatKRW(currentLiquid - inputs.asset.totalInvestment)})에 자동 비례 배분됩니다. 종목 구성은{' '}
                    <strong>[7. 절세·연금 수익률]</strong> 단계에서 변경할 수 있습니다.
                  </div>
                )}

                <div className="wizard-3col-grid" style={{ marginTop: 8 }}>
                  <label className="dock-field">
                    <div className="dock-label-row">
                      <span className="dock-label">① 본인 퇴직연금 (IRP/DC) 현재 잔액</span>
                      <FieldHelpBadge helpKey="currentRetirementPension" />
                    </div>
                    <div className="dock-input-unit">
                      <NumericInput
                        readoutWon={10_000}
                        step={1000}
                        min={0}
                        fallback={15000}
                        value={Math.round((inputs.accounts.selfRetirementPensionBalance || 0) / 10_000)}
                        onChange={(valMan) =>
                          updateShelteredAccountsWithSync({
                            selfRetirementPensionBalance: valMan * 10_000,
                          })
                        }
                      />
                      <span>만원</span>
                    </div>
                  </label>

                  <label className="dock-field">
                    <div className="dock-label-row">
                      <span className="dock-label">② 본인 연금저축펀드 현재 잔액</span>
                      <FieldHelpBadge helpKey="shelteredAccounts" />
                    </div>
                    <div className="dock-input-unit">
                      <NumericInput
                        readoutWon={10_000}
                        step={500}
                        min={0}
                        fallback={5000}
                        value={Math.round((inputs.accounts.selfPersonalPensionBalance || 0) / 10_000)}
                        onChange={(valMan) =>
                          updateShelteredAccountsWithSync({
                            selfPersonalPensionBalance: valMan * 10_000,
                          })
                        }
                      />
                      <span>만원</span>
                    </div>
                  </label>

                  <label className="dock-field">
                    <div className="dock-label-row">
                      <span className="dock-label">③ 본인 중개형 ISA 현재 잔액</span>
                    </div>
                    <div className="dock-input-unit">
                      <NumericInput
                        readoutWon={10_000}
                        step={500}
                        min={0}
                        fallback={4000}
                        value={Math.round((inputs.accounts.selfIsaBalance || 0) / 10_000)}
                        onChange={(valMan) =>
                          updateShelteredAccountsWithSync({
                            selfIsaBalance: valMan * 10_000,
                          })
                        }
                      />
                      <span>만원</span>
                    </div>
                  </label>
                </div>

                {hasSpouse && (
                  <div className="wizard-3col-grid" style={{ marginTop: 10 }}>
                    <label className="dock-field">
                      <span className="dock-label">배우자 퇴직연금 (IRP/DC) 현재 잔액</span>
                      <div className="dock-input-unit">
                        <NumericInput
                        readoutWon={10_000}
                          step={500}
                          min={0}
                          fallback={0}
                          value={Math.round(
                            (inputs.accounts.spouseRetirementPensionBalance || 0) / 10_000
                          )}
                          onChange={(valMan) =>
                            updateShelteredAccountsWithSync({
                              spouseRetirementPensionBalance: valMan * 10_000,
                            })
                          }
                        />
                        <span>만원</span>
                      </div>
                    </label>

                    <label className="dock-field">
                      <span className="dock-label">배우자 연금저축펀드 현재 잔액</span>
                      <div className="dock-input-unit">
                        <NumericInput
                        readoutWon={10_000}
                          step={500}
                          min={0}
                          fallback={3000}
                          value={Math.round(
                            (inputs.accounts.spousePersonalPensionBalance || 0) / 10_000
                          )}
                          onChange={(valMan) =>
                            updateShelteredAccountsWithSync({
                              spousePersonalPensionBalance: valMan * 10_000,
                            })
                          }
                        />
                        <span>만원</span>
                      </div>
                    </label>

                    <label className="dock-field">
                      <span className="dock-label">배우자 중개형 ISA 현재 잔액</span>
                      <div className="dock-input-unit">
                        <NumericInput
                        readoutWon={10_000}
                          step={500}
                          min={0}
                          fallback={2000}
                          value={Math.round((inputs.accounts.spouseIsaBalance || 0) / 10_000)}
                          onChange={(valMan) =>
                            updateShelteredAccountsWithSync({
                              spouseIsaBalance: valMan * 10_000,
                            })
                          }
                        />
                        <span>만원</span>
                      </div>
                    </label>
                  </div>
                )}

                <div className="dock-row-2col" style={{ marginTop: 12 }}>
                  <label className="dock-field">
                    <div className="dock-label-row">
                      <span className="dock-label">
                        본인 은퇴 시 추가 수령할 예상 퇴직금 (향후 회사 DC 불입분 + 일시 퇴직금)
                      </span>
                      <FieldHelpBadge helpKey="expectedSeverancePay" />
                    </div>
                    <div className="dock-input-unit">
                      <NumericInput
                        readoutWon={10_000}
                        step={500}
                        min={0}
                        fallback={0}
                        value={Math.round((inputs.transition.expectedSeverancePay || 0) / 10_000)}
                        onChange={(valMan) =>
                          onChange({
                            ...inputs,
                            transition: {
                              ...inputs.transition,
                              expectedSeverancePay: valMan * 10_000,
                            },
                          })
                        }
                      />
                      <span>만원</span>
                    </div>
                  </label>

                  {hasSpouse ? (
                    <label className="dock-field">
                      <div className="dock-label-row">
                        <span className="dock-label">
                          배우자 은퇴 시 추가 수령할 예상 퇴직금 (향후 회사 DC 불입분 + 일시 퇴직금)
                        </span>
                        <FieldHelpBadge helpKey="expectedSeverancePay" />
                      </div>
                      <div className="dock-input-unit">
                        <NumericInput
                        readoutWon={10_000}
                          step={500}
                          min={0}
                          fallback={0}
                          value={Math.round(
                            (inputs.transition.spouseExpectedSeverancePay || 0) / 10_000
                          )}
                          onChange={(valMan) =>
                            onChange({
                              ...inputs,
                              transition: {
                                ...inputs.transition,
                                spouseExpectedSeverancePay: valMan * 10_000,
                              },
                            })
                          }
                        />
                        <span>만원</span>
                      </div>
                    </label>
                  ) : (
                    <div className="dock-field" style={{ justifyContent: 'flex-end' }}>
                      <label className="dock-checkbox-inline" style={{ marginTop: 22 }}>
                        <input
                          type="checkbox"
                          checked={inputs.transition.severanceTransferToIrp}
                          onChange={(e) =>
                            onChange({
                              ...inputs,
                              transition: {
                                ...inputs.transition,
                                severanceTransferToIrp: e.target.checked,
                              },
                            })
                          }
                        />
                        <span>은퇴 시 일시 퇴직급여를 IRP로 이체하여 퇴직소득세 30~40% 감면 적용</span>
                      </label>
                    </div>
                  )}
                </div>

                {hasSpouse && (
                  <div className="dock-row-2col" style={{ marginTop: 10 }}>
                    <div className="dock-field" style={{ justifyContent: 'center' }}>
                      <label className="dock-checkbox-inline">
                        <input
                          type="checkbox"
                          checked={inputs.transition.severanceTransferToIrp}
                          onChange={(e) =>
                            onChange({
                              ...inputs,
                              transition: {
                                ...inputs.transition,
                                severanceTransferToIrp: e.target.checked,
                              },
                            })
                          }
                        />
                        <span>은퇴 시 일시 퇴직급여를 IRP로 이체하여 퇴직소득세 30~40% 감면 적용</span>
                      </label>
                    </div>

                    <div className="wizard-Context-pill-box num">
                      <span>부부 은퇴 시 추가 수령 예상 퇴직금 합계 (인별 분리 과세)</span>
                      <strong>
                        {formatKRW(
                          (inputs.transition.expectedSeverancePay || 0) +
                            (inputs.transition.spouseExpectedSeverancePay || 0)
                        )}{' '}
                        (본인 {formatKRW(inputs.transition.expectedSeverancePay || 0)} + 배우자{' '}
                        {formatKRW(inputs.transition.spouseExpectedSeverancePay || 0)})
                      </strong>
                    </div>
                  </div>
                )}
              </div>
            )}

            {currentStep === 5 && (
              <div className="wizard-single-topic-body">
                <div className="wizard-hero-value-row">
                  <span className="wizard-hero-caption">
                    은퇴 전 월 저축 구성 (일반계좌 월 저축 + 절세계좌 월 환산 추가납입)
                  </span>
                  <strong className="wizard-hero-readout num">
                    일반계좌 월 {Math.round(generalMonthlySavings / 10_000).toLocaleString()}만 원
                    <span className="wizard-hero-tag">
                      (+ 절세계좌 월 환산 {Math.round(shelteredMonthlyEquiv / 10_000).toLocaleString()}만원 = 총 월{' '}
                      {Math.round((generalMonthlySavings + shelteredMonthlyEquiv) / 10_000).toLocaleString()}만원)
                    </span>
                  </strong>
                </div>

                <input
                  type="range"
                  className="wizard-range-slider"
                  min={0}
                  max={20_000_000}
                  step={500_000}
                  value={Math.min(20_000_000, generalMonthlySavings)}
                  onChange={(e) => {
                    const nextGeneralMonthly = Number(e.target.value);
                    onChange({
                      ...inputs,
                      transition: {
                        ...inputs.transition,
                        preRetirementMonthlySavings: nextGeneralMonthly + shelteredMonthlyEquiv,
                      },
                    });
                  }}
                />

                <div className="dock-row-2col" style={{ marginTop: 12 }}>
                  <label className="dock-field">
                    <div className="dock-label-row">
                      <span className="dock-label">일반계좌 월 저축액 (절세계좌 납입액 외 순수 추가분)</span>
                      <FieldHelpBadge helpKey="preRetirementSavings" />
                    </div>
                    <div className="dock-input-unit">
                      <NumericInput
                        readoutWon={10_000}
                        step={50}
                        min={0}
                        fallback={100}
                        value={Math.round(generalMonthlySavings / 10_000)}
                        onChange={(valMan) => {
                          const nextGeneralMonthly = valMan * 10_000;
                          onChange({
                            ...inputs,
                            transition: {
                              ...inputs.transition,
                              preRetirementMonthlySavings: nextGeneralMonthly + shelteredMonthlyEquiv,
                            },
                          });
                        }}
                      />
                      <span>만원/월</span>
                    </div>
                  </label>

                  <div className="wizard-Context-pill-box num">
                    <span>
                      절세계좌(ISA·연금저축) 월 환산 추가납입액 (아래 입력란과 자동 합산)
                    </span>
                    <strong>
                      월 {Math.round(shelteredMonthlyEquiv / 10_000).toLocaleString()}만원 (연간 합계{' '}
                      {formatKRW(annualShelteredAddition)} · 가계 총 월 저축{' '}
                      {Math.round((generalMonthlySavings + shelteredMonthlyEquiv) / 10_000).toLocaleString()}만원)
                    </strong>
                  </div>
                </div>

                <div className="dock-mode-banner" role="note" style={{ marginTop: 10 }}>
                  💡 아래 ISA·연금저축 연간 추가납입액을 변경해도 위에서 설정한{' '}
                  <strong>일반계좌 월 저축액(월 {Math.round(generalMonthlySavings / 10_000).toLocaleString()}만원)</strong>은
                  깎이지 않으며, 절세계좌 월 환산 납입액과 합산되어 가계 총 저축액에 반영됩니다.
                </div>

                <div className="dock-row-2col" style={{ marginTop: 8 }}>
                  <label className="dock-field">
                    <span className="dock-label">본인 ISA 연간 추가납입 (연 2,000만/총 1억 한도)</span>
                    <div className="dock-input-unit">
                      <NumericInput
                        readoutWon={10_000}
                        step={200}
                        min={0}
                        max={2000}
                        fallback={1000}
                        value={Math.round((inputs.accounts.selfIsaAnnualAddition || 0) / 10_000)}
                        onChange={(valMan) => {
                          const nextVal = valMan * 10_000;
                          const nextShelteredMonthly = Math.round(
                            (nextVal +
                              (hasSpouse ? inputs.accounts.spouseIsaAnnualAddition || 0 : 0) +
                              (inputs.accounts.selfPersonalPensionAnnualAddition || 0) +
                              (hasSpouse
                                ? inputs.accounts.spousePersonalPensionAnnualAddition || 0
                                : 0)) /
                              12
                          );
                          onChange({
                            ...inputs,
                            accounts: {
                              ...inputs.accounts,
                              selfIsaAnnualAddition: nextVal,
                            },
                            transition: {
                              ...inputs.transition,
                              preRetirementMonthlySavings:
                                generalMonthlySavings + nextShelteredMonthly,
                            },
                          });
                        }}
                      />
                      <span>만원/년</span>
                    </div>
                  </label>

                  {hasSpouse ? (
                    <label className="dock-field">
                      <span className="dock-label">배우자 ISA 연간 추가납입 (연 2,000만/총 1억 한도)</span>
                      <div className="dock-input-unit">
                        <NumericInput
                        readoutWon={10_000}
                          step={200}
                          min={0}
                          max={2000}
                          fallback={1000}
                          value={Math.round((inputs.accounts.spouseIsaAnnualAddition || 0) / 10_000)}
                          onChange={(valMan) => {
                            const nextVal = valMan * 10_000;
                            const nextShelteredMonthly = Math.round(
                              ((inputs.accounts.selfIsaAnnualAddition || 0) +
                                nextVal +
                                (inputs.accounts.selfPersonalPensionAnnualAddition || 0) +
                                (inputs.accounts.spousePersonalPensionAnnualAddition || 0)) /
                                12
                            );
                            onChange({
                              ...inputs,
                              accounts: {
                                ...inputs.accounts,
                                spouseIsaAnnualAddition: nextVal,
                              },
                              transition: {
                                ...inputs.transition,
                                preRetirementMonthlySavings:
                                  generalMonthlySavings + nextShelteredMonthly,
                              },
                            });
                          }}
                        />
                        <span>만원/년</span>
                      </div>
                    </label>
                  ) : (
                    <label className="dock-field">
                      <span className="dock-label">본인 연금저축 연간 추가납입 (연 1,800만 한도)</span>
                      <div className="dock-input-unit">
                        <NumericInput
                        readoutWon={10_000}
                          step={100}
                          min={0}
                          max={1800}
                          fallback={600}
                          value={Math.round(
                            (inputs.accounts.selfPersonalPensionAnnualAddition || 0) / 10_000
                          )}
                          onChange={(valMan) => {
                            const nextVal = valMan * 10_000;
                            const nextShelteredMonthly = Math.round(
                              ((inputs.accounts.selfIsaAnnualAddition || 0) + nextVal) / 12
                            );
                            onChange({
                              ...inputs,
                              accounts: {
                                ...inputs.accounts,
                                selfPersonalPensionAnnualAddition: nextVal,
                              },
                              transition: {
                                ...inputs.transition,
                                preRetirementMonthlySavings:
                                  generalMonthlySavings + nextShelteredMonthly,
                              },
                            });
                          }}
                        />
                        <span>만원/년</span>
                      </div>
                    </label>
                  )}
                </div>

                {hasSpouse && (
                  <div className="dock-row-2col" style={{ marginTop: 8 }}>
                    <label className="dock-field">
                      <span className="dock-label">본인 연금저축 연간 추가납입 (연 1,800만 한도)</span>
                      <div className="dock-input-unit">
                        <NumericInput
                        readoutWon={10_000}
                          step={100}
                          min={0}
                          max={1800}
                          fallback={600}
                          value={Math.round(
                            (inputs.accounts.selfPersonalPensionAnnualAddition || 0) / 10_000
                          )}
                          onChange={(valMan) => {
                            const nextVal = valMan * 10_000;
                            const nextShelteredMonthly = Math.round(
                              ((inputs.accounts.selfIsaAnnualAddition || 0) +
                                (inputs.accounts.spouseIsaAnnualAddition || 0) +
                                nextVal +
                                (inputs.accounts.spousePersonalPensionAnnualAddition || 0)) /
                                12
                            );
                            onChange({
                              ...inputs,
                              accounts: {
                                ...inputs.accounts,
                                selfPersonalPensionAnnualAddition: nextVal,
                              },
                              transition: {
                                ...inputs.transition,
                                preRetirementMonthlySavings:
                                  generalMonthlySavings + nextShelteredMonthly,
                              },
                            });
                          }}
                        />
                        <span>만원/년</span>
                      </div>
                    </label>

                    <label className="dock-field">
                      <span className="dock-label">배우자 연금저축 연간 추가납입 (연 1,800만 한도)</span>
                      <div className="dock-input-unit">
                        <NumericInput
                        readoutWon={10_000}
                          step={100}
                          min={0}
                          max={1800}
                          fallback={600}
                          value={Math.round(
                            (inputs.accounts.spousePersonalPensionAnnualAddition || 0) / 10_000
                          )}
                          onChange={(valMan) => {
                            const nextVal = valMan * 10_000;
                            const nextShelteredMonthly = Math.round(
                              ((inputs.accounts.selfIsaAnnualAddition || 0) +
                                (inputs.accounts.spouseIsaAnnualAddition || 0) +
                                (inputs.accounts.selfPersonalPensionAnnualAddition || 0) +
                                nextVal) /
                                12
                            );
                            onChange({
                              ...inputs,
                              accounts: {
                                ...inputs.accounts,
                                spousePersonalPensionAnnualAddition: nextVal,
                              },
                              transition: {
                                ...inputs.transition,
                                preRetirementMonthlySavings:
                                  generalMonthlySavings + nextShelteredMonthly,
                              },
                            });
                          }}
                        />
                        <span>만원/년</span>
                      </div>
                    </label>
                  </div>
                )}
                <div className="dock-mode-banner num" role="note" style={{ marginTop: 10 }}>
                  ℹ️ 연금저축·IRP 납입액의 <strong>연말정산 세액공제 환급</strong>은 계산에 포함하지 않는 보수적 가정입니다
                  (환급금을 재투자하면 실제 결과는 이보다 조금 더 좋아질 수 있습니다).
                </div>
              </div>
            )}

            {currentStep === 6 && (
              <div className="wizard-single-topic-body">
                <div className="wizard-hero-value-row">
                  <span className="wizard-hero-caption">
                    일반·법인 금융계좌 가중평균 목표 수익률 (개인 일반계좌 · 가족법인 계좌)
                  </span>
                  <strong className="wizard-hero-readout num">
                    연 {portfolioEval.effectiveTotalReturn.toFixed(2)}%
                    {inputs.asset.returnShiftPct ? (
                      <span className="wizard-hero-tag">
                        → 시나리오 적용 연 {(portfolioEval.effectiveTotalReturn + inputs.asset.returnShiftPct).toFixed(2)}%
                      </span>
                    ) : null}
                    <span className="wizard-hero-tag">
                      (자본성장 +{portfolioEval.effectiveGrowthRate.toFixed(2)}% · 배당 +{portfolioEval.effectiveDividendYield.toFixed(2)}% · 해외직투 비중{' '}
                      {isDetailedPortfolio
                        ? portfolioEval.overseasDirectRatio.toFixed(0)
                        : inputs.asset.overseasEtfRatio}
                      %)
                    </span>
                  </strong>
                </div>

                <div
                  className="wizard-return-mode-tabs"
                  role="group"
                  aria-label="일반·법인 금융계좌 목표수익률 입력 방식 선택"
                >
                  <button
                    type="button"
                    className={`wizard-return-mode-tab ${inputs.asset.inputMode !== 'detailed' ? 'active' : ''}`}
                    onClick={() =>
                      onChange({
                        ...inputs,
                        asset: {
                          ...inputs.asset,
                          inputMode: 'macro',
                        },
                      })
                    }
                  >
                    <strong>🎚️ 간편 슬라이더 입력</strong>
                    <span>성장형 : 배당형 투자 비중 슬라이더와 기대수익률로 빠르게 설정</span>
                  </button>

                  <button
                    type="button"
                    className={`wizard-return-mode-tab ${inputs.asset.inputMode === 'detailed' ? 'active' : ''}`}
                    onClick={() =>
                      onChange({
                        ...inputs,
                        asset: {
                          ...inputs.asset,
                          inputMode: 'detailed',
                        },
                      })
                    }
                  >
                    <strong>🧩 ETF 포트폴리오 입력</strong>
                    <span>추천 포트폴리오(4종) 또는 한·미 1,274종 ETF 종목으로 직접 구성</span>
                  </button>
                </div>

                <div className="wizard-return-mode-tabs wizard-return-mode-tabs--3" role="group" aria-label="수익률 시나리오 선택">
                  {([
                    [-3, '낮게 −3%p'],
                    [0, '기본'],
                    [3, '높게 +3%p'],
                  ] as const).map(([shift, label]) => (
                    <button
                      key={shift}
                      type="button"
                      className={`wizard-return-mode-tab ${(inputs.asset.returnShiftPct ?? 0) === shift ? 'active' : ''}`}
                      onClick={() => onChange({ ...inputs, asset: { ...inputs.asset, returnShiftPct: shift } })}
                    >
                      <strong>{label}</strong>
                      <span>
                        {shift === 0
                          ? '입력한 기대수익률 그대로'
                          : `모든 계좌 기대수익률에 일괄 ${shift > 0 ? '+' : '−'}${Math.abs(shift)}%p 적용 (물가 별도 반영)`}
                      </span>
                    </button>
                  ))}
                </div>

                {inputs.asset.inputMode === 'detailed' ? (
                  <div className="step-detail-stack" style={{ marginTop: 10 }}>
                    <div className="dock-mode-banner num" role="note">
                      💡 <strong>일반·법인 ETF 포트폴리오 직접 구성 모드</strong> — 아래 추천 포트폴리오(4종)를 클릭하거나 한·미 1,274종 ETF에서 종목을 선택하면, 보유 종목{' '}
                      <strong>{inputs.asset.holdings?.length ?? 0}종</strong>의 가중합산 수익률(자본성장{' '}
                      <strong>+{portfolioEval.effectiveGrowthRate.toFixed(2)}%</strong> · 배당{' '}
                      <strong>+{portfolioEval.effectiveDividendYield.toFixed(2)}%</strong> · 실부담보수 차감{' '}
                      <strong>-{portfolioEval.weightedExpenseRatio.toFixed(3)}%</strong> · 해외직투{' '}
                      <strong>{portfolioEval.overseasDirectRatio.toFixed(0)}%</strong>)이 시뮬레이션 엔진에 즉시 반영됩니다.
                    </div>

                    <EtfPortfolioBuilder
                      inputs={inputs}
                      scope="general"
                      onChange={onChange}
                    />
                  </div>
                ) : (
                  <>
                    <div className="dock-mode-banner num" role="note" style={{ marginTop: 8 }}>
                      산출 공식: 자본성장 <strong>+{portfolioEval.effectiveGrowthRate.toFixed(2)}%</strong> ({inputs.asset.growthRate}% × 비중 {growthRatio}%) + 배당수익{' '}
                      <strong>+{portfolioEval.effectiveDividendYield.toFixed(2)}%</strong> ({inputs.asset.dividendYield}% × 비중 {divRatio}%) = 가중평균{' '}
                      <strong>연 {portfolioEval.effectiveTotalReturn.toFixed(2)}%</strong>
                    </div>

                    <div className="dock-field" style={{ marginTop: 10 }}>
                      <div className="dock-label-row">
                        <span className="dock-label">성장형 : 배당형 투자 비중</span>
                        <FieldHelpBadge helpKey="portfolioReturn" />
                        <strong className="dock-value-badge num">
                          성장 {growthRatio}% : 배당 {divRatio}%
                        </strong>
                      </div>
                      <input
                        type="range"
                        className="wizard-range-slider"
                        min={0}
                        max={100}
                        step={5}
                        value={growthRatio}
                        onChange={(e) => {
                          const nextGrowth = Math.max(0, Math.min(100, Number(e.target.value)));
                          onChange({
                            ...inputs,
                            asset: {
                              ...inputs.asset,
                              inputMode: 'macro',
                              growthEtfRatio: nextGrowth,
                              dividendEtfRatio: 100 - nextGrowth,
                            },
                          });
                        }}
                      />
                    </div>

                    <div className="wizard-3col-grid" style={{ marginTop: 12 }}>
                      <label className="dock-field">
                        <span className="dock-label">성장형 자산 기대수익률 (세전)</span>
                        <div className="dock-input-unit">
                          <NumericInput
                            step={0.2}
                            min={0}
                            max={20}
                            fallback={6}
                            value={inputs.asset.growthRate}
                            onChange={(nextGrowthRate) =>
                              onChange({
                                ...inputs,
                                asset: {
                                  ...inputs.asset,
                                  inputMode: 'macro',
                                  growthRate: nextGrowthRate,
                                },
                              })
                            }
                          />
                          <span>%/년</span>
                        </div>
                      </label>

                      <label className="dock-field">
                        <span className="dock-label">배당형 자산 기대배당률 (세전)</span>
                        <div className="dock-input-unit">
                          <NumericInput
                            step={0.2}
                            min={0}
                            max={15}
                            fallback={4}
                            value={inputs.asset.dividendYield}
                            onChange={(nextDivYield) =>
                              onChange({
                                ...inputs,
                                asset: {
                                  ...inputs.asset,
                                  inputMode: 'macro',
                                  dividendYield: nextDivYield,
                                },
                              })
                            }
                          />
                          <span>%/년</span>
                        </div>
                      </label>

                      <label className="dock-field">
                        <div className="dock-label-row">
                          <span className="dock-label">일반계좌 내 해외상장 ETF 직접투자 비중</span>
                          <FieldHelpBadge helpKey="overseasEtfRatio" />
                        </div>
                        <div className="dock-input-unit">
                          <NumericInput
                            min={0}
                            max={100}
                            fallback={70}
                            value={inputs.asset.overseasEtfRatio}
                            onChange={(overseasEtfRatio) =>
                              onChange({
                                ...inputs,
                                asset: { ...inputs.asset, overseasEtfRatio },
                              })
                            }
                          />
                          <span>%</span>
                        </div>
                      </label>
                    </div>
                  </>
                )}
              </div>
            )}

            {currentStep === 7 && (
              <div className="wizard-single-topic-body">
                <div className="wizard-hero-value-row">
                  <span className="wizard-hero-caption">
                    절세·연금 3대 계좌 (중개형 ISA · 연금저축펀드 · 퇴직연금 IRP) 기대수익률
                  </span>
                  <strong className="wizard-hero-readout num">
                    {inputs.accounts.overrideSymmetricAccountReturns ? (
                      <>
                        ISA {inputs.accounts.isaExpectedReturnRate.toFixed(2)}% · 연금저축{' '}
                        {inputs.accounts.personalPensionReturnRate.toFixed(2)}% · IRP{' '}
                        {(
                          inputs.accounts.irpExpectedReturnRate ??
                          inputs.accounts.personalPensionReturnRate
                        ).toFixed(2)}
                        %
                        {returnShift ? (
                          <span className="wizard-hero-tag">
                            → 시나리오 적용 ISA {(inputs.accounts.isaExpectedReturnRate + returnShift).toFixed(2)}% · 연금저축{' '}
                            {(inputs.accounts.personalPensionReturnRate + returnShift).toFixed(2)}% · IRP{' '}
                            {((inputs.accounts.irpExpectedReturnRate ?? inputs.accounts.personalPensionReturnRate) + returnShift).toFixed(2)}%
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        일반·법인 동일 연 {portfolioEval.effectiveTotalReturn.toFixed(2)}%
                        {returnShift ? (
                          <span className="wizard-hero-tag">
                            → 시나리오 적용 연 {(portfolioEval.effectiveTotalReturn + returnShift).toFixed(2)}%
                          </span>
                        ) : null}
                        <span className="wizard-hero-tag">(3대 절세계좌 대칭 적용)</span>
                      </>
                    )}
                  </strong>
                </div>

                {/* 1단계 상위 탭: 일반·법인 계좌 동일 적용 vs 절세·연금계좌 수익률 별도 적용 */}
                <div
                  className="wizard-return-mode-tabs"
                  role="group"
                  aria-label="절세·연금계좌 수익률 적용 방식 선택"
                >
                  <button
                    type="button"
                    className={`wizard-return-mode-tab ${!step7SeparateMode ? 'active' : ''}`}
                    onClick={() => {
                      setStep7SeparateMode(false);
                      const useCap = inputs.accounts.applyIrpRiskAssetCap ?? true;
                      const baseReturn = portfolioEval.effectiveTotalReturn;
                      const irpAutoRate = Number((baseReturn * 0.7 + 3.5 * 0.3).toFixed(2));
                      onChange({
                        ...inputs,
                        accounts: {
                          ...inputs.accounts,
                          overrideSymmetricAccountReturns: useCap,
                          applyIrpRiskAssetCap: useCap,
                          shelteredInputMode: 'macro',
                          isaExpectedReturnRate: Number(baseReturn.toFixed(2)),
                          personalPensionReturnRate: Number(baseReturn.toFixed(2)),
                          irpExpectedReturnRate: useCap
                            ? irpAutoRate
                            : Number(baseReturn.toFixed(2)),
                        },
                      });
                    }}
                  >
                    <strong>일반·법인 계좌 동일 적용 (IRP는 70% 위험자산 한도 자동 적용)</strong>
                    <span>
                      ISA · 연금저축은 일반·법인(연 {portfolioEval.effectiveTotalReturn.toFixed(2)}%)과 동일 연동 · IRP 70% 한도 자동 반영
                    </span>
                  </button>

                  <button
                    type="button"
                    className={`wizard-return-mode-tab ${step7SeparateMode ? 'active' : ''}`}
                    onClick={() => {
                      setStep7SeparateMode(true);
                      const baseReturn = portfolioEval.effectiveTotalReturn;
                      const irpAutoRate = Number((baseReturn * 0.7 + 3.5 * 0.3).toFixed(2));
                      onChange({
                        ...inputs,
                        accounts: {
                          ...inputs.accounts,
                          overrideSymmetricAccountReturns: true,
                          isaExpectedReturnRate:
                            inputs.accounts.isaExpectedReturnRate || Number(baseReturn.toFixed(2)),
                          personalPensionReturnRate:
                            inputs.accounts.personalPensionReturnRate ||
                            Number(baseReturn.toFixed(2)),
                          irpExpectedReturnRate:
                            inputs.accounts.irpExpectedReturnRate ?? irpAutoRate,
                        },
                      });
                    }}
                  >
                    <strong>절세·연금계좌 수익률 별도 적용</strong>
                    <span>간편 슬라이더(계좌별 수익률) 또는 국내상장 KRX ETF 포트폴리오로 별도 설정</span>
                  </button>
                </div>

                {!step7SeparateMode ? (
                  <div className="step-detail-stack" style={{ marginTop: 10 }}>
                    <div className="dock-mode-banner num" role="note">
                      💡 <strong>일반·법인 계좌 수익률 연동 모드</strong> — 6번 단계에서 설정한 일반·법인 기대수익률(연{' '}
                      <strong>{portfolioEval.effectiveTotalReturn.toFixed(2)}%</strong>)을 중개형 ISA와 연금저축펀드에 동일하게 적용하며,{' '}
                      {irpCapActive ? (
                        <>
                          퇴직연금(IRP)은 법정 위험자산 70% 한도 규정에 따라{' '}
                          <strong>연 {(inputs.accounts.irpExpectedReturnRate ?? 0).toFixed(2)}%</strong>로 계산됩니다.
                        </>
                      ) : (
                        <>
                          퇴직연금(IRP)도 <strong>연 {portfolioEval.effectiveTotalReturn.toFixed(2)}%</strong>로 동일하게
                          계산됩니다 (70% 한도를 반영하려면 아래 항목을 체크하세요).
                        </>
                      )}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <label className="dock-checkbox-inline">
                        <input
                          type="checkbox"
                          checked={irpCapActive}
                          onChange={(e) => {
                            const useCap = e.target.checked;
                            const baseRate = portfolioEval.effectiveTotalReturn;
                            const nextIrp = useCap
                              ? Number((baseRate * 0.7 + 3.5 * 0.3).toFixed(2))
                              : Number(baseRate.toFixed(2));
                            onChange({
                              ...inputs,
                              accounts: {
                                ...inputs.accounts,
                                overrideSymmetricAccountReturns: useCap,
                                applyIrpRiskAssetCap: useCap,
                                isaExpectedReturnRate: Number(baseRate.toFixed(2)),
                                personalPensionReturnRate: Number(baseRate.toFixed(2)),
                                irpExpectedReturnRate: nextIrp,
                              },
                            });
                          }}
                        />
                        <span>
                          IRP 위험자산 70% 한도 자동 연동 (주식형 70% + 안전자산 3.5%×30%)
                        </span>
                      </label>

                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          const baseReturn = portfolioEval.effectiveTotalReturn;
                          const irpAutoRate = Number((baseReturn * 0.7 + 3.5 * 0.3).toFixed(2));
                          onChange({
                            ...inputs,
                            accounts: {
                              ...inputs.accounts,
                              overrideSymmetricAccountReturns: true,
                              applyIrpRiskAssetCap: true,
                              isaExpectedReturnRate: Number(baseReturn.toFixed(2)),
                              personalPensionReturnRate: Number(baseReturn.toFixed(2)),
                              irpExpectedReturnRate: irpAutoRate,
                            },
                          });
                        }}
                      >
                        ⚡ IRP 위험자산 70% 한도 자동 계산 적용 (주식형 70% + 안전자산 3.5%×30% = 연{' '}
                        {(portfolioEval.effectiveTotalReturn * 0.7 + 3.5 * 0.3).toFixed(2)}%)
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="step-detail-stack" style={{ marginTop: 10 }}>
                    {/* 2단계 하위 탭: 간편 슬라이더 입력 vs KRX ETF 포트폴리오 입력 */}
                    <div
                      className="wizard-return-mode-tabs"
                      role="group"
                      aria-label="절세·연금계좌 별도 수익률 상세 입력 방식"
                    >
                      <button
                        type="button"
                        className={`wizard-return-mode-tab ${inputs.accounts.shelteredInputMode !== 'detailed' ? 'active' : ''}`}
                        onClick={() =>
                          onChange({
                            ...inputs,
                            accounts: {
                              ...inputs.accounts,
                              overrideSymmetricAccountReturns: true,
                              shelteredInputMode: 'macro',
                            },
                          })
                        }
                      >
                        <strong>🎚️ 간편 슬라이더 입력</strong>
                        <span>ISA · 연금저축 · IRP 계좌별 기대수익률을 직접 입력</span>
                      </button>

                      <button
                        type="button"
                        className={`wizard-return-mode-tab ${inputs.accounts.shelteredInputMode === 'detailed' ? 'active' : ''}`}
                        onClick={() =>
                          onChange({
                            ...inputs,
                            accounts: {
                              ...inputs.accounts,
                              overrideSymmetricAccountReturns: true,
                              shelteredInputMode: 'detailed',
                            },
                          })
                        }
                      >
                        <strong>🧩 KRX ETF 포트폴리오 입력</strong>
                        <span>절세·연금 전용 추천 프리셋(5종) 또는 국내상장 KRX 적격 ETF로 직접 구성</span>
                      </button>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <label className="dock-checkbox-inline">
                        <input
                          type="checkbox"
                          checked={inputs.accounts.applyIrpRiskAssetCap ?? true}
                          onChange={(e) => {
                            const useCap = e.target.checked;
                            const baseRate = isDetailedSheltered
                              ? shelteredEval.effectiveTotalReturn
                              : inputs.accounts.personalPensionReturnRate;
                            const nextIrp = useCap
                              ? Number((baseRate * 0.7 + 3.5 * 0.3).toFixed(2))
                              : Number(baseRate.toFixed(2));
                            onChange({
                              ...inputs,
                              accounts: {
                                ...inputs.accounts,
                                overrideSymmetricAccountReturns: true,
                                applyIrpRiskAssetCap: useCap,
                                irpExpectedReturnRate: nextIrp,
                              },
                            });
                          }}
                        />
                        <span>
                          IRP 위험자산 70% 한도 자동 연동 (주식형 70% + 안전자산 3.5%×30%)
                        </span>
                      </label>

                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          const baseReturn = isDetailedSheltered
                            ? shelteredEval.effectiveTotalReturn
                            : inputs.accounts.personalPensionReturnRate || portfolioEval.effectiveTotalReturn;
                          const irpAutoRate = Number((baseReturn * 0.7 + 3.5 * 0.3).toFixed(2));
                          onChange({
                            ...inputs,
                            accounts: {
                              ...inputs.accounts,
                              overrideSymmetricAccountReturns: true,
                              applyIrpRiskAssetCap: true,
                              isaExpectedReturnRate: Number(baseReturn.toFixed(2)),
                              personalPensionReturnRate: Number(baseReturn.toFixed(2)),
                              irpExpectedReturnRate: irpAutoRate,
                            },
                          });
                        }}
                      >
                        ⚡ IRP 위험자산 70% 한도 자동 계산 적용 (연{' '}
                        {(
                          (isDetailedSheltered
                            ? shelteredEval.effectiveTotalReturn
                            : inputs.accounts.personalPensionReturnRate || portfolioEval.effectiveTotalReturn) *
                            0.7 +
                          3.5 * 0.3
                        ).toFixed(2)}
                        %)
                      </button>
                    </div>

                    {isDetailedSheltered ? (
                      <div className="step-detail-stack">
                        <div className="dock-mode-banner num" role="note">
                          🛡️ <strong>절세·연금 KRX ETF 포트폴리오 직접 구성 모드</strong> — 절세·연금계좌에서는 미국 상장 ETF 직접 매수가 불가하므로 국내상장 적격 ETF{' '}
                          <strong>{inputs.accounts.shelteredHoldings?.length ?? 0}종</strong>의 가중합산 수익률(자본성장{' '}
                          <strong>+{shelteredEval.effectiveGrowthRate.toFixed(2)}%</strong> · 배당{' '}
                          <strong>+{shelteredEval.effectiveDividendYield.toFixed(2)}%</strong> · 실부담보수 차감{' '}
                          <strong>-{shelteredEval.weightedExpenseRatio.toFixed(3)}%</strong> = 세전{' '}
                          <strong>연 {shelteredEval.effectiveTotalReturn.toFixed(2)}%</strong>)이 ISA·연금저축·IRP에 자동 반영됩니다.
                        </div>

                        <EtfPortfolioBuilder
                          inputs={inputs}
                          scope="sheltered"
                          onChange={onChange}
                        />
                      </div>
                    ) : (
                      <div className="wizard-3col-grid">
                        <label className="dock-field">
                          <span className="dock-label">① 중개형 ISA 기대 총수익률</span>
                          <div className="dock-input-unit">
                            <NumericInput
                              step={0.2}
                              min={0}
                              max={20}
                              fallback={5.4}
                              value={inputs.accounts.isaExpectedReturnRate}
                              onChange={(nextRate) =>
                                onChange({
                                  ...inputs,
                                  accounts: {
                                    ...inputs.accounts,
                                    overrideSymmetricAccountReturns: true,
                                    shelteredInputMode: 'macro',
                                    isaExpectedReturnRate: nextRate,
                                  },
                                })
                              }
                            />
                            <span>%/년</span>
                          </div>
                        </label>

                        <label className="dock-field">
                          <span className="dock-label">② 연금저축펀드 기대 총수익률</span>
                          <div className="dock-input-unit">
                            <NumericInput
                              step={0.2}
                              min={0}
                              max={20}
                              fallback={5.4}
                              value={inputs.accounts.personalPensionReturnRate}
                              onChange={(nextRate) => {
                                const useCap = inputs.accounts.applyIrpRiskAssetCap ?? true;
                                onChange({
                                  ...inputs,
                                  accounts: {
                                    ...inputs.accounts,
                                    overrideSymmetricAccountReturns: true,
                                    shelteredInputMode: 'macro',
                                    personalPensionReturnRate: nextRate,
                                    irpExpectedReturnRate: useCap
                                      ? Number((nextRate * 0.7 + 3.5 * 0.3).toFixed(2))
                                      : inputs.accounts.irpExpectedReturnRate,
                                  },
                                });
                              }}
                            />
                            <span>%/년</span>
                          </div>
                        </label>

                        <label className="dock-field">
                          <span className="dock-label">③ 퇴직연금(IRP) 기대 총수익률 (70% 한도 반영)</span>
                          <div className="dock-input-unit">
                            <NumericInput
                              step={0.2}
                              min={0}
                              max={20}
                              fallback={4.8}
                              value={
                                inputs.accounts.irpExpectedReturnRate ??
                                inputs.accounts.personalPensionReturnRate
                              }
                              onChange={(nextRate) =>
                                onChange({
                                  ...inputs,
                                  accounts: {
                                    ...inputs.accounts,
                                    overrideSymmetricAccountReturns: true,
                                    shelteredInputMode: 'macro',
                                    applyIrpRiskAssetCap: false,
                                    irpExpectedReturnRate: nextRate,
                                  },
                                })
                              }
                            />
                            <span>%/년</span>
                          </div>
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {currentStep === 8 && (
              <div className="wizard-single-topic-body">
                <div className="wizard-hero-value-row">
                  <span className="wizard-hero-caption">장기 물가상승률 (CPI) · 화폐가치 기준 · 시장 하락장 시나리오</span>
                  <strong className="wizard-hero-readout num">
                    물가 연 {inputs.transition.inflationRate ?? 2.5}% ·{' '}
                    {inputs.transition.viewMode === 'real' ? '실질 구매력 기준' : '명목 가치 기준'}
                  </strong>
                </div>

                <div className="dock-row-2col" style={{ marginTop: 10 }}>
                  <label className="dock-field">
                    <div className="dock-label-row">
                      <span className="dock-label">장기 물가상승률 (CPI)</span>
                      <FieldHelpBadge helpKey="inflationAndViewMode" />
                    </div>
                    <div className="dock-input-unit">
                      <NumericInput
                        step={0.1}
                        min={0}
                        max={8}
                        fallback={2.5}
                        value={inputs.transition.inflationRate ?? 2.5}
                        onChange={(nextInflation) =>
                          onChange({
                            ...inputs,
                            transition: { ...inputs.transition, inflationRate: nextInflation },
                          })
                        }
                      />
                      <span>%/년</span>
                    </div>
                  </label>

                  <div className="dock-field">
                    <span className="dock-label">결과 화면 화폐가치 표시 기준</span>
                    <div className="view-mode-segmented" style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                      <button
                        type="button"
                        className={inputs.transition.viewMode === 'real' ? 'active' : ''}
                        onClick={() =>
                          onChange({
                            ...inputs,
                            transition: { ...inputs.transition, viewMode: 'real' },
                          })
                        }
                      >
                        실질 구매력 (권장)
                      </button>
                      <button
                        type="button"
                        className={inputs.transition.viewMode === 'nominal' ? 'active' : ''}
                        onClick={() =>
                          onChange({
                            ...inputs,
                            transition: { ...inputs.transition, viewMode: 'nominal' },
                          })
                        }
                      >
                        명목 화폐가치
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <label className="dock-field">
                    <span className="dock-label">은퇴 직후 시장 하락장 스트레스 시나리오</span>
                    <select
                      value={inputs.transition.marketStressScenario}
                      onChange={(e) =>
                        onChange({
                          ...inputs,
                          transition: {
                            ...inputs.transition,
                            marketStressScenario: e.target.value as MarketStressScenarioType,
                          },
                        })
                      }
                    >
                      {Object.entries(STRESS_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            )}

            {currentStep === 9 && (
              <div className="wizard-single-topic-body">
                <div className="wizard-hero-value-row">
                  <span className="wizard-hero-caption">거주 주택 공시가격 & 부부 예상 국민연금</span>
                  <strong className="wizard-hero-readout num">
                    주택 공시가 {formatKRW(inputs.realEstate.officiallyAssessedValue)} · 연금 합계 월{' '}
                    {Math.round(
                      ((inputs.pension.expectedMonthlyPensionSelf || 0) +
                        (hasSpouse ? inputs.pension.expectedMonthlyPensionSpouse || 0 : 0)) /
                        10_000
                    ).toLocaleString()}
                    만원
                  </strong>
                </div>

                <div className="dock-row-2col" style={{ marginTop: 10 }}>
                  <label className="dock-field">
                    <div className="dock-label-row">
                      <span className="dock-label">거주 주택 공시가격 (건보 재산과표 기준)</span>
                      <FieldHelpBadge helpKey="realEstateAndPension" />
                    </div>
                    <div className="dock-input-unit">
                      <NumericInput
                        readoutWon={10_000}
                        step={5000}
                        min={0}
                        fallback={120000}
                        value={Math.round(inputs.realEstate.officiallyAssessedValue / 10_000)}
                        onChange={(valMan) =>
                          onChange({
                            ...inputs,
                            realEstate: {
                              ...inputs.realEstate,
                              officiallyAssessedValue: valMan * 10_000,
                            },
                          })
                        }
                      />
                      <span>만원</span>
                    </div>
                  </label>

                  <label className="dock-field">
                    <div className="dock-label-row">
                      <span className="dock-label">주택 소유 명의 (재산건보 과표 분할 기준)</span>
                    </div>
                    <select
                      value={inputs.realEstate.ownership}
                      onChange={(e) =>
                        onChange({
                          ...inputs,
                          realEstate: {
                            ...inputs.realEstate,
                            ownership: e.target.value as OwnershipType,
                          },
                        })
                      }
                    >
                      <option value="joint">부부 공동명의 (50:50 공제)</option>
                      <option value="single">1인 단독명의</option>
                    </select>
                  </label>
                </div>

                {(inputs.realEstate.housingType ?? 'own') === 'own' && (
                  <div className="dock-field" style={{ marginTop: 12 }}>
                    <label className="dock-checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={inputs.realEstate.includePropertyTax ?? true}
                        onChange={(e) =>
                          onChange({
                            ...inputs,
                            realEstate: {
                              ...inputs.realEstate,
                              includePropertyTax: e.target.checked,
                            },
                          })
                        }
                      />
                      <span className="dock-label" style={{ fontWeight: 600 }}>
                        은퇴 후 주택 보유세(재산세 + 종합부동산세) 자동 반영
                      </span>
                    </label>
                    <div className="wizard-default-note" style={{ marginTop: 4 }}>
                      은퇴 첫해 예상 보유세: 연{' '}
                      <strong>
                        {formatKRW(
                          plan.activeLedger.rows.find((r) => !r.isEmployed)?.personalPropertyTax ?? 0
                        )}
                      </strong>
                      {' '}(단독 12억·고령공제 vs 부부공동 18억 공제 자동 적용)
                    </div>
                  </div>
                )}

                <div className="dock-row-2col" style={{ marginTop: 12 }}>
                  <label className="dock-field">
                    <div className="dock-label-row">
                      <span className="dock-label">본인 예상 국민연금 ({claimStartAge('normal', inputs.pension.currentAgeSelf)}세 정상수령 기준 월액 · 현재가치)</span>
                    </div>
                    <div className="dock-input-unit">
                      <NumericInput
                        readoutWon={10_000}
                        step={10}
                        min={0}
                        fallback={180}
                        value={Math.round((inputs.pension.expectedMonthlyPensionSelf || 0) / 10_000)}
                        onChange={(valMan) =>
                          onChange({
                            ...inputs,
                            pension: {
                              ...inputs.pension,
                              expectedMonthlyPensionSelf: valMan * 10_000,
                            },
                          })
                        }
                      />
                      <span>만원/월</span>
                    </div>
                  </label>

                  {hasSpouse && (
                    <label className="dock-field">
                      <div className="dock-label-row">
                        <span className="dock-label">배우자 예상 국민연금 ({claimStartAge('normal', inputs.pension.currentAgeSpouse)}세 정상수령 기준 월액 · 현재가치)</span>
                      </div>
                      <div className="dock-input-unit">
                        <NumericInput
                        readoutWon={10_000}
                          step={10}
                          min={0}
                          fallback={0}
                          value={Math.round((inputs.pension.expectedMonthlyPensionSpouse || 0) / 10_000)}
                          onChange={(valMan) =>
                            onChange({
                              ...inputs,
                              pension: {
                                ...inputs.pension,
                                expectedMonthlyPensionSpouse: valMan * 10_000,
                              },
                            })
                          }
                        />
                        <span>만원/월</span>
                      </div>
                    </label>
                  )}
                </div>
              </div>
            )}

            {currentStep === 10 && (
              <div className="wizard-single-topic-body">
                <div className="wizard-hero-value-row">
                  <div className="dock-label-row" style={{ marginBottom: 0 }}>
                    <span className="wizard-hero-caption">일반 금융자산의 개인 : 가족법인 배분 비율</span>
                    <FieldHelpBadge helpKey="corporateAllocation" />
                  </div>
                  <strong className="wizard-hero-readout num">
                    개인 {activePersonalRatio}% : 가족법인 {100 - activePersonalRatio}%
                    <span className="wizard-hero-tag">
                      ({isRecommendationDifferent && (inputs.hybrid.useAutoOptimalRatio ?? true) ? '강건성 권고 · ' : ''}솔버 도출 최적해 r* = 개인 {optimalPersonalRatio}% : 법인 {100 - optimalPersonalRatio}%)
                    </span>
                  </strong>
                </div>

                {/* 배분 방식 선택 탭: 황금분할 최적해 자동 적용 vs 개인 : 법인 비율 직접 지정 */}
                <div
                  className="wizard-return-mode-tabs"
                  role="group"
                  aria-label="일반 금융자산 개인 및 가족법인 배분 방식 선택"
                >
                  <button
                    type="button"
                    className={`wizard-return-mode-tab ${(inputs.hybrid.useAutoOptimalRatio ?? true) ? 'active' : ''}`}
                    onClick={() =>
                      onChange({
                        ...inputs,
                        hybrid: {
                          ...inputs.hybrid,
                          useAutoOptimalRatio: true,
                          personalRatio: recommendedPersonalRatio,
                          corporateRatio: 100 - recommendedPersonalRatio,
                        },
                      })
                    }
                  >
                    <strong>🤖 황금분할 최적해(r*) 자동 적용 (권장)</strong>
                    <span>
                      솔버가 도출한 100세 세후 순자산 극대화 최적 비율 (개인 {optimalPersonalRatio}% : 법인 {100 - optimalPersonalRatio}%) 자동 반영
                    </span>
                  </button>

                  <button
                    type="button"
                    className={`wizard-return-mode-tab ${!(inputs.hybrid.useAutoOptimalRatio ?? true) ? 'active' : ''}`}
                    onClick={() =>
                      onChange({
                        ...inputs,
                        hybrid: {
                          ...inputs.hybrid,
                          useAutoOptimalRatio: false,
                          personalRatio: activePersonalRatio,
                          corporateRatio: 100 - activePersonalRatio,
                        },
                      })
                    }
                  >
                    <strong>🎚️ 개인 : 법인 비율 직접 지정</strong>
                    <span>슬라이더를 움직여 일반 금융자산의 개인 : 가족법인 배분 비율을 수동으로 시뮬레이션</span>
                  </button>
                </div>

                {(inputs.hybrid.useAutoOptimalRatio ?? true) ? (
                  <div className="dock-mode-banner num" role="note" style={{ marginTop: 8 }}>
                    ✨ <strong>황금분할 최적 비율(r*) 자동 적용 중</strong> — 현재 입력하신 자산·수익률·세법 조건에서 100세 세후 가처분 순자산을 극대화하는 최적 배분 해는{' '}
                    <strong>
                      개인 {optimalPersonalRatio}% : 가족법인 {100 - optimalPersonalRatio}%
                    </strong>
                    입니다.
                    {isRecommendationDifferent && (
                      <>
                        {' '}다만 강건성 검증 결과 최종 권고는{' '}
                        <strong>
                          개인 {recommendedPersonalRatio}% : 가족법인 {100 - recommendedPersonalRatio}%
                        </strong>
                        입니다 ({plan.recommendation.reason}).
                      </>
                    )}{' '}
                    수동으로 다른 배분 비율을 테스트하려면 위에서{' '}
                    <strong>[🎚️ 개인 : 법인 비율 직접 지정]</strong> 탭을 선택하세요.
                  </div>
                ) : (
                  <div className="dock-field" style={{ marginTop: 10 }}>
                    <div className="dock-label-row">
                      <span className="dock-label">개인 : 가족법인 배분 비율 수동 조절</span>
                      <strong className="dock-value-badge num">
                        개인 {activePersonalRatio}% : 법인 {100 - activePersonalRatio}%
                      </strong>
                    </div>
                    <input
                      type="range"
                      className="wizard-range-slider"
                      min={0}
                      max={100}
                      step={1}
                      value={activePersonalRatio}
                      onChange={(e) => {
                        const p = Number(e.target.value);
                        onChange({
                          ...inputs,
                          hybrid: {
                            useAutoOptimalRatio: false,
                            personalRatio: p,
                            corporateRatio: 100 - p,
                          },
                        });
                      }}
                    />
                    <div className="dock-split-caption num">
                      <span>개인 0% (법인 100%)</span>
                      <span>최적 r* = 개인 {optimalPersonalRatio}%</span>
                      <span>개인 100% (법인 0%)</span>
                    </div>
                  </div>
                )}

                <div className="step-detail-stack" style={{ marginTop: 14 }}>
                  <div className="dock-field">
                    <span className="dock-label">가족법인 설립 · 자금 투입 시점</span>
                    <div
                      className="view-mode-segmented"
                      role="group"
                      aria-label="가족법인 설립 및 자금 투입 시점 선택"
                      style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr' }}
                    >
                      <button
                        type="button"
                        className={
                          (inputs.corporate.injectionTiming ?? 'now') === 'now' ? 'active' : ''
                        }
                        onClick={() =>
                          onChange({
                            ...inputs,
                            corporate: {
                              ...inputs.corporate,
                              injectionTiming: 'now',
                            },
                          })
                        }
                      >
                        지금(재직 중)부터 개인·법인 분할 적립 (기본)
                      </button>
                      <button
                        type="button"
                        className={
                          inputs.corporate.injectionTiming === 'retirement' ? 'active' : ''
                        }
                        onClick={() =>
                          onChange({
                            ...inputs,
                            corporate: {
                              ...inputs.corporate,
                              injectionTiming: 'retirement',
                            },
                          })
                        }
                      >
                        은퇴 시점(D-Day)에 법인 설립·일괄 이전 (재직 중 전액 일반계좌 운용)
                      </button>
                    </div>
                    {inputs.corporate.injectionTiming === 'retirement' && (
                      <div className="dock-mode-banner num" role="note" style={{ marginTop: 8 }}>
                        ⚠️ <strong>은퇴 D-Day 일괄 이전 세무 안내:</strong> 재직 중 일반계좌에 적립된 해외직투·과세형 국내상장 ETF를 은퇴 D-Day에 매도해 법인에 출자할 때 양도소득세(22%) 또는 배당소득세(15.4%)가 1회 정산된 후 세후 순액이 법인 가수금으로 이체됩니다.
                      </div>
                    )}
                  </div>

                  <label className="dock-field">
                    <span className="dock-label">
                      가족법인 등기임원 수 <FieldHelpBadge helpKey="corpExecutiveCount" />
                    </span>
                    <select
                      value={inputs.corporate.executiveCount}
                      onChange={(e) =>
                        onChange({
                          ...inputs,
                          corporate: {
                            ...inputs.corporate,
                            executiveCount: Number(e.target.value) === 1 ? 1 : 2,
                          },
                        })
                      }
                    >
                      <option value={1}>1인 단독 임원 (배우자 직장건보 피부양자 등재)</option>
                      <option value={2}>부부 2인 공동 임원 (급여 소득세 과표 분산)</option>
                    </select>
                  </label>

                  <div className="dock-field" style={{ marginTop: 14 }}>
                    <span className="dock-label">법인 자금 투입 구조 (설립 및 자금 조달)</span>
                    <div
                      className="view-mode-segmented"
                      role="group"
                      aria-label="법인 자금 투입 구조"
                      style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr' }}
                    >
                      <button
                        type="button"
                        className={(inputs.corporate.fundingStructure ?? 'shareholder_loan') === 'shareholder_loan' ? 'active' : ''}
                        onClick={() =>
                          onChange({
                            ...inputs,
                            corporate: {
                              ...inputs.corporate,
                              fundingStructure: 'shareholder_loan',
                            },
                          })
                        }
                      >
                        주주 가수금 대여 (등록세 0원 · 권장)
                      </button>
                      <button
                        type="button"
                        className={inputs.corporate.fundingStructure === 'capital_stock' ? 'active' : ''}
                        onClick={() =>
                          onChange({
                            ...inputs,
                            corporate: {
                              ...inputs.corporate,
                              fundingStructure: 'capital_stock',
                            },
                          })
                        }
                      >
                        납입자본금 출자 (등록세 0.48% + 감자 필요)
                      </button>
                    </div>
                    {plan.estateDiagnostic?.shareholderLoanSafeHarborNote && (
                      <div className="wizard-default-note" style={{ marginTop: 6 }}>
                        💡 {plan.estateDiagnostic.shareholderLoanSafeHarborNote}
                      </div>
                    )}
                  </div>

                  <div className="dock-field" style={{ marginTop: 12 }}>
                    <span className="dock-label">100세 기말 평가 기준 (최적화 목적함수)</span>
                    <div
                      className="view-mode-segmented"
                      role="group"
                      aria-label="100세 기말 평가 기준"
                      style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr' }}
                    >
                      <button
                        type="button"
                        className={(inputs.corporate.terminalValuationMode ?? 'liquidation') === 'liquidation' ? 'active' : ''}
                        onClick={() =>
                          onChange({
                            ...inputs,
                            corporate: {
                              ...inputs.corporate,
                              terminalValuationMode: 'liquidation',
                            },
                          })
                        }
                      >
                        100세 청산 가처분 순자산 기준 (기본)
                      </button>
                      <button
                        type="button"
                        className={inputs.corporate.terminalValuationMode === 'inheritance' ? 'active' : ''}
                        onClick={() =>
                          onChange({
                            ...inputs,
                            corporate: {
                              ...inputs.corporate,
                              terminalValuationMode: 'inheritance',
                            },
                          })
                        }
                      >
                        100세 상속세 차감 순상속재산 기준
                      </button>
                    </div>
                  </div>

                  <PrecisionTuners
                    group="D"
                    inputs={inputs}
                    onChange={onChange}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Step 2 & Step 9 전용: 메인 입력 카드 직하단 [⚙️ 상세 입력 옵션] 아코디언 토글 바 */}
          {showDetailToggle && (
            <div className="wizard-detail-toggle-bar">
              <button
                type="button"
                className={`step-detail-toggle-btn ${isDetailOpen ? 'open' : ''}`}
                aria-expanded={isDetailOpen}
                onClick={() => toggleDetail(currentStep)}
              >
                <span>
                  ⚙️ {stepMeta.shortLabel} 상세 입력 옵션{' '}
                  {currentStep === 2
                    ? '(은퇴 시점별 생활비 계단식 감액률 · 일시 목돈 유출입 이벤트)'
                    : '(주택 다운사이징/주택연금 전환 · 국민연금 조기/연기수령 · 배우자 연금 개시연령)'}
                </span>
                <strong>{isDetailOpen ? '접기 ▲' : '펼치기 ▼'}</strong>
              </button>
            </div>
          )}

          {/* 하단 [⚙️ 상세 입력 옵션] 토글 클릭 시 열리는 상세 설정 서랍 (Step 2 & Step 9 전용) */}
          {isDetailOpen && showDetailToggle && (
            <div className="step-detail-drawer" aria-label={`${stepMeta.shortLabel} 상세 입력 옵션`}>
              <div className="step-detail-drawer-header">
                <strong>⚙️ {stepMeta.shortLabel} 상세 입력 옵션</strong>
                <span>기본 설정값을 세밀하게 조정할 때 사용하세요.</span>
              </div>

              {currentStep === 2 && (
                <PrecisionTuners
                  group="A"
                  inputs={inputs}
                  onChange={onChange}
                />
              )}

              {currentStep === 9 && (
                <div className="step-detail-stack">
                  <div className="dock-row-2col">
                    <label className="dock-field">
                      <span className="dock-label">부동산 은퇴 전환 전략</span>
                      <select
                        value={inputs.realEstate.transition?.strategy ?? 'keep'}
                        onChange={(e) =>
                          onChange({
                            ...inputs,
                            realEstate: {
                              ...inputs.realEstate,
                              transition: {
                                ...(inputs.realEstate.transition ?? {
                                  strategy: 'keep',
                                  downsizingAge: 65,
                                  downsizedAssessedValue: 600_000_000,
                                  downsizingActualSurplusCash: 400_000_000,
                                  downsizingCorpAllocationRatio: 50,
                                  housingPensionStartAge: 65,
                                  housingPensionMonthlyPayout: 1_500_000,
                                  monthlyRentExpense: 0,
                                }),
                                strategy: e.target.value as RealEstateStrategyType,
                              },
                            },
                          })
                        }
                      >
                        {Object.entries(RE_STRATEGY_LABELS).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="dock-field">
                      <span className="dock-label">국민연금 수령 시기 (조기/정상/연기)</span>
                      <select
                        value={inputs.pension.claimTimingSelf}
                        onChange={(e) => {
                          const timing = e.target.value as PensionClaimTiming;
                          onChange({
                            ...inputs,
                            pension: {
                              ...inputs.pension,
                              claimTimingSelf: timing,
                              claimTimingSpouse: timing,
                            },
                          });
                        }}
                      >
                        <option value="early">
                          조기수령 ({claimStartAge('early', inputs.pension.currentAgeSelf)}세 개시 · 기본연금액의 70%)
                        </option>
                        <option value="normal">
                          정상수령 ({claimStartAge('normal', inputs.pension.currentAgeSelf)}세 개시 · 기본연금액의 100%)
                        </option>
                        <option value="deferred">
                          연기수령 ({claimStartAge('deferred', inputs.pension.currentAgeSelf)}세 개시 · 기본연금액의 136%)
                        </option>
                      </select>
                    </label>
                  </div>

                  <PrecisionTuners
                    group="C"
                    inputs={inputs}
                    onChange={onChange}
                  />
                </div>
              )}
            </div>
          )}

          {/* 하단 이전 / 다음 단계 네비게이션 바 */}
          <div className="wizard-card-footer">
            <button
              type="button"
              className="btn-secondary"
              disabled={currentStep === 1}
              onClick={() => setCurrentStep((s) => Math.max(1, s - 1))}
            >
              ← 이전 항목
            </button>

            <div className="wizard-footer-center num">
              {currentStep <= 2 && !activePresetId ? (
                <span>
                  단계 {currentStep} / 10 · 3~5단계에서 보유 자산·저축 입력 후 100세 예상 순자산이 표시됩니다
                </span>
              ) : (
                <>
                  <span>단계 {currentStep} / 10</span>
                  <WizardLiveChip plan={plan} />
                </>
              )}
            </div>

            <div className="wizard-footer-right">
              {returnToSummary && currentStep < 10 && (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ marginRight: 8 }}
                  onClick={() => setCurrentStep(11)}
                >
                  📋 요약 화면으로 돌아가기
                </button>
              )}
              <button
                type="button"
                className="btn-primary"
                onClick={() => setCurrentStep((s) => Math.min(11, s + 1))}
              >
                {currentStep === 10 ? '전체 입력 요약 확인 (Step 11) →' : '다음 항목 →'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Step 11: 전체 입력 완료 요약(Summary) 확인 화면 (요건 5) */
        <div className="wizard-summary-screen" aria-label="전체 입력 항목 요약 확인">
          <div className="wizard-summary-header">
            <div>
              <span className="wizard-category-badge">FINAL INPUT SUMMARY · STEP 11</span>
              <h2 className="wizard-question-title">입력하신 10개 항목의 전체 요약입니다</h2>
              <p className="wizard-question-sub">
                수정이 필요한 항목은 우측의 <strong>[수정 ✎]</strong> 버튼을 눌러 바로 변경할 수 있으며, 확인이 끝나면 하단의{' '}
                <strong>[핵심 결과 브리핑 보기]</strong>를 눌러주세요.
              </p>
            </div>
          </div>

          <div className="wizard-summary-grid">
            {summaryItems.map((item) => (
              <div key={item.step} className="wizard-summary-card">
                <div className="wizard-summary-card-top">
                  <span className="wizard-summary-step-title">{item.title}</span>
                  <div className="wizard-summary-badges">
                    <span
                      className={`wizard-status-chip ${item.isDefault ? 'chip-default' : 'chip-custom'}`}
                    >
                      {item.isDefault ? '기본 설정값' : '맞춤 입력됨'}
                    </span>
                    <button
                      type="button"
                      className="wizard-edit-jump-btn"
                      onClick={() => {
                        setReturnToSummary(true);
                        setCurrentStep(item.step);
                      }}
                    >
                      수정 ✎
                    </button>
                  </div>
                </div>
                <strong className="wizard-summary-primary num">{item.primaryValue}</strong>
                <p className="wizard-summary-detail">{item.detailText}</p>
              </div>
            ))}
          </div>

          <div className="wizard-summary-bottom-cta">
            <div className="wizard-summary-preview num">
              <div>
                <span>은퇴 시점(D-Day {plan.activeLedger.blueprint.retirementAgeSelf}세) 총 운용자본</span>
                <strong>
                  {formatDdayAmount(
                    plan.activeLedger.blueprint.totalCapitalAtRetirement,
                    plan.activeLedger.rows,
                    plan.activeLedger.blueprint.retirementAgeSelf,
                    inputs.transition.viewMode === 'real',
                  )}
                </strong>
              </div>
              <div>
                <span>{(inputs.hybrid.useAutoOptimalRatio ?? true) ? '권고' : '선택'} 개인 : 법인 배분 비율</span>
                <strong>
                  개인 {plan.activeLedger.personalRatio}% : 법인 {plan.activeLedger.corporateRatio}%
                </strong>
              </div>
              <div>
                <span>100세 예상 세후 가처분 순자산 ({inputs.transition.viewMode === 'real' ? '실질' : '명목'})</span>
                <strong className="text-accent">
                  {formatKRW(plan.activeLedger.finalDisposableNetWorth)}
                </strong>
              </div>
            </div>

            <div className="wizard-summary-cta-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCurrentStep(10)}
              >
                ← 10번 항목으로 돌아가기
              </button>
              <button
                type="button"
                className="btn-primary wizard-cta-large"
                onClick={onCompleteToGuide}
              >
                🎯 이 조건으로 핵심 결과 브리핑 보기 →
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
