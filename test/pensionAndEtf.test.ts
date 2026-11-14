import {
  calculateAdditionalPensionIncrease,
  calculateAnnualPublicPension,
  calculatePublicPensionWorkReduction,
  classifyKrxEtfTaxProfile,
  evaluatePortfolio,
  evaluateRealEstateForYear,
  getPensionClaimStartAge,
  getStatutoryPensionAge,
  getStressAdjustedGrowthRate,
} from '../src/engine/pensionAndEtf';
import { DEFAULT_SIMULATION_INPUTS } from '../src/engine/presets';

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// 1. 국민연금 추납 증액 공식 검증 (60개월 × 360,000 × 0.0055 = 118,800원)
check(
  calculateAdditionalPensionIncrease(true, 60, 360_000) === 118_800,
  '60개월 추납 월 증액 118,800원'
);
check(calculateAdditionalPensionIncrease(false, 60, 360_000) === 0, '추납 미적용 시 0원');

// 2. 조기(70%) / 정상(100%) / 연기(136%) 수령 및 1인 가구 배우자 가드 검증
const basePen = DEFAULT_SIMULATION_INPUTS.pension;
const normal65 = calculateAnnualPublicPension({
  ageSelf: 65,
  ageSpouse: 65,
  elapsedYears: 0,
  inflationRatePercent: 2.5,
  pension: basePen,
});
check(normal65.selfAnnual === 1_800_000 * 12, '65세 본인 정상수령 연 2,160만 원');
check(normal65.spouseAnnual === 800_000 * 12, '65세 배우자 정상수령 연 960만 원');

const singleHousehold = calculateAnnualPublicPension({
  ageSelf: 65,
  ageSpouse: 65,
  elapsedYears: 0,
  inflationRatePercent: 2.5,
  pension: { ...basePen, hasSpouse: false },
});
check(singleHousehold.spouseAnnual === 0, '1인 가구 배우자 연금 0원 가드');

// 3. 부동산 다운사이징 시 개인 100% (cRatio=0) 자산 증발 방지 가드 검증
const reDownsizePersonalOnly = evaluateRealEstateForYear(
  65,
  {
    ...DEFAULT_SIMULATION_INPUTS.realEstate,
    transition: {
      ...DEFAULT_SIMULATION_INPUTS.realEstate.transition!,
      strategy: 'downsize',
      downsizingAge: 65,
      downsizingActualSurplusCash: 500_000_000,
      downsizingCorpAllocationRatio: 80,
    },
  },
  0
);
check(
  reDownsizePersonalOnly.downsizingPersonalCashInflow === 500_000_000 &&
    reDownsizePersonalOnly.downsizingCorpCashInflow === 0,
  '개인 100% 트랙에서는 다운사이징 잉여금 전액이 개인으로 유입되어야 함'
);

// 4. ETF 포트폴리오 역산 (거시 가중평균 vs 상세 모드) 검증
const macroEval = evaluatePortfolio(DEFAULT_SIMULATION_INPUTS.asset);
check(
  macroEval.effectiveTotalReturn === 5.4,
  '거시 기본 성장 6%(비중 70%) + 배당 4%(비중 30%) = 가중평균 5.4%'
);

const detailedEval = evaluatePortfolio({
  ...DEFAULT_SIMULATION_INPUTS.asset,
  inputMode: 'detailed',
});
check(detailedEval.effectiveTotalReturn > 8.0, '상세 ETF 가중평균 총수익률 산출');
check(detailedEval.overseasDirectRatio === 70, 'VOO 40% + SCHD 30% = 해외직투 70%');

// 5. SORR 하락장 시나리오 검증
check(getStressAdjustedGrowthRate('early_drop_30', 0, 6.0) === -30, '은퇴 첫해 -30% 충격');
check(getStressAdjustedGrowthRate('early_drop_30', -1, 6.0) === 6.0, '은퇴 전에는 기본 성장률');

