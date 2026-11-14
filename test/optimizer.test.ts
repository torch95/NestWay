import {
  DEFAULT_SIMULATION_INPUTS,
  defineInputs,
  evaluateSensitivityBand,
  PRESET_SCENARIOS,
  solveOptimizationMasterPlan,
} from '../src/engine';
import { runCanonicalLedger } from '../src/engine/ledgerKernel';
import { evaluatePortfolio } from '../src/engine/pensionAndEtf';
import { formatKRW } from '../src/engine/presets';
import { recommendAllocation, solveSustainableMonthlyLiving } from '../src/engine/optimizer';
import { pickActiveCard } from '../src/components/planVerdict';
import { generateAnnualReturnPath, mulberry32, shiftInputsReturn } from '../src/engine/sensitivityBand';

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// 1. 표준 프리셋(DEFAULT_SIMULATION_INPUTS = 50->60세 은퇴) 마스터 플랜 실행 시간(< 150ms, 병렬 테스트 부하 허용) 및 최적해(optimalHybrid) 우위 불변식 검증
const plan = solveOptimizationMasterPlan(DEFAULT_SIMULATION_INPUTS);
check(plan.computeTimeMs < 150, `마스터 플랜 연산 시간 150ms 이내 (실측: ${plan.computeTimeMs}ms)`);
check(
  plan.optimalHybrid.finalDisposableNetWorth >= plan.personal100.finalDisposableNetWorth &&
    plan.optimalHybrid.finalDisposableNetWorth >= plan.corporate100.finalDisposableNetWorth,
  '황금분할 최적해(optimalHybrid)는 항상 개인 100% 및 법인 100% 이상이어야 함'
);
check(
  plan.allocationCurve.some((pt) => pt.personalRatio === plan.optimalHybrid.personalRatio),
  '배분 효율 곡선에 최적 개인비중(r*) 포인트가 반드시 포함되어야 함'
);
check(plan.allocationStatus === 'OK', '표준 프리셋은 지속 가능(allocationStatus OK)');

// 1-a. 5대 연령별 프리셋 모두 정상 마스터 플랜 도출 확인
for (const preset of PRESET_SCENARIOS) {
  const pPlan = solveOptimizationMasterPlan(preset.inputs);
  check(
    pPlan.optimalHybrid.maxAccountingResidualAbs === 0,
    `[${preset.id}] 최적해 회계 보존 잔차 0원`
  );
  check(
    pPlan.optimalHybrid.finalDisposableNetWorth >= pPlan.personal100.finalDisposableNetWorth &&
      pPlan.optimalHybrid.finalDisposableNetWorth >= pPlan.corporate100.finalDisposableNetWorth,
    `[${preset.id}] 황금분할 최적해 우위 불변식 만족`
  );
}

// 1-b. 그리드+국소 탐색 결과는 0~100 전수 탐색 최적값과 일치해야 함 (±1 이탈 회귀 가드)
let exhaustiveBest = -Infinity;
let exhaustiveRatio = -1;
for (let r = 0; r <= 100; r += 1) {
  const v = runCanonicalLedger(plan.inputs, r).finalDisposableNetWorth;
  if (v > exhaustiveBest) {
    exhaustiveBest = v;
    exhaustiveRatio = r;
  }
}
check(
  plan.optimalHybrid.finalDisposableNetWorth >= exhaustiveBest,
  `r* 순자산(${plan.optimalHybrid.personalRatio}%: ${plan.optimalHybrid.finalDisposableNetWorth}) >= 전수 탐색(${exhaustiveRatio}%: ${exhaustiveBest})`
);

// 1-c. 배분 곡선 보간 플래그: r* 포인트만 실계산, 나머지는 보간 표기
for (const pt of plan.allocationCurve) {
  check(
    pt.sustainableIsInterpolated === (pt.personalRatio !== plan.optimalHybrid.personalRatio),
    `allocationCurve[${pt.personalRatio}] sustainableIsInterpolated 플래그 정확`
  );
}

// 2. 명목(nominal) vs 실질(real) 가치 할인 투영 정합성 검증
const nominalPlan = solveOptimizationMasterPlan(
  defineInputs({
    transition: { ...DEFAULT_SIMULATION_INPUTS.transition, viewMode: 'nominal' },
  })
);
const realPlan = solveOptimizationMasterPlan(
  defineInputs({
    transition: { ...DEFAULT_SIMULATION_INPUTS.transition, viewMode: 'real' },
  })
);
const horizonIdx = nominalPlan.activeLedger.rows.length - 1;
const expectedDiscount = 1 / Math.pow(1.025, horizonIdx);
const expectedRealFinal = Math.round(
  nominalPlan.activeLedger.finalDisposableNetWorth * expectedDiscount
);
check(
  Math.abs(realPlan.activeLedger.finalDisposableNetWorth - expectedRealFinal) <= 2,
  `실질 뷰 최종 가처분 순자산은 명목 × (1/1.025^${horizonIdx})와 일치해야 함`
);

