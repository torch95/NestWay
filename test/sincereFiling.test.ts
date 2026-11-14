import { solveOptimizationMasterPlan } from '../src/engine/optimizer';
import { DEFAULT_SIMULATION_INPUTS, defineInputs } from '../src/engine/presets';
import { assessSincereFiling, sincereFilingStatusLine, summarizeSincereFiling } from '../src/engine/sincereFiling';

declare function require(id: 'fs'): {
  readdirSync(p: string): string[];
  readFileSync(p: string, enc: string): string;
  statSync(p: string): { isDirectory(): boolean };
};
declare function require(id: 'path'): { join(...parts: string[]): string };
const { readdirSync, readFileSync, statSync } = require('fs');
const { join } = require('path');

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// 1. 판정식: (배당+이자) ÷ (매매차익 + 배당+이자) ≥ 50% → 성실신고확인대상 가능성
const allDiv = assessSincereFiling(100, 0);
check(allDiv.likely && allDiv.passiveShare === 1 && allDiv.minSaleGainToAvoid === 101, 'all-dividend year is likely, needs >100');
const gainMajor = assessSincereFiling(100, 150);
check(!gainMajor.likely && Math.abs(gainMajor.passiveShare - 0.4) < 1e-9 && gainMajor.minSaleGainToAvoid === 0, 'gain-majority year is not likely');
const tie = assessSincereFiling(100, 100);
check(tie.likely && tie.minSaleGainToAvoid === 1, '50% exactly is still likely (≥ 50%)');
const unregistered = assessSincereFiling(100, 1000, false);
check(unregistered.likely && unregistered.minSaleGainToAvoid === null, 'unregistered: sale gain excluded from revenue → always likely');
const none = assessSincereFiling(0, 0);
check(!none.likely && none.passiveShare === 0 && none.minSaleGainToAvoid === 0, 'no passive income → not likely');

// 2. 원장 관측 필드: 현금흐름 불변(잔차 0), 개인 100%는 법인 수익 0
const plan = solveOptimizationMasterPlan(DEFAULT_SIMULATION_INPUTS);
for (const ledger of [plan.personal100, plan.corporate100, plan.optimalHybrid, plan.activeLedger]) {
  for (const r of ledger.rows) {
    check(Number.isFinite(r.corpDividendIncome) && r.corpDividendIncome >= 0, 'corpDividendIncome finite ≥ 0');
    check(Number.isFinite(r.corpRealizedSaleGain), 'corpRealizedSaleGain finite');
    check(r.accountingResidual === 0, 'residual stays 0');
  }
}
check(plan.personal100.rows.every((r) => r.corpDividendIncome === 0 && r.corpRealizedSaleGain === 0), 'personal 100% has no corp income');
check(plan.corporate100.rows.some((r) => r.corpDividendIncome > 0), 'corp 100% has corp dividend income');

// 3. 요약 = 행 단위 재계산과 일치
function recount(rows: typeof plan.activeLedger.rows) {
  const corpRows = rows.filter((r) => r.corpDividendIncome > 0 || r.corpRealizedSaleGain > 0);
  const likely = corpRows.filter((r) => assessSincereFiling(r.corpDividendIncome, r.corpRealizedSaleGain).likely);
  return { corpYears: corpRows.length, likelyYears: likely.length };
}
for (const ledger of [plan.corporate100, plan.optimalHybrid]) {
  const s = summarizeSincereFiling(ledger.rows, false);
  const rc = recount(ledger.rows);
  check(s.corpYears === rc.corpYears && s.likelyYears === rc.likelyYears, 'summary matches row recount');
  check(s.likelyYears === 0 ? s.firstLikelyAgeSelf === null : s.firstLikelyAgeSelf !== null, 'firstLikelyAgeSelf consistency');
  check(s.maxAdditionalSaleGain >= 0, 'maxAdditionalSaleGain ≥ 0');
}
const ps = summarizeSincereFiling(plan.personal100.rows, false);
check(ps.corpYears === 0 && ps.likelyYears === 0 && ps.maxAdditionalSaleGain === 0, 'personal 100% summary empty');

