import { PRESET_SCENARIOS, defineInputs } from '../src/engine/presets';
import { solveOptimizationMasterPlan } from '../src/engine/optimizer';
import type { CanonicalYearRow } from '../src/engine';
import { outsideCost } from '../src/components/Lens2WaterfallLedger';
import { CHART_FALLBACK_WIDTH, chartHeightFor } from '../src/components/useChartWidth';
import { resolveCurveTap } from '../src/components/Lens1AllocationTrack';
import {
  PLAN_B_MAX_DELAY_YEARS,
  VERDICT_SURVIVAL_MIN_PCT,
  claimStartAge,
  claimTimingLabel,
  classifyPlanVerdict,
  computePlanBLevers,
  formatDdayAmount,
  isBorderlineSurvival,
  meetsPlanBTarget,
  optimalTradeoffNote,
  pickActiveCard,
  shouldShowPlanB,
  strategyCardPills,
  survivalAssumptionText,
} from '../src/components/planVerdict';
import { evaluateSensitivityBand } from '../src/engine/sensitivityBand';

declare function require(id: string): {
  existsSync(p: string): boolean;
  readFileSync(p: string, enc: string): string;
  join(...parts: string[]): string;
};

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

console.log('Running UI Parity & Static Security Integrity Tests...');

let verifiedModes = 0;

// 1. Verify 1-Won Parity across VerdictHeader, Lens1 Scoreboard/Trajectory, and Lens2 Ledger Table
for (const preset of PRESET_SCENARIOS) {
  for (const viewMode of ['nominal', 'real'] as const) {
    const isRealValueMode = viewMode === 'real';
    const inputs = defineInputs({
      ...preset.inputs,
      transition: {
        ...preset.inputs.transition,
        viewMode,
      },
    });
    const plan = solveOptimizationMasterPlan(inputs);

    const scale = (val: number, df: number) =>
      isRealValueMode ? Math.round(val * df) : Math.round(val);

    // Check Personal, Corp, Optimal, and Active Ledgers
    for (const ledger of [
      plan.personal100,
      plan.corporate100,
      plan.optimalHybrid,
      plan.activeLedger,
    ]) {
      const lastRow = ledger.rows[ledger.rows.length - 1];
      check(Boolean(lastRow), `Preset ${preset.id} must have a final row`);

      // Final net worth in summary (scaled by viewMode) must equal scaled lastRow value to 0 Won
      check(
        ledger.finalDisposableNetWorth ===
          scale(lastRow.endDisposableNetWorth, lastRow.discountFactor),
        `[${preset.id}/${viewMode}] Summary finalDisposableNetWorth != scaled lastRow.endDisposableNetWorth`,
      );
      check(
        ledger.finalBookNetWorth === scale(lastRow.endBookTotal, lastRow.discountFactor),
        `[${preset.id}/${viewMode}] Summary finalBookNetWorth != scaled lastRow.endBookTotal`,
      );

      // VerdictHeader & Lens1 Card & Lens2 Final Table Row value in active display mode
      const verdictNetWorth = ledger.finalDisposableNetWorth;
      const lens1TrajectoryLastPoint = scale(
        ledger.rows[ledger.rows.length - 1].endDisposableNetWorth,
        ledger.rows[ledger.rows.length - 1].discountFactor,
      );
      const lens2TableLastCell = scale(lastRow.endDisposableNetWorth, lastRow.discountFactor);

      check(
        verdictNetWorth === lens1TrajectoryLastPoint,
        `[${preset.id}/${viewMode}] VerdictHeader != Lens1 Trajectory final point`,
      );
      check(
        verdictNetWorth === lens2TableLastCell,
        `[${preset.id}/${viewMode}] VerdictHeader != Lens2 Final Table Row cell`,
      );

      // Verify D-Day 5-basket sum == D-Day total capital
      const b = ledger.blueprint;
      const basketSum =
        b.allocIrp +
        b.allocPersonalPension +
        b.allocIsa +
        b.allocTaxable +
        b.allocCorporate;
      check(
        basketSum === b.totalCapitalAtRetirement,
        `[${preset.id}] D-Day 5-basket sum != totalCapitalAtRetirement`,
      );
    }

    verifiedModes++;
  }
}

// 2. Static Security & Structural Integrity Audit
const fs = require('fs');
check(
  !fs.existsSync('src/components/PasscodeGateModal.tsx'),
  'PasscodeGateModal.tsx must be deleted (stateless client-only architecture)',
);

// Ensure all core components exist and are wired in App.tsx (2-mode: wizard | guide) + local Export/Import
const appSrc = fs.readFileSync('src/App.tsx', 'utf-8');
const requiredAppImports = [
  'InputWizard',
  'ActionGuideView',
  'serializeScenario',
  'parseScenarioJson',
];

for (const symbol of requiredAppImports) {
  check(appSrc.includes(symbol), `App.tsx must wire ${symbol}`);
}
check(
  !appSrc.includes('PasscodeGateModal') &&
    !appSrc.includes('/api/session') &&
    !appSrc.includes('/api/state') &&
    !appSrc.includes('/api/auth') &&
    !appSrc.includes('X-Fincorp-Session') &&
    !appSrc.includes('X-Fincorp-Owner-Token'),
  'App.tsx must contain zero passcode/owner/server-state auth plumbing',
);
check(
  !appSrc.includes('전문가 통합 뷰') && !appSrc.includes("'workbench'"),
  'App.tsx must unify around the 2-mode workflow (wizard | guide) without legacy workbench mode',
);

// 3. Verify Draft-Buffered Numeric Input Logic (prevents mid-typing clamping to 30 or 8)
import { amountReadout, resolveNumericDraft } from '../src/components/ControlDock';
import { presetDisplayLabel } from '../src/components/InputWizard';

// Case A: Typing "53" into Retirement Age (min=50, max=85)
const step1 = resolveNumericDraft('5', { min: 50, max: 85, fallback: 50, commit: false });
check(
  step1.display === '5' && step1.committedValue === null,
  'First keystroke "5" with min=50 must not clamp to 50 mid-typing',
);
const step2 = resolveNumericDraft('53', { min: 50, max: 85, fallback: 50, commit: false });
check(
  step2.display === '53' && step2.committedValue === 53,
  'Second keystroke "53" within [50, 85] must immediately commit 53',
);

// Case B: Clearing input ("") while focused must stay empty until blur
const emptyTyping = resolveNumericDraft('', { min: 30, max: 80, fallback: 50, commit: false });
check(
  emptyTyping.display === '' && emptyTyping.committedValue === null,
  'Cleared input must remain empty while focused without forcing 0 or 30',
);
const emptyBlur = resolveNumericDraft('', { min: 30, max: 80, fallback: 50, commit: true });
check(
  emptyBlur.display === '50' && emptyBlur.committedValue === 50,
  'Blurred empty input must restore fallback value',
);

// Case C: Typing decimal "2.5" into CPI inflation (min=0, max=8)
const decDot = resolveNumericDraft('2.', { min: 0, max: 8, fallback: 2.5, commit: false });
check(
  decDot.display === '2.' && decDot.committedValue === null,
  'Trailing decimal point "2." must be preserved while typing',
);
const decFull = resolveNumericDraft('2.5', { min: 0, max: 8, fallback: 2.5, commit: false });
check(
  decFull.display === '2.5' && decFull.committedValue === 2.5,
  'Decimal "2.5" must commit 2.5',
);
const accidentalOver = resolveNumericDraft('25', { min: 0, max: 8, fallback: 2.5, commit: false });
check(
  accidentalOver.display === '25' && accidentalOver.committedValue === null,
  'Out-of-range intermediate "25" (e.g. deleting dot in 2.5) must not clamp to 8 until blur',
);
const clampOnBlur = resolveNumericDraft('25', { min: 0, max: 8, fallback: 2.5, commit: true });
check(
  clampOnBlur.display === '8' && clampOnBlur.committedValue === 8,
  'Out-of-range "25" must clamp to max=8 on blur',
);

// 4. Verify Scenario Preset Button Minimization & Hover Popup Containment
const controlDockSrc = fs.readFileSync('src/components/ControlDock.tsx', 'utf-8');
const precisionTunersSrc = fs.readFileSync('src/components/PrecisionTuners.tsx', 'utf-8');
const stylesSrc = fs.readFileSync('src/styles.css', 'utf-8');

check(
  controlDockSrc.includes('NumericInput') && !controlDockSrc.includes('export const ControlDock:'),
  'ControlDock.tsx must export shared NumericInput/FieldHelpBadge primitives without legacy ControlDock component',
);
check(
  precisionTunersSrc.includes('NumericInput'),
  'PrecisionTuners.tsx must use NumericInput for all numeric fields',
);
check(
  stylesSrc.includes('repeat(2, minmax(0, 1fr))'),
  'styles.css must constrain 2-column grids with repeat(2, minmax(0, 1fr)) to prevent horizontal overflow',
);

// 5. Verify SVG Chart Y-Axis Left Padding (padL >= 100) to prevent multi-digit 억/만 label clipping
const lens1Src = fs.readFileSync('src/components/Lens1AllocationTrack.tsx', 'utf-8');
const lens2Src = fs.readFileSync('src/components/Lens2WaterfallLedger.tsx', 'utf-8');

const lens1PadL = lens1Src.match(/const\s+padL\s*=\s*(\d+)/);
const lens2PadL = lens2Src.match(/const\s+padL\s*=\s*(\d+)/);
check(
  Boolean(lens1PadL && Number(lens1PadL[1]) >= 100),
  'Lens1AllocationTrack.tsx must set padL >= 100 so 10억+ Y-axis labels never clip on the left',
);
check(
  Boolean(lens2PadL && Number(lens2PadL[1]) >= 100),
  'Lens2WaterfallLedger.tsx must set padL >= 100 so 10억+ Y-axis labels never clip on the left',
);

// 6. Verify Step-by-Step Input Wizard ([입력 1~5]) & Action Guide Output ([출력 1~2])
const wizardSrc = fs.readFileSync('src/components/InputWizard.tsx', 'utf-8');
const guideSrc = fs.readFileSync('src/components/ActionGuideView.tsx', 'utf-8');

check(
  appSrc.includes('InputWizard') && appSrc.includes('ActionGuideView'),
  'App.tsx must wire both InputWizard and ActionGuideView',
);
check(
  wizardSrc.includes('wizard-focus-card') &&
    (wizardSrc.includes('field-help-popover') ||
      (wizardSrc.includes('FieldHelpBadge') && controlDockSrc.includes('field-help-popover'))) &&
    wizardSrc.includes('step-detail-toggle-btn') &&
    wizardSrc.includes('wizard-summary-screen'),
  'InputWizard.tsx must implement 1-item-at-a-time focus card, hover explanation popover, top detail toggle, and Step 10 summary screen',
);
check(
  guideSrc.includes('action-blueprint-hero') &&
    guideSrc.includes('action-basket-grid') &&
    guideSrc.includes('analysis-tile-card') &&
    guideSrc.includes('sectionMode="charts"') &&
    guideSrc.includes('sectionMode="table"'),
  'ActionGuideView.tsx must implement 3-step financial asset configuration playbook, 5-basket allocation cards, and 4-tile bento drill-down selector',
);

// 7. Verify Modern SVG Chart Upgrade (Catmull-Rom spline, Area Gradients, Compact Axis Labels, Floating Tooltips, Rounded Stacked Bars)
check(
  lens1Src.includes('buildSmoothPath') &&
    lens1Src.includes('formatAxisKRW') &&
    lens1Src.includes('linearGradient') &&
    lens1Src.includes('svg-floating-tooltip') &&
    lens1Src.includes('svg-milestone-pill'),
  'Lens1AllocationTrack.tsx must implement Catmull-Rom smooth splines (buildSmoothPath), compact axis labels (formatAxisKRW), linearGradient area fills, pill milestone badges, and floating tooltips',
);
check(
  lens2Src.includes('formatAxisKRW') &&
    lens2Src.includes('svg-floating-tooltip') &&
    lens2Src.includes('svg-active-col-band') &&
    lens2Src.includes('rx={2.5}'),
  'Lens2WaterfallLedger.tsx must implement compact axis labels (formatAxisKRW), active hover column band, rounded bar segments (rx={2.5}), and floating breakdown tooltips',
);

// 8. Local JSON scenario Export/Import contract: file input + schema-validated parseScenarioJson
check(
  appSrc.includes('type="file"') &&
    appSrc.includes('accept=".json,application/json"') &&
    appSrc.includes('handleExportScenario') &&
    appSrc.includes('handleImportFile') &&
    appSrc.includes('aria-label="시나리오 내보내기"') &&
    appSrc.includes('aria-label="시나리오 불러오기"'),
  'App.tsx must expose local JSON scenario Export/Import controls in top-actions',
);

// 9. ALL_DEPLETE 신호가 ActionGuideView 헤드라인에서 분기되어야 함 (법인 100% 권고 오출력 방지)
check(
  guideSrc.includes("plan.allocationStatus === 'ALL_DEPLETE'"),
  'ActionGuideView.tsx must branch its headline on plan.allocationStatus === ALL_DEPLETE',
);