// 3. 법인 출구 전략: 출자원금 비과세 청산이 단순 일괄 청산보다 항상 같거나 유리해야 함
check(
  plan.corporateExit.lumpSumCapitalExempt.netPocketedValue >=
    plan.corporateExit.lumpSumGross.netPocketedValue,
  '출자원금 비과세 청산 실수령액 >= 단순 일괄 청산 실수령액'
);
// 3-a. A1/B5-②: 출구 매트릭스의 원장 출구전략(기본 10년 분할) 실수령 = 원장 청산가치(세금·건보료 차감) — 같은 함수로 계산
{
  // 출구 매트릭스 원천: 권고 원장에 법인이 있으면 그 원장, 권고가 개인 100%(B7 기각)이면 법인 100% 원장 (optimizer.ts)
  const exitSource =
    plan.activeLedger.corporateRatio > 0 ? plan.activeLedger : plan.corporate100;
  const last = exitSource.rows[exitSource.rows.length - 1];
  const phased = plan.corporateExit.phasedExit;
  const ledgerValue = Math.round(last.endCorpLiquidationNetValue * last.discountFactor);
  check(
    Math.abs(phased.netPocketedValue - ledgerValue) <= 2,
    `출구 매트릭스(분할) 실수령 = 원장 청산가치 (${phased.netPocketedValue} vs ${ledgerValue})`
  );
  const yearlyCap = 4_591_740 * 12 * (1 + 0.1314) * last.discountFactor;
  const ex = plan.corporateExit;
  check(
    ex.lumpSumGross.extraHealthInsPaid <= Math.round(yearlyCap) + 1 &&
      ex.lumpSumCapitalExempt.extraHealthInsPaid <= Math.round(yearlyCap) + 1 &&
      ex.phasedExit.extraHealthInsPaid <= Math.round(yearlyCap * 10) + 1,
    `B5-② 출구 건보료는 법정 월 상한 이내(일시 1년·분할 10년) (${ex.lumpSumGross.extraHealthInsPaid}/${ex.lumpSumCapitalExempt.extraHealthInsPaid}/${ex.phasedExit.extraHealthInsPaid})`
  );
  check(
    phased.exitTaxPaid >= (phased.corporateLevelTax ?? -1) && (phased.corporateLevelTax ?? -1) >= 0,
    '출구 세액에 법인 단계 잠재 법인세(corporateLevelTax) 포함·노출'
  );
}

// 4. 한계 월생활비 솔버(Bisection) 결과 검증
check(
  plan.cards.hybrid.sustainableMonthlyLivingExpense >= 5_000_000,
  '표준 프리셋 지속가능 월생활비는 목표 500만 원 이상이어야 함'
);

// 5. 전 후보 고갈(ALL_DEPLETE): 생활비 월 5,000만 원이면 어떤 비율도 지속 불가 → status 분기 + 법인 0% 고정 승자 금지
const depletePlan = solveOptimizationMasterPlan(
  defineInputs({
    cashflow: { ...DEFAULT_SIMULATION_INPUTS.cashflow, targetNetMonthlyLivingExpense: 50_000_000 },
  })
);
check(depletePlan.allocationStatus === 'ALL_DEPLETE', '월 5,000만 생활비는 ALL_DEPLETE 판정');
check(
  depletePlan.allocationCurve.every((pt) => pt.depletionAgeSelf !== null),
  'ALL_DEPLETE 시 곡선의 모든 포인트가 고갈 연령을 가짐'
);
check(
  depletePlan.winnerTitle.includes('지속 불가'),
  `ALL_DEPLETE winnerTitle은 지속 불가를 명시해야 함 (실제: ${depletePlan.winnerTitle})`
);
check(
  depletePlan.winnerTitle.includes(`개인 ${depletePlan.recommendation.personalRatio}%`) &&
    depletePlan.winnerTitle.includes(`${depletePlan.activeLedger.depletionAgeSelf}세`),
  `B7 ALL_DEPLETE 제목은 권고 배분·activeLedger 고갈 연령과 일치 (실제: ${depletePlan.winnerTitle})`
);
// 동률(순자산 0)일 때 승자는 가장 늦게 고갈되는 비율이어야 함 (첫 후보 r=0 고정 금지)
const latestDepletion = Math.max(
  ...depletePlan.allocationCurve.map((pt) => pt.depletionAgeSelf ?? -1)
);
check(
  (depletePlan.optimalHybrid.depletionAgeSelf ?? -1) >= latestDepletion,
  'ALL_DEPLETE 승자는 고갈 연령이 가장 늦은 후보'
);

// 6. 실행 체크리스트 문구는 입력에 따라 분기 (퇴직금 IRP 이연 여부 · 추천 출구 전략)
const lumpPlan = solveOptimizationMasterPlan(
  defineInputs({
    transition: { ...DEFAULT_SIMULATION_INPUTS.transition, severanceTransferToIrp: false },
  })
);
const ddayIrp = plan.actionChecklist.find((a) => a.id === 'act-2-dday');
const ddayLump = lumpPlan.actionChecklist.find((a) => a.id === 'act-2-dday');
check(
  Boolean(ddayIrp?.description.includes('IRP로 이연')) &&
    Boolean(ddayLump?.description.includes('일시 수령')),
  '체크리스트 D-Day 문구는 severanceTransferToIrp에 따라 분기'
);
const exitItem = plan.actionChecklist.find((a) => a.id === 'act-4-exit');
const exitMap = {
  lump_sum_gross: plan.corporateExit.lumpSumGross,
  lump_sum_capital_exempt: plan.corporateExit.lumpSumCapitalExempt,
  phased_dividend_reduction: plan.corporateExit.phasedExit,
  family_share_transfer: plan.corporateExit.familySuccession,
} as const;
check(
  plan.recommendation.personalRatio === 100
    ? Boolean(exitItem?.title.includes('법인 미설립'))
    : Boolean(exitItem?.title.includes(exitMap[plan.corporateExit.recommendedExit].title)),
  '체크리스트 출구 문구는 recommendedExit 전략 제목을 사용 (법인 미설립 권고 시 "해당 없음")'
);

