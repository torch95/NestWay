import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  evaluateSensitivityBand,
  formatKRW,
  type OptimizationMasterPlan,
  type SimulationInputs,
} from '../engine';
import { Lens1AllocationTrack } from './Lens1AllocationTrack';
import { Lens2WaterfallLedger } from './Lens2WaterfallLedger';
import { Lens3StrategyMatrix } from './Lens3StrategyMatrix';
import { VerdictHeader, VerdictHero } from './VerdictHeader';
import { InfoPop } from './InfoPop';
import { SincereFilingGuide } from './SincereFilingGuide';
import { FlowSteps, HBarList, NetWorthSparkline, StackedBar, StackedRows } from './BriefingVisuals';
import { ISA_SEPARATE_TAX_PCT } from './ControlDock';
import {
  PLAN_B_MAX_DELAY_YEARS,
  PLAN_B_MAX_EXTRA_SAVINGS,
  VERDICT_SURVIVAL_MIN_PCT,
  claimStartAge,
  claimTimingLabel,
  computePlanBLevers,
  formatDdayAmount,
  optimalTradeoffNote,
  pickActiveCard,
  shouldShowPlanB,
  strategyCardPills,
  type PlanBLevers,
} from './planVerdict';

export type AnalysisTileKey = 'tile1' | 'tile2' | 'tile3' | 'tile4';

export interface ActionGuideViewProps {
  inputs: SimulationInputs;
  plan: OptimizationMasterPlan;
  snapshotA: OptimizationMasterPlan | null;
  guideSection?: 'briefing' | 'analytics';
  briefingStep?: number;
  onBriefingStepChange?: (step: number) => void;
  selectedTile?: AnalysisTileKey | null;
  isPrintMode?: boolean;
  onPrintReport?: () => void;
  onSelectTile?: (tile: AnalysisTileKey | null) => void;
  onSwitchToBriefing?: () => void;
  onSwitchToAnalytics?: () => void;
  onJumpToAnalyticsTile?: (tile: AnalysisTileKey) => void;
  onPinSnapshotA: () => void;
  onClearSnapshotA: () => void;
  onChangeInputs: (next: SimulationInputs) => void;
  onBackToWizard: () => void;
  onJumpToWizardStep?: (step: number) => void;
}

const BASKET_COLORS = {
  irp: '#0ea5e9',
  isa: '#10b981',
  personalPension: '#14b8a6',
  taxable: '#f59e0b',
  corporate: '#8b5cf6',
};

const CHECKLIST_STORAGE_KEY = 'retire_opt_checklist_v1';

interface BriefingSlideMeta {
  step: number;
  shortLabel: string;
  category: string;
  questionTitle: string;
  questionSub: string;
  targetTile: AnalysisTileKey;
  deepDiveLabel: string;
}

