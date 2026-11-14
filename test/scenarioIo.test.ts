import { PRESET_SCENARIOS, defineInputs, solveNestWaySlider } from '../src/engine';
import { buildScenarioFilename, parseScenarioJson, serializeScenario } from '../src/lib/scenarioIo';

declare function require(id: string): {
  existsSync(p: string): boolean;
  readFileSync(p: string, enc: string): string;
};
const fs = require('fs');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// 1. Round-trip 1-Won parity across all 6 presets + optional HNWI/ETF/lumpSum fields
for (const preset of PRESET_SCENARIOS) {
  const original = defineInputs({
    ...preset.inputs,
    asset: { ...preset.inputs.asset, selfOwnershipPercent: 70, returnShiftPct: -3 },
    corporate: {
      ...preset.inputs.corporate,
      injectionTiming: 'retirement',
      fundingStructure: 'capital_stock',
      terminalValuationMode: 'inheritance',
    },
    transition: { ...preset.inputs.transition, serviceYears: 25, spouseServiceYears: 18 },
    cashflow: {
      ...preset.inputs.cashflow,
      lumpSumEvents: [{ id: 'e1', ageSelf: 62, type: 'outflow', amount: 120_000_000, label: '자녀 결혼' }],
    },
  });
  const json = serializeScenario(original);
  const restored = parseScenarioJson(json);
  const planOrig = solveNestWaySlider(original);
  const planRest = solveNestWaySlider(restored);
  assert(
    planOrig.activeLedger.finalDisposableNetWorth === planRest.activeLedger.finalDisposableNetWorth,
    `[${preset.id}] 1-Won final net worth parity`,
  );
  assert(planRest.activeLedger.maxAccountingResidualAbs === 0, `[${preset.id}] 0-Won residual`);
  assert(restored.asset.selfOwnershipPercent === 70 && restored.asset.returnShiftPct === -3, `[${preset.id}] optional asset fields preserved`);
  assert(restored.corporate.injectionTiming === 'retirement', `[${preset.id}] optional injectionTiming preserved`);
  assert(restored.transition.serviceYears === 25 && restored.transition.spouseServiceYears === 18, `[${preset.id}] optional serviceYears preserved`);
  assert(restored.cashflow.lumpSumEvents?.length === 1, `[${preset.id}] lumpSumEvents preserved`);
}

// 2. Bare SimulationInputs root compatibility (for CLI / AI Skill interoperability) + filename format
const bareRestored = parseScenarioJson(JSON.stringify(defineInputs()));
assert(solveNestWaySlider(bareRestored).activeLedger.maxAccountingResidualAbs === 0, 'Bare SimulationInputs root accepted');
assert(
  buildScenarioFilename(bareRestored, new Date('2026-11-10T00:00:00Z')) === 'nestway_plan_20261110_60세은퇴.json',
  'Deterministic scenario filename',
);

// 3. Existing legacy user_state.json ({ inputs, updatedAt }) lossless compatibility
if (fs.existsSync('user_state.json')) {
  const legacyRaw = fs.readFileSync('user_state.json', 'utf-8');
  const legacyRestored = parseScenarioJson(legacyRaw);
  const legacyDirect = defineInputs(JSON.parse(legacyRaw).inputs);
  assert(
    solveNestWaySlider(legacyRestored).activeLedger.finalDisposableNetWorth ===
      solveNestWaySlider(legacyDirect).activeLedger.finalDisposableNetWorth,
    'Existing user_state.json imports with 0-Won drift',
  );
}

// 4. Trust-boundary validation: reject empty, >1MB, invalid JSON, arrays, unrelated objects; scrub bad types & __proto__
for (const bad of ['', '   ', '{broken', '[]', 'null', '"str"', '{}', '{"hello":1}', 'x'.repeat(1_050_000)]) {
  let threw = false;
  try {
    parseScenarioJson(bad);
  } catch {
    threw = true;
  }
  assert(threw, `Must reject invalid payload (${bad.slice(0, 20)})`);
}

const polluted = JSON.stringify({
  __proto__: { polluted: true },
  inputs: {
    asset: { totalInvestment: 'not_a_number', growthRate: null },
    corporate: { taxType: 'hacked_enum', executiveCount: 99 },
    pension: { currentAgeSelf: 999 },
  },
});
const sanitized = parseScenarioJson(polluted);
assert(({} as Record<string, unknown>).polluted === undefined, 'Prototype pollution blocked');
assert(sanitized.asset.totalInvestment === defineInputs().asset.totalInvestment, 'Invalid string number falls back to default');
assert(sanitized.corporate.taxType === 'transparent' && sanitized.corporate.executiveCount === 2, 'Invalid enum & executiveCount sanitized');
assert(sanitized.pension.currentAgeSelf === 99, 'Extreme age clamped safely');

console.log('✅ PASS: scenarioIo.test.ts (6 presets + optional fields + bare root + user_state.json + trust-boundary fuzzing)');