// 7. Phase D: 결정론적 수익률 민감도 밴드(±2.0%p) & P10/P50/P90 100세 생존확률 검증
const band1 = evaluateSensitivityBand(DEFAULT_SIMULATION_INPUTS, plan.optimalHybrid.personalRatio, 25);
const band2 = evaluateSensitivityBand(DEFAULT_SIMULATION_INPUTS, plan.optimalHybrid.personalRatio, 25);
check(
  band1.p10FinalNetWorth === band2.p10FinalNetWorth &&
    band1.p50FinalNetWorth === band2.p50FinalNetWorth &&
    band1.p90FinalNetWorth === band2.p90FinalNetWorth &&
    band1.survivalProbabilityPercent === band2.survivalProbabilityPercent,
  '시드 고정 PRNG(mulberry32) 기반 민감도 밴드는 100% 결정론적으로 재현되어야 함'
);
check(
  band1.p10FinalNetWorth <= band1.p50FinalNetWorth &&
    band1.p50FinalNetWorth <= band1.p90FinalNetWorth,
  `분위수 단조성 성립: P10(${band1.p10FinalNetWorth}) <= P50(${band1.p50FinalNetWorth}) <= P90(${band1.p90FinalNetWorth})`
);
check(
  band1.minus2FinalNetWorth <= band1.baseFinalNetWorth &&
    band1.baseFinalNetWorth <= band1.plus2FinalNetWorth,
  '±2.0%p 시나리오 순자산 단조성: Low(-2%p) <= Base <= High(+2%p)'
);
check(
  band1.bandPoints.length === plan.activeLedger.rows.length &&
    band1.survivalProbabilityPercent >= 0 &&
    band1.survivalProbabilityPercent <= 100,
  '민감도 밴드 연차 포인트 수 일치 및 생존확률 [0, 100] 범위 준수'
);

// 7-b. E5: 몬테카를로는 연도별 i.i.d. 정규 수익률 경로(순서위험 반영)여야 하며 가정을 결과에 노출
{
  const a = band1.mcAssumptions;
  check(
    a.model === 'iid_normal_annual' &&
      a.annualVolatilityPct === 12 &&
      Math.abs(a.driftCorrectionPct - 0.72) < 1e-9 &&
      a.sampleCount === 25 &&
      a.antithetic === true,
    `MC 가정 노출: i.i.d. 연 σ 12%p, +σ²/2 = 0.72%p 보정, 표본 25, antithetic (실측 ${JSON.stringify(a)})`
  );
  const path = generateAnnualReturnPath(mulberry32(42), 4000, 12);
  const mean = path.reduce((s, v) => s + v, 0) / path.length;
  const sd = Math.sqrt(path.reduce((s, v) => s + (v - mean) ** 2, 0) / path.length);
  check(
    path.length === 4000 && Math.abs(mean - 0.72) < 0.6 && Math.abs(sd - 12) < 0.6,
    `연도별 충격 평균 ≈ +0.72%p, 표준편차 ≈ 12%p (실측 mean ${mean.toFixed(3)}, sd ${sd.toFixed(3)})`
  );
  const defaultBand = evaluateSensitivityBand(DEFAULT_SIMULATION_INPUTS, plan.optimalHybrid.personalRatio);
  check(defaultBand.mcAssumptions.sampleCount === 100, '기본 표본 수 100 (생존확률 해상도 1%p)');
}

// 7-a. v1.2.14 T5 (D3): 밴드 ±2.0%p는 간편 모드에서도 정확히 2.0%p여야 함 (기존: growthRate만 옮겨 성장 비중 70% 가중 → ±1.4%p)
{
  const m2 = shiftInputsReturn(DEFAULT_SIMULATION_INPUTS, -2.0);
  const baseEff = evaluatePortfolio(DEFAULT_SIMULATION_INPUTS.asset).effectiveTotalReturn;
  const m2Eff = evaluatePortfolio(m2.asset).effectiveTotalReturn + (m2.asset.returnShiftPct ?? 0);
  check(
    DEFAULT_SIMULATION_INPUTS.asset.inputMode !== 'detailed' &&
      baseEff.toFixed(2) === '5.40' &&
      m2Eff.toFixed(2) === '3.40',
    `간편 모드 기본 입력 −2%p 밴드 경로 실효 수익률 3.40% (실측: ${baseEff.toFixed(2)}% → ${m2Eff.toFixed(2)}%)`
  );
  // 누적: 사용자가 고른 시나리오(−3%p) 위에 밴드 −2%p가 더해짐
  const userLow = defineInputs({ asset: { ...DEFAULT_SIMULATION_INPUTS.asset, returnShiftPct: -3 } });
  check(shiftInputsReturn(userLow, -2.0).asset.returnShiftPct === -5, '밴드 시프트는 returnShiftPct에 누적');
  // 밴드 −2%p 경로 = 커널에 returnShiftPct −2를 준 원장과 1원 단위 일치
  const r = plan.optimalHybrid.personalRatio;
  const kernelM2 = runCanonicalLedger(
    defineInputs({ asset: { ...DEFAULT_SIMULATION_INPUTS.asset, returnShiftPct: -2 } }),
    r
  );
  check(
    band1.minus2FinalNetWorth === kernelM2.finalDisposableNetWorth,
    `밴드 −2%p 100세 순자산(${band1.minus2FinalNetWorth}) = 커널 시프트 −2 원장(${kernelM2.finalDisposableNetWorth})`
  );
  // 커널 실측: 일반계좌 1억만 둔 격리 입력에서 밴드 −2%p 경로 1년차 투자수익 = 정확히 3.40% (340만)
  const iso = defineInputs({
    asset: { ...DEFAULT_SIMULATION_INPUTS.asset, totalInvestment: 100_000_000 },
    accounts: {
      ...DEFAULT_SIMULATION_INPUTS.accounts,
      selfRetirementPensionBalance: 0,
      spouseRetirementPensionBalance: 0,
      selfIsaBalance: 0,
      spouseIsaBalance: 0,
      selfPersonalPensionBalance: 0,
      spousePersonalPensionBalance: 0,
    },
  });
  const isoM2Return = runCanonicalLedger(shiftInputsReturn(iso, -2.0), 100).rows[0].grossInvestmentReturn;
  check(isoM2Return === 3_400_000, `커널 밴드 −2%p 1년차 실효 수익률 3.40% (실측 ${isoM2Return}원 / 1억)`);
}