// 6. 2026.06.17 국민연금 소득활동 감액 개편(A값+200만 = 월 5,193,511원 미만 감액 폐지) 및 국내상장 커버드콜 비과세 분배금 비중 검증
check(
  calculatePublicPensionWorkReduction(1_800_000, 4_500_000, true).monthlyReduction === 0 &&
    calculatePublicPensionWorkReduction(1_800_000, 4_500_000, false).monthlyReduction > 0,
  '2026.06.17 개편안 적용 시 월 소득 450만 원(A값+200만 미만)은 국민연금 감액 0원'
);
check(
  calculatePublicPensionWorkReduction(1_800_000, 7_000_000, true).monthlyReduction > 0 &&
    calculatePublicPensionWorkReduction(1_800_000, 7_000_000, true).monthlyReduction <= 900_000,
  'A값+200만 원 초과 소득 구간에서는 초과분 단계별 감액 및 연금액 50% 상한 준수'
);
const coveredCallEval = evaluatePortfolio({
  ...DEFAULT_SIMULATION_INPUTS.asset,
  inputMode: 'detailed',
  holdings: [
    ...(DEFAULT_SIMULATION_INPUTS.asset.holdings ?? []),
    {
      ticker: '458760',
      name: 'TIGER 미국배당+7%프리미엄다우존스',
      market: 'KRX',
      amount: 200_000_000,
      ratio: 20,
      category: 'COVERED_CALL',
      expenseRatio: 0.39,
      actualExpenseRatio: 0.48,
      dividendYield: 10.2,
      dividendCycle: 'Monthly',
      expectedGrowthRate: 2.5,
      productType: 'covered_call',
    },
  ],
});
check(
  typeof coveredCallEval.taxableDividendRatio === 'number' &&
    coveredCallEval.taxableDividendRatio < 1.0 &&
    typeof coveredCallEval.krxTaxableGainRatio === 'number' &&
    coveredCallEval.krxTaxableGainRatio > 0,
  '상세 ETF 모드에서 국내상장 커버드콜(TIGER 미국배당+7%프리미엄) 편입 시 과표배당 비중(<1.0) 및 국내기타ETF 매매차익 과세비중(>0) 산출'
);

// 7. KR_INDEX 국내 시장대표지수 ETF 매매차익 비과세(krxTaxableGainRatio === 0) 및 273130 채권 프리셋 보정 검증
import { STARTER_SHELTERED_ETF_HOLDINGS } from '../src/engine/presets';
const krIndexEval = evaluatePortfolio({
  totalInvestment: 500_000_000,
  investmentHorizon: 30,
  growthEtfRatio: 70,
  dividendEtfRatio: 30,
  growthRate: 6,
  dividendYield: 4,
  overseasEtfRatio: 0,
  inputMode: 'detailed',
  holdings: [
    {
      ticker: '292150',
      name: 'TIGER TOP10',
      market: 'KRX',
      amount: 300_000_000,
      ratio: 60,
      category: 'KR_INDEX',
      expenseRatio: 0.15,
      actualExpenseRatio: 0.22,
      dividendYield: 2.5,
      dividendCycle: 'Quarterly',
      expectedGrowthRate: 5.5,
      productType: 'domestic_listed',
    },
    {
      ticker: '069500',
      name: 'KODEX 200',
      market: 'KRX',
      amount: 200_000_000,
      ratio: 40,
      category: 'KR_INDEX',
      expenseRatio: 0.15,
      actualExpenseRatio: 0.19,
      dividendYield: 2.0,
      dividendCycle: 'Quarterly',
      expectedGrowthRate: 5.0,
      productType: 'domestic_listed',
    },
  ],
});
check(
  krIndexEval.krxTaxableGainRatio === 0,
  `KRX 국내 시장대표지수(KR_INDEX) ETF는 일반계좌 매매차익 비과세(krxTaxableGainRatio === 0)여야 함 (실측: ${krIndexEval.krxTaxableGainRatio})`
);
const bond273130 = STARTER_SHELTERED_ETF_HOLDINGS.find((h) => h.ticker === '273130')!;
check(
  bond273130.expectedGrowthRate === 0.8 &&
    bond273130.dividendYield === 3.4 &&
    bond273130.expenseRatio === 0.045 &&
    bond273130.actualExpenseRatio === 0.07,
  'STARTER_SHELTERED_ETF_HOLDINGS 내 273130(KODEX 종합채권액티브) 수익률·배당·보수 현실화 검증'
);

// B5-④. 출생연도별 노령연금 수급개시연령 (국민연금법 부칙 법률 제8541호 §8: 1953~56년생 61세 … 1965~68년생 64세, 1969년생 이후 65세)
check(
  getStatutoryPensionAge(1952) === 60 &&
    getStatutoryPensionAge(1956) === 61 &&
    getStatutoryPensionAge(1960) === 62 &&
    getStatutoryPensionAge(1964) === 63 &&
    getStatutoryPensionAge(1965) === 64 &&
    getStatutoryPensionAge(1968) === 64 &&
    getStatutoryPensionAge(1969) === 65,
  '출생연도별 수급개시연령 60/61/62/63/64/64/65'
);
check(
  getPensionClaimStartAge('early', 1966) === 59 &&
    getPensionClaimStartAge('normal', 1966) === 64 &&
    getPensionClaimStartAge('deferred', 1966) === 69,
  '1966년생: 조기 59 · 정상 64 · 연기 69 (±5년)'
);
{
  // 2026년 60세(1966년생): 64세부터 정상 수령 — 종전 엔진은 65세부터
  const pension = { ...DEFAULT_SIMULATION_INPUTS.pension, hasSpouse: false, claimTimingSelf: 'normal' as const, expectedMonthlyPensionSelf: 1_000_000 };
  const at64 = calculateAnnualPublicPension({ ageSelf: 64, ageSpouse: 64, elapsedYears: 4, inflationRatePercent: 0, pension });
  const at63 = calculateAnnualPublicPension({ ageSelf: 63, ageSpouse: 63, elapsedYears: 3, inflationRatePercent: 0, pension });
  check(at64.selfAnnual === 12_000_000 && at63.selfAnnual === 0, '1966년생은 64세 개시, 63세 미개시');
}