// 4. 계획 요약은 activeLedger 기준
const active = summarizeSincereFiling(plan.activeLedger.rows, plan.inputs.corporate.taxRecognitionMode === 'yearly');
check(JSON.stringify(plan.sincereFilingSummary) === JSON.stringify(active), 'plan.sincereFilingSummary = activeLedger summary');

// 5. 법인 100%는 매매차익 매출 계상 전제에서도 대부분 배당 우세(유출이 배당 현금으로 먼저 충당)
const c100 = summarizeSincereFiling(plan.corporate100.rows, false);
check(c100.corpYears > 0 && c100.likelyYears > 0, 'corp 100% has dividend-majority years');

// 6. yearly 인식 모드는 근사치 플래그
const yearlyPlan = solveOptimizationMasterPlan(
  defineInputs({ ...DEFAULT_SIMULATION_INPUTS, corporate: { ...DEFAULT_SIMULATION_INPUTS.corporate, taxRecognitionMode: 'yearly' } })
);
check(yearlyPlan.sincereFilingSummary.isApproximate === true, 'yearly mode flagged approximate');
check(plan.sincereFilingSummary.isApproximate === (plan.inputs.corporate.taxRecognitionMode === 'yearly'), 'approx flag mirrors mode');

// 7. 체크리스트 act-5: 법인 수익 연도가 있을 때만, 상태 문구 = impactSummary
check(!plan.actionChecklist.some((i) => i.id === 'act-5-sincere') === (plan.sincereFilingSummary.corpYears === 0), 'act-5 only with corp years');
const manual74 = solveOptimizationMasterPlan(
  defineInputs({ ...DEFAULT_SIMULATION_INPUTS, hybrid: { ...DEFAULT_SIMULATION_INPUTS.hybrid, useAutoOptimalRatio: false, personalRatio: 74 } })
);
const act5 = manual74.actionChecklist.find((i) => i.id === 'act-5-sincere');
check(!!act5 && act5.impactSummary === sincereFilingStatusLine(manual74.sincereFilingSummary), 'act-5 present for corp plan with status line');
check(!act5!.description.includes('마찰'), 'no forbidden copy in act-5');
check(sincereFilingStatusLine({ corpYears: 0, likelyYears: 0, firstLikelyAgeSelf: null, maxAdditionalSaleGain: 0, maxAdditionalSaleGainAgeSelf: null, isApproximate: false }) === null, 'no status without corp');
check(sincereFilingStatusLine({ corpYears: 5, likelyYears: 5, firstLikelyAgeSelf: 60, maxAdditionalSaleGain: 1, maxAdditionalSaleGainAgeSelf: 60, isApproximate: false })!.includes('회피 어려움'), 'all-dividend status');

// 8. 특정 법인 형태 표기 부재 및 성실신고 가이드 정적 가드
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n: string) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
let scannedFiles = 0;
for (const file of walk('src')) {
  const srcText = readFileSync(file, 'utf8');
  scannedFiles++;
  for (const term of ['주식회사', '(주)']) check(!srcText.includes(term), `${file}: no company-form string`);
}
check(scannedFiles > 10, 'scanned src tree');
const guideSrc = readFileSync('src/components/SincereFilingGuide.tsx', 'utf8');
check(!guideSrc.includes('9.9%') && !guideSrc.includes('19%') && !guideSrc.includes('9%'), 'guide uses 2026 rates via CORP_TAX_PCT only');
for (const must of ['659902', '세무대리인', '실질과세', '50%', 'CORP_TAX_PCT.transparent', 'CORP_TAX_PCT.normalLow'])
  check(guideSrc.includes(must), `guide includes ${must}`);
const agvSrc = readFileSync('src/components/ActionGuideView.tsx', 'utf8');
check((agvSrc.match(/<SincereFilingGuide /g) || []).length === 2, 'guide rendered in slide 5 InfoPop and PDF PART III');

console.log(
  `sincereFiling OK — active ${plan.sincereFilingSummary.likelyYears}/${plan.sincereFilingSummary.corpYears}, corp100 ${c100.likelyYears}/${c100.corpYears}`
);