// 8. v1.2.6: 법인 손익분기 진단(corporateBreakEven)과 황금분할 최적해(optimalHybrid) 판정 일관성 & 실질가치(viewMode: 'real') 생애 총 세금·건보 할인 정합성 검증
for (const preset of PRESET_SCENARIOS) {
  const pPlan = solveOptimizationMasterPlan(preset.inputs);
  const hybridAdv =
    pPlan.optimalHybrid.finalDisposableNetWorth - pPlan.personal100.finalDisposableNetWorth;
  const corpAdv =
    pPlan.corporate100.finalDisposableNetWorth - pPlan.personal100.finalDisposableNetWorth;
  // E-4: B7 강건성 게이트가 법인안을 기각(권고 개인 100%)하면 손익분기도 개인으로 동기화
  const shouldRecommendCorp =
    pPlan.optimalHybrid.corporateRatio > 0 &&
    Math.max(hybridAdv, corpAdv) > 0 &&
    pPlan.recommendation.personalRatio !== 100;
  check(
    pPlan.breakEven.isAboveBreakEven === shouldRecommendCorp,
    `[${preset.id}] breakEven.isAboveBreakEven(${pPlan.breakEven.isAboveBreakEven})은 최적해 법인 유리 + B7 권고 판정(${shouldRecommendCorp})과 일치해야 함`
  );
  if (shouldRecommendCorp) {
    check(
      pPlan.breakEven.verdictSummary.includes(
        `법인 ${pPlan.optimalHybrid.corporateRatio}%`
      ),
      `[${preset.id}] 손익분기 판정 배지는 최적 법인 비중(${pPlan.optimalHybrid.corporateRatio}%)을 명시해야 함`
    );
  }
}

check(
  realPlan.personal100.totalLifetimeTaxAndHealthCost <
    nominalPlan.personal100.totalLifetimeTaxAndHealthCost &&
    realPlan.optimalHybrid.totalLifetimeTaxAndHealthCost <
      nominalPlan.optimalHybrid.totalLifetimeTaxAndHealthCost &&
    realPlan.corporate100.totalLifetimeTaxAndHealthCost <
      nominalPlan.corporate100.totalLifetimeTaxAndHealthCost,
  `실질 구매력 모드(viewMode: 'real') 생애 총 세금·건보·유지비는 물가할인계수(discountFactor)가 적용되어 명목 합계보다 작아야 함`
);

const expectedRealLifetimeCost = realPlan.activeLedger.rows.reduce(
  (acc, r) => acc + Math.round(r.totalTaxHealthAndFees * r.discountFactor),
  0
);
check(
  realPlan.activeLedger.totalLifetimeTaxAndHealthCost === expectedRealLifetimeCost,
  `실질 모드 totalLifetimeTaxAndHealthCost(${realPlan.activeLedger.totalLifetimeTaxAndHealthCost}) === Σ Math.round(row.totalTaxHealthAndFees * row.discountFactor)(${expectedRealLifetimeCost})`
);

// 9. v1.2.10 CFP/PB 전문가 리뷰 반영 검증:
//    - Task 1: 실질 가치 모드(viewMode: 'real')에서 국민연금 수령시기 비교표(pensionComparison)의 월 수령액이 개시 시점 물가할인계수(discountFactor)와 1원 단위 일치
const firstNormalPenRow = realPlan.activeLedger.rows.find((r) => r.publicPensionInflow > 0);
const expectedRealMonthlyPen = firstNormalPenRow
  ? Math.round((firstNormalPenRow.publicPensionInflow * firstNormalPenRow.discountFactor) / 12)
  : 0;
check(
  realPlan.pensionComparison.normal.monthlyPayoutInitial === expectedRealMonthlyPen &&
    realPlan.pensionComparison.normal.monthlyPayoutInitial <
      nominalPlan.pensionComparison.normal.monthlyPayoutInitial,
  `실질 모드 국민연금 초기 월수령액(${realPlan.pensionComparison.normal.monthlyPayoutInitial}) === 개시연차 할인 월액(${expectedRealMonthlyPen})`
);