// 8. 2026 개편 국민연금 감액 구간 및 국민연금법 §66 조기노령연금 재직 시 전액 지급정지 검증
{
  const workRed = calculatePublicPensionWorkReduction(1_800_000, 5_500_000, true);
  check(
    workRed.monthlyReduction === 195_973,
    `2026 개편안 A값+200만 초과 소득(550만) 감액은 195,973원 (실측: ${workRed.monthlyReduction})`
  );

  const earlyPensionPreRetire = calculateAnnualPublicPension({
    ageSelf: 60,
    ageSpouse: 60,
    elapsedYears: 0,
    inflationRatePercent: 0,
    pension: {
      ...DEFAULT_SIMULATION_INPUTS.pension,
      hasSpouse: false,
      claimTimingSelf: 'early',
      expectedMonthlyPensionSelf: 1_000_000,
    },
    isPreRetirementEmployed: true,
  });
  check(
    earlyPensionPreRetire.selfAnnual === 0,
    '국민연금법 §66: 조기노령연금 수급권자가 은퇴 전 재직(소득활동) 중인 경우 연금 전액 지급정지(0원)'
  );
}

// 9. KRX ETF underlying 세무 프로파일 자동 분류(classifyKrxEtfTaxProfile) 검증
{
  const p229200 = classifyKrxEtfTaxProfile({
    ticker: '229200',
    name: 'KODEX 코스닥150',
    market: 'KRX',
    category: 'OTHER',
    amount: 100,
    ratio: 10,
    expenseRatio: 0.1,
    actualExpenseRatio: 0.15,
    dividendYield: 1.0,
    dividendCycle: 'Quarterly',
    expectedGrowthRate: 5.0,
    productType: 'domestic_listed',
  });
  check(p229200.isKrxTaxableGain === false, '229200 KODEX 코스닥150은 국내주식형 지수로 매매차익 비과세');

  const p091160 = classifyKrxEtfTaxProfile({
    ticker: '091160',
    name: 'KODEX 반도체',
    market: 'KRX',
    category: 'OTHER',
    amount: 100,
    ratio: 10,
    expenseRatio: 0.1,
    actualExpenseRatio: 0.15,
    dividendYield: 1.0,
    dividendCycle: 'Quarterly',
    expectedGrowthRate: 5.0,
    productType: 'domestic_listed',
  });
  check(p091160.isKrxTaxableGain === false, '091160 KODEX 반도체는 국내주식형 섹터로 매매차익 비과세');

  const p360750 = classifyKrxEtfTaxProfile({
    ticker: '360750',
    name: 'TIGER 미국S&P500',
    market: 'KRX',
    category: 'OTHER',
    amount: 100,
    ratio: 10,
    expenseRatio: 0.1,
    actualExpenseRatio: 0.15,
    dividendYield: 1.0,
    dividendCycle: 'Quarterly',
    expectedGrowthRate: 5.0,
    productType: 'domestic_listed',
  });
  check(p360750.isKrxTaxableGain === true, '360750 TIGER 미국S&P500은 해외 기초자산으로 매매차익 과세(15.4%)');

  const domCoveredCall = classifyKrxEtfTaxProfile({
    ticker: '999999',
    name: 'KODEX 200타겟위클리커버드콜',
    market: 'KRX',
    category: 'COVERED_CALL',
    amount: 100,
    ratio: 10,
    expenseRatio: 0.3,
    actualExpenseRatio: 0.4,
    dividendYield: 10.0,
    dividendCycle: 'Monthly',
    expectedGrowthRate: 2.0,
    productType: 'covered_call',
  });
  check(
    domCoveredCall.defaultTaxStandardRatio === 0.25 && domCoveredCall.isKrxTaxableGain === false,
    '국내 커버드콜은 과표비율 0.25, 매매차익 비과세'
  );

  const overseasCoveredCall = classifyKrxEtfTaxProfile({
    ticker: '458760',
    name: 'TIGER 미국배당+7%프리미엄다우존스',
    market: 'KRX',
    category: 'COVERED_CALL',
    amount: 100,
    ratio: 10,
    expenseRatio: 0.39,
    actualExpenseRatio: 0.48,
    dividendYield: 10.2,
    dividendCycle: 'Monthly',
    expectedGrowthRate: 2.5,
    productType: 'covered_call',
  });
  check(
    overseasCoveredCall.defaultTaxStandardRatio === 0.95 && overseasCoveredCall.isKrxTaxableGain === true,
    '해외 커버드콜은 과표비율 0.95, 매매차익 과세'
  );
}

console.log('✅ PASS: pensionAndEtf.test.ts (26 assertions passed)');