// 10. ETF catalog client hygiene: timeout-guarded fetch, no stale session headers, no 6-row truncation, no raw fetch()
const etfClientSrc = fs.readFileSync('src/components/EtfPortfolioBuilder.tsx', 'utf-8');
check(
  fs.readFileSync('src/lib/fetchWithTimeout.ts', 'utf-8').includes('AbortController') &&
    !fs.readFileSync('src/lib/fetchWithTimeout.ts', 'utf-8').includes('X-Fincorp-Session') &&
    etfClientSrc.includes('fetchWithTimeout') &&
    !etfClientSrc.includes('sessionHeaders') &&
    !etfClientSrc.includes('X-App-Session') &&
    !precisionTunersSrc.includes('X-App-Session') &&
    !etfClientSrc.includes('slice(0, 6)') &&
    !/[^a-zA-Z]fetch\(/.test(etfClientSrc) &&
    !/[^a-zA-Z]fetch\(/.test(precisionTunersSrc),
  'ETF catalog client must call /api/etf/list only through fetchWithTimeout without auth headers and render every returned row',
);

// 11. ETF portfolio builder: presets + explorer component wired into PrecisionTuners, legacy hardcoded add policy gone,
//     spouse ISA / pension edited as separate fields (no 50:50 overwrite), macro→detailed auto-fit
const builderSrc = fs.readFileSync('src/components/EtfPortfolioBuilder.tsx', 'utf-8');
check(
  precisionTunersSrc.includes('<EtfPortfolioBuilder') &&
    !precisionTunersSrc.includes('amount: 100_000_000') &&
    !builderSrc.includes('amount: 100_000_000') &&
    !precisionTunersSrc.includes('totalSpouse * 0.5') &&
    precisionTunersSrc.includes('rebalanceHoldingsToTotal(holdings, inputs.asset.totalInvestment'),
  'PrecisionTuners.tsx must delegate to EtfPortfolioBuilder, drop the 1억 hardcoded add policy and 50:50 spouse overwrite, and auto-fit holdings on macro→detailed switch',
);
check(
  builderSrc.includes('PORTFOLIO_PRESETS') &&
    builderSrc.includes('applyPresetToHoldings') &&
    builderSrc.includes('addHoldingKeepingTotal') &&
    builderSrc.includes('rebalanceHoldingsToTotal') &&
    builderSrc.includes('fetchWithTimeout') &&
    builderSrc.includes('tickers=') &&
    builderSrc.includes('isEstimated') &&
    builderSrc.includes('eligibleIsa') &&
    builderSrc.includes('eligiblePension') &&
    builderSrc.includes("'error'") &&
    stylesSrc.includes('.etf-preset-chip') &&
    stylesSrc.includes('.etf-delta-strip') &&
    stylesSrc.includes('.etf-tag-est'),
  'EtfPortfolioBuilder.tsx must render preset chips (catalog-resolved via tickers=), delta strip, total-invariant add, proportional rebalance, estimate/ISA/pension badges and error states with matching styles',
);

// 12. Detailed-portfolio guards: macro inputs flagged as reference-only, totals keep holdings in sync,
//     overseas ratio derived from holdings, ActionGuide ③ branches, FEATURES/VERSION synced
const featuresSrc = fs.readFileSync('FEATURES.md', 'utf-8');
const versionSrc = fs.readFileSync('VERSION', 'utf-8').trim();
const pkgVersionSrc = JSON.parse(fs.readFileSync('package.json', 'utf-8')).version;
check(
  wizardSrc.includes('isDetailedPortfolio') &&
    wizardSrc.includes('dock-mode-banner') &&
    wizardSrc.includes('rebalanceHoldingsToTotal(inputs.asset.holdings ?? [], nextTotal)') &&
    precisionTunersSrc.includes('보유 ETF에서 자동 산출') &&
    guideSrc.includes('isDetailedPortfolio') &&
    !guideSrc.includes('{inputs.asset.overseasEtfRatio}%') &&
    guideSrc.includes('portfolio.overseasDirectRatio') &&
    stylesSrc.includes('.dock-mode-banner'),
  'Detailed-mode guards must exist in InputWizard/PrecisionTuners/ActionGuideView (banner, total→holdings sync, derived overseas ratio)',
);
check(
  featuresSrc.includes('## 5. ETF 포트폴리오 빌더') &&
    featuresSrc.includes('## 6. v1.1.0 금융 엔진 신뢰성 보강') &&
    featuresSrc.includes('5.40%') &&
    featuresSrc.includes('448290') &&
    featuresSrc.includes('NestWay Slider') &&
    versionSrc === '1.2.25' &&
    pkgVersionSrc === versionSrc &&
    featuresSrc.includes('## 27. v1.2.20') &&
    featuresSrc.includes('## 28. v1.2.21') &&
    featuresSrc.includes('## 29. v1.2.22') &&
    featuresSrc.includes('## 30. v1.2.23') &&
    featuresSrc.includes('## 31. v1.2.24') &&
    featuresSrc.includes('## 32. v1.2.25'),
  'FEATURES.md must document the ETF builder + engine reliability work; VERSION = package.json = latest FEATURES release (1.2.25)',
);

// 13. Brand identity: NestWay Slider across HTML, App shell, InputWizard, ActionGuideView, package.json, solver, and ENGINE_ANALYSIS_REPORT.md
const indexHtmlSrc = fs.readFileSync('index.html', 'utf-8');
const pkgJsonSrc = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const engineReportSrc = fs.readFileSync('ENGINE_ANALYSIS_REPORT.md', 'utf-8');
check(
  indexHtmlSrc.includes('<title>NestWay Slider — 은퇴 금융자산 최적화 워크벤치</title>') &&
    pkgJsonSrc.name === 'nestway-slider' &&
    appSrc.includes('solveNestWaySlider') &&
    appSrc.includes('NestWay') &&
    appSrc.includes('Slider') &&
    wizardSrc.includes('NestWay Slider') &&
    guideSrc.includes('NESTWAY SLIDER') &&
    engineReportSrc.includes('## 10. 핵심 수식 요약 치트시트'),
  'Brand identity, package.json name, solveNestWaySlider solver, and ENGINE_ANALYSIS_REPORT.md must all be verified',
);

// 14. Tab 2 UI & Preset Invariants (6 chronological presets including corp 50% & corp 100%, Step 1~9 refinements, FieldHelpBadge deduplication, PrecisionTuners sync)
const presetsSrc = fs.readFileSync('src/engine/presets.ts', 'utf-8');
check(
  PRESET_SCENARIOS.length === 6 &&
    PRESET_SCENARIOS[0].label === '40세 -> 45세 은퇴 (파이어족, 싱글)' &&
    PRESET_SCENARIOS[0].inputs.pension.hasSpouse === false &&
    PRESET_SCENARIOS[1].label === '45세 -> 50세 은퇴 (이른 은퇴)' &&
    PRESET_SCENARIOS[2].label === '50세 -> 55세 은퇴 (법인 50% 균형)' &&
    PRESET_SCENARIOS[3].label === '50세 -> 60세 은퇴' &&
    PRESET_SCENARIOS[4].label === '55세 -> 55세 은퇴 (법인 100% 집중)' &&
    PRESET_SCENARIOS[5].label === '60세 -> 60세 은퇴' &&
    !presetsSrc.includes('late-55-60') &&
    !presetsSrc.includes('19개 표준 검증조건') &&
    !presetsSrc.includes('고액 자산가 (투자자산 30억 · 법인 우위)'),
  'PRESET_SCENARIOS must define the 6 chronological presets (including corp 50% & corp 100% archetypes) and omit late-55-60 and test/internal presets',
);
check(
  controlDockSrc.includes('export const FIELD_HELP_CATALOG') &&
    controlDockSrc.includes('export const FieldHelpBadge') &&
    wizardSrc.includes("from './ControlDock'") &&
    precisionTunersSrc.includes("from './ControlDock'") &&
    wizardSrc.includes('generalMonthlySavings') &&
    wizardSrc.includes('shelteredMonthlyEquiv') &&
    wizardSrc.includes('irpExpectedReturnRate') &&
    wizardSrc.includes('IRP 위험자산 70% 한도 자동 계산') &&
    wizardSrc.includes('<EtfPortfolioBuilder') &&
    !wizardSrc.includes('IRP 연금 인출 희망 월액') &&
    !wizardSrc.includes('임원 1인당 실수령 월급') &&
    !wizardSrc.includes('(SORR 테스트)') &&
    !precisionTunersSrc.includes('분할 배당 출구 기간') &&
    !precisionTunersSrc.includes('(SoRR)') &&
    precisionTunersSrc.includes('downsizedAssessedValue') &&
    precisionTunersSrc.includes('monthlyRentExpense'),
  'InputWizard, ControlDock, and PrecisionTuners must satisfy all Tab 2 Step 1~9 UI invariants and share FIELD_HELP_CATALOG',
);

// 15. Tab 3 UI & Chart/Table Invariants (Item 1~5: D-Day bridge, Lens1 beautify, Lens2 1:1 legend & purple separation, Table inline breakdown & why-explanation, Step 4 vs Step 6 separation)
check(
  guideSrc.includes('action-basket-bridge') &&
    !wizardSrc.includes('group="B"') &&
    wizardSrc.includes('wizard-return-mode-tabs') &&
    lens2Src.includes('중개형 ISA') &&
    lens2Src.includes('개인연금저축') &&
    lens2Src.includes('퇴직연금 IRP') &&
    !lens2Src.includes('③~⑤ IRP·ISA·연금저축') &&
    lens2Src.includes('#4f46e5') &&
    lens2Src.includes('#9333ea') &&
    lens2Src.includes('ledger-cell-breakdown') &&
    lens2Src.includes('ledger-why-popover') &&
    stylesSrc.includes('.ledger-cell-breakdown') &&
    stylesSrc.includes('.ledger-why-popover'),
  'Tab 3 invariants: ActionGuideView D-Day bridge, Step 4/6 deduplication, Lens2 1:1 legend & distinct colors (#4f46e5 vs #9333ea), and inline table breakdown + why-explanation popovers',
);

// 16. Updated Tab 3 Wizard Structure:
//     - Step 3 (일반금융자산) has no detail drawer; overseasEtfRatio moved to Step 6 (일반·법인 수익률)
//     - Step 4 (절세·연금계좌) uses NumericInput for expectedSeverancePay and removes manual private pension start age input
//     - Target Return is split into Step 6 (일반·법인 수익률) and Step 7 (절세·연금 수익률), each with simple sliders on the main card and <EtfPortfolioBuilder scope="general" | "sheltered" /> in the detail drawer
//     - .field-help-trigger / .field-help-icon prevent vertical badge squishing via flex-shrink: 0 and white-space: nowrap
check(
  wizardSrc.includes("shortLabel: '3. 일반금융자산'") &&
    wizardSrc.includes("shortLabel: '4. 절세·연금계좌'") &&
    wizardSrc.includes("shortLabel: '5. 은퇴전저축'") &&
    wizardSrc.includes("shortLabel: '6. 일반·법인 수익률'") &&
    wizardSrc.includes("shortLabel: '7. 절세·연금 수익률'") &&
    wizardSrc.includes("shortLabel: '8. 물가·시장환경'") &&
    wizardSrc.includes("shortLabel: '9. 부동산·국민연금'") &&
    wizardSrc.includes("shortLabel: '10. 법인·배분전략'") &&
    wizardSrc.includes('scope="general"') &&
    wizardSrc.includes('scope="sheltered"') &&
    wizardSrc.includes('spouseExpectedSeverancePay') &&
    guideSrc.includes('spouseExpectedSeverancePay') &&
    !wizardSrc.includes('사적연금(연금저축·IRP) 수령 개시 연령 (최소 55세)') &&
    stylesSrc.includes('flex-shrink: 0;') &&
    stylesSrc.includes('white-space: nowrap;') &&
    builderSrc.includes('SHELTERED_PORTFOLIO_PRESETS') &&
    builderSrc.includes("scope = 'general'") &&
    builderSrc.includes('shelteredHoldings') &&
    builderSrc.includes('evaluateHoldingsList') &&
    builderSrc.includes('calculateCurrentShelteredTotal'),
  'Updated Tab 3 wizard split (Step 6 General/Corp Return & Step 7 Sheltered/Pension Return), Step 3 detail removal, spouseExpectedSeverancePay wiring, automatic pension start age, and non-wrapping FieldHelpBadge must be wired',
);

// 17. Phase A~D & UI/UX Polish Invariants:
//     - Phase A: 4 granular personal taxes + additionalPensionContribution + isHealthDependentEligible in Lens2 popover
//     - Phase B: lumpSumEvents presets & editor in PrecisionTuners, summary count in InputWizard, breakdown in Lens2
//     - Phase C: @media print in styles.css, isPrintMode + window.print in App.tsx & ActionGuideView.tsx
//     - Phase D: evaluateSensitivityBand + sensitivity-confidence-band in Lens1AllocationTrack.tsx
//     - Design polish: --ease-out, --ease-in-out, --ease-drawer, scale(0.97) tactile feedback, @media (hover: hover)
check(
  lens2Src.includes('r.taxPublicAndDiv') &&
    lens2Src.includes('r.taxPrivatePensionAndIrp') &&
    lens2Src.includes('r.taxOverseasCapGains') &&
    lens2Src.includes('r.taxIsaAndSeveranceLump') &&
    lens2Src.includes('r.additionalPensionContribution') &&
    lens2Src.includes('r.isHealthDependentEligible') &&
    lens2Src.includes('r.lumpSumInflowLabels') &&
    lens2Src.includes('r.lumpSumOutflowLabels') &&
    precisionTunersSrc.includes('addPresetEvent') &&
    precisionTunersSrc.includes('lump-sum-preset-chip') &&
    precisionTunersSrc.includes('lumpSumEvents') &&
    wizardSrc.includes('lumpSumEvents') &&
    lens2Src.includes('r.lumpSumEventInflow') &&
    lens2Src.includes('r.lumpSumEventOutflow') &&
    guideSrc.includes('isPrintMode') &&
    guideSrc.includes('handlePrintReport') &&
    appSrc.includes('handlePrintReport') &&
    appSrc.includes('prevModeBeforePrintRef') &&
    appSrc.includes('isPrintMode={isPrintMode}') &&
    appSrc.includes('window.print()') &&
    stylesSrc.includes('@media print') &&
    lens1Src.includes('evaluateSensitivityBand(inputs, activeLedger.personalRatio)') &&
    lens1Src.includes('sensitivity-confidence-band') &&
    lens1Src.includes('survivalProbabilityPercent') &&
    stylesSrc.includes('--ease-out:') &&
    stylesSrc.includes('--ease-in-out:') &&
    stylesSrc.includes('--ease-drawer:') &&
    stylesSrc.includes('scale(0.97)') &&
    stylesSrc.includes('@media (hover: hover) and (pointer: fine)'),
  'Phase A~D (granular tax popover, lump-sum events, 1-click PDF print report, sensitivity band & survival probability) and Emil/Design-Taste CSS polish tokens must all be wired',
);

// 18. Tab 3 Doc Update (Items 1~8):
//     - Item 1: Step 1~2 hides asset-dependent 100-age net worth & sustainable living expense before Step 3 asset entry
//     - Item 2 & 6-a: .field-help-popover enforces white-space: normal, word-break: keep-all, overflow-wrap: break-word, and right-aligned .dock-label-row popover
//     - Item 3: window.confirm guards on reset buttons + semantic caution styling on .wizard-reset-btn and .step-reset-btn
//     - Item 4 & 5: showDetailToggle restricted to Step 2 and Step 9 (.wizard-detail-toggle-bar below .wizard-primary-input-box)
//     - Item 6-b & 7: Mutually exclusive mode tabs for Step 6 and hierarchical 1st/2nd-level tabs for Step 7
//     - Item 8: Step 10 conditional manual ratio slider + corporate settings (group="D") promoted to primary card
check(
  !wizardSrc.includes('현재 자산 기준 100세 지속가능 최대 월생활비') &&
    wizardSrc.includes('3~5단계에서 보유 자산·저축 입력 후 100세 예상 순자산이 표시됩니다') &&
    wizardSrc.includes('window.confirm(') &&
    wizardSrc.includes('wizard-reset-btn') &&
    wizardSrc.includes('const showDetailToggle = currentStep === 2 || currentStep === 9;') &&
    wizardSrc.includes('wizard-detail-toggle-bar') &&
    wizardSrc.includes('간편 슬라이더 입력') &&
    wizardSrc.includes('ETF 포트폴리오 입력') &&
    wizardSrc.includes('절세·연금계좌 수익률 별도 적용') &&
    wizardSrc.includes('KRX ETF 포트폴리오 입력') &&
    wizardSrc.includes('개인 : 법인 비율 직접 지정') &&
    stylesSrc.includes('white-space: normal;') &&
    stylesSrc.includes('word-break: keep-all;') &&
    stylesSrc.includes('overflow-wrap: break-word;') &&
    stylesSrc.includes('.dock-label-row .field-help-popover') &&
    stylesSrc.includes('.wizard-detail-toggle-bar') &&
    stylesSrc.includes('.wizard-reset-btn'),
  'Tab 3 Doc Update Items 1~8 (no premature asset metrics on Step 1~2, popover text wrap & right-edge guard, reset confirmation & danger color, detail toggle only on Step 2/9 below primary box, Step 6/7/10 mode tabs & promoted fields) must be wired',
);

// 19. v1.2.6 Tab 3 Follow-Up (Items 1~7):
//     - Item 1: (§17②3) symbol removed from PrecisionTuners.tsx
//     - Item 2: .wizard-status-chip and .wizard-edit-jump-btn enforce white-space: nowrap; flex-shrink: 0; height: 24px;
//     - Item 5 & 6: Clickable legend buttons (.legend-item-btn, .legend-item-muted, .legend-reset-btn) in Lens1 & Lens2, and corporate100 dashed path rendered after optimalHybrid path
//     - Item 7: .ledger-row-top-popover on first 3 rows in Lens2 opening .ledger-why-popover downward
check(
  !precisionTunersSrc.includes('§17②3') &&
    precisionTunersSrc.includes('<option value="capital_return_exempt">출자원금 비과세 선회수</option>') &&
    lens1Src.includes('mutedTrajKeys') &&
    lens1Src.includes('legend-item-btn') &&
    lens1Src.includes('연간 배당·양도·과세이연 절세 실익') &&
    lens1Src.indexOf('d={hybridTrajPath}') <
      lens1Src.indexOf('d={buildTrajectorySmooth(corporate100.rows)}') &&
    lens2Src.includes('mutedStackKeys') &&
    lens2Src.includes('mutedFlowKeys') &&
    lens2Src.includes('legend-item-btn') &&
    lens2Src.includes('ledger-row-top-popover') &&
    stylesSrc.includes('.legend-item-btn') &&
    stylesSrc.includes('.legend-item-muted') &&
    stylesSrc.includes('.ledger-row-top-popover .ledger-why-popover'),
  'v1.2.6 Tab 3 Follow-Up Items 1~7 (remove §17②3, non-wrapping Step 11 badges, clickable chart legends with auto-scaling, corporate100 dashed path on top of optimalHybrid, and downward popover for top 3 ledger rows) must be wired',
);

// 20. v1.2.7 Option A: 2-Mode Unification (wizard | guide) & Legacy ControlDock Component Removal
check(
  guideSrc.includes('VerdictHeader') &&
    guideSrc.includes('Lens1AllocationTrack') &&
    guideSrc.includes('Lens2WaterfallLedger') &&
    guideSrc.includes('Lens3StrategyMatrix') &&
    !appSrc.includes('workbench-grid') &&
    !controlDockSrc.includes('export const ControlDock:'),
  'v1.2.7 Option A: ActionGuideView must mount VerdictHeader and Lens1~3 while App.tsx and ControlDock.tsx omit legacy workbench mode and ControlDock component',
);

// 21. v1.2.8 UX Heuristic Improvements:
//     - State preservation across wizard <-> guide switches (wizardStep & selectedTile in App.tsx)
//     - Direct step jump from ActionGuideView top context chips (onJumpToWizardStep)
//     - Quick return to Step 11 summary after clicking [수정 ✎] in InputWizard + dynamic default/custom status note on Step 1~10 card header
//     - Lens3StrategyMatrix: remove stale "좌측 도크" and "(§17②3)" copy, persist checklist in localStorage, and add keyboard accessibility (role="button", tabIndex={0}) to .sub-option-row
const lens3Src = fs.readFileSync('src/components/Lens3StrategyMatrix.tsx', 'utf-8');
check(
  appSrc.includes('wizardStep') &&
    appSrc.includes('selectedTile') &&
    guideSrc.includes('onJumpToWizardStep') &&
    wizardSrc.includes('맞춤 입력값이 적용되어 있습니다') &&
    wizardSrc.includes('요약 화면으로 돌아가기') &&
    !lens3Src.includes('좌측 도크') &&
    !lens3Src.includes('§17②3') &&
    lens3Src.includes('retire_opt_checklist_v1') &&
    lens3Src.includes('role="button"') &&
    lens3Src.includes('tabIndex={0}'),
  'v1.2.8 UX Heuristic Improvements (wizardStep/selectedTile persistence, onJumpToWizardStep, dynamic default/custom note, quick return to Step 11, stale copy removal, checklist persistence, and keyboard-accessible strategy rows) must be wired',
);

// 22. v1.2.9 Step-by-Step Result Briefing Slides (Hybrid Option A + B):
//     - Top 3-mode navigation: ① 조건 입력 (단계별 위저드) ➔ ② 핵심 결과 브리핑 (단계별 슬라이드) ➔ ③ 상세 분석 & 원장
//     - 6-slide BRIEFING_SLIDES deck in ActionGuideView.tsx reusing wizard-focus-card / renderStep1Card / renderStep2DdayBox / renderStep3Card without duplicating calculation logic
//     - Direct jump button "[📊 이 슬라이드의 심층 차트·원장 바로 보기]" wiring onJumpToAnalyticsTile / handleJumpToAnalytics(targetTile)
check(
  appSrc.includes("'wizard' | 'briefing' | 'guide'") &&
    appSrc.includes('② 핵심 결과 브리핑 (단계별 슬라이드)') &&
    appSrc.includes('③ 상세 분석 & 원장') &&
    appSrc.includes('onJumpToAnalyticsTile') &&
    guideSrc.includes('BRIEFING_SLIDES') &&
    guideSrc.includes('이 슬라이드의 심층 차트·원장 바로 보기') &&
    guideSrc.includes('renderStep1Card') &&
    guideSrc.includes('renderStep2DdayBox') &&
    guideSrc.includes('renderStep3Card') &&
    stylesSrc.includes('.briefing-stepper-bar'),
  'v1.2.9 Step-by-Step Result Briefing Slides (3-mode navigation, 6-slide briefing deck, zero-duplication card helpers, and direct jump to analytics tiles) must be wired',
);

// 23. v1.2.10 CFP/PB Expert Review Improvements (Tasks 1~5):
//     - Task 1: STEP 1 uses totalSeveranceGross (본인 + 배우자), Lens2 D-Day severance shows nominal suffix in real mode
//     - Task 2: VerdictHeader explicitly compares against 개인 단독 운용(100%) and flags micro-split consolidation; Slide 5 winner matches plan.winner
//     - Task 3: STEP 3 explains 3,000만 low-tax cap + 10-year deferred severance annuity pacing
//     - Task 4: Lens3 & optimizer rename 가업승계 -> 가족법인 지분승계 and surface §45의5 / substantive work evidence; Lens2 shows 장부 - 청산세
//     - Task 5: Slide 1 surfaces -2.0%p / P10 survival probability & care buffer; Print mode keeps the sensitivity band OFF (X5: band axis crushed strategy lines in PDF)
const verdictSrc = fs.readFileSync('src/components/VerdictHeader.tsx', 'utf-8');
check(
  guideSrc.includes('예상 퇴직금 합계') &&
    guideSrc.includes('const isBest = c.strategyType === plan.winner;') &&
    guideSrc.includes('이연퇴직금 원금은 10년 연금수령한도에 맞춰') &&
    guideSrc.includes('수익률 -2.0%p 보수적 시나리오') &&
    guideSrc.includes('후기 노년 케어·간병비 가용 월 여유분') &&
    guideSrc.includes('isPrintMode\n              defaultShowSensitivityBand={false}') &&
    verdictSrc.includes('개인 단독 운용(100%) 대비 세후') &&
    verdictSrc.includes('실무상 법인 100% 통합 권장') &&
    lens2Src.includes('기말 5대 계좌 장부잔액') &&
    lens2Src.includes('기말 세후 가처분 순자산 (청산세 차감)') &&
    lens2Src.includes('− 청산세') &&
    lens3Src.includes('가족법인 지분승계') &&
    lens3Src.includes('제45조의5(특정법인과의 거래를 통한 이익의 증여 의제)'),
  'v1.2.10 CFP/PB Expert Review Improvements (Tasks 1~5) must all be wired across VerdictHeader, ActionGuideView, Lens1~3, and optimizer',
);

// 24. v1.2.11 Unified PDF Report Button & 4-Part PB Wealth Consulting Masterplan Report:
//     - Single unified PDF button in App.tsx ('🖨️ PDF 마스터플랜 리포트') and duplicate print-report-btn removed from ActionGuideView.tsx
//     - Dedicated .print-masterplan-report layout in ActionGuideView.tsx integrating clientAssumptionsSummary (10 steps), Briefing Slides 1~6, and Analytics Lenses 1~4 across PART I ~ PART IV + .print-report-footer
check(
  appSrc.includes('🖨️<span className="btn-label"> PDF 마스터플랜 리포트</span>') &&
    !guideSrc.includes('print-report-btn') &&
    guideSrc.includes('print-masterplan-report') &&
    guideSrc.includes('print-report-masthead') &&
    guideSrc.includes('clientAssumptionsSummary') &&
    guideSrc.includes('PART I-1') &&
    guideSrc.includes('PART I-2') &&
    guideSrc.includes('PART I-3') &&
    guideSrc.includes('PART II') &&
    guideSrc.includes('PART III') &&
    guideSrc.includes('PART IV') &&
    guideSrc.includes('print-report-footer') &&
    stylesSrc.includes('.print-masterplan-report') &&
    stylesSrc.includes('.print-report-masthead') &&
    stylesSrc.includes('.print-assumptions-grid') &&
    stylesSrc.includes('.print-part-header') &&
    stylesSrc.includes('.print-page-break') &&
    stylesSrc.includes('.print-report-footer'),
  'v1.2.11 Unified PDF Report Button and 4-Part PB Wealth Consulting Masterplan Report (masthead, 10-step assumptions, briefing slides 1~6 + detailed analytics lenses 1~4 + compliance footer) must be wired',
);

// 25. v1.2.12 2026 Tax/NHIS Precision & Inline Diagnostics Enhancements (Zero UX Clutter):
//     - Lens3StrategyMatrix.tsx inline crossoverAgeVsNormal ('정상수령 누적교차')
//     - Lens2WaterfallLedger.tsx inline Tax/NHIS cliff headroom ('세법·건보 절벽 여유 한도') & '통합 마스터플랜 CSV' (handleExportMasterPlanCsv)
check(
  lens3Src.includes('crossoverAgeVsNormal') &&
    lens3Src.includes('정상수령 누적교차') &&
    lens2Src.includes('handleExportMasterPlanCsv') &&
    lens2Src.includes('통합 마스터플랜 CSV') &&
    lens2Src.includes('세법·건보 절벽 여유 한도'),
  'v1.2.12 inline pension crossover age, Tax/NHIS cliff headroom popover, and multi-section MasterPlan CSV export must be wired without adding UI tabs or wizard steps',
);

// 26. v1.2.13 Care Shock Fix & CFP/PB 20-Page PDF Review Enhancements:
//     - ActionGuideView.tsx Plan B advisory callout ('plan-b-advisory-box') & hideBlueprintCard in PART III
//     - Lens2WaterfallLedger.tsx corporate tax split label ('세금(법인포함)' / '법인세') & 'canvas-card-ledger'
//     - styles.css @media print rules for .ab-empty-card, .playbook-dday-box, .canvas-card-ledger, and .ledger-table
check(
  guideSrc.includes('plan-b-advisory-box') &&
    guideSrc.includes('hideBlueprintCard') &&
    lens2Src.includes('세금(법인포함)') &&
    lens2Src.includes('canvas-card-ledger') &&
    lens3Src.includes('ab-empty-card') &&
    stylesSrc.includes('.plan-b-advisory-box') &&
    stylesSrc.includes('.canvas-card-ledger'),
  'v1.2.13 Plan B advisory callout, hideBlueprintCard in PART III, corporate tax label split, and print layout rules must be wired',
);

// 27. v1.2.14 T1: 원장 팝오버 셀(cursor: help)마다 실제 팝오버 자식이 있어야 함 (외부유입 칸 빈 팝오버 버그)
const popoverCellCount = (lens2Src.match(/ledger-has-popover/g) ?? []).length;
const popoverBodyCount = (lens2Src.match(/className="ledger-why-popover"/g) ?? []).length;
check(
  popoverCellCount === popoverBodyCount &&
    lens2Src.includes('외부유입 산출 근거') &&
    lens2Src.includes("'(IRP로 이전 → 퇴직소득세 과세이연)'"),
  `v1.2.14 T1: every ledger-has-popover cell needs a ledger-why-popover body (cells=${popoverCellCount}, popovers=${popoverBodyCount})`,
);

// 28. v1.2.14 T2': 워터폴 범례 키 = 막대 키 = Y축 스케일 키 (범례 끄면 Y축 재조정), 빨간 막대는 조달 막대 밖 비용만 (D4)
const flowLegendKeys = ['s1', 's2', 's3', 's4', 's5', 's8', 's67', 'tax'];
const flowKeyUses = [...lens2Src.matchAll(/mutedFlowKeys\.includes\('(\w+)'\)/g)].map((m) => m[1]);
check(
  flowKeyUses.length === flowLegendKeys.length * 2 &&
    flowLegendKeys.every((k) => flowKeyUses.filter((u) => u === k).length === 2) &&
    flowLegendKeys.every((k) => lens2Src.includes(`{ key: '${k}', label:`)),
  `v1.2.14 T2': flow legend keys must be used exactly twice (scale + bar); got [${flowKeyUses.join(', ')}]`,
);

const fundingSumOf = (r: CanonicalYearRow) =>
  r.stage1PublicAndHousingPension +
  r.stage2CorpNetSalary +
  r.stage3IrpWithdrawal +
  r.stage4IsaWithdrawal +
  r.stage5PersonalPensionWithdrawal +
  r.stage6OverseasTaxableWithdrawal +
  r.stage7DomesticTaxableWithdrawal +
  r.stage8CorpFallbackDividend;
let outsideRowsChecked = 0;
for (const preset of [{ id: 'default', inputs: defineInputs() }, ...PRESET_SCENARIOS]) {
  const p = solveOptimizationMasterPlan(defineInputs({ ...preset.inputs }));
  for (const ledger of [p.personal100, p.corporate100, p.optimalHybrid, p.activeLedger]) {
    for (const r of ledger.rows) {
      const oc = outsideCost(r);
      const corpCosts = r.corpCorporateTax + r.corpPayrollTaxAndInsurance + r.corpMaintenanceAndFixedCost;
      const actualOutflow = r.requiredLivingOutflow + r.totalTaxHealthAndFees - r.unmetSpendingNeed;
      check(
        oc >= corpCosts &&
          oc <= r.totalTaxHealthAndFees &&
          fundingSumOf(r) + oc >= actualOutflow &&
          oc <= corpCosts + Math.max(0, actualOutflow - fundingSumOf(r)),
        `[${preset.id}/${r.ageSelf}] outsideCost must cover corp costs, never hide outflow, and never re-count costs already inside the funding bars`,
      );
      outsideRowsChecked++;
    }
  }
}
const defaultRows = solveOptimizationMasterPlan(defineInputs()).activeLedger.rows;
const row90 = defaultRows.find((r) => r.ageSelf === 90)!;
const row50 = defaultRows.find((r) => r.ageSelf === 50)!;
// outsideCost는 막대 높이용 근사(인출 원천을 원 단위 반올림 → 과다인출 연도에 +1원 가능)이므로 ±1원 허용.
// 원장 회계 항등식(accountingResidual === 0)은 ledgerInvariants가 별도로 강제한다.
check(
  Math.abs(
    fundingSumOf(row90) +
      outsideCost(row90) -
      (row90.requiredLivingOutflow + row90.totalTaxHealthAndFees - row90.unmetSpendingNeed),
  ) <= 1,
  `v1.2.14 T2': default 90세 bar height (funding + outsideCost) must equal living + total outflow within 1 won (bar rounding)`,
);
check(
  row50.isEmployed &&
    row50.personalIncomeAndDivTax > 0 &&
    fundingSumOf(row50) + outsideCost(row50) === row50.totalTaxHealthAndFees,
  `v1.2.14 T2': employed-year dividend tax must be stacked once (funding ${fundingSumOf(row50)} + outside ${outsideCost(row50)} vs total ${row50.totalTaxHealthAndFees})`,
);
// 프리셋 6종은 '계좌 밖 비용' 중 법인 비용 외 항목(일시퇴직세·일반계좌 직차감 추납)을 한 번도 만들지 않으므로 별도 시나리오로 고정
{
  const base = defineInputs();
  const dDay = base.transition.targetRetirementAgeSelf;
  const sevLumpRow = solveOptimizationMasterPlan(
    defineInputs({
      transition: { ...base.transition, expectedSeverancePay: 300_000_000, severanceTransferToIrp: false },
    })
  ).personal100.rows.find((r) => r.ageSelf === dDay)!;
  const addPenRow = solveOptimizationMasterPlan(
    defineInputs({
      pension: { ...base.pension, applyAdditionalPensionSelf: true, applyAdditionalPensionSpouse: true },
    })
  ).personal100.rows.find((r) => r.ageSelf === dDay)!;
  const extraOf = (r: CanonicalYearRow) =>
    outsideCost(r) - (r.corpCorporateTax + r.corpPayrollTaxAndInsurance + r.corpMaintenanceAndFixedCost);
  check(
    extraOf(sevLumpRow) > 0 &&
      extraOf(sevLumpRow) <= sevLumpRow.taxIsaAndSeveranceLump &&
      addPenRow.additionalPensionContribution > 0 &&
      extraOf(addPenRow) > addPenRow.additionalPensionContribution * 0.9 &&
      extraOf(addPenRow) <= addPenRow.additionalPensionContribution,
    `v1.2.14 T2': lump-sum severance tax (${extraOf(sevLumpRow)}) and 추납 paid from the taxable account (${extraOf(addPenRow)} / ${addPenRow.additionalPensionContribution}) must land in the red outside-cost bar`,
  );
}
console.log(`  · v1.2.14 outsideCost verified on ${outsideRowsChecked} scenario-years`);

// 29. v1.2.14 T3: 금융권 직역어 "마찰" 제거 → 세금·건보·유지비 / 새는 비용, 합계에 국민연금 추납 납입액 포함 명시
const optimizerSrc = fs.readFileSync('src/engine/optimizer.ts', 'utf-8');
const frictionFiles = { lens1Src, lens2Src, lens3Src, guideSrc, optimizerSrc };
const frictionLeft = Object.entries(frictionFiles)
  .filter(([, src]) => src.includes('마찰'))
  .map(([name]) => name);
check(
  frictionLeft.length === 0 && lens2Src.includes('국민연금 추납 납입액 포함'),
  `v1.2.14 T3: "마찰" must be replaced in user-facing copy (left in: ${frictionLeft.join(', ') || 'none'}) and 추납 inclusion disclosed`,
);

// 30. v1.2.14 T4: 생활비·간병비·국민연금은 현재가치 입력(현재 나이부터 CPI 복리), 유지비는 명목 고정 — 화면 표기를 엔진에 맞춤
const realNominalTag = "{isReal ? '실질·현재가치' : '명목'}";
check(
  wizardSrc.includes('은퇴 첫해(') &&
    wizardSrc.includes('반영 (명목)') &&
    wizardSrc.includes(
      'Math.pow(1 + inputs.transition.inflationRate / 100, Math.max(0, inputs.transition.targetRetirementAgeSelf - inputs.pension.currentAgeSelf))'
    ) &&
    // B6: 개시연령은 출생연도별 법정연령(엔진 claimStartAge)으로 표기
    (wizardSrc.match(/세 정상수령 기준 월액 · 현재가치/g) ?? []).length === 2 &&
    precisionTunersSrc.includes('케어기(78세+) 월 간병·의료 추가비 (현재가치 · {inputs.pension.currentAgeSelf}세부터 물가연동)') &&
    !controlDockSrc.includes('매년 물가상승률에 연동되어 법인 계좌에서 차감') &&
    controlDockSrc.includes('입력한 금액(명목, 물가 미연동)이 매년 법인 계좌에서 차감') &&
    lens2Src.split(realNominalTag).length - 1 === 2,
  'v1.2.14 T4: Step 2 nominal first-year pill, 현재가치 labels on pension/care inputs, nominal maintenance-fee help (D1-B), and 실질·현재가치/명목 tags on waterfall + ledger titles',
);

// 30-a. Step 2 은퇴 첫해 pill은 엔진과 같은 지출 곡선(getMonthlyLivingExpenseForAge)을 써야 함 — 액티브 시니어 모드에서 +25%를 빠뜨리면 640만 vs 엔진 800만
import {
  DEFAULT_SIMULATION_INPUTS as T4_DEFAULTS,
  getMonthlyLivingExpenseForAge,
  normalizeCashflow,
  runCanonicalLedger as t4Run,
} from '../src/engine';
{
  check(
    /getMonthlyLivingExpenseForAge\(\s*inputs\.transition\.targetRetirementAgeSelf,\s*inputs\.cashflow\.targetNetMonthlyLivingExpense,\s*normalizeCashflow\(inputs\.cashflow\)\.activeSeniorConfig\s*\)/.test(wizardSrc),
    'v1.2.14 T4: Step 2 first-year pill must apply the engine spending curve (active_senior +25% etc.)',
  );
  for (const spendingMode of ['flat', 'active_senior'] as const) {
    const inp = defineInputs({ cashflow: { ...T4_DEFAULTS.cashflow, spendingMode } });
    const retAge = inp.transition.targetRetirementAgeSelf;
    const row = t4Run({ ...inp, cashflow: normalizeCashflow(inp.cashflow) }, 50).rows.find((r) => r.ageSelf === retAge)!;
    const pillMonthly =
      getMonthlyLivingExpenseForAge(retAge, inp.cashflow.targetNetMonthlyLivingExpense, normalizeCashflow(inp.cashflow).activeSeniorConfig) *
      Math.pow(1 + inp.transition.inflationRate / 100, Math.max(0, retAge - inp.pension.currentAgeSelf));
    check(
      Math.abs(row.requiredLivingOutflow - Math.round(pillMonthly * 12)) <= 1,
      `v1.2.14 T4 [${spendingMode}]: pill 월 ${Math.round(pillMonthly / 10_000)}만 × 12 must equal engine first-year living outflow ${row.requiredLivingOutflow}`,
    );
  }
}

// 31. v1.2.14 T5: 수익률 시나리오 선택기(낮게 −3%p / 기본 / 높게 +3%p) + 밴드는 returnShiftPct 누적(D3)
const bandSrc = fs.readFileSync('src/engine/sensitivityBand.ts', 'utf-8');
const kernelSrc = fs.readFileSync('src/engine/ledgerKernel.ts', 'utf-8');
check(
  ["[-3, '낮게 −3%p']", "[0, '기본']", "[3, '높게 +3%p']"].every((l) => wizardSrc.includes(l)) &&
    wizardSrc.includes('returnShiftPct: shift') &&
    wizardSrc.includes('모든 계좌 기대수익률에 일괄') &&
    wizardSrc.includes('(inputs.asset.returnShiftPct ?? 0) === 0') &&
    guideSrc.includes('inputs.asset.returnShiftPct') &&
    bandSrc.includes('returnShiftPct: (inputs.asset.returnShiftPct ?? 0) + deltaPct') &&
    !bandSrc.includes('growthRate: inputs.asset.growthRate + deltaPct') &&
    kernelSrc.includes('inputs.asset.returnShiftPct ?? 0') &&
    lens1Src.includes('evaluateSensitivityBand(inputs, activeLedger.personalRatio)'),
  'v1.2.14 T5: Step 6 return scenario segment + isDefault guard, PDF PART I-1 scenario, kernel-only shift, band accumulates returnShiftPct',
);
// 31-a. Step 6 대표 수익률(hero)은 시나리오를 고르면 적용 후 수익률을 함께 보여야 함 (선택해도 '연 5.40%'만 보이던 문제)
check(
  wizardSrc.includes('→ 시나리오 적용 연 {(portfolioEval.effectiveTotalReturn + inputs.asset.returnShiftPct).toFixed(2)}%'),
  'v1.2.14 T5: Step 6 hero readout must show the scenario-applied return when returnShiftPct ≠ 0',
);
// 31-b. 시나리오 시프트 선택 시 같은 화면/리포트에 미반영 수익률이 남지 않아야 함 (엔진: 계좌 수익률 + returnShiftPct)
{
  const between = (src: string, from: string, to: string) => {
    const s = src.indexOf(from);
    const e = s < 0 ? -1 : src.indexOf(to, s + from.length);
    return s < 0 || e < 0 ? '' : src.slice(s, e);
  };
  const step7Row = between(wizardSrc, "title: '7. 절세·연금계좌(ISA·연금저축·IRP) 수익률'", 'step: 8,');
  const step7Hero = between(wizardSrc, '{currentStep === 7 && (', '1단계 상위 탭');
  const guideStep3 = between(guideSrc, '③ 포트폴리오 상품 구성', '④ 은퇴 당일');
  const guideStep07 = between(guideSrc, "step: 'STEP 07'", "step: 'STEP 08'");
  const count = (src: string, needle: string) => src.split(needle).length - 1;
  check(
    // 대칭 모드 + 계좌별 지정 모드 두 분기 모두 시나리오 적용값을 보여야 함 (한 분기만 남아도 통과하던 includes 대신 개수로 고정)
    count(step7Row, '→ 시나리오 적용') === 2 &&
      step7Row.includes('returnShift') &&
      count(step7Hero, '→ 시나리오 적용') === 2 &&
      step7Hero.includes('returnShift') &&
      (guideStep3.match(/→ 시나리오 적용 연/g) ?? []).length === 2 &&
      count(guideStep07, '+ returnShift)') === 3 &&
      !/\?\? (7|6\.5|5\.6)\)/.test(guideStep07) &&
      guideStep07.includes('irpExpectedReturnRate ?? inputs.accounts.personalPensionReturnRate ?? 5.4'),
    'v1.2.14 T5: Step 7 summary/hero, PDF STEP 07 per-account rates, and ActionGuide ③ weighted return must show the scenario-applied (base + returnShiftPct) rate with engine fallbacks',
  );
}

// 32. v1.2.14 Core Enhancements:
//     - Lens2 inline personal/corporate tax breakdown (`(개인 ...·법인 ...)`) & dynamic National Pension rate in popover
//     - Step 10 corporate injectionTiming ('now' | 'retirement') segmented control, tax warning banner, summaryItems isDefault/detailText, & ActionGuideView D-Day bridge
//     - ControlDock corpExecutiveCount help text documents 2026 9.5% -> +0.5%p/yr -> 2033 13.0% cap
check(
  lens2Src.includes('개인 ${formatAxisKRW(scale(r.personalIncomeAndDivTax, r))}·법인 ${formatAxisKRW(scale(r.corpCorporateTax, r))}') &&
    lens2Src.includes('getNationalPensionRateTotal(r.yearIndex - 1)') &&
    wizardSrc.includes("injectionTiming: 'retirement'") &&
    wizardSrc.includes('은퇴 시점(D-Day)에 법인 설립·일괄 이전 (재직 중 전액 일반계좌 운용)') &&
    wizardSrc.includes('재직 중 일반계좌에 적립된 해외직투·과세형 국내상장 ETF를 은퇴 D-Day에 매도해 법인에 출자할 때 양도소득세(22%) 또는 배당소득세(15.4%)가 1회 정산된 후 세후 순액이 법인 가수금으로 이체됩니다.') &&
    wizardSrc.includes("(inputs.corporate.injectionTiming ?? 'now') === 'now'") &&
    wizardSrc.includes("inputs.corporate.injectionTiming === 'retirement' ? '은퇴 D-Day 법인 설립·일괄 이전' : '지금부터 분할 적립'") &&
    guideSrc.includes('isDeferredCorp') &&
    guideSrc.includes('blueprint.corporateRatio > 0') &&
    guideSrc.includes('② 잔여 저축액 전액 일반계좌 적립 (D-Day 법인 ${blueprint.corporateRatio}% 이전)') &&
    guideSrc.includes('재직기 0원 → 은퇴 D-Day 일괄 이전') &&
    controlDockSrc.includes('2033년 13.0%'),
  'v1.2.14 inline personal/corporate tax split, National Pension rate schedule, and D-Day corporate injectionTiming UI must all be wired',
);

// 33. Top-Bar Single-Line Spatial Budget & Dead Owner Capsule Cleanup:
check(
  !appSrc.includes('owner-capsule-group') &&
    !stylesSrc.includes('.owner-capsule-group') &&
    !appSrc.includes('NestWay Slider — 은퇴 금융자산 최적화 워크벤치'),
  'Top-bar must omit removed owner-capsule-group CSS/JSX and preserve concise brand subtitle',
);

// 34. dev-ux B1 (U1/U2/X5): responsive top-bar + measured-width SVG charts with print-safe 780 fallback
const chartHookSrc = fs.readFileSync('src/components/useChartWidth.ts', 'utf-8');
check(
  appSrc.includes('className="label-short"') &&
    appSrc.includes("aria-current={appMode === 'guide' ? 'page' : undefined}") &&
    appSrc.includes('className="btn-label"') &&
    stylesSrc.includes('@media (max-width: 1040px)') &&
    stylesSrc.includes('.label-full {\n    display: none;') &&
    stylesSrc.includes('min-width: 560px; /* useChartWidth CHART_MIN_WIDTH') &&
    chartHookSrc.includes('CHART_FALLBACK_WIDTH = 780') &&
    chartHookSrc.includes('CHART_MIN_WIDTH = 560') &&
    chartHookSrc.includes('frozen || measured <= 0 ? CHART_FALLBACK_WIDTH') &&
    lens1Src.includes('useChartWidth(isPrintMode)') &&
    lens2Src.includes('useChartWidth(isPrintMode)') &&
    !lens1Src.includes('const trajW = 780') &&
    !lens1Src.includes('const curveW = 780') &&
    !lens2Src.includes('const chartW = 780') &&
    lens1Src.includes('[sensitivityBand, maxTrajVal, rowsCount, trajW, trajH]') &&
    guideSrc.includes('hideBlueprintCard isPrintMode'),
  'B1: top-bar must wrap with short labels below 1040px, charts must use measured width (min 560) and print must freeze the 780 viewBox',
);
// chartHeightFor keeps the print (780) heights identical to the legacy fixed viewBox
check(
  CHART_FALLBACK_WIDTH === 780 &&
    chartHeightFor(780, 268) === 268 &&
    chartHeightFor(780, 248) === 248 &&
    chartHeightFor(780, 236) === 236 &&
    chartHeightFor(1186, 268) <= 360,
  'print chart heights must stay 268/248/236 at the 780 fallback width and be capped on wide screens',
);

// 35. dev-ux B2 (U3/X1/X2): verdict hero from engine outputs only, D-Day nominal→real disclosure, r* criterion note
{
  const base = { allocationStatus: 'OK' as const, depletionAgeSelf: null, totalUnmetSpendingNeed: 0 };
  check(classifyPlanVerdict({ ...base, survivalProbabilityPercent: 95, monthlyBuffer: 3_450_000 }).level === 'safe', 'verdict safe');
  // B4 임계(#39/#40): 안전 ≥80 / 주의 60~79 / 위험 <60(시장 변동 헤드라인) 또는 결정론 고갈
  check(classifyPlanVerdict({ ...base, survivalProbabilityPercent: 80, monthlyBuffer: 3_450_000 }).level === 'safe', 'verdict safe at 80%');
  check(classifyPlanVerdict({ ...base, survivalProbabilityPercent: 79, monthlyBuffer: 3_450_000 }).level === 'caution', 'verdict caution (survival < 80)');
  check(classifyPlanVerdict({ ...base, survivalProbabilityPercent: 60, monthlyBuffer: 3_450_000 }).level === 'caution', 'verdict caution at 60%');
  const mkt = classifyPlanVerdict({ ...base, survivalProbabilityPercent: 59, monthlyBuffer: 3_450_000 });
  check(mkt.level === 'risk' && mkt.headline === '시장 변동 시 고갈 위험이 큽니다', 'verdict risk (<60%) uses market-volatility headline, not depletion');
  check(VERDICT_SURVIVAL_MIN_PCT === 80 && shouldShowPlanB(79, 5_000_000) && !shouldShowPlanB(80, 1_000_000), 'Plan B trigger = <80% or buffer <100만');
  check(
    isBorderlineSurvival(75) && isBorderlineSurvival(84) && !isBorderlineSurvival(85) && !isBorderlineSurvival(74) &&
      isBorderlineSurvival(55) && isBorderlineSurvival(64) && !isBorderlineSurvival(65) && !isBorderlineSurvival(54),
    'borderline bands 75~84 (safe threshold) and 55~64 (risk threshold)',
  );
  check(survivalAssumptionText(undefined, 58).includes('위험 기준(60%)'), 'risk-threshold borderline tooltip names the 60% boundary');
  check(
    survivalAssumptionText({ model: 'iid_normal_annual', annualVolatilityPct: 12, driftCorrectionPct: 0.72, sampleCount: 100, antithetic: true }, 80).includes('σ 12%p') &&
      survivalAssumptionText(undefined, 80).includes('경계값') &&
      !survivalAssumptionText(undefined, 90).includes('경계값'),
    'survival tooltip reads mcAssumptions and flags borderline values',
  );
  check(classifyPlanVerdict({ ...base, survivalProbabilityPercent: 95, monthlyBuffer: 999_999 }).level === 'caution', 'verdict caution (buffer < 100만)');
  const risk = classifyPlanVerdict({ ...base, depletionAgeSelf: 83, survivalProbabilityPercent: 99, monthlyBuffer: 5_000_000 });
  check(risk.level === 'risk' && risk.headline.includes('83세'), 'verdict risk on depletion age');
  check(classifyPlanVerdict({ ...base, allocationStatus: 'ALL_DEPLETE', survivalProbabilityPercent: 99, monthlyBuffer: 5_000_000 }).level === 'risk', 'verdict risk on ALL_DEPLETE');

  // Hero verdict must never contradict the existing Plan B advisory trigger (auto-optimal presets)
  for (const preset of PRESET_SCENARIOS) {
    const plan = solveOptimizationMasterPlan(defineInputs(preset.inputs));
    if (!(plan.inputs.hybrid.useAutoOptimalRatio ?? true)) continue;
    const band = evaluateSensitivityBand(plan.inputs, plan.activeLedger.personalRatio);
    const v = classifyPlanVerdict({
      allocationStatus: plan.allocationStatus,
      depletionAgeSelf: plan.activeLedger.depletionAgeSelf,
      totalUnmetSpendingNeed: plan.activeLedger.totalUnmetSpendingNeed,
      survivalProbabilityPercent: band.survivalProbabilityPercent,
      monthlyBuffer: plan.cards.hybrid.monthlyBuffer,
    });
    const planBShown = shouldShowPlanB(band.survivalProbabilityPercent, plan.cards.hybrid.monthlyBuffer);
    check(v.level !== 'safe' || !planBShown, `hero 'safe' must not coexist with Plan B advisory (${preset.id})`);
  }

  // X1: real mode discloses the D-Day snapshot (nominal) and converts with the same-year ledger discountFactor
  const realPlan = solveOptimizationMasterPlan(
    defineInputs({ ...PRESET_SCENARIOS[0].inputs, transition: { ...PRESET_SCENARIOS[0].inputs.transition, viewMode: 'real' } }),
  );
  const bp = realPlan.activeLedger.blueprint;
  const ddayRow = realPlan.activeLedger.rows.find((r) => r.ageSelf === bp.retirementAgeSelf);
  check(!!ddayRow && ddayRow.discountFactor < 1, 'real mode D-Day row must carry a discountFactor < 1');
  const realTxt = formatDdayAmount(bp.totalCapitalAtRetirement, realPlan.activeLedger.rows, bp.retirementAgeSelf, true);
  check(realTxt.includes('현재가치') && realTxt.includes(`${bp.retirementAgeSelf}세 시점 명목`), 'real-mode D-Day amount must show 현재가치 + 명목 disclosure');
  check(!formatDdayAmount(1, [], 60, false).includes('명목'), 'nominal mode keeps the plain amount');

  // X2: criterion note + trade-off only when a rival offers a higher sustainable monthly spend
  const cardsA = [
    { strategyType: 'personal', strategyName: '개인 100%', sustainableMonthlyLivingExpense: 8_580_000 },
    { strategyType: 'hybrid', strategyName: '최적', sustainableMonthlyLivingExpense: 8_450_000 },
  ];
  check(optimalTradeoffNote(cardsA, 'hybrid').includes('최적 기준: 100세 세후 순자산 최대') && optimalTradeoffNote(cardsA, 'hybrid').includes('개인 100%'), 'trade-off note names the higher-spend rival');
  check(!optimalTradeoffNote(cardsA, 'personal').includes('단,'), 'no trade-off line when best already has the highest spend');

  const verdictHeroSrc = fs.readFileSync('src/components/VerdictHeader.tsx', 'utf-8');
  check(
    verdictHeroSrc.includes('export const VerdictHero') &&
      verdictHeroSrc.includes('title={`연산 ${plan.computeTimeMs}ms`}') &&
      !verdictHeroSrc.includes('<span className="verdict-badge num">연산') &&
      guideSrc.includes('<VerdictHero') &&
      (guideSrc.match(/shouldShowPlanB\(slide1Sensitivity\.survivalProbabilityPercent/g) ?? []).length === 2 &&
      !guideSrc.includes('survivalProbabilityPercent < 90') &&
      (guideSrc.match(/mcAssumptions=\{slide1Sensitivity\.mcAssumptions\}/g) ?? []).length === 2 &&
      guideSrc.includes('그래서 무엇을 해야 하나요? · 실행 한 줄 결론') &&
      guideSrc.includes('fmtDday(blueprint.totalCapitalAtRetirement)') &&
      !guideSrc.includes('formatKRW(blueprint.totalCapitalAtRetirement)') &&
      guideSrc.includes('optimalTradeoffNote(strategyCards, plan.winner, plan.recommendation)') &&
      lens1Src.includes("optimalTradeoffNote(strategyCards, 'hybrid', plan.recommendation)") &&
      lens2Src.includes('formatDdayAmount(blueprint.totalCapitalAtRetirement') &&
      stylesSrc.includes('.verdict-hero-risk'),
    'B2: verdict hero precedes action headline, ms badge moved to title, D-Day amounts disclose real/nominal, r* criterion note wired',
  );
}

// 36. dev-ux B3a (U5/U6/X3/X4 + risk-state copy): wizard stepper/presets, live chip, CTA, amount readout, depleted KPI copy
check(
  presetDisplayLabel('60세 -> 60세 은퇴') === '60세 즉시 은퇴' &&
    presetDisplayLabel('40세 -> 45세 은퇴 (파이어족, 싱글)') === '40세 → 45세 은퇴 (파이어족, 싱글)' &&
    PRESET_SCENARIOS.every((p) => !presetDisplayLabel(p.label).includes('->')),
  'preset chips must not show developer arrows (->) or "60세 -> 60세"',
);
check(
  amountReadout(15000, 10_000) === '= 1억 5,000만' &&
    amountReadout(500, 10_000) === null &&
    amountReadout(NaN, 10_000) === null &&
    amountReadout(15000) === null,
  'X4: 만원 inputs read out amounts >= 1억 as Korean units',
);
{
  const liveChipSrc = fs.readFileSync('src/components/WizardLiveChip.tsx', 'utf-8');
  const vhSrc = fs.readFileSync('src/components/VerdictHeader.tsx', 'utf-8');
  check(
    (wizardSrc.match(/readoutWon=\{10_000\}/g) ?? []).length >= 19 &&
      wizardSrc.includes("aria-current={isCurrent ? 'step' : undefined}") &&
      wizardSrc.includes('<WizardLiveChip plan={plan} />') &&
      wizardSrc.includes('🎯 이 조건으로 핵심 결과 브리핑 보기 →') &&
      !wizardSrc.includes('금융자산 구성 가이드 & 상세 분석 보기') &&
      !wizardSrc.includes('19개 표준 검증조건') &&
      liveChipSrc.includes('classifyPlanVerdict') &&
      liveChipSrc.includes('useDeferredValue(plan)') &&
      liveChipSrc.includes('deferredPlan.activeLedger.personalRatio') &&
      liveChipSrc.includes('aria-live="polite"') &&
      stylesSrc.includes('repeat(11, minmax(0, 1fr)); /* U5') &&
      stylesSrc.includes('word-break: keep-all;') &&
      stylesSrc.includes('.wizard-stepper-bar:not(.briefing-stepper-bar) {') &&
      vhSrc.includes('100세 전 고갈 — 배분별 순자산 우위 비교 불가') &&
      vhSrc.includes('월 {formatKRW(-activeCard.monthlyBuffer)} 부족') &&
      vhSrc.includes('activeLedger.finalAssetMultiple > 0 &&') &&
      !vhSrc.includes('`${activeLedger.depletionAgeSelf}세 고갈 주의`}\n'),
    'B3a: 11-col stepper with aria-current, live result chip, briefing CTA label, keep-all, X4 readout, depleted-state KPI copy',
  );
}

// 37. dev-ux B3b: survival parity (Lens1 uses the default 100-sample band like hero/live chip),
//     depleted-state Plan B copy, '월 N 부족' wording, ISA rate from engine constants
{
  const isaPctLiteral = /(?<![\d.])9\.9%/;
  check(
    !lens1Src.includes('activeLedger.personalRatio, 40)') &&
      guideSrc.includes('기본 시나리오에서도 <strong>{activeLedger.depletionAgeSelf}세</strong>에 금융자산이 고갈') &&
      guideSrc.includes("`월 ${formatKRW(-b)} 부족`") &&
      !guideSrc.includes('{formatKRW(plan.cards.hybrid.monthlyBuffer)}/월 여유') &&
      ![guideSrc, lens2Src, controlDockSrc, wizardSrc].some((src) => isaPctLiteral.test(src) || src.includes('20.9%')),
    'B3b: band sample parity, depleted Plan B copy, shortfall wording, no hard-coded 9.9%/20.9%',
  );
}

// 38. dev-ux B5 (#61 P1-a): 법인 미설립 최적안(법인 0%)이면 출구 매트릭스·분석03 요약은 '법인 100% 가정 참고치'로 표시, BEST EXIT 숨김
{
  const lens3Src = fs.readFileSync('src/components/Lens3StrategyMatrix.tsx', 'utf-8');
  const noCorpPreset = PRESET_SCENARIOS.find((p) => p.id === 'early-45-50');
  const noCorpPlan = noCorpPreset ? solveOptimizationMasterPlan(defineInputs(noCorpPreset.inputs)) : null;
  check(
    !!noCorpPlan && noCorpPlan.activeLedger.corporateRatio === 0,
    'fixture: early-45-50 preset currently yields a no-corporation optimum (r* = 개인 100%)',
  );
  check(
    lens3Src.includes('const isNoCorpPlan = plan.activeLedger.corporateRatio === 0;') &&
      lens3Src.includes('const isRec = !isNoCorpPlan && opt.strategyType === corporateExit.recommendedExit;') &&
      lens3Src.includes('아래는 법인 100% 가정 참고치') &&
      guideSrc.includes('const isNoCorpPlan = activeLedger.corporateRatio === 0;') &&
      guideSrc.includes("isNoCorpPlan ? '법인 미설립'") &&
      guideSrc.includes('법인 미설립 — 해당 없음 (법인 100% 가정 참고치') &&
      stylesSrc.includes('.reference-only-banner'),
    'B5: no-corp optimum must label corporate exit figures as reference-only and hide BEST EXIT',
  );
}

// 39. dev-ux B6: 국민연금 개시연령은 엔진 getPensionClaimStartAge(출생연도별 법정연령 ±5) — 60세 프리셋(1966년생)은 59/64/69세
{
  const lens3SrcB6 = fs.readFileSync('src/components/Lens3StrategyMatrix.tsx', 'utf-8');
  check(
    claimStartAge('early', 60) === 59 && claimStartAge('normal', 60) === 64 && claimStartAge('deferred', 60) === 69 &&
      claimStartAge('normal', 50) === 65 &&
      claimTimingLabel('normal', 60, true) === '64세 정상수령 (100%)' &&
      claimTimingLabel('deferred', 60, true) === '69세 연기수령 (136%)',
    'B6: claim ages come from the statutory birth-year table (60세 → 59/64/69, 50세 → 65)',
  );
  const hard = /'(60|65|70)세 (조기|정상|연기)|\((60|65|70)세 개시|정상수령\(65세\)|\? 60\s*:\s*inputs|: 65;/;
  check(
    ![wizardSrc, guideSrc, lens1Src, lens3SrcB6].some((src) => hard.test(src)) &&
      lens3SrcB6.includes('아래 임원 구성은 법인 설립 가정 참고치') &&
      lens3SrcB6.includes('const isRec = !isNoCorpPlan && executiveComparison.recommendedCount === ex.executiveCount;'),
    'B6: no hard-coded 60/65/70 claim ages in UI; no-corp plan labels the executive comparison as reference-only',
  );
}

// 40. dev-ux B7 (#76): 국민연금 ROI 설명문 방향 = 엔진 비교(연기 vs 정상 100세 순자산) — 연기 권고 화면에 '정상이 더 큼' 단정 금지
{
  const lens3SrcB7 = fs.readFileSync('src/components/Lens3StrategyMatrix.tsx', 'utf-8');
  check(
    lens3SrcB7.includes('const deferredWins =') &&
      lens3SrcB7.includes('{deferredWins ? (') &&
      lens3SrcB7.indexOf('{deferredWins ? (') < lens3SrcB7.indexOf('왜 연기수령(+36%)보다 정상수령') &&
      lens3SrcB7.includes('pensionComparison.deferred.crossoverAgeVsNormal ?? normalClaimAge + 14') &&
      lens3SrcB7.includes("isNoCorpPlan ? '절세계좌·개인 일반계좌' : '절세계좌·법인가수금'"),
    'B7: pension ROI explanation must branch on the engine comparison (no unconditional "정상이 더 큼" copy)',
  );
  for (const id of ['standard-50-60', 'immediate-60-60', 'early-45-50']) {
    const pre = PRESET_SCENARIOS.find((p) => p.id === id);
    if (!pre) continue;
    const pc = solveOptimizationMasterPlan(defineInputs(pre.inputs)).pensionComparison;
    const deferredWins = pc.deferred.finalDisposableNetWorth > pc.normal.finalDisposableNetWorth;
    check(
      pc.recommendedTiming !== 'deferred' || deferredWins,
      `B7 [${id}]: when the engine recommends 연기수령 the ROI box must take the 연기-우위 branch`,
    );
  }
}

// 41. dev-ux B8: 엔진 B7 실행 권고(recommendation) 표시 — 사유 1줄, Lens1 '수학적 최적 r*'+'권고' 마커, 카드 배지·X2 문구 권고 기준
{
  const same = { isMathematicalOptimum: true, personalRatio: 76, corporateRatio: 24 };
  const diff = { isMathematicalOptimum: false, personalRatio: 100, corporateRatio: 0 };
  check(
    strategyCardPills('hybrid', 'hybrid', same).join() === 'OPTIMAL r*' &&
      strategyCardPills('personal', 'hybrid', same).length === 0 &&
      strategyCardPills('hybrid', 'personal', diff).join() === '수학적 최적 r*' &&
      strategyCardPills('personal', 'personal', diff).join() === '권고',
    'B8: card pills — same → single OPTIMAL r*, different → 수학적 최적 r* (hybrid) + 권고 (winner)',
  );
  const cardsX = [
    { strategyType: 'personal', strategyName: '개인 100%', sustainableMonthlyLivingExpense: 6_000_000 },
    { strategyType: 'hybrid', strategyName: '최적', sustainableMonthlyLivingExpense: 5_960_000 },
  ];
  check(
    optimalTradeoffNote(cardsX, 'hybrid', diff).includes('실행 권고는 개인 100% : 법인 0%') &&
      optimalTradeoffNote(cardsX, 'hybrid', same) === optimalTradeoffNote(cardsX, 'hybrid'),
    'B8: X2 note names the execution recommendation when it differs from the mathematical optimum',
  );
  check(
    (guideSrc.match(/!plan\.recommendation\.isMathematicalOptimum && \(/g) ?? []).length === 2 &&
      guideSrc.includes('권고 사유 · {plan.recommendation.reason}') &&
      lens1Src.includes('rec.isMathematicalOptimum || rec.personalRatio === optimalHybrid.personalRatio') &&
      lens1Src.includes('★ 수학적 최적 r*') &&
      lens1Src.includes('✔ 권고 (개인') &&
      lens1Src.includes('const isBest = c.strategyType === plan.winner;') &&
      stylesSrc.includes('.recommendation-reason'),
    'B8: reason line (screen + print), dual curve markers, recommendation-based card highlight',
  );
  // 프리셋은 현재 모두 권고 = 수학적 최적 (#75) → 마커 1개·사유 미표시 경로
  for (const pre of PRESET_SCENARIOS) {
    const r = solveOptimizationMasterPlan(defineInputs(pre.inputs)).recommendation;
    check(typeof r.reason === 'string' && r.reason.length > 0, `B8 [${pre.id}]: recommendation.reason must be present`);
  }
}

// 42. dev-ux B9 (U4): 본문·설명·라벨 하한 12.5px(핵심 설명 13px) — 화면 전용(@media screen), 인쇄·표·SVG·상태 배지 제외
{
  // B9 섹션만 검사 (다음 `/* ====` 섹션 헤더 전까지) — 뒤에 추가되는 섹션(예: v1.2.25 C1의 .ledger-table 바텀시트)은 대상 아님
  const b9Start = stylesSrc.indexOf('B9 (U4)');
  const b9End = stylesSrc.indexOf('/* ====', b9Start);
  const b9 = stylesSrc.slice(b9Start, b9End > b9Start ? b9End : undefined);
  check(
    b9.length > 0 &&
      b9.includes('@media screen {') &&
      /\.action-basket-rule-desc,[\s\S]*?font-size: 13px;/.test(b9) &&
      /\.verdict-kpi-sub,[\s\S]*?font-size: 12\.5px;/.test(b9) &&
      /\.canvas-kicker,[\s\S]*?font-size: 12px;/.test(b9) &&
      !/font-size: (9|10|11)(\.5)?px/.test(b9) &&
      !b9.includes('.verdict-badge') &&
      !b9.includes('table') &&
      !b9.includes('svg'),
    'B9: readability floor block must be screen-only, ≥12px, and exclude badges/tables/SVG',
  );
}

// 43. Batch 3 (UX Usability, Contrast, Unit Consistency & HNWI Tax Scope UI Controls)
{
  const cssB3 = fs.readFileSync('src/styles.css', 'utf-8');
  const precB3 = fs.readFileSync('src/components/PrecisionTuners.tsx', 'utf-8');
  const guideB3 = fs.readFileSync('src/components/ActionGuideView.tsx', 'utf-8');
  const wizB3 = fs.readFileSync('src/components/InputWizard.tsx', 'utf-8');
  const lens2B3 = fs.readFileSync('src/components/Lens2WaterfallLedger.tsx', 'utf-8');
  const lens3B3 = fs.readFileSync('src/components/Lens3StrategyMatrix.tsx', 'utf-8');

  // 1. CSS Contrast & Dark Mode & Sticky Table Column (all before B9 U4)
  const b9Index = cssB3.indexOf('B9 (U4)');
  check(b9Index > 0, 'B9 (U4) section must exist in styles.css');
  const preB9Css = cssB3.slice(0, b9Index);

  check(
    preB9Css.includes(":root[data-theme='dark'] { color-scheme: dark; }") ||
      preB9Css.includes(":root[data-theme='dark'] {\n  color-scheme: dark;"),
    ':root[data-theme="dark"] must set color-scheme: dark above B9 (U4)',
  );
  check(
    preB9Css.includes('.legend-item-btn') &&
      /\.legend-item-btn[\s\S]*?color:\s*var\(--text-primary\);/.test(preB9Css),
    '.legend-item-btn must set color: var(--text-primary) above B9 (U4)',
  );
  check(
    preB9Css.includes('.ledger-table th:first-child') &&
      preB9Css.includes('position: sticky;') &&
      preB9Css.includes('left: 0;'),
    '.ledger-table th:first-child must have sticky positioning above B9 (U4)',
  );
  check(
    preB9Css.includes('.wizard-preset-btn.is-active-preset') &&
      preB9Css.includes('.preset-instant-briefing-btn') &&
      preB9Css.includes('.estate-comparison-grid'),
    'Active preset, instant briefing CTA, and estate comparison grid styles must be defined above B9 (U4)',
  );
  check(
    cssB3.includes('.bv-flow-step > span.bv-flow-num, .bv-flow-num') ||
      cssB3.includes('.bv-flow-step > span.bv-flow-num,\n.bv-flow-num'),
    'Slide 4 bv-flow-num must override bv-flow-step span color with #ffffff',
  );

  // 2. PrecisionTuners duplicate stress select removed
  check(
    !precB3.includes('은퇴 직후 시장 스트레스 시나리오') &&
      !precB3.includes('MarketStressScenarioType'),
    'PrecisionTuners Group A must not duplicate 은퇴 직후 시장 스트레스 시나리오 (managed in InputWizard Step 2)',
  );

  // 3. ActionGuideView real estate STEP 09 reference & Slide 3 real-mode basket scaling
  check(
    !guideB3.includes('다운사이징(STEP 10)') &&
      !guideB3.includes('(STEP 10 연동)') &&
      !guideB3.includes('(STEP 10 연계)'),
    'ActionGuideView must refer to real estate step as STEP 09, not stale STEP 10',
  );
  check(
    guideB3.includes('scaleDday') &&
      guideB3.includes('value: scaleDday(b.amount)'),
    'ActionGuideView Slide 3 must scale basket values with scaleDday in real mode',
  );

  // 4. InputWizard HNWI controls & active preset state
  check(
    wizB3.includes('selfOwnershipPercent') &&
      wizB3.includes('includePropertyTax') &&
      wizB3.includes('fundingStructure') &&
      wizB3.includes('terminalValuationMode') &&
      wizB3.includes('preset-instant-briefing-btn') &&
      wizB3.includes('is-active-preset'),
    'InputWizard must wire selfOwnershipPercent, includePropertyTax, fundingStructure, terminalValuationMode, and active preset instant CTA',
  );

  // 5. Lens2WaterfallLedger property tax breakdown
  check(
    lens2B3.includes('주택보유세(재산·종부)'),
    'Lens2WaterfallLedger must render property tax breakdown when personalPropertyTax > 0',
  );

  // 6. Lens3StrategyMatrix estate diagnostic section
  check(
    lens3B3.includes('estateDiagnostic') &&
      lens3B3.includes('금융재산상속공제') &&
      lens3B3.includes('estimatedInheritanceTax'),
    'Lens3StrategyMatrix must render 100세 청산 vs 상속세 진단 using estateDiagnostic',
  );
}

// v2 B3b (U-1): 위저드 Step 10/11 활성 비율과 Lens1 궤적은 activeLedger(auto=권고) 기준 — 수학적 r* 카드 고정 금지
{
  const wizSrcB3 = fs.readFileSync('src/components/InputWizard.tsx', 'utf-8');
  const lens1SrcB3 = fs.readFileSync('src/components/Lens1AllocationTrack.tsx', 'utf-8');
  check(
    wizSrcB3.includes('const activePersonalRatio = plan.activeLedger.personalRatio;') &&
      wizSrcB3.includes('자동 권고 (개인 ${recommendedPersonalRatio}%') &&
      wizSrcB3.includes('personalRatio: recommendedPersonalRatio,'),
    'U-1 위저드 Step 10 활성 비율·요약 = 권고(activeLedger), r*는 참고 표기'
  );
  check(
    !lens1SrcB3.includes('optimalHybrid.rows') && lens1SrcB3.includes('◆ 선택 (개인'),
    'U-1 Lens1 궤적 차트는 activeLedger.rows, 수동 선택 비율 핀 표시'
  );
}

// v2 B4: U-3 각주 법인세율·CSV 실질가치, U-4 Step 7 IRP 표기·탭 복원, D1 세액공제 가정, D3 팝오버 방향
{
  const lens2SrcB4 = fs.readFileSync('src/components/Lens2WaterfallLedger.tsx', 'utf-8');
  const wizSrcB4 = fs.readFileSync('src/components/InputWizard.tsx', 'utf-8');
  const cssB4 = fs.readFileSync('src/styles.css', 'utf-8');
  check(
    !lens2SrcB4.includes('법인세(9%)') &&
      lens2SrcB4.includes('CORP_TAX_PCT.transparent') &&
      (lens2SrcB4.match(/\]\.map\(\(v\) => scale\(v, r\)\)/g) ?? []).length === 4,
    'U-3 원장 각주 법인세율은 CORP_TAX_PCT, 두 CSV의 금액 열은 화면과 같은 scale(실질/명목) 적용',
  );
  // U-3 수치: 실질 모드 100세 행 scale(endDisposableNetWorth) = 섹션1 100세 세후가처분순자산(±1원)
  for (const preset of PRESET_SCENARIOS) {
    const realPlan = solveOptimizationMasterPlan(
      defineInputs({ ...preset.inputs, transition: { ...preset.inputs.transition, viewMode: 'real' } }),
    );
    const last = realPlan.activeLedger.rows[realPlan.activeLedger.rows.length - 1];
    check(
      Math.abs(Math.round(last.endDisposableNetWorth * last.discountFactor) - realPlan.activeLedger.finalDisposableNetWorth) <= 1,
      `U-3 [${preset.id}] CSV 100세 행(실질) = 섹션1 100세 순자산`,
    );
  }
  check(
    wizSrcB4.includes('checked={irpCapActive}') &&
      wizSrcB4.includes('inputs.accounts.overrideSymmetricAccountReturns && (inputs.accounts.applyIrpRiskAssetCap ?? true)') &&
      wizSrcB4.includes('useState<boolean>(() => {') &&
      wizSrcB4.includes('세액공제 환급</strong>은 계산에 포함하지 않는 보수적 가정'),
    'U-4 연동 모드 IRP 70% 배너·체크는 엔진 적용 조건과 동일, Step 7 탭은 저장값으로 복원 / D1 세액공제 미반영 가정 공개',
  );
  check(
    lens2SrcB4.includes('onFocus={orientLedgerPopover}') && cssB4.includes("tr[data-pop-down='1'] .ledger-why-popover"),
    'D3 원장 팝오버는 스크롤 영역 상단 여유가 부족하면 아래로 열림',
  );
}

// v1.2.17: '표준 예시' 버튼 제거 유지 & localStorage 복원 보존
{
  const wizSrcGuest = fs.readFileSync('src/components/InputWizard.tsx', 'utf-8');
  check(
    !wizSrcGuest.includes('표준 예시') && !wizSrcGuest.includes('createStandard19ScenarioInputs'),
    "'표준 예시 (50세 → 53세 은퇴)' 버튼·빌더 제거",
  );
}

// v1.2.18 브리핑 간결화 1단계: ⓘ 팝업(브라우저 기본 popover) — 설명문은 팝업으로 이동(삭제 금지), PDF는 펼침 유지
{
  const guideSrcD1 = fs.readFileSync('src/components/ActionGuideView.tsx', 'utf-8');
  const heroSrcD1 = fs.readFileSync('src/components/VerdictHeader.tsx', 'utf-8');
  const popSrcD1 = fs.readFileSync('src/components/InfoPop.tsx', 'utf-8');
  check(
    popSrcD1.includes('popover="auto"') && popSrcD1.includes('popoverTarget={id}') && popSrcD1.includes('popoverTargetAction="hide"'),
    'InfoPop은 브라우저 기본 popover(auto·light-dismiss)와 popovertarget 버튼으로 구현',
  );
  check(
    heroSrcD1.includes("criteriaMode = 'inline'") &&
      (guideSrcD1.match(/criteriaMode="popover"/g) ?? []).length === 1,
    'VerdictHero 기본은 펼침(PDF 불변), 브리핑 슬라이드 1만 팝업 모드',
  );
  const slide1 = guideSrcD1.slice(guideSrcD1.indexOf('{/* Slide 1: 종합 판정'), guideSrcD1.indexOf('{/* Slide 2: STEP 01'));
  const slide5 = guideSrcD1.slice(guideSrcD1.indexOf('{/* Slide 5: 개인 vs 법인'), guideSrcD1.indexOf('{/* Slide 6: 실행'));
  for (const [label, body] of [
    ['권고 사유', '{plan.recommendation.reason}'],
    ['배분 상세', '<VerdictHeader plan={plan} />'],
    ['연령대별 순자산', 'milestoneSnapshots.map'],
    ['하방 시나리오', 'minus2FinalNetWorth'],
    ['Plan B 레버', '하락장 가변 인출 가드레일'],
  ] as const) {
    const at = slide1.indexOf(`label="${label}"`);
    check(at > 0 && slide1.indexOf(body, at) > at && slide1.indexOf('</InfoPop>', at) > slide1.indexOf(body, at), `슬라이드 1 '${label}' 내용은 ⓘ 팝업 안에 보존`);
  }
  check(
    slide5.indexOf('label="상세"') < slide5.indexOf('<dl className="strategy-detail-list num">') &&
      slide5.indexOf('label="왜 이 권고인가요?"') < slide5.indexOf('plan.breakEven.verdictSummary'),
    '슬라이드 5 카드 상세·손익분기 판정은 ⓘ 팝업 안에 보존',
  );
  check(
    !guideSrcD1.includes('<p className="wizard-question-sub">{activeSlide.questionSub}</p>') &&
      guideSrcD1.includes('<p>{activeSlide.questionSub}</p>'),
    '브리핑 슬라이드 부제 설명은 제목 옆 ⓘ 팝업으로 이동',
  );
  // 2~4단계: 슬라이드 2·3·4·6도 시각 요소 + ⓘ 팝업 (공유 렌더러는 팝업 안에서 그대로 재사용 → PDF 불변)
  const sliceOf = (from: string, to: string) => guideSrcD1.slice(guideSrcD1.indexOf(from), guideSrcD1.indexOf(to));
  const s2 = sliceOf('{/* Slide 2: STEP 01', '{/* Slide 3: STEP 02');
  const s3 = sliceOf('{/* Slide 3: STEP 02', '{/* Slide 4: STEP 03');
  const s4 = sliceOf('{/* Slide 4: STEP 03', '{/* Slide 5: 개인 vs 법인');
  const s6 = sliceOf('{/* Slide 6: 실행 체크리스트', '{/* 각 슬라이드 하단');
  const inPop = (body: string, label: string, inner: string) => {
    const at = body.indexOf(`label="${label}"`);
    return at > 0 && body.indexOf(inner, at) > at && body.indexOf('</InfoPop>', at) > body.indexOf(inner, at);
  };
  check(
    s2.includes('<StackedBar') && inPop(s2, '적립 공식 전문', 'renderStep1Card()') &&
      s3.includes('<StackedBar') && inPop(s3, '계좌별 산식·운용 규칙', 'renderStep2DdayBox()') &&
      s4.includes('<FlowSteps') && s4.includes('<StackedRows') && inPop(s4, '인출 공식 전문', 'renderStep3Card()') &&
      s6.includes('className="bv-timeline"') && inPop(s6, '왜·어떻게', '{item.description}') && inPop(s6, '출구전략·검증', 'maxAccountingResidualAbs'),
    '슬라이드 2·3·4·6: 막대·흐름도·타임라인 시각 요소 + 기존 설명은 ⓘ 팝업 안에 보존',
  );
  check(
    (guideSrcD1.match(/이 슬라이드의 심층 차트·원장 바로 보기/g) ?? []).length === 1,
    '슬라이드 상단 중복 심층 이동 버튼 제거(하단 바 1곳만 유지)',
  );
}

// 27. v1.2.20 & v1.2.21: 다열 카드 팝업 wide 패널 선별 적용 및 팝업 내부 레이아웃 정합
{
  const infoPopSrc = fs.readFileSync('src/components/InfoPop.tsx', 'utf-8');
  const sincereSrc = fs.readFileSync('src/components/SincereFilingGuide.tsx', 'utf-8');
  const widePop = (label: string) => new RegExp(`<InfoPop label="${label}"[^>]*\\swide[\\s>]`).test(guideSrc);
  check(
    infoPopSrc.includes('wide?: boolean') &&
      infoPopSrc.includes('info-pop-panel--wide') &&
      stylesSrc.includes('.info-pop-panel--wide') &&
      ['배분 상세', '연령대별 순자산', '계좌별 산식·운용 규칙', '하방 시나리오', '성실신고 22% 피하는 법'].every(widePop) &&
      !widePop('출구전략·검증'),
    'v1.2.20~v1.2.21: wide 패널은 배분 상세·연령대별 순자산·5대 계좌·하방 시나리오·성실신고 5종에 적용하고 2카드 출구전략·검증은 기본 폭(640px) 사용',
  );
  check(
    guideSrc.includes('<InfoPop label="출구전략·검증" title="가족법인 출구전략 · 원장 검증">') &&
      guideSrc.includes('<div className="wizard-2col-grid num">') &&
      stylesSrc.includes('.wizard-2col-grid') &&
      stylesSrc.includes('.info-pop-body > .playbook-step-card') &&
      stylesSrc.includes('.info-pop-body > .playbook-dday-box') &&
      stylesSrc.includes('.info-pop-body > .plan-b-advisory-box') &&
      stylesSrc.includes('.info-pop-body > .playbook-step-card > .playbook-step-header') &&
      stylesSrc.includes('.info-pop-body > .playbook-dday-box > .blueprint-stack-bar') &&
      stylesSrc.includes('.info-pop-panel .sincere-filing-grid') &&
      sincereSrc.includes('<div className="sincere-filing-grid">') &&
      (sincereSrc.match(/className="sincere-filing-sec"/g) ?? []).length === 4,
    'v1.2.21: 출구전략 2열 그리드, InfoPop 내부 중복 테두리·헤더·누적 막대 평탄화, 성실신고 가이드 팝업 2열 그리드',
  );
}

// 44. Batch 4 (4-Part PDF Masterplan, Statutory Receipt Appendix, CSV Parity & v1.2.23 Release)
{
  const cssB4 = fs.readFileSync('src/styles.css', 'utf-8');
  const guideB4 = fs.readFileSync('src/components/ActionGuideView.tsx', 'utf-8');
  const lens2B4 = fs.readFileSync('src/components/Lens2WaterfallLedger.tsx', 'utf-8');

  // 1. CSS A4 Landscape multi-column collapse guards and orphan prevention
  const b9Index = cssB4.indexOf('B9 (U4)');
  check(b9Index > 0, 'B9 (U4) section must exist in styles.css');
  const preB9Css = cssB4.slice(0, b9Index);

  check(
    preB9Css.includes('@media screen and (max-width: 1220px)') &&
      preB9Css.includes('@media screen and (max-width: 1080px)') &&
      preB9Css.includes('@media screen and (max-width: 1180px)') &&
      preB9Css.includes('@media screen and (max-width: 900px)') &&
      cssB4.includes('@media (max-width: 1040px)'),
    'Batch 4: layout media queries must be scoped to @media screen and (max-width: ...) to protect print layout, keeping 1040px untouched',
  );

  check(
    preB9Css.includes('.print-part-header {\n    break-after: avoid;\n    page-break-after: avoid;\n  }') ||
      preB9Css.includes('break-after: avoid;'),
    'Batch 4: .print-part-header must have break-after: avoid',
  );

  check(
    preB9Css.includes('.print-masterplan-report .sincere-filing-grid') &&
      preB9Css.includes('.print-statutory-appendix') &&
      preB9Css.includes('.print-statutory-appendix-table') &&
      preB9Css.includes('.screen-only-hint'),
    'Batch 4: styles.css must define print sincere-filing-grid, statutory appendix table, and screen-only-hint above B9 (U4)',
  );

  // 2. ActionGuideView Masthead, STEP 07 truthfulness, legal framing & statutory appendix
  check(
    !guideB4.includes('(+-') &&
      !guideB4.includes('(+{formatKRW(activeLedger.totalLifetimeTaxAndHealthSaved)}') &&
      guideB4.includes('NESTWAY SLIDER · PRIVATE WEALTH &amp; TAX SIMULATION REPORT') &&
      guideB4.includes('은퇴 금융자산 최적 배분 및 절세·건보료 마스터플랜 시뮬레이션 리포트') &&
      guideB4.includes('통합 {rows.length}개년(1원 단위) 정밀 시뮬레이션 보고서') &&
      guideB4.includes('TAX SIMULATION REPORT') &&
      guideB4.includes('세무사법 제2조') &&
      guideB4.includes('자본시장법 제6조') &&
      guideB4.includes('5대 계좌 동일 기대수익률 연동') &&
      guideB4.includes('일반·법인 계좌와 동일한 공정 비교 기대수익률 적용') &&
      guideB4.includes('print-statutory-appendix-table') &&
      guideB4.includes('세목별·주요 연령대 산식 검증 부록 (법정 세율·건보 부과 근거 요약)') &&
      guideB4.includes('가족법인 미설립(개인 100% 권고) — 법인 성실신고확인대상(22%) 요건 및 회피 절차 해당 없음'),
    'Batch 4: ActionGuideView masthead simulation phrasing, no (+- formatting bugs, STEP 07 truthfulness, legal disclaimers, and statutory appendix',
  );

  // 3. Lens2WaterfallLedger CSV withdrawal order, property tax column, and scaleDdayFor
  check(
    lens2B4.includes('scaleDdayFor') &&
      lens2B4.includes('scaleDdayFor(item.sim, item.sim.blueprint.totalCapitalAtRetirement)') &&
      lens2B4.includes('scaleDdayFor(activeLedger, seg.amount)') &&
      lens2B4.includes("'3단계_연금저축인출(원)'") &&
      lens2B4.includes("'4단계_IRP인출(원)'") &&
      lens2B4.includes("'5단계_ISA인출(원)'") &&
      lens2B4.includes("'개인주택보유세(원)'") &&
      (lens2B4.match(/\]\.map\(\(v\) => scale\(v, r\)\)/g) ?? []).length === 4 &&
      lens2B4.includes('className="screen-only-hint"'),
    'Batch 4: Lens2WaterfallLedger CSV 1-A order, property tax column, scaleDdayFor parity, and screen-only-hint',
  );
}

// 32. v1.2.25 C1 모바일(≤640px) 레이아웃 · 터치 입력 · 도움말 바텀시트 (노트북·인쇄 무영향 격리)
{
  const c1Start = stylesSrc.indexOf('v1.2.25 C1');
  check(c1Start > 0, 'styles.css must contain the v1.2.25 C1 mobile block');
  const c1Css = stylesSrc.slice(c1Start);
  check(
    c1Css.includes('@media screen and (max-width: 640px) {') &&
      ['.action-basket-grid', '.analysis-tile-grid', '.wizard-summary-grid', '.briefing-milestone-strip', '.etf-preset-chips'].every(
        (sel) => c1Css.includes(sel),
      ) &&
      c1Css.includes('grid-template-columns: 1fr;') &&
      c1Css.includes('grid-auto-flow: column;'),
    'C1: ≤640px card grids collapse to 1 column and briefing tabs scroll in one row',
  );
  check(
    c1Css.includes('@media screen and (max-width: 640px) and (hover: none) {') &&
      c1Css.includes("input:not([type='range']):not([type='checkbox']):not([type='radio'])") &&
      c1Css.includes('font-size: 16px;'),
    'C1: 16px inputs only on narrow touch screens (prevents iOS focus zoom, laptops untouched)',
  );
  check(
    c1Css.includes('.precision-drawer,') &&
      c1Css.includes('transform: none;') &&
      c1Css.includes('.field-help-trigger .field-help-popover') &&
      c1Css.includes(".ledger-table tr[data-pop-down='1'] .ledger-why-popover") &&
      c1Css.includes('position: fixed;'),
    'C1: help/ledger popovers become bottom sheets on mobile, with resting transforms neutralized',
  );
  check(
    controlDockSrc.includes('inputMode="decimal"') && controlDockSrc.includes('onClick={(e) => e.preventDefault()}'),
    'C1: NumericInput requests the decimal keypad; FieldHelpBadge stops <label> from stealing focus to the input',
  );
  check(
    guideSrc.includes('briefingStepperRef') && guideSrc.includes("aria-current={isCurrent ? 'step' : undefined}"),
    'C1: briefing tab bar keeps the current tab in view and marks it with aria-current',
  );
  const c1bStart = stylesSrc.indexOf('v1.2.25 C1-b');
  const c1bCss = c1bStart > 0 ? stylesSrc.slice(c1bStart) : '';
  check(
    c1bCss.includes('@media screen and (max-width: 640px) {') &&
      /\.verdict-bar \{\s*position: static;/.test(c1bCss) &&
      /\.bv-spark-mark \{[^}]*white-space: normal;[^}]*max-width: 4\.6em;/.test(c1bCss),
    'C1-b: on ≤640px the 4-KPI verdict bar is not sticky and sparkline amount labels wrap to avoid overlap',
  );
  check(
    /\.ledger-table td:first-child \{\s*position: sticky;[^}]*background: var\(--bg-panel\);/.test(stylesSrc) &&
      stylesSrc.includes('.ledger-table .ledger-row-dday td:first-child {'),
    'C1-b: ledger sticky first column uses a defined opaque background (--bg-panel; D-Day row keeps its tint)',
  );
}

// 33. v1.2.25 C2 배분 곡선: 터치 첫 탭은 툴팁만(arm), 같은 점 재탭 시 적용 · 마우스는 기존대로 클릭 즉시 적용
{
  check(
    resolveCurveTap('mouse', null, 3) === 'apply' &&
      resolveCurveTap('pen', null, 3) === 'apply' &&
      resolveCurveTap('touch', null, 3) === 'arm' &&
      resolveCurveTap('touch', 5, 3) === 'arm' &&
      resolveCurveTap('touch', 3, 3) === 'apply',
    'C2: resolveCurveTap applies immediately for mouse, arms on first touch tap, applies on second tap of the same point',
  );
  check(
    lens1Src.includes('lastPointerTypeRef.current = e.pointerType') &&
      lens1Src.includes("resolveCurveTap(lastPointerTypeRef.current, touchArmedIdx, idx) === 'arm'") &&
      lens1Src.includes('(다시 탭하면 적용)'),
    'C2: allocation curve points route clicks through resolveCurveTap and show the touch hint',
  );
}

// 34. v1.2.25 C3 Plan B 단일 레버: 산출값을 원장에 다시 넣으면 실제로 해소되는지 왕복 검증 (+ 최소성)
{
  const base = defineInputs();
  const withLiving = (inp: typeof base, living: number) => ({
    ...inp,
    cashflow: { ...inp.cashflow, targetNetMonthlyLivingExpense: living },
  });
  const baseCard = pickActiveCard(solveOptimizationMasterPlan(base));
  const scenarios = [
    { id: 'risk (living 1,400만)', inputs: withLiving(base, 14_000_000) },
    // 고갈은 없지만 월 여유 < 100만 → '주의' 구간
    { id: 'caution (buffer ≈ +50만)', inputs: withLiving(base, baseCard.sustainableMonthlyLivingExpense - 500_000) },
  ];
  for (const sc of scenarios) {
    const plan = solveOptimizationMasterPlan(sc.inputs);
    const card = pickActiveCard(plan);
    const ratio = plan.activeLedger.personalRatio;
    check(card.monthlyBuffer < 1_000_000, `C3 [${sc.id}]: scenario must sit below the 100만 buffer target`);
    const lev = computePlanBLevers(plan.inputs, ratio);
    check(!lev.deterministicMet, `C3 [${sc.id}]: deterministic target must be unmet`);
    const living = plan.inputs.cashflow.targetNetMonthlyLivingExpense;
    if (lev.livingCut !== null) {
      check(meetsPlanBTarget(withLiving(plan.inputs, living - lev.livingCut), ratio), `C3 [${sc.id}]: living cut resolves`);
      check(
        lev.livingCut < 10_000 || !meetsPlanBTarget(withLiving(plan.inputs, living - lev.livingCut + 10_000), ratio),
        `C3 [${sc.id}]: living cut is minimal (1만 원 단위)`,
      );
      // 화면의 '월 여유분'(지속가능 한계생활비 − 목표)과 같은 크기여야 함 (±2만 원)
      check(Math.abs(lev.livingCut - (1_000_000 - card.monthlyBuffer)) <= 20_000, `C3 [${sc.id}]: living cut ≈ 100만 − monthlyBuffer`);
    }
    if (lev.retireDelayYears !== null) {
      const delayed = (n: number) => ({
        ...plan.inputs,
        transition: { ...plan.inputs.transition, targetRetirementAgeSelf: plan.inputs.transition.targetRetirementAgeSelf + n },
      });
      check(lev.retireDelayYears >= 1 && lev.retireDelayYears <= PLAN_B_MAX_DELAY_YEARS, `C3 [${sc.id}]: delay within range`);
      check(meetsPlanBTarget(delayed(lev.retireDelayYears), ratio), `C3 [${sc.id}]: retirement delay resolves`);
      check(lev.retireDelayYears === 1 || !meetsPlanBTarget(delayed(lev.retireDelayYears - 1), ratio), `C3 [${sc.id}]: delay is minimal`);
    }
    check(lev.savingsApplicable === plan.inputs.pension.currentAgeSelf < plan.inputs.transition.targetRetirementAgeSelf, `C3 [${sc.id}]: savings lever only before retirement`);
    if (lev.extraMonthlySavings !== null) {
      const saved = {
        ...plan.inputs,
        transition: {
          ...plan.inputs.transition,
          preRetirementMonthlySavings: plan.inputs.transition.preRetirementMonthlySavings + lev.extraMonthlySavings,
        },
      };
      check(meetsPlanBTarget(saved, ratio), `C3 [${sc.id}]: extra savings resolves`);
    }
  }
  // 안전 시나리오(기본값)는 결정론 기준을 이미 충족 → 수치 레버 대신 생존확률 안내
  check(computePlanBLevers(base, solveOptimizationMasterPlan(base).activeLedger.personalRatio).deterministicMet, 'C3: default scenario already meets the deterministic target');
  check(
    (guideSrc.match(/\{renderPlanBLevers\(\)\}/g) ?? []).length === 2 && stylesSrc.includes('.plan-b-quant-levers'),
    'C3: Plan B levers render on briefing slide 1 and in the PDF Plan B box',
  );
}

// 35. v1.2.26 Task 1: Warm Paper & Ink Editorial Binder Tokens + Dark/Print Isolation
{
  const cssT1 = fs.readFileSync('src/styles.css', 'utf-8');
  const b9IdxT1 = cssT1.indexOf('B9 (U4)');
  check(b9IdxT1 > 0, 'B9 (U4) block must exist in styles.css');
  const preB9T1 = cssT1.slice(0, b9IdxT1);
  check(
    preB9T1.includes('--bg-sheet:') &&
      preB9T1.includes('--ink-frame:') &&
      preB9T1.includes('--bg-warm-head:') &&
      preB9T1.includes('--bg-active-head:') &&
      preB9T1.includes('--editorial-pill-bg:') &&
      preB9T1.includes('--editorial-pill-fg:') &&
      preB9T1.includes('--mono-font:') &&
      preB9T1.includes('--canvas-dot:') &&
      preB9T1.includes('radial-gradient(var(--canvas-dot)') &&
      cssT1.includes('@media print') &&
      /background-image:\s*none\s*!important/.test(cssT1),
    'Task 1: Warm Paper & Ink tokens must be defined above B9 (U4) for light/dark and stripped in @media print',
  );
}

console.log(
  `✅ PASS: uiParity.test.ts (${verifiedModes} preset/mode combinations verified for 0-Won UI parity, InputWizard [입력 1~5], ActionGuideView [출력 1~2], Tab 2 & Tab 3 invariants, Step 6/7 split return slides, Method B dual-scope ETF builder, spouseExpectedSeverancePay, Phase A~D, CSS polish & Tab 3 Doc Update v1.2.5~v1.2.23)`,
);