//    - Task 3: 본인만 개인연금저축을 보유하고 부부 모두 IRP를 보유한 경우(53세 은퇴 페르소나),
//              본인 연금저축 인출(1,500만)로 인해 배우자 IRP 저율한도(1,500만)가 0원으로 잠기던 60~83세 단절 현상이 해소되고 10년 연금수령한도로 평탄화되는지 검증
const cfpReviewPersona = defineInputs({
  pension: {
    ...DEFAULT_SIMULATION_INPUTS.pension,
    currentAgeSelf: 50,
    currentAgeSpouse: 50,
    hasSpouse: true,
  },
  transition: {
    ...DEFAULT_SIMULATION_INPUTS.transition,
    targetRetirementAgeSelf: 53,
    expectedSeverancePay: 160_000_000,
    spouseExpectedSeverancePay: 30_000_000,
    severanceTransferToIrp: true,
  },
  accounts: {
    ...DEFAULT_SIMULATION_INPUTS.accounts,
    selfPersonalPensionBalance: 80_000_000,
    spousePersonalPensionBalance: 0,
    selfRetirementPensionBalance: 120_000_000,
    spouseRetirementPensionBalance: 30_000_000,
    selfIsaBalance: 60_000_000,
    spouseIsaBalance: 60_000_000,
  },
});
const cfpPlan = solveOptimizationMasterPlan(cfpReviewPersona);
check(
  cfpPlan.activeLedger.maxAccountingResidualAbs === 0,
  'CFP 리뷰 페르소나 51개년 회계 오차 0원'
);
// 저율한도 잠금 회귀 검증은 r*와 무관해야 하므로 고정 비율(개인 17%, A1 이전 r*)에서 확인
// (A1 이후 r*≈52%에서는 65~69세 수요가 국민연금·연금저축으로 충당돼 IRP 인출이 필요 없어지는 정상 동작)
const rows60to70 = runCanonicalLedger(cfpReviewPersona, 17).rows.filter(
  (r) => r.ageSelf >= 60 && r.ageSelf <= 70
);
check(
  rows60to70.every((r) => r.stage3IrpWithdrawal > 0),
  '배우자 IRP 보유 시 60~70세 구간에서 IRP 인출이 0원으로 단절되지 않고 연속 인출되어야 함'
);
check(
  cfpPlan.corporateExit.familySuccession.title === '자녀 지분 참여 · 가족법인 지분승계',
  '금융투자법인은 가업상속공제 대상이 아니므로 출구전략 명칭이 가족법인 지분승계여야 함'
);
check(
  typeof cfpPlan.pensionComparison.early.crossoverAgeVsNormal === 'number' &&
    cfpPlan.pensionComparison.early.crossoverAgeVsNormal >= 70 &&
    typeof cfpPlan.pensionComparison.deferred.crossoverAgeVsNormal === 'number' &&
    cfpPlan.pensionComparison.deferred.crossoverAgeVsNormal >= 75 &&
    cfpPlan.pensionComparison.normal.crossoverAgeVsNormal === null,
  `국민연금 조기/연기 수령의 정상수령 대비 누적 수령액 교차 연령(early=${cfpPlan.pensionComparison.early.crossoverAgeVsNormal}, deferred=${cfpPlan.pensionComparison.deferred.crossoverAgeVsNormal}) 산출 검증`
);
check(
  cfpPlan.activeLedger.rows.every((r) => typeof r.dependentIncomeHeadroom === 'number'),
  '모든 원장 연차 행에 피부양자 소득 여유 한도(dependentIncomeHeadroom) 산출 검증'
);

// B6. 체크리스트 문구는 엔진 r*와 모순되지 않아야 함 (#61): 개인 100% 최적안이면 법인 출자·가수금·출구·승계 권고 0건, 싱글이면 '부부' 0건
{
  const byId = (id: string) => PRESET_SCENARIOS.find((p) => p.id === id)!;
  const early = solveOptimizationMasterPlan(byId('early-45-50').inputs);
  const items = early.actionChecklist.filter((a) => a.id === 'act-2-dday' || a.id === 'act-4-exit');
  const text = items.map((a) => `${a.title} ${a.impactSummary} ${a.description}`).join(' ');
  check(
    early.optimalHybrid.personalRatio === 100 && !/지분승계|가수금|가족법인 0%/.test(text),
    `B6 개인 100% 최적안(early-45-50)의 act-2/act-4에 법인 권고 없음 (r*=${early.optimalHybrid.personalRatio}: ${text.slice(0, 120)})`
  );
  const single = solveOptimizationMasterPlan(byId('fire-40-45-single').inputs);
  const singleText = single.actionChecklist.map((a) => `${a.title} ${a.impactSummary} ${a.description}`).join(' ');
  check(!singleText.includes('부부'), "B6 싱글 프리셋 체크리스트에 '부부' 0건");
  const exitItem4 = plan.actionChecklist.find((a) => a.id === 'act-4-exit')!;
  check(
    !/\+0억/.test(exitItem4.impactSummary) &&
      (plan.recommendation.personalRatio === 100
        ? exitItem4.impactSummary.includes('가족법인을 설립하지 않으므로')
        : plan.corporateExit.recommendedExit === 'lump_sum_gross'
          ? exitItem4.impactSummary.includes('추가 절세 효과 없음')
          : exitItem4.impactSummary.includes(formatKRW(plan.corporateExit.maxTaxSavedVsSimpleGross))),
    `B6 출구 절세액은 Lens3와 같은 formatKRW 표기, 법인 미설립 권고 시 "해당 없음" ('${exitItem4.impactSummary}')`
  );
  check(!/\d{2},\d{3}만/.test(plan.breakEven.verdictSummary), `B6 손익분기 문구 억/만 표기 ('${plan.breakEven.verdictSummary.slice(0, 160)}')`);
}

