import {
  DEFAULT_ACTIVE_SENIOR_CONFIG,
  DEFAULT_SIMULATION_INPUTS,
  STARTER_ETF_HOLDINGS,
  defineInputs,
  solveNestWaySlider,
  type EtfHolding,
  type SimulationInputs,
} from '../engine';

const MAX_IMPORT_BYTES = 1_048_576;

const ENUM_SETS: Record<string, ReadonlySet<string>> = {
  inputMode: new Set(['macro', 'detailed']),
  shelteredInputMode: new Set(['macro', 'detailed']),
  housingType: new Set(['own', 'rent']),
  targetHousingType: new Set(['own', 'rent']),
  ownership: new Set(['single', 'joint']),
  strategy: new Set(['keep', 'downsize', 'housing_pension', 'sell_rent']),
  spendingMode: new Set(['flat', 'active_senior']),
  taxType: new Set(['transparent', 'normal']),
  taxRecognitionMode: new Set(['yearly', 'realized']),
  liquidationTaxMode: new Set(['simple_gross', 'capital_return_exempt']),
  injectionTiming: new Set(['now', 'retirement']),
  exitStrategy: new Set(['lump_sum_liquidation', 'phased_dividend_reduction', 'family_share_transfer']),
  fundingStructure: new Set(['shareholder_loan', 'capital_stock']),
  terminalValuationMode: new Set(['liquidation', 'inheritance']),
  claimTimingSelf: new Set(['early', 'normal', 'deferred']),
  claimTimingSpouse: new Set(['early', 'normal', 'deferred']),
  selfSeveranceType: new Set(['pension', 'severance_pay']),
  spouseSeveranceType: new Set(['pension', 'severance_pay']),
  viewMode: new Set(['nominal', 'real']),
  marketStressScenario: new Set(['none', 'early_drop_20', 'early_drop_30', 'dotcom_crash', 'gfc_2008', 'stagflation']),
  market: new Set(['KRX', 'US']),
  dividendCycle: new Set(['Monthly', 'Quarterly', 'Annual', 'None']),
  productType: new Set(['overseas_direct', 'domestic_listed', 'covered_call', 'other']),
};

const HOLDING_TEMPLATE: EtfHolding = {
  ...STARTER_ETF_HOLDINGS[0],
  ratio: 0,
  taxStandardRatio: 1,
};

const SECTION_TEMPLATES: Record<keyof SimulationInputs, Record<string, unknown>> = {
  asset: { ...DEFAULT_SIMULATION_INPUTS.asset, selfOwnershipPercent: 50, returnShiftPct: 0 },
  realEstate: { ...DEFAULT_SIMULATION_INPUTS.realEstate },
  cashflow: {
    ...DEFAULT_SIMULATION_INPUTS.cashflow,
    activeSeniorConfig: { ...DEFAULT_ACTIVE_SENIOR_CONFIG },
  },
  corporate: { ...DEFAULT_SIMULATION_INPUTS.corporate, injectionTiming: 'now' },
  pension: { ...DEFAULT_SIMULATION_INPUTS.pension },
  accounts: { ...DEFAULT_SIMULATION_INPUTS.accounts },
  transition: { ...DEFAULT_SIMULATION_INPUTS.transition, serviceYears: 30, spouseServiceYears: 30 },
  hybrid: { ...DEFAULT_SIMULATION_INPUTS.hybrid },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sanitizeRecord(src: Record<string, unknown>, tmpl: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(tmpl)) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const val = src[key];
    const exemplar = tmpl[key];
    if (key === 'holdings' || key === 'shelteredHoldings') {
      if (Array.isArray(val)) {
        const cleanHoldings = val
          .filter(isPlainObject)
          .slice(0, 50)
          .map((item) => sanitizeRecord(item, HOLDING_TEMPLATE as unknown as Record<string, unknown>))
          .filter((h) => typeof h.ticker === 'string' && h.ticker.trim().length > 0);
        out[key] = cleanHoldings;
      }
      continue;
    }
    if (key === 'lumpSumEvents') {
      if (Array.isArray(val)) {
        out[key] = val
          .filter((e): e is Record<string, unknown> => isPlainObject(e) && typeof e.amount === 'number' && Number.isFinite(e.amount))
          .slice(0, 5);
      }
      continue;
    }
    if (isPlainObject(exemplar)) {
      if (isPlainObject(val)) out[key] = sanitizeRecord(val, exemplar);
      continue;
    }
    if (typeof exemplar === 'number' && typeof val === 'number' && Number.isFinite(val)) {
      if (key === 'executiveCount') {
        out[key] = val === 1 ? 1 : 2;
      } else if (key === 'currentAgeSelf' || key === 'currentAgeSpouse' || key === 'targetRetirementAgeSelf') {
        out[key] = Math.min(99, Math.max(20, Math.round(val)));
      } else {
        out[key] = val;
      }
    } else if (typeof exemplar === 'boolean' && typeof val === 'boolean') {
      out[key] = val;
    } else if (typeof exemplar === 'string' && typeof val === 'string') {
      const allowed = ENUM_SETS[key];
      if (!allowed || allowed.has(val)) out[key] = val;
    }
  }
  return out;
}

export function serializeScenario(inputs: SimulationInputs): string {
  return JSON.stringify({ version: 1, inputs }, null, 2);
}

export function buildScenarioFilename(inputs: SimulationInputs, now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const retireAge = Math.round(inputs.transition.targetRetirementAgeSelf || 60);
  return `nestway_plan_${yyyy}${mm}${dd}_${retireAge}세은퇴.json`;
}

export function parseScenarioJson(rawText: string): SimulationInputs {
  if (!rawText || !rawText.trim()) {
    throw new Error('파일이 비어 있습니다.');
  }
  if (rawText.length > MAX_IMPORT_BYTES) {
    throw new Error('파일 크기가 1MB를 초과합니다.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('올바른 JSON 파일 형식이 아닙니다.');
  }
  if (!isPlainObject(parsed)) {
    throw new Error('유효한 NestWay 시나리오 객체가 아닙니다.');
  }
  const candidate = isPlainObject(parsed.inputs) ? parsed.inputs : parsed;
  const sectionKeys = Object.keys(SECTION_TEMPLATES) as Array<keyof SimulationInputs>;
  const matchedSections = sectionKeys.filter((k) => isPlainObject(candidate[k]));
  if (matchedSections.length === 0) {
    throw new Error('시나리오 입력 항목(asset, pension 등)을 찾을 수 없습니다.');
  }
  const cleanPartial: Record<string, unknown> = {};
  for (const sec of matchedSections) {
    cleanPartial[sec] = sanitizeRecord(candidate[sec] as Record<string, unknown>, SECTION_TEMPLATES[sec]);
  }
  const normalized = defineInputs(cleanPartial as Partial<SimulationInputs>);
  const plan = solveNestWaySlider(normalized);
  if (!Number.isFinite(plan.activeLedger.finalDisposableNetWorth)) {
    throw new Error('시뮬레이션 계산이 불가능한 비정상 입력값이 포함되어 있습니다.');
  }
  return normalized;
}