export const ActionGuideView: React.FC<ActionGuideViewProps> = ({
  inputs,
  plan,
  snapshotA,
  guideSection = 'analytics',
  briefingStep: briefingStepProp,
  onBriefingStepChange,
  selectedTile: selectedTileProp,
  isPrintMode: isPrintModeProp = false,
  onPrintReport,
  onSelectTile,
  onSwitchToBriefing,
  onSwitchToAnalytics,
  onJumpToAnalyticsTile,
  onPinSnapshotA,
  onClearSnapshotA,
  onChangeInputs,
  onBackToWizard,
  onJumpToWizardStep,
}) => {
  const [internalTile, setInternalTile] = useState<AnalysisTileKey | null>('tile1');
  const selectedTile = selectedTileProp !== undefined ? selectedTileProp : internalTile;
  const setSelectedTile = onSelectTile ?? setInternalTile;

  const [internalBriefingStep, setInternalBriefingStep] = useState<number>(1);
  const currentBriefingStep =
    briefingStepProp !== undefined ? briefingStepProp : internalBriefingStep;
  const setCurrentBriefingStep = (
    next: number | ((prev: number) => number)
  ) => {
    const resolved = typeof next === 'function' ? next(currentBriefingStep) : next;
    if (onBriefingStepChange) {
      onBriefingStepChange(resolved);
    } else {
      setInternalBriefingStep(resolved);
    }
  };

  // 좁은 화면(한 줄 가로 스크롤 탭)에서 현재 브리핑 탭이 항상 보이도록 탭바 안에서만 스크롤 (InputWizard 스텝바와 동일)
  const briefingStepperRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = briefingStepperRef.current;
    const btn = bar?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!bar || !btn || bar.scrollWidth <= bar.clientWidth) return;
    bar.scrollTo({ left: btn.offsetLeft - (bar.clientWidth - btn.offsetWidth) / 2, behavior: 'smooth' });
  }, [currentBriefingStep, guideSection]);

  const [showAnalyticsPlaybook, setShowAnalyticsPlaybook] = useState<boolean>(false);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(CHECKLIST_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore storage errors
    }
    return {};
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CHECKLIST_STORAGE_KEY);
      if (saved) setCheckedItems(JSON.parse(saved));
    } catch {
      // ignore storage errors
    }
  }, [guideSection]);

  const toggleCheck = (id: string) =>
    setCheckedItems((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });

  const [localPrintMode, setLocalPrintMode] = useState(false);
  const isPrintMode = isPrintModeProp || localPrintMode;

  useEffect(() => {
    const handleBeforePrint = () => setLocalPrintMode(true);
    const handleAfterPrint = () => setLocalPrintMode(false);
    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, []);

  const handlePrintReport = () => {
    if (onPrintReport) {
      onPrintReport();
      return;
    }
    setLocalPrintMode(true);
    window.setTimeout(() => {
      window.print();
    }, 60);
  };

  const { activeLedger, portfolio, corporateExit, pensionComparison } = plan;
  const returnShift = inputs.asset.returnShiftPct ?? 0;
  const { blueprint, rows } = activeLedger;
  const hasSpouse = inputs.pension.hasSpouse ?? true;
  const isReal = inputs.transition.viewMode === 'real';
  // X1: D-Day 스냅샷 금액은 엔진에서 명목 → 실질 모드에서는 해당 연차 discountFactor로 환산 병기
  const fmtDday = (amount: number) =>
    formatDdayAmount(amount, rows, blueprint.retirementAgeSelf, isReal);
  // 음수 여유분은 '−634만원/월 여유'가 아니라 '월 634만원 부족'으로 표기
  const isNoCorpPlan = activeLedger.corporateRatio === 0; // B5: 법인 미설립 최적안이면 법인 출구 수치는 참고치
  const fmtMonthlyBuffer = (b: number) => (b >= 0 ? `+${formatKRW(b)}/월 여유` : `월 ${formatKRW(-b)} 부족`);

  const growthRatio = Math.round(inputs.asset.growthEtfRatio ?? 70);
  const divRatio = Math.max(0, 100 - growthRatio);
  const isDetailedPortfolio =
    inputs.asset.inputMode === 'detailed' && (inputs.asset.holdings?.length ?? 0) > 0;

  // STEP 1 계산: 은퇴 전 연간 절세계좌 납입액 및 초과 저축액
  const annualSavingsTotal = (inputs.transition.preRetirementMonthlySavings || 0) * 12;
  const annualIsaAdd =
    (inputs.accounts.selfIsaAnnualAddition || 0) +
    (hasSpouse ? inputs.accounts.spouseIsaAnnualAddition || 0 : 0);
  const annualPensionAdd =
    (inputs.accounts.selfPersonalPensionAnnualAddition || 0) +
    (hasSpouse ? inputs.accounts.spousePersonalPensionAnnualAddition || 0 : 0);
  const annualExcessSavings = Math.max(0, annualSavingsTotal - annualIsaAdd - annualPensionAdd);

  // STEP 2 계산: D-Day 5대 계좌 배분 표 및 원금·적립·수익 브릿지 산출
  const initialIrp =
    Math.max(0, Math.round(inputs.accounts.selfRetirementPensionBalance || 0)) +
    (hasSpouse ? Math.max(0, Math.round(inputs.accounts.spouseRetirementPensionBalance || 0)) : 0);
  const totalSeveranceGross =
    Math.max(0, Math.round(inputs.transition.expectedSeverancePay || 0)) +
    (hasSpouse ? Math.max(0, Math.round(inputs.transition.spouseExpectedSeverancePay || 0)) : 0);
  const severanceAddIrp = inputs.transition.severanceTransferToIrp
    ? totalSeveranceGross
    : 0;
  const irpNetReturn = Math.max(0, blueprint.allocIrp - initialIrp - severanceAddIrp);

  const initialIsa =
    Math.max(0, Math.round(inputs.accounts.selfIsaBalance || 0)) +
    (hasSpouse ? Math.max(0, Math.round(inputs.accounts.spouseIsaBalance || 0)) : 0);
  const selfIsaAdded = Math.min(
    Math.max(0, 100_000_000 - Math.max(0, Math.round(inputs.accounts.selfIsaBalance || 0))),
    Math.max(0, Math.round(inputs.accounts.selfIsaAnnualAddition || 0)) * blueprint.yearsToRetirement
  );
  const spouseIsaAdded = hasSpouse
    ? Math.min(
        Math.max(0, 100_000_000 - Math.max(0, Math.round(inputs.accounts.spouseIsaBalance || 0))),
        Math.max(0, Math.round(inputs.accounts.spouseIsaAnnualAddition || 0)) * blueprint.yearsToRetirement
      )
    : 0;
  const totalIsaAdded = selfIsaAdded + spouseIsaAdded;
  const isaNetReturn = Math.max(0, blueprint.allocIsa - initialIsa - totalIsaAdded);

  const initialPension =
    Math.max(0, Math.round(inputs.accounts.selfPersonalPensionBalance || 0)) +
    (hasSpouse ? Math.max(0, Math.round(inputs.accounts.spousePersonalPensionBalance || 0)) : 0);
  const totalPensionAdded = annualPensionAdd * blueprint.yearsToRetirement;
  const pensionNetReturn = Math.max(
    0,
    blueprint.allocPersonalPension - initialPension - totalPensionAdded
  );

  const isDeferredCorp =
    inputs.corporate.injectionTiming === 'retirement' &&
    blueprint.yearsToRetirement > 0 &&
    blueprint.corporateRatio > 0;
  const initialFreeInv = Math.max(0, Math.round(inputs.asset.totalInvestment || 0));
  const initialTaxable = isDeferredCorp
    ? initialFreeInv
    : Math.round(initialFreeInv * (blueprint.personalRatio / 100));
  const initialCorp = initialFreeInv - initialTaxable;
  const totalCorpAdded = Math.max(0, blueprint.corporatePaidInCapital - initialCorp);
  const corpNetReturn = Math.max(0, blueprint.allocCorporate - blueprint.corporatePaidInCapital);

  const totalEmployedSavings = annualSavingsTotal * blueprint.yearsToRetirement;
  const nonIrpSeveranceAdd = !inputs.transition.severanceTransferToIrp
    ? totalSeveranceGross
    : 0;
  const totalTaxableAdded =
    Math.max(
      0,
      totalEmployedSavings -
        totalIsaAdded -
        totalPensionAdded -
        (isDeferredCorp ? 0 : totalCorpAdded)
    ) + nonIrpSeveranceAdd;
  const taxableNetReturn = Math.max(
    0,
    blueprint.allocTaxable - initialTaxable - totalTaxableAdded
  );

  const dDayRow = activeLedger.rows.find((r) => r.ageSelf === blueprint.retirementAgeSelf);
  const dDayScale = isReal ? (dDayRow?.discountFactor ?? 1) : 1;
  const scaleDday = (v: number) => Math.round(v * dDayScale);

  const bTotal = Math.max(
    1,
    blueprint.allocIrp +
      blueprint.allocIsa +
      blueprint.allocPersonalPension +
      blueprint.allocTaxable +
      blueprint.allocCorporate
  );
  const basketItems = [
    {
      key: 'irp',
      stepBadge: '계좌 1',
      title: '퇴직연금 IRP',
      color: BASKET_COLORS.irp,
      amount: blueprint.allocIrp,
      pct: Number(((blueprint.allocIrp / bTotal) * 100).toFixed(1)),
      bridgeText: `초기 ${formatKRW(initialIrp)} + 퇴직금이체 ${formatKRW(severanceAddIrp)} + 복리수익 ${formatKRW(irpNetReturn)}`,
      actionTitle: '퇴직급여 전액 이체 및 만 55세 이후 연금 인출',
      actionDetail: '일시 수령 대신 연금으로 수령해 퇴직소득세를 30~40% 감면받고 건보료 과표에서 제외합니다.',
    },
    {
      key: 'isa',
      stepBadge: '계좌 2',
      title: '중개형 ISA (부부 합산)',
      color: BASKET_COLORS.isa,
      amount: blueprint.allocIsa,
      pct: Number(((blueprint.allocIsa / bTotal) * 100).toFixed(1)),
      bridgeText: `초기 ${formatKRW(initialIsa)} + 적립 ${formatKRW(totalIsaAdded)} + 복리수익 ${formatKRW(isaNetReturn)}`,
      actionTitle:
        inputs.transition.targetRetirementAgeSelf < 55
          ? '인당 원금 1억 한도 채우기 · 55세 전 크레바스 1순위 가교'
          : '인당 원금 1억 한도 채우기 · 연금 저율한도 인출 후 비과세 보충',
      actionDetail: `배당·매매차익 비과세 후 ${ISA_SEPARATE_TAX_PCT}% 분리과세되며, 건강보험료 소득 산정에서 완전히 제외됩니다.`,
    },
    {
      key: 'personalPension',
      stepBadge: '계좌 3',
      title: '개인연금저축',
      color: BASKET_COLORS.personalPension,
      amount: blueprint.allocPersonalPension,
      pct: Number(((blueprint.allocPersonalPension / bTotal) * 100).toFixed(1)),
      bridgeText: `초기 ${formatKRW(initialPension)} + 적립 ${formatKRW(totalPensionAdded)} + 복리수익 ${formatKRW(pensionNetReturn)}`,
      actionTitle: `만 55세부터 ${hasSpouse ? '부부 연 3,000만' : '연 1,500만'} 한도 인출`,
      actionDetail: '사적연금 저율 분리과세(3.3~5.5%) 구간 내에서만 인출하여 종합소득세 합산을 방지합니다.',
    },
    {
      key: 'taxable',
      stepBadge: '계좌 4',
      title: '개인 일반과세계좌',
      color: BASKET_COLORS.taxable,
      amount: blueprint.allocTaxable,
      pct: Number(((blueprint.allocTaxable / bTotal) * 100).toFixed(1)),
      bridgeText: isDeferredCorp
        ? `재직기 100% 적립(초기 ${formatKRW(initialTaxable)} + 적립 ${formatKRW(totalTaxableAdded)}) 후 D-Day ${blueprint.corporateRatio}% 법인 이전`
        : `초기 ${formatKRW(initialTaxable)} + 적립 ${formatKRW(totalTaxableAdded)} + 세후수익 ${formatKRW(taxableNetReturn)}`,
      actionTitle: `일반자금의 ${blueprint.personalRatio}% 배치 · 해외상장 ETF 중심`,
      actionDetail: '해외직투 ETF는 연 250만원 기본공제 후 22% 양도세로 분리과세되어 건보료가 부과되지 않습니다.',
    },
    {
      key: 'corporate',
      stepBadge: '계좌 5',
      title: '가족법인 계좌 (주주 대여금/가수금)',
      color: BASKET_COLORS.corporate,
      amount: blueprint.allocCorporate,
      pct: Number(((blueprint.allocCorporate / bTotal) * 100).toFixed(1)),
      bridgeText: isDeferredCorp
        ? `재직기 0원 → 은퇴 D-Day 일괄 이전(세후 출자원금 ${formatKRW(blueprint.corporatePaidInCapital)})`
        : `초기 ${formatKRW(initialCorp)} + 적립 ${formatKRW(totalCorpAdded)} + 세후수익 ${formatKRW(corpNetReturn)}`,
      actionTitle: `일반자금의 ${blueprint.corporateRatio}% 배치 · 출자원금 ${formatKRW(blueprint.corporatePaidInCapital)}`,
      actionDetail: '법인가수금(출자원금)은 세금·건보료 0원으로 비과세 선회수하고, 임원 급여로 지역건보료를 방어합니다.',
    },
  ];

  // STEP 3 계산: 은퇴 후 대표 연령대 행 추출
  const firstRetiredRow = rows.find((r) => !r.isEmployed) ?? rows[0];
  const pensionClaimAge = claimStartAge(inputs.pension.claimTimingSelf, inputs.pension.currentAgeSelf); // B6
  const pensionStartRow =
    rows.find((r) => r.ageSelf === pensionClaimAge) ?? rows[rows.length - 1];

  const corpMonthlyNetSalary =
    blueprint.corporateRatio > 0 && firstRetiredRow
      ? Math.round(
          (firstRetiredRow.stage2CorpNetSalary *
            (isReal ? firstRetiredRow.discountFactor : 1)) /
            12
        )
      : 0;
  const firstMonthlyPublicPension = pensionStartRow
    ? Math.round(
        (pensionStartRow.publicPensionInflow *
          (isReal ? pensionStartRow.discountFactor : 1)) /
          12
      )
    : 0;

  const advOverCorp100 = Math.max(
    0,
    activeLedger.finalDisposableNetWorth - plan.corporate100.finalDisposableNetWorth
  );
  const isMicroSplitPractical =
    blueprint.personalRatio > 0 &&
    blueprint.personalRatio <= 5 &&
    advOverCorp100 < Math.max(10_000_000, Math.round(activeLedger.finalDisposableNetWorth * 0.005));

  // 한 줄 액션 헤드라인
  const headlineText =
    plan.allocationStatus === 'ALL_DEPLETE'
      ? `⚠️ 현 조건(월 생활비·은퇴 시점·자산)에서는 어떤 개인:법인 배분도 100세까지 지속되지 않습니다 (최장 보존 배분에서도 ${activeLedger.depletionAgeSelf ?? '-'}세 고갈). 생활비를 줄이거나 은퇴 시점을 늦춰 다시 계산하세요.`
      : blueprint.corporateRatio === 0
      ? '법인 설립 없이 절세계좌 3종(IRP·ISA·연금저축)을 채우고 개인 100%로 운용하세요.'
      : blueprint.personalRatio === 0
        ? '절세계좌 3종을 먼저 채운 뒤, 일반 금융자산은 가족법인 100%(가수금 비과세 회수)로 운용하세요.'
        : isMicroSplitPractical
          ? `절세계좌 3종을 최우선 채우고, 일반 금융자산은 개인 ${blueprint.personalRatio}% : 가족법인 ${blueprint.corporateRatio}%로 배분하거나 실무상 가족법인 100%로 통합 운용하세요 (50년 세후 차이 +${formatKRW(advOverCorp100)} 미만 — 개인 ${blueprint.personalRatio}%는 연 250만 양도세 기본공제용 소액 배분).`
          : `절세계좌 3종을 최우선 채우고, 일반 금융자산은 개인 ${blueprint.personalRatio}% : 가족법인 ${blueprint.corporateRatio}%로 나누어 운용하세요.`;

  const slide1Sensitivity = useMemo(
    () => evaluateSensitivityBand(plan.inputs, activeLedger.personalRatio),
    [plan.inputs, activeLedger.personalRatio]
  );

  // 4대 상세 분석 타일 정의 (요건: 출력 2)
  const analysisTiles: {
    key: AnalysisTileKey;
    badge: string;
    title: string;
    kpiLabel: string;
    kpiValue: string;
    description: string;
  }[] = [
    {
      key: 'tile1',
      badge: '분석 01 · 배분 비율 & 순자산 궤적',
      title: '개인 vs 법인 최적 비율 비교',
      kpiLabel: '최적 배분 비율 (r*)',
      kpiValue: `개인 ${plan.optimalHybrid.personalRatio}% : 법인 ${plan.optimalHybrid.corporateRatio}%`,
      description: '개인 100% · 법인 100% · 최적 혼합 3대 전략 비교표, 황금분할 효율 곡선, 100세 순자산 추이 차트',
    },
    {
      key: 'tile2',
      badge: '분석 02 · 계좌별 추이 & 세금·건보료',
      title: '5대 계좌 잔액 & 인출 워터폴 차트',
      kpiLabel: '평생 세금·건보료 절감액',
      kpiValue: `+${formatKRW(activeLedger.totalLifetimeTaxAndHealthSaved)}`,
      description: '연령별 5대 바스켓 적층 자산 차트, 8단계 인출 원천 워터폴 차트, 연간 세금·건보·유지비 추이',
    },
    {
      key: 'tile3',
      badge: '분석 03 · 법인 출구 · 연금 · 임원 전략',
      title: '출구전략 · 연금시기 · A/B 비교',
      kpiLabel: '추천 국민연금 개시 / 법인 임원',
      kpiValue: `${claimTimingLabel(pensionComparison.recommendedTiming, inputs.pension.currentAgeSelf).replace('수령', '')} · ${isNoCorpPlan ? '법인 미설립' : `임원 ${plan.executiveComparison.recommendedCount}인`}`,
      description: isNoCorpPlan
        ? `현재 최적안은 법인 미설립 — 법인 4대 출구전략은 법인 100% 가정 참고치(최대 +${formatKRW(corporateExit.maxTaxSavedVsSimpleGross)}), 연금 추납 ROI, 시나리오 A/B 비교`
        : `법인 4대 출구전략(최대 +${formatKRW(corporateExit.maxTaxSavedVsSimpleGross)} 절세), 연금 추납 ROI, 시나리오 A/B 비교`,
    },
    {
      key: 'tile4',
      badge: '분석 04 · 51개년 정밀 데이터 원장',
      title: '연차별 현금흐름 원장 표 & CSV',
      kpiLabel: `${inputs.pension.currentAgeSelf}세~100세 (${rows.length}개년) 회계오차`,
      kpiValue: `${activeLedger.maxAccountingResidualAbs}원 (완전 일치)`,
      description: '50세부터 100세까지 매년 수입·지출·8단계 인출·세금·건보료·5대 계좌 기말잔액 전체 표 및 CSV 다운로드',
    },
  ];

  const handleTileClick = (key: AnalysisTileKey) => {
    setSelectedTile(selectedTile === key ? null : key);
  };

  const handleJumpToAnalytics = (tile: AnalysisTileKey) => {
    setSelectedTile(tile);
    if (onJumpToAnalyticsTile) {
      onJumpToAnalyticsTile(tile);
    } else if (onSwitchToAnalytics) {
      onSwitchToAnalytics();
    }
  };

  const BRIEFING_SLIDES: BriefingSlideMeta[] = [
    {
      step: 1,
      shortLabel: '1. 종합 판정',
      category: '결과 브리핑 01 / 06 · 100세 은퇴 안전성 종합 판정',
      questionTitle: '내 은퇴 계획은 100세까지 안전한가요?',
      questionSub:
        '현재 입력하신 자산·저축·생활비 조건에서 100세까지 자산 고갈 여부와 지속가능한 최대 월생활비를 먼저 확인합니다.',
      targetTile: 'tile1',
      deepDiveLabel: '분석 01 · 배분 비율 & 100세 순자산 궤적 차트',
    },
    {
      step: 2,
      shortLabel: '2. 은퇴 전 적립 공식',
      category: '결과 브리핑 02 / 06 · STEP 01 은퇴 전 연간 저축 & 투자 공식',
      questionTitle: '은퇴 전까지 매년 어디에 얼마를 넣어야 하나요?',
      questionSub: `현재(${inputs.pension.currentAgeSelf}세)부터 은퇴(${blueprint.retirementAgeSelf}세)까지 ${blueprint.yearsToRetirement}년 동안 세금과 건보료를 아끼는 연간 적립 공식입니다.`,
      targetTile: 'tile2',
      deepDiveLabel: '분석 02 · 연령별 5대 계좌 적립 추이 차트',
    },
    {
      step: 3,
      shortLabel: '3. 은퇴 D-Day 5대 계좌',
      category: '결과 브리핑 03 / 06 · STEP 02 은퇴 당일 5대 금융계좌 최종 배치표',
      questionTitle: `은퇴 당일(D-Day ${blueprint.retirementAgeSelf}세), 모은 금융자산을 5개 계좌에 어떻게 나누나요?`,
      questionSub: `은퇴 시점 총 금융자산 ${fmtDday(blueprint.totalCapitalAtRetirement)}을 세금·건보료 특성이 다른 5개 바구니에 최적 배치한 결과입니다.`,
      targetTile: 'tile2',
      deepDiveLabel: '분석 02 · 5대 계좌 잔액 추이 & 워터폴 차트',
    },
    {
      step: 4,
      shortLabel: '4. 은퇴 후 월 인출 순서',
      category: '결과 브리핑 04 / 06 · STEP 03 은퇴 후 월별 생활비 인출 공식',
      questionTitle: `은퇴 후 매달 목표 생활비(${Math.round(inputs.cashflow.targetNetMonthlyLivingExpense / 10_000).toLocaleString()}만원)는 어떤 순서로 꺼내 쓰나요?`,
      questionSub:
        '종합소득세 합산과세와 지역건강보험료 피부양자 탈락을 막기 위해 반드시 지켜야 할 3단계 인출 우선순위입니다.',
      targetTile: 'tile2',
      deepDiveLabel: '분석 02 · 8단계 인출 원천 워터폴 & 세금 추이',
    },
    {
      step: 5,
      shortLabel: '5. 개인 vs 법인 절세 실익',
      category: '결과 브리핑 05 / 06 · 개인 100% vs 최적 황금비율(r*) vs 법인 100% 비교',
      questionTitle: '개인 단독 운용 대비 절세계좌·가족법인을 활용하면 평생 얼마를 아끼나요?',
      questionSub:
        '동일한 투자 수익률에서 계좌 구조(개인 vs 법인 배분 비율)만 바꿨을 때 100세 최종 세후 순자산과 평생 세금·건보료 차이를 비교합니다.',
      targetTile: 'tile1',
      deepDiveLabel: '분석 01 · 0~100% 황금분할 배분 효율 곡선 & 손익분기 진단',
    },
    {
      step: 6,
      shortLabel: '6. 실행 체크리스트 & 요약',
      category: '결과 브리핑 06 / 06 · 생애 실행 체크리스트 & 심층 분석 허브',
      questionTitle: '오늘 당장 무엇부터 실행하면 되나요?',
      questionSub:
        '국민연금 최적 개시 시기, 법인 출구전략, 생애 단계별 실행 체크리스트를 점검하고 필요 시 51개년 상세 원장으로 이동합니다.',
      targetTile: 'tile3',
      deepDiveLabel: '분석 03 · 법인 출구전략 · 연금개시 · 시나리오 A/B 비교',
    },
  ];

  const activeSlide =
    BRIEFING_SLIDES[Math.min(BRIEFING_SLIDES.length - 1, Math.max(0, currentBriefingStep - 1))];

  // 연령대별 마일스톤 순자산 요약 (Slide 1용)
  const milestoneAges = Array.from(
    new Set([blueprint.retirementAgeSelf, 65, 75, 85, 100])
  ).sort((a, b) => a - b);
  const milestoneSnapshots = milestoneAges.map((age) => {
    const r = rows.find((row) => row.ageSelf === age) ?? rows[rows.length - 1];
    const dispVal = r
      ? Math.round(r.endDisposableNetWorth * (isReal ? r.discountFactor : 1))
      : 0;
    return {
      age,
      label: age === blueprint.retirementAgeSelf ? `${age}세 (은퇴 D-Day)` : `${age}세`,
      value: dispVal,
    };
  });

  // 브리핑 간결화: 연간 적립 배분 (ISA · 연금저축 · 잔여 저축 개인/법인)
  const savingsToTaxable = isDeferredCorp
    ? annualExcessSavings
    : Math.round((annualExcessSavings * blueprint.personalRatio) / 100);
  const savingsSegments = [
    { key: 'isa', label: '중개형 ISA', value: annualIsaAdd, color: BASKET_COLORS.isa },
    { key: 'pension', label: '연금저축', value: annualPensionAdd, color: BASKET_COLORS.personalPension },
    { key: 'taxable', label: '개인 일반계좌', value: savingsToTaxable, color: BASKET_COLORS.taxable },
    { key: 'corp', label: '가족법인 출자', value: annualExcessSavings - savingsToTaxable, color: BASKET_COLORS.corporate },
  ];
  // 브리핑 간결화: 나이별 인출 재원(원장 1~8단계) 행
  const withdrawalSourceRows = Array.from(
    new Set([blueprint.retirementAgeSelf, 70, 80, 90, rows[rows.length - 1]?.ageSelf ?? 100])
  )
    .filter((age) => age >= blueprint.retirementAgeSelf)
    .sort((a, b) => a - b)
    .map((age) => {
      const r = rows.find((row) => row.ageSelf === age);
      const values: Record<string, number> = r
          ? {
              pub: r.stage1PublicAndHousingPension,
              sal: r.stage2CorpNetSalary,
              pen: r.stage3IrpWithdrawal + r.stage5PersonalPensionWithdrawal,
              isa: r.stage4IsaWithdrawal,
              tax: r.stage6OverseasTaxableWithdrawal + r.stage7DomesticTaxableWithdrawal,
              corp: r.stage8CorpFallbackDividend,
            }
          : {};
      return { key: String(age), label: `${age}세`, values };
    });

  // STEP 1 카드 렌더러 (Slide 2 및 전체 인쇄/요약 공용)
  const renderStep1Card = () => (
    <div className="playbook-step-card">
      <div className="playbook-step-header">
        <span className="playbook-step-num">STEP 01 · 은퇴 전 적립 공식</span>
        <span className="playbook-step-period num">
          {blueprint.yearsToRetirement > 0
            ? `현재 ${inputs.pension.currentAgeSelf}세 → 은퇴 ${blueprint.retirementAgeSelf}세 (${blueprint.yearsToRetirement}년간)`
            : `즉시 은퇴 (${blueprint.retirementAgeSelf}세 기준)`}
        </span>
      </div>
      <h3 className="playbook-step-title">은퇴 전까지 매년 이렇게 적립하세요</h3>
      <ul className="playbook-action-list num">
        <li>
          <strong>① 절세계좌 한도 우선 입금:</strong> 매년 중개형 ISA에{' '}
          <span className="text-accent">{formatKRW(annualIsaAdd)}</span>(인당 누적원금 1억 한도), 연금저축에{' '}
          <span className="text-accent">{formatKRW(annualPensionAdd)}</span>을 최우선 납입합니다.
        </li>
        <li>
          {isDeferredCorp && blueprint.corporateRatio > 0 ? (
            <>
              <strong>② 잔여 저축액 전액 일반계좌 적립 (은퇴 D-Day 법인 설립):</strong> 연간 총 저축액({formatKRW(annualSavingsTotal)}) 중 절세계좌 납입 후 남는{' '}
              <strong>{formatKRW(annualExcessSavings)}/년</strong>은 재직 중 개인 일반계좌에 <strong>100%</strong> 적립하고, 은퇴 당일({blueprint.retirementAgeSelf}세)에 일반계좌의 <strong>{blueprint.corporateRatio}%</strong>를 매도(양도세 정산 후 세후 <span className="text-accent">{formatKRW(blueprint.corporatePaidInCapital)}</span>)하여 가족법인 출자원금으로 일괄 이전합니다.
            </>
          ) : (
            <>
              <strong>② 잔여 저축액 분할 적립:</strong> 연간 총 저축액({formatKRW(annualSavingsTotal)}) 중 절세계좌 납입 후 남는{' '}
              <strong>{formatKRW(annualExcessSavings)}/년</strong>은 개인 일반계좌{' '}
              <strong>{blueprint.personalRatio}%</strong> : 가족법인 출자원금{' '}
              <strong>{blueprint.corporateRatio}%</strong> 비율로 나누어 넣습니다.
            </>
          )}
        </li>
        <li>
          <strong>③ 포트폴리오 상품 구성:</strong>{' '}
          {isDetailedPortfolio ? (
            <>
              5대 계좌 모두 <strong>직접 구성한 ETF {inputs.asset.holdings?.length ?? 0}종</strong> 비중(가중평균 기대수익률{' '}
              <strong>연 {portfolio.effectiveTotalReturn.toFixed(2)}%{returnShift ? ` → 시나리오 적용 연 ${(portfolio.effectiveTotalReturn + returnShift).toFixed(2)}%` : ''}</strong>, 실부담보수 {portfolio.weightedExpenseRatio.toFixed(3)}%,
              해외상장 직접투자 {portfolio.overseasDirectRatio.toFixed(0)}%)으로 운용합니다.
            </>
          ) : (
            <>
              5대 계좌 모두 <strong>성장형 ETF {growthRatio}% : 배당형 ETF {divRatio}%</strong>{' '}
              비중(가중평균 기대수익률 <strong>연 {portfolio.effectiveTotalReturn.toFixed(2)}%{returnShift ? ` → 시나리오 적용 연 ${(portfolio.effectiveTotalReturn + returnShift).toFixed(2)}%` : ''}</strong>, 해외상장 직접투자{' '}
              {portfolio.overseasDirectRatio.toFixed(0)}%)으로 운용합니다.
            </>
          )}
        </li>
        {totalSeveranceGross > 0 && (
          <li>
            <strong>④ 은퇴 당일 퇴직급여 이체:</strong> 은퇴 시점({blueprint.retirementAgeSelf}세) 예상 퇴직금 합계{' '}
            <span className="text-accent">{formatKRW(totalSeveranceGross)}</span>
            {hasSpouse && (inputs.transition.spouseExpectedSeverancePay || 0) > 0
              ? ` (본인 ${formatKRW(inputs.transition.expectedSeverancePay || 0)} + 배우자 ${formatKRW(inputs.transition.spouseExpectedSeverancePay || 0)})`
              : ''}
            은{' '}
            {inputs.transition.severanceTransferToIrp
              ? '전액 퇴직연금 IRP로 이체하여 과세를 이연합니다.'
              : '퇴직소득세 원천징수 후 일반과세계좌에 편입합니다.'}
          </li>
        )}
      </ul>
    </div>
  );

  // STEP 3 카드 렌더러 (Slide 4 및 전체 인쇄/요약 공용)
  const renderStep3Card = () => (
    <div className="playbook-step-card">
      <div className="playbook-step-header">
        <span className="playbook-step-num">STEP 03 · 은퇴 후 월 인출 공식</span>
        <span className="playbook-step-period num">
          {blueprint.retirementAgeSelf}세 ~ 100세 · 목표 월{' '}
          {Math.round(inputs.cashflow.targetNetMonthlyLivingExpense / 10_000).toLocaleString()}만원
        </span>
      </div>
      <h3 className="playbook-step-title">은퇴 후 생활비는 이 순서로 꺼내 쓰세요</h3>
      <ul className="playbook-action-list num">
        <li>
          <strong>1순위 (고정 현금흐름):</strong> 국민연금({pensionClaimAge}세 개시, 월 약{' '}
          <span className="text-accent">{formatKRW(firstMonthlyPublicPension)}</span>) +{' '}
          {blueprint.corporateRatio > 0
            ? `가족법인 임원 실수령 월급(${inputs.corporate.executiveCount}인 합산 월 ${formatKRW(corpMonthlyNetSalary)})`
            : '개인계좌 세후 배당금'}
          으로 기본 생활비를 먼저 충당합니다.
        </li>
        <li>
          <strong>2순위 (만 55세 이후 저율 사적연금·IRP):</strong> 연금저축·IRP 운용수익분은{' '}
          <strong>{hasSpouse ? '부부 합산 연 3,000만원(인당 1,500만원)' : '연 1,500만원'}</strong> 한도 내에서 3.3~5.5% 저율 분리과세로 인출하고, IRP 내 <strong>이연퇴직금 원금은 10년 연금수령한도에 맞춰 30~40% 감면세율(약 3.6~4.2%)</strong>로 평탄화 인출합니다. (55세 이전에는 16.5% 페널티 방지를 위해 인출 중지)
        </li>
        <li>
          <strong>3순위 (비과세 원금 · 분리과세 보충):</strong> 부족분은{' '}
          {blueprint.retirementAgeSelf < 55 ? (
            <span>
              55세 전 크레바스 구간에는 중개형 ISA를 1순위로 인출해 연금 중도해지 페널티(16.5%)를 피하고, 만 55세부터는 ① 연금저축·IRP 저율한도(인당 연 1,500만 · 3.3~5.5% + 이연퇴직소득 10년 분할 감면) 선인출 ➔ ② 부족분만 중개형 ISA 보충 ➔ ③ 법인 출자원금 비과세 회수 ➔ ④ 일반계좌 순으로 인출합니다.
            </span>
          ) : (
            <span>
              ① 연금저축·IRP 저율한도({hasSpouse ? '부부 최대 연 3,000만' : '연 1,500만'} · 3.3~5.5% + 이연퇴직소득 감면, 건보료 0원) 선인출 ➔ ② 부족분만 중개형 ISA 비과세 보충(잔여분 영구 복리 보존) ➔{' '}
              {blueprint.corporateRatio > 0
                ? `③ 법인 출자원금(${formatKRW(scaleDday(blueprint.corporatePaidInCapital))}) 무세금 회수 ➔ ④ 일반계좌 해외ETF`
                : '③ 일반계좌 해외ETF(연 250만 공제)'}
            </span>
          )}{' '}
          순서로 인출해 건보료 추가 부과를 차단합니다.
        </li>
      </ul>
    </div>
  );

  // STEP 2 D-Day 5대 계좌 박스 렌더러 (Slide 3 및 전체 인쇄/요약 공용)
  const renderStep2DdayBox = () => (
    <div className="playbook-dday-box">
      <div className="playbook-dday-header">
        <div>
          <span className="playbook-step-num">
            STEP 02 · 은퇴 당일 (D-Day {blueprint.retirementAgeSelf}세) 5대 금융계좌 최종 배치표
          </span>
          <h3 className="playbook-step-title">
            은퇴 시점 총 금융자산 <span className="text-accent num">{fmtDday(blueprint.totalCapitalAtRetirement)}</span>을 아래 5개 계좌로 구성하세요
          </h3>
          {isReal && (
            <span className="playbook-dday-caption">
              ※ 5대 계좌 금액도 현재 물가(실질 구매력) 기준으로 환산해 합계를 일치시켰습니다 · 은퇴 당일 명목 총액 {formatDdayAmount(blueprint.totalCapitalAtRetirement, rows, blueprint.retirementAgeSelf, false)}
            </span>
          )}
        </div>
        <span className="playbook-dday-caption num">{blueprint.isaStrategySummary}</span>
      </div>

      <div className="blueprint-stack-bar" role="img" aria-label="은퇴 시점 5대 금융계좌 배치 비율">
        {basketItems.map((b) =>
          b.pct > 0 ? (
            <div
              key={b.key}
              className="blueprint-segment"
              style={{ width: `${Math.max(3, b.pct)}%`, background: b.color }}
              title={`${b.title}: ${formatKRW(scaleDday(b.amount))} (${b.pct}%)`}
            />
          ) : null
        )}
      </div>

      <div className="action-basket-grid">
        {basketItems.map((b) => (
          <div key={b.key} className="action-basket-card">
            <div className="action-basket-top">
              <span className="legend-dot" style={{ background: b.color }} />
              <span className="action-basket-badge">{b.stepBadge}</span>
              <span className="action-basket-pct num">{b.pct}%</span>
            </div>
            <strong className="action-basket-name">{b.title}</strong>
            <div className="action-basket-amount num">
              {formatKRW(scaleDday(b.amount))}
              {isReal && dDayScale < 0.999 && (
                <span className="bv-sub-note" style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-muted)' }}>
                  (명목 {formatKRW(b.amount)})
                </span>
              )}
            </div>
            <div className="action-basket-bridge num">{b.bridgeText}</div>
            <div className="action-basket-rule-title">{b.actionTitle}</div>
            <p className="action-basket-rule-desc">{b.actionDetail}</p>
          </div>
        ))}
      </div>
    </div>
  );

  const jumpBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    padding: 0,
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
    textDecoration: 'underline',
    textDecorationStyle: 'dotted',
    textUnderlineOffset: '3px',
  };

  const strategyCards = [plan.cards.personal, plan.cards.hybrid, plan.cards.corporate];

  // U-1: 활성 비율 카드(엔진 plan.activeCard) — Tile 1·Slide 1 여유분·Plan B 판정의 단일 정본
  const activeStrategyCard = pickActiveCard(plan);

  // C3: Plan B 단일 레버 정량 해소치 — 기존 Plan B 블록(shouldShowPlanB) 안에서 처음 그릴 때 한 번만 계산 (원장 약 30회, 실측 ≈ 15ms)
  const getPlanBLevers = useMemo(() => {
    let cached: PlanBLevers | null = null;
    return () => (cached ??= computePlanBLevers(plan.inputs, activeLedger.personalRatio));
  }, [plan.inputs, activeLedger.personalRatio]);
  const renderPlanBLevers = () => {
    const planBLevers = getPlanBLevers();
    if (planBLevers.deterministicMet) {
      return (
        <div className="plan-b-quant-levers" role="note">
          <span>
            기본 원장으로는 100세까지 고갈 없이 월 100만 원 이상 여유가 있습니다. &apos;주의&apos; 판정은 시장 변동(100세
            생존확률 {slide1Sensitivity.survivalProbabilityPercent}%) 때문이므로 하락장 대응 레버를 먼저 검토하세요.
          </span>
        </div>
      );
    }
    const target = plan.inputs.cashflow.targetNetMonthlyLivingExpense;
    const retireAge = plan.inputs.transition.targetRetirementAgeSelf;
    const { livingCut, retireDelayYears, savingsApplicable, extraMonthlySavings } = planBLevers;
    return (
      <div className="plan-b-quant-levers" role="note">
        <strong>아래 중 하나만 바꿔도 해소됩니다</strong>
        <ul>
          <li>
            {livingCut !== null ? (
              <>
                은퇴 후 월 생활비 <b>−{formatKRW(livingCut)}</b> (월 {formatKRW(target)} → {formatKRW(target - livingCut)},
                현재가치)
              </>
            ) : (
              '은퇴 후 생활비 조정만으로는 해소되지 않습니다'
            )}
          </li>
          <li>
            {retireDelayYears !== null ? (
              <>
                은퇴 <b>+{retireDelayYears}년</b> ({retireAge}세 → {retireAge + retireDelayYears}세)
              </>
            ) : (
              `은퇴를 ${PLAN_B_MAX_DELAY_YEARS}년 늦춰도 해소되지 않습니다`
            )}
          </li>
          {savingsApplicable && (
            <li>
              {extraMonthlySavings !== null ? (
                <>
                  은퇴 전 월 저축 <b>+{formatKRW(extraMonthlySavings)}</b>
                </>
              ) : (
                `은퇴 전 월 저축을 ${formatKRW(PLAN_B_MAX_EXTRA_SAVINGS)} 늘려도 해소되지 않습니다`
              )}
            </li>
          )}
        </ul>
        <span className="plan-b-quant-caption">
          해소 기준: 100세까지 고갈 없이 월 여유 100만 원 이상 · 나머지 조건과 개인:법인 비율은 그대로 · 시장 변동(생존확률)
          판정은 별도라 &apos;주의&apos;가 남을 수 있습니다
        </span>
      </div>
    );
  };

  const clientAssumptionsSummary = [
    {
      step: 'STEP 01',
      label: '가계 및 은퇴 타임라인',
      primary: `본인 ${inputs.pension.currentAgeSelf}세${hasSpouse ? ` · 배우자 ${inputs.pension.currentAgeSpouse}세` : ' (1인 가구)'} → ${blueprint.retirementAgeSelf}세 은퇴`,
      detail: `재직 적립기 ${blueprint.yearsToRetirement}년 · 은퇴 인출기 ${100 - blueprint.retirementAgeSelf + 1}년 (100세 기준)`,
    },
    {
      step: 'STEP 02',
      label: '목표 월생활비 & 일시 이벤트',
      primary: `은퇴 후 월 ${formatKRW(inputs.cashflow.targetNetMonthlyLivingExpense)}`,
      detail: `${
        inputs.cashflow.spendingMode === 'active_senior'
          ? `액티브 시니어 3단계 지출${
              (inputs.cashflow.activeSeniorConfig?.careShockMonthlyExpense ?? 1_500_000) > 0
                ? `(케어기 간병비 +${Math.round((inputs.cashflow.activeSeniorConfig?.careShockMonthlyExpense ?? 1_500_000) / 10_000)}만)`
                : ''
            }`
          : '평생 정액 지출(물가연동)'
      } · 비정기 현금흐름 이벤트 ${inputs.cashflow.lumpSumEvents?.length || 0}건`,
    },
    {
      step: 'STEP 03',
      label: '현재 보유 일반금융자산',
      primary: formatKRW(inputs.asset.totalInvestment),
      detail: `해외상장 직접투자 ETF 비중 ${Math.round(portfolio.overseasDirectRatio)}% (연 250만 공제 후 22% 분리과세)`,
    },
    {
      step: 'STEP 04',
      label: '절세·연금계좌 & 예상 퇴직금',
      primary: `초기 절세잔고 ${formatKRW(initialIrp + initialIsa + initialPension)}`,
      detail: `은퇴 시 예상 퇴직금 합계 ${formatKRW(totalSeveranceGross)} (${inputs.transition.severanceTransferToIrp ? 'IRP 과세이연 이체' : '일시금 수령'})`,
    },
    {
      step: 'STEP 05',
      label: '은퇴 전 추가 저축',
      primary: `월 ${formatKRW(inputs.transition.preRetirementMonthlySavings)} (연 ${formatKRW(annualSavingsTotal)})`,
      detail: `연간 ISA ${formatKRW(annualIsaAdd)} + 연금저축 ${formatKRW(annualPensionAdd)} 우선 납입 후 잔여분 분할`,
    },
    {
      step: 'STEP 06',
      label: '일반·법인 계좌 목표수익률',
      primary: `세전 연 ${(portfolio.effectiveTotalReturn + (inputs.asset.returnShiftPct ?? 0)).toFixed(2)}%${inputs.asset.returnShiftPct ? ` (수익률 시나리오 ${inputs.asset.returnShiftPct > 0 ? '높게 +' : '낮게 −'}${Math.abs(inputs.asset.returnShiftPct)}%p · 전 계좌 일괄)` : ' (수익률 시나리오: 기본)'}`,
      detail: `자본성장 ${(portfolio.effectiveGrowthRate + (inputs.asset.returnShiftPct ?? 0)).toFixed(2)}% + 배당 ${portfolio.effectiveDividendYield.toFixed(2)}% (${isDetailedPortfolio ? `ETF ${inputs.asset.holdings?.length ?? 0}종 직접구성` : `성장 ${growthRatio}% : 배당 ${divRatio}%`})`,
    },
    {
      step: 'STEP 07',
      label: '절세·연금계좌 목표수익률',
      primary: inputs.accounts.overrideSymmetricAccountReturns ? '계좌별 맞춤 수익률 적용' : '5대 계좌 동일 기대수익률 연동',
      detail: inputs.accounts.overrideSymmetricAccountReturns
        ? `ISA ${((inputs.accounts.isaExpectedReturnRate ?? 5.4) + returnShift).toFixed(2)}% · 연금저축 ${((inputs.accounts.personalPensionReturnRate ?? 5.4) + returnShift).toFixed(2)}% · IRP ${((inputs.accounts.irpExpectedReturnRate ?? inputs.accounts.personalPensionReturnRate ?? 5.4) + returnShift).toFixed(2)}%${inputs.accounts.applyIrpRiskAssetCap !== false ? ' (IRP 위험자산 70% 한도 반영)' : ''}${returnShift ? ` (수익률 시나리오 ${returnShift > 0 ? '높게 +' : '낮게 −'}${Math.abs(returnShift)}%p 반영)` : ''}`
        : '일반·법인 계좌와 동일한 공정 비교 기대수익률 적용',
    },
    {
      step: 'STEP 08',
      label: '물가상승률 & 시장 스트레스',
      primary: `장기 물가상승률 연 ${inputs.transition.inflationRate.toFixed(1)}%`,
      detail:
        inputs.transition.marketStressScenario !== 'none'
          ? `시장 스트레스 시나리오(${inputs.transition.marketStressScenario}) 반영`
          : '기본 복리 + 하방 민감도(-2.0%p · P10) 스트레스 병기',
    },
    {
      step: 'STEP 09',
      label: '거주주택 & 국민연금',
      primary: `주택 공시가 ${formatKRW(inputs.realEstate.officiallyAssessedValue)}`,
      detail: `국민연금 ${pensionClaimAge}세 개시 (개시 첫해 월 ${formatKRW(firstMonthlyPublicPension)})`,
    },
    {
      step: 'STEP 10',
      label: '가족법인 & 배분전략',
      primary: `개인 ${blueprint.personalRatio}% : 법인 ${blueprint.corporateRatio}%`,
      detail: `${inputs.hybrid.useAutoOptimalRatio !== false ? '황금분할 최적해(r*) 자동 적용' : '수동 비율 지정'}${isDeferredCorp ? ' · 은퇴 D-Day 법인 설립·일괄 이전' : ''} · 임원 ${inputs.corporate.executiveCount}인 · 유지비 연 ${formatKRW(inputs.corporate.annualFixedMaintenanceFee)}`,
    },
  ];

  return (
    <div className="action-guide-view" aria-label="금융자산 구성 가이드 및 상세 분석 결과">
      {/* 상단 액션 컨트롤 스트립 (PDF 출력 버튼은 상단 글로벌 헤더로 단일화) */}
      <div className="guide-top-bar">
        <div className="guide-top-left">
          <button type="button" className="btn-secondary" onClick={onBackToWizard}>
            ← 입력 항목 수정하기 (위저드)
          </button>
          {guideSection === 'analytics' && onSwitchToBriefing && (
            <button
              type="button"
              className="btn-secondary"
              onClick={onSwitchToBriefing}
            >
              🧭 ② 핵심 결과 브리핑 (단계별 슬라이드)
            </button>
          )}
          <span className="guide-top-context num">
            <button
              type="button"
              style={jumpBtnStyle}
              onClick={() => (onJumpToWizardStep ? onJumpToWizardStep(1) : onBackToWizard())}
              title="클릭하여 1단계(은퇴 시점 및 가계 연령) 바로 수정"
            >
              현재 {inputs.pension.currentAgeSelf}세 → {blueprint.retirementAgeSelf}세 은퇴
            </button>
            {' · '}
            <button
              type="button"
              style={jumpBtnStyle}
              onClick={() => (onJumpToWizardStep ? onJumpToWizardStep(2) : onBackToWizard())}
              title="클릭하여 2단계(목표 월생활비) 바로 수정"
            >
              목표 월생활비{' '}
              <strong>
                {Math.round(inputs.cashflow.targetNetMonthlyLivingExpense / 10_000).toLocaleString()}만원
              </strong>
            </button>
            {' · '}
            <button
              type="button"
              style={jumpBtnStyle}
              onClick={() => (onJumpToWizardStep ? onJumpToWizardStep(3) : onBackToWizard())}
              title="클릭하여 3단계(현재 보유 일반 금융자산) 바로 수정"
            >
              일반자산 <strong>{formatKRW(inputs.asset.totalInvestment)}</strong>
            </button>
          </span>
        </div>

        <div className="guide-top-right">
          <div className="view-mode-segmented" role="group" aria-label="명목/실질 화폐가치 전환">
            <button
              type="button"
              className={inputs.transition.viewMode === 'real' ? 'active' : ''}
              onClick={() =>
                onChangeInputs({
                  ...inputs,
                  transition: { ...inputs.transition, viewMode: 'real' },
                })
              }
            >
              실질 구매력 (현재가치)
            </button>
            <button
              type="button"
              className={inputs.transition.viewMode === 'nominal' ? 'active' : ''}
              onClick={() =>
                onChangeInputs({
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

      {/* =====================================================================
       * 인쇄 / PDF 마스터플랜 전용: PB·자산 컨설팅 펌 4-Part 마스터플랜 리포트
       * (핵심 결과 브리핑 슬라이드 1~6 + 고객 10대 입력 명세 + 상세 분석 01~04 전체 통합)
       * =================================================================== */}
      {isPrintMode ? (
        <div className="print-masterplan-report" aria-label="PB 자산 컨설팅 마스터플랜 PDF 리포트">
          {/* =================================================================
           * PART I: 표지 마스트헤드 · 10대 설계 전제조건 · 핵심 결과 브리핑 (슬라이드 1~4)
           * =============================================================== */}
          <header className="print-report-masthead">
            <div className="print-masthead-top">
              <div className="print-masthead-brand">
                <span className="print-masthead-kicker">
                  NESTWAY SLIDER · PRIVATE WEALTH &amp; TAX SIMULATION REPORT
                </span>
                <h1 className="print-masthead-title">
                  은퇴 금융자산 최적 배분 및 절세·건보료 마스터플랜 시뮬레이션 리포트
                </h1>
                <p className="print-masthead-sub">
                  대한민국 소득세법 · 법인세법 · 상증세법 · 종합부동산세법 · 국민건강보험법 통합 {rows.length}개년(1원 단위) 정밀 시뮬레이션 보고서
                </p>
              </div>
              <div className="print-masthead-stamp num">
                <span className="print-stamp-badge">1-WON EXACT VERIFIED</span>
                <strong>{isReal ? '실질 구매력 (현재가치 할인)' : '명목 화폐가치 (물가상승 반영)'}</strong>
                <span>
                  {inputs.pension.currentAgeSelf}~100세 ({rows.length}개년) 회계오차 {activeLedger.maxAccountingResidualAbs}원
                </span>
              </div>
            </div>

            <div className="print-masthead-meta num">
              <div>
                <span>고객 가계 및 은퇴 타임라인</span>
                <strong>
                  {hasSpouse
                    ? `부부 합산 (본인 ${inputs.pension.currentAgeSelf}세 · 배우자 ${inputs.pension.currentAgeSpouse}세)`
                    : `1인 가구 (본인 ${inputs.pension.currentAgeSelf}세)`}{' '}
                  ➔ {blueprint.retirementAgeSelf}세 은퇴 ➔ 100세
                </strong>
              </div>
              <div>
                <span>은퇴 D-Day({blueprint.retirementAgeSelf}세) 총 운용 금융자산</span>
                <strong>
                  {fmtDday(blueprint.totalCapitalAtRetirement)} (개인 {blueprint.personalRatio}% : 법인 {blueprint.corporateRatio}%)
                </strong>
              </div>
              <div>
                <span>목표 월 순생활비 vs 지속가능 한계생활비</span>
                <strong>
                  목표 월 {formatKRW(inputs.cashflow.targetNetMonthlyLivingExpense)} / 한계 월{' '}
                  {formatKRW(activeStrategyCard.sustainableMonthlyLivingExpense)}
                </strong>
              </div>
              <div>
                <span>100세 세후 {inputs.corporate.terminalValuationMode === 'inheritance' ? '상속' : '청산'} 순자산 (절세·건보 효과)</span>
                <strong>
                  {activeLedger.depletionAgeSelf !== null
                    ? `${activeLedger.depletionAgeSelf}세 고갈 (0원)`
                    : formatKRW(activeLedger.finalDisposableNetWorth)}{' '}
                  ({activeLedger.totalLifetimeTaxAndHealthSaved >= 0
                    ? `단순 일반계좌 대비 +${formatKRW(activeLedger.totalLifetimeTaxAndHealthSaved)} 절감`
                    : `단순 일반계좌 대비 -${formatKRW(Math.abs(activeLedger.totalLifetimeTaxAndHealthSaved))}`})
                </strong>
              </div>
            </div>
          </header>

          {/* PART I-1: 10대 고객 설계 전제조건 명세표 */}
          <section className="print-section-block">
            <div className="print-part-header">
              <span className="print-part-kicker">PART I-1 · CLIENT PROFILE &amp; INPUT ASSUMPTIONS</span>
              <h2 className="print-part-title">10대 고객 설계 전제조건 및 포트폴리오 명세표</h2>
              <p className="print-part-desc">
                본 컨설팅 리포트의 모든 세무·건보료 및 현금흐름 원장 시뮬레이션에 적용된 10단계 입력 전제조건입니다.
              </p>
            </div>
            <div className="print-assumptions-grid num">
              {clientAssumptionsSummary.map((item) => (
                <div key={item.step} className="print-assumption-card">
                  <div className="print-assumption-top">
                    <span className="print-assumption-step">{item.step}</span>
                    <span className="print-assumption-label">{item.label}</span>
                  </div>
                  <strong className="print-assumption-primary">{item.primary}</strong>
                  <span className="print-assumption-detail">{item.detail}</span>
                </div>
              ))}
            </div>
          </section>

          {/* PART I-2: 핵심 결과 브리핑 01 — 종합 판정 · 연령대별 순자산 · 하방 스트레스 & 간병비 버퍼 */}
          <section className="print-section-block">
            <div className="print-part-header">
              <span className="print-part-kicker">
                PART I-2 · EXECUTIVE VERDICT &amp; DOWNSIDE RESILIENCE (핵심 결과 브리핑 슬라이드 01)
              </span>
              <h2 className="print-part-title">
                100세 은퇴 안전성 종합 판정 · 연령대별 마일스톤 순자산 및 하방 스트레스 진단
              </h2>
              <p className="print-part-desc">{headlineText}</p>
              {!plan.recommendation.isMathematicalOptimum && (
                <p className="recommendation-reason">권고 사유 · {plan.recommendation.reason}</p>
              )}
            </div>

            <VerdictHero plan={plan} survivalProbabilityPercent={slide1Sensitivity.survivalProbabilityPercent}
                    mcAssumptions={slide1Sensitivity.mcAssumptions} />
            <VerdictHeader plan={plan} />

            <div className="briefing-milestone-strip num" style={{ marginTop: 10 }}>
              {milestoneSnapshots.map((m) => (
                <div key={m.age} className="wizard-Context-pill-box">
                  <span>{m.label} 예상 세후 순자산</span>
                  <strong className={m.value > 0 ? 'text-accent' : 'text-danger'}>
                    {formatKRW(m.value)}
                  </strong>
                </div>
              ))}
            </div>

            <div className="wizard-3col-grid num" style={{ marginTop: 10 }}>
              <div className="wizard-Context-pill-box">
                <span>수익률 -2.0%p 보수적 시나리오 (100세 순자산)</span>
                <strong
                  className={
                    slide1Sensitivity.minus2FinalNetWorth > 0 ? 'text-accent' : 'text-danger'
                  }
                >
                  {slide1Sensitivity.minus2DepletionAge !== null
                    ? `${slide1Sensitivity.minus2DepletionAge}세 고갈 (0원)`
                    : formatKRW(slide1Sensitivity.minus2FinalNetWorth)}
                </strong>
              </div>
              <div className="wizard-Context-pill-box">
                <span>몬테카를로 하위 10% (P10) · 100세 생존확률</span>
                <strong
                  className={
                    slide1Sensitivity.survivalProbabilityPercent >= VERDICT_SURVIVAL_MIN_PCT
                      ? 'text-positive'
                      : 'text-danger'
                  }
                >
                  {formatKRW(slide1Sensitivity.p10FinalNetWorth)} (생존확률{' '}
                  {slide1Sensitivity.survivalProbabilityPercent}%)
                </strong>
              </div>
              <div className="wizard-Context-pill-box">
                <span>후기 노년 케어·간병비 가용 월 여유분 (한계생활비 − 목표)</span>
                <strong
                  className={
                    activeStrategyCard.monthlyBuffer >= 0 ? 'text-positive' : 'text-danger'
                  }
                >
                  {fmtMonthlyBuffer(activeStrategyCard.monthlyBuffer)}
                </strong>
              </div>
            </div>

            {shouldShowPlanB(slide1Sensitivity.survivalProbabilityPercent, activeStrategyCard.monthlyBuffer) && (
              <div className="plan-b-advisory-box" style={{ marginTop: 10 }}>
                <strong>
                  🛡️ 하방 리스크 및 후기 간병비 안전마진 보강 권고 (Plan B 컨틴전시 가이드)
                </strong>
                <p>
                  {activeLedger.depletionAgeSelf !== null ? (
                    <>
                      기본 시나리오에서도 <strong>{activeLedger.depletionAgeSelf}세</strong>에 금융자산이 고갈되고 목표 생활비 대비{' '}
                      <strong>{fmtMonthlyBuffer(activeStrategyCard.monthlyBuffer)}</strong>이며, 수익률
                    </>
                  ) : (
                    <>
                      기본 시나리오에서는 100세 순자산 <strong>{formatKRW(activeLedger.finalDisposableNetWorth)}</strong>이 유지되나, 한계생활비 여유분이{' '}
                      <strong>
                      {activeStrategyCard.monthlyBuffer >= 0
                        ? `월 ${formatKRW(activeStrategyCard.monthlyBuffer)}`
                        : fmtMonthlyBuffer(activeStrategyCard.monthlyBuffer)}
                    </strong>{' '}
                    수준이고 수익률
                    </>
                  )} -2.0%p·P10(하위 10% 부진 장세) 시{' '}
                  <strong>
                    {slide1Sensitivity.minus2DepletionAge !== null
                      ? `${slide1Sensitivity.minus2DepletionAge}세 전후 금융자산 조기 소진`
                      : `100세 순자산이 ${formatKRW(slide1Sensitivity.p10FinalNetWorth)}으로 축소`}
                  </strong>
                  됩니다. 금융자산 단독 운용의 하방 취약성을 보완하기 위해 아래 3가지 플랜 B 레버를 권고합니다.
                </p>
                <ul>
                  {inputs.realEstate.officiallyAssessedValue > 0 && (
                    <li>
                      <strong>① 거주주택({formatKRW(inputs.realEstate.officiallyAssessedValue)}) 후기 유동화 (STEP 09 연계)</strong>:{' '}
                      {inputs.realEstate.officiallyAssessedValue > 1_200_000_000
                        ? '공시가 12억 원 초과 주택은 주택금융공사(HF) 일반 주택연금 가입이 제한되므로, 75~80세 케어기 진입 시 주택 다운사이징(차익 현금 유입) 또는 민간 역모기지·수익형 전환을 통해 간병비 재원을 확보하세요.'
                        : '75~80세 후기 노년 진입 시 주택연금 전환 또는 다운사이징(STEP 09)을 실행하면 금융자산 소진 없이 종신 현금흐름을 보강할 수 있습니다.'}
                    </li>
                  )}
                  <li>
                    <strong>② 은퇴 시점 1~2년 연장 또는 반퇴(소득 크레바스 완충)</strong>: 은퇴 연령을 {blueprint.retirementAgeSelf}세에서 1~2년 늦추거나 크레바스 구간 소액 근로·자문 소득을 병행하면 초기 원금 인출 압력이 줄어 100세 생존확률을 끌어올릴 수 있습니다.
                  </li>
                  <li>
                    <strong>③ 하락장 가변 인출 가드레일(Guardrail)</strong>: 은퇴 직후 5년 내 시장이 -10% 이상 하락하는 해에는 액티브기 선택지출(여행·여가비)을 일시적으로 10~15% 감액하여 수익률 순서 리스크(Sequence of Returns Risk)를 방어하세요.
                  </li>
                </ul>
                {renderPlanBLevers()}
              </div>
            )}
          </section>

          {/* PART I-3: 핵심 결과 브리핑 02~04 — 3단계 실행 공식 & 은퇴 D-Day 5대 금융계좌 최종 배치표 */}
          <section className="print-section-block print-page-break">
            <div className="print-part-header">
              <span className="print-part-kicker">
                PART I-3 · 3-STEP EXECUTION PLAYBOOK &amp; D-DAY 5-ACCOUNT BLUEPRINT (핵심 결과 브리핑 슬라이드 02~04)
              </span>
              <h2 className="print-part-title">
                은퇴 전 적립 공식(STEP 01) ➔ 은퇴 당일 5대 계좌 배치(STEP 02) ➔ 은퇴 후 월별 인출 순서(STEP 03)
              </h2>
              <p className="print-part-desc">
                종합소득세 누진과세와 지역건강보험료 피부양자 탈락을 방어하기 위한 시기별 계좌 운용 및 인출 실행 지침입니다.
              </p>
            </div>

            {/* 브리핑 슬라이드 2 & 4 핵심 KPI 요약 스트립 */}
            <div className="wizard-3col-grid num" style={{ marginBottom: 10 }}>
              <div className="wizard-Context-pill-box">
                <span>① 절세계좌 연간 우선 입금 (ISA+연금저축)</span>
                <strong className="text-accent">
                  연 {formatKRW(annualIsaAdd + annualPensionAdd)}
                </strong>
              </div>
              <div className="wizard-Context-pill-box">
                <span>
                  {isDeferredCorp
                    ? `② 잔여 저축액 전액 일반계좌 적립 (D-Day 법인 ${blueprint.corporateRatio}% 이전)`
                    : `② 잔여 저축액 분할 적립 (개인 ${blueprint.personalRatio}% : 법인 ${blueprint.corporateRatio}%)`}
                </span>
                <strong>연 {formatKRW(annualExcessSavings)}</strong>
              </div>
              <div className="wizard-Context-pill-box">
                <span>③ 1순위 고정 현금흐름 ({pensionClaimAge}세 국민연금 개시)</span>
                <strong className="text-positive">
                  국민연금 월 {formatKRW(firstMonthlyPublicPension)}
                  {blueprint.corporateRatio > 0
                    ? ` + 법인급여 월 ${formatKRW(corpMonthlyNetSalary)}`
                    : ' + 개인배당'}
                </strong>
              </div>
            </div>

            <div className="action-playbook-grid" style={{ marginBottom: 12 }}>
              {renderStep1Card()}
              {renderStep3Card()}
            </div>

            {renderStep2DdayBox()}
          </section>

          {/* =================================================================
           * PART II: 개인 vs 법인 황금분할(r*) 최적화 및 100세 순자산·절세 궤적 (상세 분석 01 · Lens 1)
           * =============================================================== */}
          <section className="print-section-block print-page-break">
            <div className="print-part-header">
              <span className="print-part-kicker">
                PART II · ALLOCATION FRONTIER &amp; 100-AGE TRAJECTORY ANALYTICS (상세 분석 01)
              </span>
              <h2 className="print-part-title">
                개인 vs 법인 황금분할(r*) 효율 곡선 및 100세 순자산·절세 방어 궤적 (민감도 ±2.0%p · P10~P90 포함)
              </h2>
              <p className="print-part-desc">
                일반 금융자산 배분 비율(0%~100%) 전수 시뮬레이션 결과와 연간 세금·건보료 방어 실익입니다. (수익률 -2.0%p·P10 하방 시나리오와 생존확률은 PART I-2 참조)
              </p>
            </div>

            <Lens1AllocationTrack
              plan={plan}
              isPrintMode
              defaultShowSensitivityBand={false}
              onSelectPersonalRatio={(ratio) =>
                onChangeInputs({
                  ...inputs,
                  hybrid: {
                    useAutoOptimalRatio: false,
                    personalRatio: ratio,
                    corporateRatio: 100 - ratio,
                  },
                })
              }
            />
          </section>

          {/* =================================================================
           * PART III: 5대 계좌 잔고·8단계 인출 워터폴 & 전략 매트릭스·체크리스트 (브리핑 슬라이드 05~06 + 상세 분석 02~03)
           * =============================================================== */}
          <section className="print-section-block print-page-break">
            <div className="print-part-header">
              <span className="print-part-kicker">
                PART III · 5-ACCOUNT WATERFALL, STRATEGIC MATRIX &amp; EXECUTION CHECKLIST (핵심 결과 브리핑 05~06 &amp; 상세 분석 02~03)
              </span>
              <h2 className="print-part-title">
                5대 계좌 적층 잔고 · 8단계 절세 인출 워터폴 및 3대 전략·연금·법인 출구·생애 실행 체크리스트
              </h2>
              <p className="print-part-desc">
                연령별 5대 계좌 잔액 변화와 8단계 인출 원천 워터폴, 개인 vs 법인 손익분기 진단, 국민연금 개시 시기 및 가족법인 출구·실행 체크리스트입니다.
              </p>
            </div>

            <Lens2WaterfallLedger plan={plan} sectionMode="charts" hideBlueprintCard isPrintMode />

            <div className="print-page-break" style={{ marginTop: 12 }}>
              <Lens3StrategyMatrix
                plan={plan}
                snapshotA={snapshotA}
                onPinSnapshotA={onPinSnapshotA}
                onClearSnapshotA={onClearSnapshotA}
                onChangeInputs={onChangeInputs}
              />
            </div>

            <div className="print-section-block" style={{ marginTop: 12 }}>
              <h3 className="canvas-title">법인세율 점검 · 성실신고확인대상(22%) 요건과 회피 가이드</h3>
              {isNoCorpPlan ? (
                <div className="reference-only-banner">
                  가족법인 미설립(개인 100% 권고) — 법인 성실신고확인대상(22%) 요건 및 회피 절차 해당 없음 (법인 설립 시에만 배당·이자 매출 비중 50% 기준 적용)
                </div>
              ) : (
                <SincereFilingGuide summary={plan.sincereFilingSummary} />
              )}
            </div>
          </section>

          {/* =================================================================
           * PART IV: 51개년(50~100세) 연차별 현금흐름·세금·건보료 전체 원장 명세표 & 세무·법무 유의사항 (상세 분석 04)
           * =============================================================== */}
          <section className="print-section-block print-page-break">
            <div className="print-part-header">
              <span className="print-part-kicker">
                PART IV · FULL {rows.length}-YEAR CANONICAL CASHFLOW, TAX &amp; NHIS AUDIT LEDGER (상세 분석 04)
              </span>
              <h2 className="print-part-title">
                전 생애({inputs.pension.currentAgeSelf}~100세, {rows.length}개년) 연차별 현금흐름·8단계 인출·세금·건보료 및 5대 계좌 기말 원장 명세표
              </h2>
              <p className="print-part-desc">
                매년 기초잔액 + 세후운용수익 + 외부유입 − 순생활비 − 세금·건보료·법인유지비 = 기말잔액 항등식이 1원 단위로 검증된 전체 연차별 원장입니다.
              </p>
            </div>

            {/* 세목별·주요 연령대 산식 검증 부록 */}
            {(() => {
              const activeEstateOpt = plan.estateDiagnostic.activeEstate;
              const milestoneAges = Array.from(
                new Set([
                  blueprint.retirementAgeSelf,
                  pensionClaimAge,
                  75,
                  85,
                  rows[rows.length - 1]?.ageSelf ?? 100,
                ]),
              )
                .filter((age) => age >= inputs.pension.currentAgeSelf && age <= 100)
                .sort((a, b) => a - b)
                .slice(0, 5);

              const milestoneRows = milestoneAges
                .map((age) => rows.find((r) => r.ageSelf === age))
                .filter((r): r is NonNullable<typeof r> => r != null);

              const scaledVal = (v: number, r: (typeof rows)[number]) =>
                isReal ? Math.round(v * r.discountFactor) : Math.round(v);

              return (
                <div className="print-statutory-appendix">
                  <h3 className="canvas-title" style={{ fontSize: 13, marginBottom: 6 }}>
                    세목별·주요 연령대 산식 검증 부록 (법정 세율·건보 부과 근거 요약)
                  </h3>
                  <table className="print-statutory-appendix-table">
                    <thead>
                      <tr>
                        <th>연령 (구간)</th>
                        <th>공적연금·배당세 (§14·§17)</th>
                        <th>사적연금·IRP세 (§129①5의3)</th>
                        <th>해외양도·ISA·퇴직세</th>
                        <th>주택보유세 (재산·종부)</th>
                        <th>개인 건보료 (피부양 판정)</th>
                        <th>법인세·4대보험·기장료</th>
                      </tr>
                    </thead>
                    <tbody>
                      {milestoneRows.map((r) => {
                        const scaledHealth = scaledVal(r.personalHealthInsurance, r);
                        const healthStatus = r.isEmployed
                          ? '재직 직장'
                          : r.isHealthDependentEligible
                            ? '피부양 적격'
                            : blueprint.corporateRatio > 0 && inputs.corporate.executiveCount > 0
                              ? '법인직장/지역'
                              : '지역부과';
                        return (
                          <tr key={r.ageSelf}>
                            <td>{r.ageSelf}세 ({r.stageLabel})</td>
                            <td>{formatKRW(scaledVal(r.taxPublicAndDiv, r))}</td>
                            <td>{formatKRW(scaledVal(r.taxPrivatePensionAndIrp, r))}</td>
                            <td>{formatKRW(scaledVal(r.taxOverseasCapGains + r.taxIsaAndSeveranceLump, r))}</td>
                            <td>{formatKRW(scaledVal(r.personalPropertyTax ?? 0, r))}</td>
                            <td>{formatKRW(scaledHealth)} ({healthStatus})</td>
                            <td>{formatKRW(scaledVal(r.corpCorporateTax + r.corpPayrollTaxAndInsurance + r.corpMaintenanceAndFixedCost, r))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p style={{ marginTop: 8, fontSize: '10.5px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '8px 0 0' }}>
                    • 100세 {inputs.corporate.terminalValuationMode === 'inheritance' ? '상속' : '청산'} 기준 비교: 100세 청산 기준 세후 순자산 {formatKRW(activeLedger.finalDisposableNetWorth)} vs 100세 상속 기준 세후 순자산 {formatKRW(activeEstateOpt.netAfterInheritanceValue)} (상증세법 §22 금융재산상속공제 최대 2억 · §26 누진세율 10~50% 반영, 추정 상속세 {formatKRW(activeEstateOpt.estimatedInheritanceTax)})
                  </p>
                </div>
              );
            })()}

            <Lens2WaterfallLedger plan={plan} sectionMode="table" />

            <footer className="print-report-footer">
              <div className="print-footer-col">
                <strong>① 1원 단위 회계 항등식 검증 보증 (1-Won Exact Audit)</strong>
                <p>
                  본 리포트의 전 생애({inputs.pension.currentAgeSelf}~100세, {rows.length}개년) 시뮬레이션 원장은 매년 기초잔액 + 세후운용수익 + 외부유입 − 목표 순생활비 − 세금·건보료·법인유지비 = 기말잔액 항등식을 연차별 최대 오차{' '}
                  <strong>{activeLedger.maxAccountingResidualAbs}원</strong>으로 통과하였습니다.
                </p>
              </div>
              <div className="print-footer-col">
                <strong>② 가족법인 세무·건보 실무 준수사항 (Tax &amp; NHIS Compliance)</strong>
                <p>
                  가족법인 임원 급여의 손금산입 및 직장가입자 자격 유지를 위해서는 정관 임원보수 지급규정, 주주총회 결의서 및 실질 자산운용 업무 증빙 구비가 필수적입니다. 자녀 지분 참여 및 무이자 가수금 대여 시 상증세법 제45조의5(특정법인과의 거래를 통한 이익의 증여 의제) 적용 여부를 담당 세무사와 사전 검토하시기 바랍니다.
                </p>
              </div>
              <div className="print-footer-col">
                <strong>③ 시뮬레이션 전제 및 법적 고지 (Simulation Disclaimer)</strong>
                <p>
                  본 문서는 고객 입력 전제조건 및 현행 대한민국 세법·국민건강보험법령 산식에 기반한 알고리즘 금융·세무 시뮬레이션 참고자료이며, 개별 고객에 대한 맞춤형 세무대리(세무사법 제2조) 또는 투자자문(자본시장법 제6조)에 해당하지 않습니다. 실제 세무 신고 및 금융자산 배분 실행 시에는 반드시 공인회계사·세무사 등 공인 전문가와 개별 신고 요건을 최종 검토하시기 바랍니다.
                </p>
              </div>
            </footer>
          </section>
        </div>
      ) : guideSection === 'briefing' ? (
        <div className="briefing-wizard-stage" aria-label="단계별 핵심 결과 브리핑 슬라이드">
          {/* 1~6단계 결과 브리핑 Stepper Bar */}
          <nav ref={briefingStepperRef} className="wizard-stepper-bar briefing-stepper-bar" aria-label="결과 브리핑 단계 선택">
            {BRIEFING_SLIDES.map((s) => {
              const isCurrent = currentBriefingStep === s.step;
              const isCompleted = currentBriefingStep > s.step;
              return (
                <button
                  key={s.step}
                  type="button"
                  className={`wizard-step-pill ${isCurrent ? 'current' : ''} ${isCompleted ? 'completed' : ''}`}
                  aria-current={isCurrent ? 'step' : undefined}
                  onClick={() => setCurrentBriefingStep(s.step)}
                >
                  <span className="wizard-step-num num">결과 {s.step}</span>
                  <span className="wizard-step-text">{s.shortLabel.replace(/^\d+\.\s*/, '')}</span>
                </button>
              );
            })}
          </nav>

          {/* 단일 포커스 결과 브리핑 카드 */}
          <div className="wizard-focus-card briefing-focus-card" key={currentBriefingStep}>
            <div className="wizard-card-top">
              <div className="wizard-card-meta">
                <span className="wizard-category-badge">{activeSlide.category}</span>
                <span className="wizard-default-note">
                  {isReal ? '실질 구매력(현재가치) 기준' : '명목 화폐가치 기준'}
                </span>
              </div>

            </div>

            <div className="wizard-question-header">
              <div className="wizard-question-title-row">
                <h2 className="wizard-question-title">{activeSlide.questionTitle}</h2>
                <InfoPop label="설명" title={activeSlide.questionTitle}>
                  <p>{activeSlide.questionSub}</p>
                </InfoPop>
              </div>
            </div>

            {/* 슬라이드별 집중 콘텐츠 (한 번에 하나의 핵심 주제만 노출) */}
            <div className="wizard-primary-input-box briefing-slide-body">
              {/* Slide 1: 종합 판정 & 100세 결론 — 핵심 숫자 3개 + 한 줄 결론, 설명·상세는 ⓘ 팝업 */}
              {currentBriefingStep === 1 && (
                <div className="wizard-single-topic-body" style={{ gap: 16 }}>
                  <VerdictHero
                    plan={plan}
                    survivalProbabilityPercent={slide1Sensitivity.survivalProbabilityPercent}
                    mcAssumptions={slide1Sensitivity.mcAssumptions}
                    criteriaMode="popover"
                  />


                  <div className="action-hero-banner" style={{ paddingBottom: 14 }}>
                    <span className="action-hero-kicker">그래서 무엇을 해야 하나요? · 실행 한 줄 결론</span>
                    <h1 className="action-hero-title">{headlineText}</h1>
                    <div className="info-pop-row">
                      {!plan.recommendation.isMathematicalOptimum && (
                        <InfoPop label="권고 사유">
                          <p className="recommendation-reason">권고 사유 · {plan.recommendation.reason}</p>
                        </InfoPop>
                      )}
                      <InfoPop label="배분 상세" wide title="최적 배분 · 100세 순자산 · 지속가능 생활비 상세">
                        <VerdictHeader plan={plan} />
                      </InfoPop>
                      <InfoPop label="연령대별 순자산" wide title="연령대별 예상 세후 순자산">
                        <div className="briefing-milestone-strip num">
                    {milestoneSnapshots.map((m) => (
                      <div key={m.age} className="wizard-Context-pill-box">
                        <span>{m.label} 예상 세후 순자산</span>
                        <strong className={m.value > 0 ? 'text-accent' : 'text-danger'}>
                          {formatKRW(m.value)}
                        </strong>
                      </div>
                    ))}
                  </div>
                      </InfoPop>
                      <InfoPop label="하방 시나리오" wide title="수익률 하락·부진 장세 시나리오와 월 여유분">
                        <div className="wizard-3col-grid num">
                    <div className="wizard-Context-pill-box">
                      <span>수익률 -2.0%p 보수적 시나리오 (100세 순자산)</span>
                      <strong
                        className={
                          slide1Sensitivity.minus2FinalNetWorth > 0 ? 'text-accent' : 'text-danger'
                        }
                      >
                        {slide1Sensitivity.minus2DepletionAge !== null
                          ? `${slide1Sensitivity.minus2DepletionAge}세 고갈 (0원)`
                          : formatKRW(slide1Sensitivity.minus2FinalNetWorth)}
                      </strong>
                    </div>
                    <div className="wizard-Context-pill-box">
                      <span>몬테카를로 하위 10% (P10) · 100세 생존확률</span>
                      <strong
                        className={
                          slide1Sensitivity.survivalProbabilityPercent >= VERDICT_SURVIVAL_MIN_PCT
                            ? 'text-positive'
                            : 'text-danger'
                        }
                      >
                        {formatKRW(slide1Sensitivity.p10FinalNetWorth)} (생존확률{' '}
                        {slide1Sensitivity.survivalProbabilityPercent}%)
                      </strong>
                    </div>
                    <div className="wizard-Context-pill-box">
                      <span>후기 노년 케어·간병비 가용 월 여유분 (한계생활비 − 목표)</span>
                      <strong
                        className={
                          activeStrategyCard.monthlyBuffer >= 0 ? 'text-positive' : 'text-danger'
                        }
                      >
                        {fmtMonthlyBuffer(activeStrategyCard.monthlyBuffer)}
                      </strong>
                    </div>
                  </div>
                      </InfoPop>
                    </div>
                  </div>

                  <div className="briefing-visual-block">
                    <span className="action-hero-kicker">100세까지 세후 순자산 흐름</span>
                    <NetWorthSparkline
                      rows={rows}
                      isReal={isReal}
                      markAges={[blueprint.retirementAgeSelf, 80, rows[rows.length - 1]?.ageSelf ?? 100]}
                    />
                  </div>

                  {shouldShowPlanB(slide1Sensitivity.survivalProbabilityPercent, activeStrategyCard.monthlyBuffer) && (
                    <>
                    <div className="briefing-slide-lead">
                      🛡️ 하방 여유가 얇습니다 — 보강 방법을 확인하세요
                      <InfoPop label="Plan B 레버" title="하방 리스크 및 후기 간병비 안전마진 보강 권고">
                        <div className="plan-b-advisory-box">
                      <strong>
                        🛡️ 하방 리스크 및 후기 간병비 안전마진 보강 권고 (Plan B 컨틴전시 가이드)
                      </strong>
                      <p>
                        {activeLedger.depletionAgeSelf !== null ? (
                          <>
                            기본 시나리오에서도 <strong>{activeLedger.depletionAgeSelf}세</strong>에 금융자산이 고갈되고 목표 생활비 대비{' '}
                            <strong>{fmtMonthlyBuffer(activeStrategyCard.monthlyBuffer)}</strong>이며, 수익률
                          </>
                        ) : (
                          <>
                            기본 시나리오에서는 100세 순자산 <strong>{formatKRW(activeLedger.finalDisposableNetWorth)}</strong>이 유지되나, 한계생활비 여유분이{' '}
                            <strong>
                      {activeStrategyCard.monthlyBuffer >= 0
                        ? `월 ${formatKRW(activeStrategyCard.monthlyBuffer)}`
                        : fmtMonthlyBuffer(activeStrategyCard.monthlyBuffer)}
                    </strong>{' '}
                    수준이고 수익률
                          </>
                        )} -2.0%p·P10(하위 10% 부진 장세) 시{' '}
                        <strong>
                          {slide1Sensitivity.minus2DepletionAge !== null
                            ? `${slide1Sensitivity.minus2DepletionAge}세 전후 금융자산 조기 소진`
                            : `100세 순자산이 ${formatKRW(slide1Sensitivity.p10FinalNetWorth)}으로 축소`}
                        </strong>
                        됩니다. 하방 안전마진 확보를 위해 다음 플랜 B 레버를 함께 검토하세요.
                      </p>
                      <ul>
                        {inputs.realEstate.officiallyAssessedValue > 0 && (
                          <li>
                            <strong>① 거주주택({formatKRW(inputs.realEstate.officiallyAssessedValue)}) 후기 유동화 (STEP 09 연계)</strong>:{' '}
                            {inputs.realEstate.officiallyAssessedValue > 1_200_000_000
                              ? '공시가 12억 원 초과 주택은 주택금융공사(HF) 일반 주택연금 가입이 제한되므로, 75~80세 케어기 진입 시 주택 다운사이징(차익 현금 유입) 또는 민간 역모기지·수익형 전환으로 간병비 재원을 확보하세요.'
                              : '75~80세 후기 노년 진입 시 주택연금 전환 또는 다운사이징(STEP 09)을 실행하면 금융자산 소진 없이 종신 현금흐름을 보강할 수 있습니다.'}
                          </li>
                        )}
                        <li>
                          <strong>② 은퇴 시점 1~2년 연장 또는 반퇴(소득 크레바스 완충)</strong>: 은퇴 연령을 {blueprint.retirementAgeSelf}세에서 1~2년 늦추거나 크레바스 구간 소액 근로·자문 소득을 병행하면 초기 원금 인출 압력이 줄어 100세 생존확률을 끌어올릴 수 있습니다.
                        </li>
                        <li>
                          <strong>③ 하락장 가변 인출 가드레일(Guardrail)</strong>: 은퇴 직후 5년 내 시장이 -10% 이상 하락하는 해에는 액티브기 선택지출(여행·여가비)을 일시적으로 10~15% 감액하여 수익률 순서 리스크(Sequence of Returns Risk)를 방어하세요.
                        </li>
                      </ul>
                    </div>
                      </InfoPop>
                    </div>
                    {renderPlanBLevers()}
                    </>
                  )}
                </div>
              )}

              {/* Slide 2: STEP 01 은퇴 전 적립 공식 — 연간 적립 배분 막대 + 은퇴 시점 결과 */}
              {currentBriefingStep === 2 && (
                <div className="wizard-single-topic-body" style={{ gap: 14 }}>
                  {annualSavingsTotal > 0 && blueprint.yearsToRetirement > 0 ? (
                    <>
                      <div className="bv-big-line">
                        매년 <span className="text-accent num">{formatKRW(annualSavingsTotal)}</span> 적립 →{' '}
                        {blueprint.retirementAgeSelf}세 <span className="text-accent num">{fmtDday(blueprint.totalCapitalAtRetirement)}</span>
                      </div>
                      <StackedBar ariaLabel="연간 적립액 계좌별 배분" segments={savingsSegments} />
                    </>
                  ) : (
                    <div className="bv-big-line">
                      추가 적립 없이 {blueprint.retirementAgeSelf}세{' '}
                      <span className="text-accent num">{fmtDday(blueprint.totalCapitalAtRetirement)}</span>로 시작
                    </div>
                  )}
                  <div className="info-pop-row">
                    <InfoPop label="적립 공식 전문" title="은퇴 전 연간 적립 공식 (상세)">
                      {renderStep1Card()}
                    </InfoPop>
                  </div>
                </div>
              )}

              {/* Slide 3: STEP 02 은퇴 D-Day 5대 금융계좌 최종 배치표 */}
              {currentBriefingStep === 3 && (
                <div className="wizard-single-topic-body" style={{ gap: 14 }}>
                  <div className="bv-big-line">
                    은퇴 당일 총 금융자산{' '}
                    <span className="text-accent num">{fmtDday(blueprint.totalCapitalAtRetirement)}</span>
                  </div>
                  {isReal && (
                    <span className="bv-sub-note">
                      5대 계좌 금액도 현재 물가(실질 구매력) 기준으로 환산해 합계를 일치시켰습니다 · 은퇴 당일 명목 총액 {formatDdayAmount(blueprint.totalCapitalAtRetirement, rows, blueprint.retirementAgeSelf, false)}
                    </span>
                  )}
                  <StackedBar
                    tall
                    ariaLabel="은퇴 시점 5대 금융계좌 배치 비율"
                    segments={basketItems.map((b) => ({ key: b.key, label: b.title, value: scaleDday(b.amount), color: b.color }))}
                  />
                  <div className="info-pop-row">
                    <InfoPop label="계좌별 산식·운용 규칙" wide title="은퇴 당일 5대 금융계좌 최종 배치표 (전체)">
                      {renderStep2DdayBox()}
                    </InfoPop>
                  </div>
                </div>
              )}

              {/* Slide 4: STEP 03 은퇴 후 월 인출 순서 — 1→2→3 흐름도 + 나이별 인출 재원 구성 */}
              {currentBriefingStep === 4 && (
                <div className="wizard-single-topic-body" style={{ gap: 16 }}>
                  <FlowSteps
                    steps={[
                      {
                        key: 'fixed',
                        title: blueprint.corporateRatio > 0 ? '국민연금 + 법인급여' : '국민연금 + 배당',
                        value: `${pensionClaimAge}세부터 월 ${formatKRW(firstMonthlyPublicPension)}${
                          blueprint.corporateRatio > 0 ? ` + 월 ${formatKRW(corpMonthlyNetSalary)}` : ''
                        }`,
                      },
                      {
                        key: 'pension',
                        title: '연금계좌 저율 인출',
                        value: hasSpouse ? '부부 연 3,000만 한도 · 3.3~5.5%' : '연 1,500만 한도 · 3.3~5.5%',
                      },
                      {
                        key: 'topup',
                        title: blueprint.corporateRatio > 0 ? 'ISA → 법인원금 → 일반계좌' : 'ISA → 일반계좌',
                        value: '부족분만 세금 적은 순서로',
                      },
                    ]}
                  />
                  <div className="briefing-visual-block" style={{ paddingBottom: 14 }}>
                    <span className="action-hero-kicker">나이별 생활비 재원 구성</span>
                    <StackedRows
                      ariaLabel="나이별 생활비 인출 재원 구성"
                      legend={[
                        { key: 'pub', label: '국민·주택연금', color: '#2563eb' },
                        { key: 'sal', label: '법인급여', color: '#8b5cf6' },
                        { key: 'pen', label: '연금계좌', color: '#0ea5e9' },
                        { key: 'isa', label: 'ISA', color: '#10b981' },
                        { key: 'tax', label: '일반계좌', color: '#f59e0b' },
                        { key: 'corp', label: '법인 배당·원금', color: '#a855f7' },
                      ]}
                      rows={withdrawalSourceRows}
                    />
                  </div>
                  <div className="info-pop-row">
                    <InfoPop label="인출 공식 전문" title="은퇴 후 월 생활비 인출 공식 (세율·한도·감면 상세)">
                      {renderStep3Card()}
                    </InfoPop>
                  </div>
                </div>
              )}

              {/* Slide 5: 개인 vs 법인 절세 실익 & 3대 전략 비교 */}
              {currentBriefingStep === 5 && (
                <div className="wizard-single-topic-body" style={{ gap: 14 }}>
                  <span className="action-hero-kicker">100세 세후 가처분 순자산 비교</span>
                  <HBarList
                    ariaLabel="전략별 100세 세후 가처분 순자산"
                    items={strategyCards.map((c) => {
                      const isBest = c.strategyType === plan.winner;
                      const pills = strategyCardPills(c.strategyType, plan.winner, plan.recommendation);
                      return {
                        key: c.strategyType,
                        highlight: isBest,
                        label: (
                          <>
                            {c.strategyName}
                            {pills.map((label) => (
                              <span key={label} className="winner-pill">
                                {label}
                              </span>
                            ))}
                          </>
                        ),
                        value: Math.max(0, c.finalDisposableNetWorth),
                        valueLabel: formatKRW(c.finalDisposableNetWorth),
                        extra: (
                          <InfoPop label="상세" title={`${c.strategyName} 상세`}>
                            <dl className="strategy-detail-list num">
                            <div>
                              <dt>지속가능 한계 월생활비</dt>
                              <dd>월 {formatKRW(c.sustainableMonthlyLivingExpense)}</dd>
                            </div>
                            <div>
                              <dt>생애 총 세금·건보·유지비</dt>
                              <dd>{formatKRW(c.totalLifetimeTaxAndHealthCost)}</dd>
                            </div>
                            <div>
                              <dt>단순보유 대비 절세·건보 방어</dt>
                              <dd className="text-positive">
                                +{formatKRW(Math.max(0, c.totalLifetimeTaxAndHealthSaved))}
                              </dd>
                            </div>
                          </dl>
                          </InfoPop>
                        ),
                      };
                    })}
                  />
                  <div className="info-pop-row">
                    <InfoPop label="왜 이 권고인가요?" title="최적 기준 · 법인 설립 손익분기 판정">
                  <p className="optimal-criterion-note num">{optimalTradeoffNote(strategyCards, plan.winner, plan.recommendation)}</p>

                  <p className="breakeven-verdict-text num">
                    <strong>가족법인 설립 손익분기(Break-Even) 판정:</strong> {plan.breakEven.verdictSummary} (최소 손익분기 금융자산:{' '}
                    <strong>{formatKRW(plan.breakEven.breakEvenLiquidAssetThreshold)}</strong>)
                  </p>
                    </InfoPop>
                    <InfoPop label="성실신고 22% 피하는 법" wide title="성실신고확인대상 소규모법인 요건 · 회피 원리 · 연말 점검">
                      <SincereFilingGuide summary={plan.sincereFilingSummary} />
                    </InfoPop>
                    {plan.sincereFilingSummary.corpYears > 0 && (
                      <span className="phase-tag num">
                        배당 우세 {plan.sincereFilingSummary.likelyYears}/{plan.sincereFilingSummary.corpYears}년
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Slide 6: 실행 체크리스트 — 생애 단계 타임라인, 설명은 ⓘ */}
              {currentBriefingStep === 6 && (
                <div className="wizard-single-topic-body" style={{ gap: 14 }}>
                  <div className="briefing-slide-lead">
                    국민연금{' '}
                    <span className="text-accent">
                      {claimTimingLabel(pensionComparison.recommendedTiming, inputs.pension.currentAgeSelf, true)} 권장
                    </span>
                    <InfoPop label="출구전략·검증" title="가족법인 출구전략 · 원장 검증">
                  <div className="wizard-2col-grid num">
                    <div className="wizard-Context-pill-box">
                      <span>가족법인 임원 & 출구전략 절세액</span>
                      <strong>
                        {isNoCorpPlan
                          ? `법인 미설립 — 해당 없음 (법인 100% 가정 참고치 +${formatKRW(corporateExit.maxTaxSavedVsSimpleGross)})`
                          : `임원 ${plan.executiveComparison.recommendedCount}인 · 최대 +${formatKRW(corporateExit.maxTaxSavedVsSimpleGross)} 절세`}
                      </strong>
                    </div>
                    <div className="wizard-Context-pill-box">
                      <span>{inputs.pension.currentAgeSelf}~100세 ({rows.length}개년) 회계오차</span>
                      <strong className="text-positive">
                        {activeLedger.maxAccountingResidualAbs}원 (완전 일치)
                      </strong>
                    </div>
                  </div>
                    </InfoPop>
                  </div>
                  <ol className="bv-timeline">
                    {plan.actionChecklist.map((item) => {
                      const done = Boolean(checkedItems[item.id]);
                      return (
                        <li key={item.id} className={`bv-tl-item ${done ? 'bv-tl-done' : ''}`}>
                          <span className="phase-tag">{item.phaseLabel}</span>
                          <label className="bv-tl-check">
                            <input type="checkbox" checked={done} onChange={() => toggleCheck(item.id)} />
                            <strong>{item.title}</strong>
                          </label>
                          <InfoPop label="왜·어떻게" title={item.title}>
                            <p>
                              <strong>{item.category}</strong> · {item.impactSummary}
                            </p>
                            <p>{item.description}</p>
                          </InfoPop>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
            </div>

            {/* 각 슬라이드 하단: ③ 상세 분석 & 원장의 해당 렌즈(tile1~tile4) 직행 바 */}
            <div className="briefing-deepdive-bar">
              <button
                type="button"
                className="step-detail-toggle-btn briefing-deepdive-btn"
                onClick={() => handleJumpToAnalytics(activeSlide.targetTile)}
              >
                <span>
                  📊 <strong>이 슬라이드의 심층 차트·원장 바로 보기</strong> — {activeSlide.deepDiveLabel}
                </span>
                <strong>③ 상세 분석 & 원장으로 이동 →</strong>
              </button>

              {currentBriefingStep === 6 && (
                <button
                  type="button"
                  className="step-detail-toggle-btn briefing-deepdive-btn"
                  style={{ marginTop: 8 }}
                  onClick={() => handleJumpToAnalytics('tile4')}
                >
                  <span>
                    📋 <strong>51개년 연차별 현금흐름 원장 표 & CSV 바로 보기</strong> — 매년 수입·지출·8단계 인출·세금·건보료 전체 원장
                  </span>
                  <strong>분석 04 원장 표 열기 →</strong>
                </button>
              )}
            </div>

            {/* 하단 이전 / 다음 브리핑 슬라이드 네비게이션 */}
            <div className="wizard-card-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  if (currentBriefingStep <= 1) {
                    onBackToWizard();
                  } else {
                    setCurrentBriefingStep((s) => Math.max(1, s - 1));
                  }
                }}
              >
                {currentBriefingStep <= 1 ? '← 입력 조건 수정 (위저드)' : '← 이전 결과 슬라이드'}
              </button>

              <div className="wizard-footer-center num">
                <span>
                  핵심 결과 브리핑 <strong>{currentBriefingStep} / 6</strong> · {activeSlide.shortLabel}
                </span>
              </div>

              <div className="wizard-footer-right">
                {currentBriefingStep < 6 ? (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setCurrentBriefingStep((s) => Math.min(6, s + 1))}
                  >
                    다음 결과 슬라이드 ({BRIEFING_SLIDES[currentBriefingStep]?.shortLabel}) →
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => handleJumpToAnalytics('tile1')}
                  >
                    📊 ③ 상세 분석 & 원장 전체 보기 →
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* =====================================================================
         * 모드 B: ③ 상세 분석 & 원장 (4대 심층 분석 렌즈)
         * =================================================================== */
        <>
          {/* 상단 4대 핵심 KPI 판정 헤더 */}
          <VerdictHeader plan={plan} />

          {/* 상세 분석 뷰에서는 3단계 실행 가이드를 접을 수 있는 요약 서랍으로 제공 */}
          <div className="wizard-detail-toggle-bar" style={{ marginTop: 0 }}>
            <button
              type="button"
              className={`step-detail-toggle-btn ${showAnalyticsPlaybook ? 'active' : ''}`}
              aria-expanded={showAnalyticsPlaybook}
              onClick={() => setShowAnalyticsPlaybook((prev) => !prev)}
            >
              <span>
                📌 <strong>3단계 실행 공식 & 은퇴 D-Day 5대 계좌 최종 배치표 한눈에 보기</strong> (단일 슬라이드로 보려면 상단 [② 핵심 결과 브리핑]을 누르세요)
              </span>
              <strong>{showAnalyticsPlaybook ? '요약 접기 ▴' : '요약 펼치기 ▾'}</strong>
            </button>
          </div>

          {showAnalyticsPlaybook && (
            <section className="action-blueprint-hero" aria-label="내 금융자산 구성 및 인출 실행 가이드">
              <div className="action-hero-banner">
                <div>
                  <span className="action-hero-kicker">
                    NESTWAY SLIDER · EXECUTIVE ACTION PLAYBOOK · 그래서 어떻게 구성할까?
                  </span>
                  <h1 className="action-hero-title">{headlineText}</h1>
                  <p className="action-hero-sub">
                    아래 <strong>3단계 실행 가이드(① 은퇴 전 적립 ➔ ② 은퇴 당일 5대 계좌 배치 ➔ ③ 은퇴 후 월별 인출 순서)</strong>대로만
                    계좌를 구성하시면 세금과 건강보험료를 법정 최소치로 줄일 수 있습니다.
                  </p>
                </div>
              </div>

              <div className="action-playbook-grid">
                {renderStep1Card()}
                {renderStep3Card()}
              </div>

              {renderStep2DdayBox()}
            </section>
          )}

          {/* [출력 2] 버튼/타일형 상세 분석 결과 셀렉터 */}
          <section className="analysis-tiles-section" aria-label="상세 분석 결과 타일 선택">
            <div className="analysis-tiles-header">
              <div>
                <span className="canvas-kicker">ON-DEMAND DEEP DIVE ANALYTICS</span>
                <h2 className="canvas-title">
                  상세 분석 결과 보기 (원하는 타일을 누르면 아래에 상세 데이터·차트·원장이 열립니다)
                </h2>
              </div>
              {selectedTile && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setSelectedTile(null)}
                >
                  상세 분석 패널 접기 ▴
                </button>
              )}
            </div>

            <div className="analysis-tile-grid" role="tablist" aria-label="상세 분석 카테고리 타일">
              {analysisTiles.map((tile) => {
                const isSelected = selectedTile === tile.key;
                return (
                  <button
                    key={tile.key}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    className={`analysis-tile-card ${isSelected ? 'active' : ''}`}
                    onClick={() => handleTileClick(tile.key)}
                  >
                    <div className="analysis-tile-top">
                      <span className="analysis-tile-badge">{tile.badge}</span>
                      <span className="analysis-tile-cta">
                        {isSelected ? '열림 ▴' : '상세 보기 ▾'}
                      </span>
                    </div>
                    <h3 className="analysis-tile-title">{tile.title}</h3>
                    <div className="analysis-tile-kpi num">
                      <span>{tile.kpiLabel}</span>
                      <strong>{tile.kpiValue}</strong>
                    </div>
                    <p className="analysis-tile-desc">{tile.description}</p>
                  </button>
                );
              })}
            </div>

            {/* 선택된 타일의 상세 차트 / 데이터 / 테이블 렌더링 영역 */}
            {selectedTile && (
              <div className="analysis-drilldown-panel" key={selectedTile}>
                {selectedTile === 'tile1' && (
                  <Lens1AllocationTrack
                    plan={plan}
                    defaultShowSensitivityBand={isPrintMode}
                    onSelectPersonalRatio={(ratio) =>
                      onChangeInputs({
                        ...inputs,
                        hybrid: {
                          useAutoOptimalRatio: false,
                          personalRatio: ratio,
                          corporateRatio: 100 - ratio,
                        },
                      })
                    }
                  />
                )}

                {selectedTile === 'tile2' && <Lens2WaterfallLedger plan={plan} sectionMode="charts" />}

                {selectedTile === 'tile3' && (
                  <Lens3StrategyMatrix
                    plan={plan}
                    snapshotA={snapshotA}
                    onPinSnapshotA={onPinSnapshotA}
                    onClearSnapshotA={onClearSnapshotA}
                    onChangeInputs={onChangeInputs}
                  />
                )}

                {selectedTile === 'tile4' && (
                  <Lens2WaterfallLedger plan={plan} sectionMode="table" />
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