// B7. r* 실익 임계(#72·#73): 권고 = r*<100 && [유지비×1.5·수익률 −0.5%p 강건성] && [지속가능 월생활비 ≥ 개인100% − 5만] || 고갈 구제 || 고갈 +3년
{
  const base = {
    bestRatio: 40,
    optimalFinal: 1_050_000_000,
    personalFinal: 1_000_000_000,
    optimalDepletionAge: null as number | null,
    personalDepletionAge: null as number | null,
    sustainableHybrid: 6_000_000,
    sustainablePersonal: 6_000_000,
    robustToMaintenance: true,
    robustToReturn: true,
  };
  const ok = recommendAllocation(base);
  check(
    ok.personalRatio === 40 && ok.isMathematicalOptimum && ok.netWorthGainPct === 5 && ok.netWorthGainKrw === 50_000_000 && !ok.robustnessFailure,
    `B7 강건·월 비열위 → r* 권고 (${JSON.stringify(ok)})`
  );
  const fragile = recommendAllocation({ ...base, robustToMaintenance: false });
  check(
    fragile.personalRatio === 100 && !fragile.isMathematicalOptimum && fragile.robustnessFailure === 'maintenance' &&
      fragile.reason.includes('유지비') && fragile.reason.includes('5,000만') && fragile.reason.includes('5.0%'),
    `B7 유지비×1.5에서 뒤집히면 개인 100% + 사유(이득률·절대액·원인) (${fragile.reason})`
  );
  check(recommendAllocation({ ...base, robustToMaintenance: false, robustToReturn: false }).robustnessFailure === 'maintenance_and_return', 'B7 두 섭동 모두 실패');
  const lowerMonthly = recommendAllocation({ ...base, sustainableHybrid: 5_940_000 });
  check(lowerMonthly.personalRatio === 100 && lowerMonthly.sustainableMonthlyDelta === -60_000 && lowerMonthly.reason.includes('6만'), `B7 월생활비 6만 열위 → 개인 100% (${lowerMonthly.reason})`);
  check(recommendAllocation({ ...base, sustainableHybrid: 5_960_000 }).personalRatio === 40, 'B7 월생활비 −4만은 허용(−5만 이내 동률)');
  const rescue = recommendAllocation({ ...base, robustToReturn: false, personalDepletionAge: 88, sustainableHybrid: 5_000_000 });
  check(rescue.personalRatio === 40 && rescue.reason.includes('88세'), 'B7 개인 100%만 고갈되면 고갈 구제로 r* 권고');
  check(
    recommendAllocation({ ...base, robustToMaintenance: false, optimalDepletionAge: 91, personalDepletionAge: 88 }).personalRatio === 40 &&
      recommendAllocation({ ...base, robustToMaintenance: false, optimalDepletionAge: 90, personalDepletionAge: 88 }).personalRatio === 100,
    'B7 고갈 연령 +3년 이상이면 r*, +2년이면 개인'
  );
  check(recommendAllocation({ ...base, bestRatio: 100 }).isMathematicalOptimum, 'B7 r*=100이면 그대로');
  const bothDeplete = recommendAllocation({ ...base, optimalFinal: 0, personalFinal: 0, robustToMaintenance: false, robustToReturn: false, optimalDepletionAge: 83, personalDepletionAge: 82 });
  check(
    bothDeplete.personalRatio === 100 && bothDeplete.reason.includes('83세') && bothDeplete.reason.includes('82세') && !bothDeplete.reason.includes('+0원'),
    `B7 둘 다 고갈(+1년)이면 고갈 연령 비교 사유 (${bothDeplete.reason})`
  );
  // 통합: auto 모드 activeLedger·winner·체크리스트 = 권고 비율, 수동 모드는 사용자 비율
  check(
    plan.activeLedger.personalRatio === plan.recommendation.personalRatio &&
      plan.optimalHybrid.personalRatio === exhaustiveRatio &&
      (plan.recommendation.personalRatio === 100 ? plan.winner === 'personal' : plan.winner !== 'personal'),
    `B7 auto 모드 activeLedger·winner = 권고 (r*=${plan.optimalHybrid.personalRatio}, 권고=${plan.recommendation.personalRatio}: ${plan.recommendation.reason})`
  );
  const manual = solveOptimizationMasterPlan(
    defineInputs({ ...DEFAULT_SIMULATION_INPUTS, hybrid: { ...DEFAULT_SIMULATION_INPUTS.hybrid, useAutoOptimalRatio: false, personalRatio: 30 } })
  );
  check(manual.activeLedger.personalRatio === 30, 'B7 수동 비율 모드는 사용자 비율 유지');
}

// ── v2 B2: E-4 B7 기각 시 손익분기·체크리스트 동기화, "48년" 교정, G2 유지비 마찰 = 원장 첫 은퇴연도 ──
{
  for (const preset of PRESET_SCENARIOS) {
    const pp = solveOptimizationMasterPlan(preset.inputs);
    const retYears = pp.personal100.rows.filter((r) => !r.isEmployed).length;
    check(
      !pp.breakEven.verdictSummary.includes('48년') || retYears === 48,
      `E-4 [${preset.id}] verdictSummary에 하드코딩 "48년" 금지 (은퇴 ${retYears}년)`
    );
    if (pp.recommendation.personalRatio === 100) {
      const act3 = pp.actionChecklist.find((a) => a.id === 'act-3-health')!;
      check(
        pp.breakEven.recommendedStrategy === 'personal' &&
          !pp.breakEven.isAboveBreakEven &&
          !/하이브리드[^.]*증가/.test(pp.breakEven.verdictSummary) &&
          !/하이브리드[^.]*증가/.test(act3.description) &&
          !act3.impactSummary.includes('방어 약'),
        `E-4 [${preset.id}] 권고 개인 100%면 손익분기·act-3도 개인 기준 (${pp.breakEven.recommendedStrategy}: ${pp.breakEven.verdictSummary.slice(0, 80)} / ${act3.impactSummary})`
      );
    }
  }
  // B7 기각 강제 케이스: 유지비 600만
  const feePlan = solveOptimizationMasterPlan(
    defineInputs({
      ...DEFAULT_SIMULATION_INPUTS,
      corporate: { ...DEFAULT_SIMULATION_INPUTS.corporate, annualFixedMaintenanceFee: 6_000_000 },
    })
  );
  check(
    feePlan.recommendation.personalRatio !== 100 || feePlan.breakEven.recommendedStrategy === 'personal',
    `E-4 유지비 600만 B7 기각 시 손익분기 personal (${feePlan.breakEven.recommendedStrategy})`
  );

  // G2: 손익분기 "유지·보수 비용"과 임원비교 4대보험은 원장 첫 은퇴연도(임원별 나이·요율) 값과 일치
  for (const id of ['standard-50-60', 'hybrid-50-55-corp50', 'corp-100-focus', 'immediate-60-60']) {
    const pp = solveOptimizationMasterPlan(PRESET_SCENARIOS.find((p) => p.id === id)!.inputs);
    const src = pp.optimalHybrid.corporateRatio > 0 ? pp.optimalHybrid : pp.corporate100;
    const row = src.rows.find((r) => !r.isEmployed)!;
    const ledgerFixed = row.corpMaintenanceAndFixedCost + row.corpPayrollTaxAndInsurance;
    check(
      Math.abs(pp.breakEven.annualCorporateFixedCost - ledgerFixed) <= 10_000,
      `G2 [${id}] 손익분기 유지·보수 비용 ${pp.breakEven.annualCorporateFixedCost} = 원장 첫 은퇴연도 ${ledgerFixed}`
    );
    const execOpt =
      pp.inputs.corporate.executiveCount === 2 ? pp.executiveComparison.jointExec : pp.executiveComparison.singleExec;
    check(
      Math.abs(execOpt.annualTaxAnd4InsCost - row.corpPayrollTaxAndInsurance) <= 10_000,
      `G2 [${id}] 임원비교 4대보험/세금 ${execOpt.annualTaxAnd4InsCost} = 원장 ${row.corpPayrollTaxAndInsurance}`
    );
  }

  // v1.2.22: 법인 50% 균형(hybrid-50-55-corp50) 및 법인 100% 집중(corp-100-focus) 프리셋 수렴 검증
  const corp50Plan = solveOptimizationMasterPlan(
    PRESET_SCENARIOS.find((p) => p.id === 'hybrid-50-55-corp50')!.inputs
  );
  check(
    corp50Plan.optimalHybrid.corporateRatio === 50 &&
      corp50Plan.recommendation.corporateRatio === 50 &&
      corp50Plan.recommendation.isMathematicalOptimum === true &&
      corp50Plan.winner === 'hybrid',
    `v1.2.22 [hybrid-50-55-corp50] 법인 50% 최적 수렴 (r* corp=${corp50Plan.optimalHybrid.corporateRatio}%, rec corp=${corp50Plan.recommendation.corporateRatio}%, winner=${corp50Plan.winner})`
  );
  const corp100Plan = solveOptimizationMasterPlan(
    PRESET_SCENARIOS.find((p) => p.id === 'corp-100-focus')!.inputs
  );
  check(
    corp100Plan.optimalHybrid.corporateRatio === 100 &&
      corp100Plan.recommendation.corporateRatio === 100 &&
      corp100Plan.recommendation.isMathematicalOptimum === true &&
      corp100Plan.winner === 'corporate' &&
      !PRESET_SCENARIOS.some((p) => p.id === 'late-55-60'),
    `v1.2.22 [corp-100-focus] 법인 100% 최적 수렴 (r* corp=${corp100Plan.optimalHybrid.corporateRatio}%, rec corp=${corp100Plan.recommendation.corporateRatio}%, winner=${corp100Plan.winner})`
  );
}

// ── v2 B3: U-1 권고비율·지속가능 월생활비·여유분 단일 정본 (plan.activeCard = activeLedger 비율의 실계산 카드) ──
{
  const stdIn = PRESET_SCENARIOS.find((p) => p.id === 'standard-50-60')!.inputs;
  const cases: { label: string; plan: ReturnType<typeof solveOptimizationMasterPlan> }[] = [];
  for (const preset of PRESET_SCENARIOS) {
    cases.push({ label: `${preset.id} auto`, plan: solveOptimizationMasterPlan(preset.inputs) });
  }
  for (const r of [0, 1, 30, 50, 70, 99, 100]) {
    cases.push({
      label: `standard manual ${r}`,
      plan: solveOptimizationMasterPlan(
        defineInputs({ ...stdIn, hybrid: { ...stdIn.hybrid, useAutoOptimalRatio: false, personalRatio: r } })
      ),
    });
  }
  for (const { label, plan: pl } of cases) {
    const card = pickActiveCard(pl);
    const r = pl.activeLedger.personalRatio;
    const expectedSust =
      r === 100
        ? pl.cards.personal.sustainableMonthlyLivingExpense
        : r === 0
          ? pl.cards.corporate.sustainableMonthlyLivingExpense
          : r === pl.optimalHybrid.personalRatio
            ? pl.cards.hybrid.sustainableMonthlyLivingExpense
            : solveSustainableMonthlyLiving(pl.inputs, r, undefined, 12);
    check(
      card.personalRatio === r &&
        card.finalDisposableNetWorth === pl.activeLedger.finalDisposableNetWorth &&
        card.sustainableMonthlyLivingExpense === expectedSust &&
        card.monthlyBuffer === expectedSust - pl.inputs.cashflow.targetNetMonthlyLivingExpense,
      `U-1 [${label}] 활성 카드 = activeLedger 비율(${r}%) 실계산 (카드 ${card.personalRatio}% 월 ${card.sustainableMonthlyLivingExpense} vs ${expectedSust})`
    );
  }
}

// ── v2 B4: Batch 2 HNWI/CPA 자본금 등록세, 15년 NOL, 누진 지분승계세 및 상속세 진단 ──
{
  // 자본금 유상증자(capital_stock) 등록면허세(0.48%) 부과 및 회계 보존 0원 검증
  const capStockInputs = defineInputs({
    corporate: { ...DEFAULT_SIMULATION_INPUTS.corporate, fundingStructure: 'capital_stock' },
  });
  const sim = runCanonicalLedger(capStockInputs, 50);
  check(sim.maxAccountingResidualAbs === 0, '자본금(capital_stock) 등록면허세 부과 시 회계 보존 잔차 0원');
  check(sim.rows[0].corpMaintenanceAndFixedCost > 0, '첫 해 법인 유지·비용에 등록면허세 포함');

  // 시장 충격(early_drop_30) 시 15년 이월결손금(NOL) 80% 공제 한도 동작 검증
  const stressInputs = defineInputs({
    transition: { ...DEFAULT_SIMULATION_INPUTS.transition, marketStressScenario: 'early_drop_30' },
  });
  const stressSim = runCanonicalLedger(stressInputs, 0);
  check(stressSim.maxAccountingResidualAbs === 0, 'early_drop_30 충격 하 회계 보존 잔차 0원');
  const rowsWithLoss = stressSim.rows.filter((r) => (r.endCorpCarryforwardLoss ?? 0) > 0);
  check(rowsWithLoss.length > 0, '초기 폭락 시 법인 결손금 이월(NOL) 버킷 적립 검증');

  // 가족법인 지분승계(familySuccession) 상증세법 §26 5단계 누진세율 및 실효세율 검증 (50억 대형 잔고 시 >=20%)
  const richInputs = defineInputs({
    asset: { ...DEFAULT_SIMULATION_INPUTS.asset, totalInvestment: 5_000_000_000 },
  });
  const richPlan = solveOptimizationMasterPlan(richInputs);
  const succ = richPlan.corporateExit.familySuccession;
  check(
    succ.effectiveExitTaxRatePercent >= 20.0,
    `50억 대형 자산가 가족법인 지분승계 실효세율은 누진세율로 20% 이상이어야 함 (실측: ${succ.effectiveExitTaxRatePercent}%)`
  );
  check(
    succ.title === '자녀 지분 참여 · 가족법인 지분승계',
    '가족법인 지분승계 옵션 명칭 준수'
  );

  // 상속세 진단(estateDiagnostic) 및 terminalValuationMode: 'inheritance' 검증
  const inheritPlan = solveOptimizationMasterPlan(
    defineInputs({
      corporate: { ...DEFAULT_SIMULATION_INPUTS.corporate, terminalValuationMode: 'inheritance' },
    })
  );
  const diag = inheritPlan.estateDiagnostic;
  check(diag.terminalValuationMode === 'inheritance', '진단 평가 모드 inheritance 일치');
  check(diag.personal100Estate.grossEstateValue > 0, '개인 100% 총상속재산가액 산출');
  check(diag.personal100Estate.financialAssetDeduction <= 200_000_000, '금융재산상속공제 법정한도 2억 이하');
  check(
    diag.corporate100Estate.financialAssetDeduction <= diag.personal100Estate.financialAssetDeduction,
    '법인 100% 시 최대주주 비상장주식 금융재산상속공제 배제로 개인 100% 이하'
  );
  check(diag.activeEstate.totalNetEstateAfterTax > 0, '활성 배분 세후 총상속재산 산출');
  check(diag.shareholderLoanSafeHarborNote !== null, '가수금 세이프하버 적정이자 안내 노출');

  const pureCorpInputs = defineInputs({
    ...DEFAULT_SIMULATION_INPUTS,
    corporate: { ...DEFAULT_SIMULATION_INPUTS.corporate, terminalValuationMode: 'inheritance' },
    accounts: {
      ...DEFAULT_SIMULATION_INPUTS.accounts,
      selfIsaBalance: 0,
      spouseIsaBalance: 0,
      selfPersonalPensionBalance: 0,
      spousePersonalPensionBalance: 0,
      selfRetirementPensionBalance: 0,
      spouseRetirementPensionBalance: 0,
    },
  });
  const pureCorpPlan = solveOptimizationMasterPlan(pureCorpInputs);
  check(
    pureCorpPlan.estateDiagnostic.corporate100Estate.financialAssetDeduction === 0,
    '순수 법인 100%(개인 금융자산 0) 시 최대주주 비상장주식 금융재산상속공제 배제(0원)'
  );
}

console.log(
  `✅ PASS: optimizer.test.ts (Master plan solved in ${plan.computeTimeMs}ms, optimal split Personal ${plan.optimalHybrid.personalRatio}% : Corp ${plan.optimalHybrid.corporateRatio}%, exhaustive r*=${exhaustiveRatio}%, 6 presets + ALL_DEPLETE guard + sensitivity band + break-even & CFP/PB statutory tasks verified)`
);
