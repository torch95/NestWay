import React, { useEffect, useMemo, useState } from 'react';
import {
  PORTFOLIO_PRESETS,
  SHELTERED_PORTFOLIO_PRESETS,
  addHoldingKeepingTotal,
  applyPresetToHoldings,
  calculateCurrentShelteredTotal,
  evaluateHoldingsList,
  evaluatePortfolio,
  evaluateShelteredPortfolio,
  holdingFromCatalogRow,
  rebalanceHoldingsToTotal,
  type EtfCatalogRow,
  type EtfHolding,
  type PortfolioPreset,
  type PortfolioPresetId,
  type SimulationInputs,
} from '../engine';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { NumericInput } from './ControlDock';

export interface EtfPortfolioBuilderProps {
  inputs: SimulationInputs;
  scope?: 'general' | 'sheltered';
  onChange: (next: SimulationInputs) => void;
}

type MarketFilter = 'ALL' | 'US' | 'KRX';
type GroupFilter = 'ALL' | 'INDEX' | 'DIVIDEND' | 'COVERED_CALL' | 'BOND_GOLD';

const GROUP_LABELS: Record<GroupFilter, string> = {
  ALL: '전체',
  INDEX: '지수·성장',
  DIVIDEND: '배당',
  COVERED_CALL: '커버드콜',
  BOND_GOLD: '채권·금·리츠',
};
const MARKET_LABELS: Record<MarketFilter, string> = { ALL: '한·미 전체', US: '미국 직투', KRX: '국내 상장' };
const EXPLORER_PAGE_SIZE = 100;

const fmtEok = (krw: number): string => `${(Math.max(0, krw) / 100_000_000).toFixed(2)}억`;
const fmtPct = (v: number, digits = 2): string => `${v.toFixed(digits)}%`;
const deltaTag = (before: number, after: number, digits = 2): string => {
  const d = after - before;
  if (Math.abs(d) < 10 ** -digits / 2) return '±0';
  return `${d > 0 ? '+' : ''}${d.toFixed(digits)}`;
};

const PRESET_TICKERS = Array.from(
  new Set(
    [...PORTFOLIO_PRESETS, ...SHELTERED_PORTFOLIO_PRESETS].flatMap((p) =>
      p.legs.map((l) => l.ticker)
    )
  )
);

export const EtfPortfolioBuilder: React.FC<EtfPortfolioBuilderProps> = ({
  inputs,
  scope = 'general',
  onChange,
}) => {
  const isShelteredScope = scope === 'sheltered';
  const activePresets = isShelteredScope ? SHELTERED_PORTFOLIO_PRESETS : PORTFOLIO_PRESETS;
  const holdings: EtfHolding[] = isShelteredScope
    ? (inputs.accounts.shelteredHoldings ?? [])
    : (inputs.asset.holdings ?? []);
  const shelteredBalanceTotal = calculateCurrentShelteredTotal(
    inputs.accounts,
    inputs.pension.hasSpouse ?? true
  );
  const totalInvestment = isShelteredScope
    ? shelteredBalanceTotal > 0
      ? shelteredBalanceTotal
      : 290_000_000
    : Math.max(0, inputs.asset.totalInvestment || 0);
  const holdingsTotal = holdings.reduce((s, h) => s + Math.max(0, h.amount || 0), 0);
  const totalMismatch = holdings.length > 0 && Math.abs(holdingsTotal - totalInvestment) > 0;
  const current = useMemo(() => {
    const genEval = evaluatePortfolio(inputs.asset);
    return isShelteredScope ? evaluateShelteredPortfolio(inputs.accounts, genEval) : genEval;
  }, [inputs.asset, inputs.accounts, isShelteredScope]);

  // --- Preset metadata (resolved once from the catalog so figures track the DB) ---
  const [presetRows, setPresetRows] = useState<EtfCatalogRow[]>([]);
  const [presetState, setPresetState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [previewId, setPreviewId] = useState<PortfolioPresetId | null>(null);

  useEffect(() => {
    setPreviewId(null);
  }, [scope]);

  useEffect(() => {
    let cancelled = false;
    setPresetState('loading');
    fetchWithTimeout(`/api/etf/list?tickers=${encodeURIComponent(PRESET_TICKERS.join(','))}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`preset meta ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setPresetRows(Array.isArray(data.items) ? data.items : []);
          setPresetState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setPresetState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const previewPreset: PortfolioPreset | undefined = activePresets.find((p) => p.id === previewId);
  const preview = useMemo(() => {
    if (!previewPreset || presetRows.length === 0) return null;
    const base = totalInvestment > 0 ? totalInvestment : holdingsTotal;
    const applied = applyPresetToHoldings(previewPreset, base, presetRows);
    if (applied.holdings.length === 0) return { applied, summary: null };
    const summary = isShelteredScope
      ? evaluateHoldingsList(applied.holdings)
      : evaluatePortfolio({
          ...inputs.asset,
          inputMode: 'detailed',
          totalInvestment: base,
          holdings: applied.holdings,
        });
    return { applied, summary };
  }, [previewPreset, presetRows, totalInvestment, holdingsTotal, inputs.asset, isShelteredScope]);

  const commitHoldings = (nextHoldings: EtfHolding[], nextTotal?: number) => {
    if (isShelteredScope) {
      const summary = evaluateHoldingsList(nextHoldings);
      const netReturn = summary ? summary.effectiveTotalReturn : 5.4;
      const useIrpCap = inputs.accounts.applyIrpRiskAssetCap ?? true;
      const irpRate = useIrpCap ? Number((netReturn * 0.7 + 3.5 * 0.3).toFixed(2)) : netReturn;
      onChange({
        ...inputs,
        accounts: {
          ...inputs.accounts,
          shelteredInputMode: 'detailed',
          shelteredHoldings: nextHoldings,
          overrideSymmetricAccountReturns: true,
          applyIrpRiskAssetCap: useIrpCap,
          isaExpectedReturnRate: netReturn,
          personalPensionReturnRate: netReturn,
          irpExpectedReturnRate: irpRate,
        },
      });
      return;
    }
    const total = nextTotal ?? nextHoldings.reduce((s, h) => s + Math.max(0, h.amount || 0), 0);
    onChange({
      ...inputs,
      asset: { ...inputs.asset, inputMode: 'detailed', totalInvestment: total, holdings: nextHoldings },
    });
  };

  const applyPreview = () => {
    if (!preview || preview.applied.holdings.length === 0) return;
    commitHoldings(preview.applied.holdings);
    setPreviewId(null);
  };

  // --- Explorer (Top 100 by AUM + search / market / group filters) ---
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState<MarketFilter>('ALL');
  const [group, setGroup] = useState<GroupFilter>('ALL');
  const [results, setResults] = useState<EtfCatalogRow[]>([]);
  const [resultTotal, setResultTotal] = useState(0);
  const [explorerState, setExplorerState] = useState<'loading' | 'ready' | 'error'>('loading');
  const effectiveMarket: MarketFilter = isShelteredScope ? 'KRX' : market;

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setExplorerState('loading');
      try {
        const params = new URLSearchParams({
          market: effectiveMarket,
          category: group,
          limit: String(EXPLORER_PAGE_SIZE),
        });
        if (query.trim()) params.set('q', query.trim());
        const res = await fetchWithTimeout(`/api/etf/list?${params.toString()}`);
        if (!res.ok) throw new Error(`explorer ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          const rawItems: EtfCatalogRow[] = Array.isArray(data.items) ? data.items : [];
          const filtered = isShelteredScope
            ? rawItems.filter((r) => r.market === 'KRX' && (r.eligibleIsa || r.eligiblePension))
            : rawItems;
          setResults(filtered);
          setResultTotal(isShelteredScope ? filtered.length : Number(data.total) || 0);
          setExplorerState('ready');
        }
      } catch {
        if (!cancelled) {
          setResults([]);
          setResultTotal(0);
          setExplorerState('error');
        }
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, effectiveMarket, group, isShelteredScope]);

  const heldTickers = useMemo(() => new Set(holdings.map((h) => h.ticker)), [holdings]);

  const addRow = (row: EtfCatalogRow) => {
    if (heldTickers.has(row.ticker)) return;
    if (holdings.length === 0) {
      commitHoldings([holdingFromCatalogRow(row, totalInvestment, 100)], totalInvestment);
      return;
    }
    const next = addHoldingKeepingTotal(holdings, holdingFromCatalogRow(row, 0));
    commitHoldings(next, holdingsTotal);
  };

  const removeAt = (idx: number) => {
    const remaining = holdings.filter((_, i) => i !== idx);
    if (remaining.length === 0) {
      commitHoldings([], totalInvestment);
      return;
    }
    commitHoldings(rebalanceHoldingsToTotal(remaining, holdingsTotal), holdingsTotal);
  };

  const editAmount = (idx: number, valMan: number) => {
    const next = holdings.map((h, i) => (i === idx ? { ...h, amount: Math.max(0, valMan) * 10_000 } : h));
    commitHoldings(next);
  };

  const useIrpCap = inputs.accounts.applyIrpRiskAssetCap ?? true;

  return (
    <div className="etf-builder-box" aria-label={isShelteredScope ? '절세·연금계좌 ETF 포트폴리오 빌더' : 'ETF 포트폴리오 빌더'}>
      {/* 1. Recommended presets */}
      <div className="etf-preset-bar">
        <div className="etf-section-title">
          {isShelteredScope
            ? '절세·연금계좌(ISA·연금저축·IRP) 전용 추천 프리셋 (국내 상장 KRX 6대 핵심 ETF 조합)'
            : '추천 포트폴리오 빠른 적용'}
          {presetState === 'loading' && <span className="etf-muted"> · 카탈로그 조회 중…</span>}
          {presetState === 'error' && <span className="etf-error"> · 카탈로그 연결 실패 (프리셋 비활성)</span>}
        </div>
        <div className="etf-preset-chips" role="group" aria-label="추천 포트폴리오">
          {activePresets.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`etf-preset-chip${previewId === p.id ? ' is-active' : ''}`}
              disabled={presetState !== 'ready'}
              title={p.description}
              onClick={() => setPreviewId(previewId === p.id ? null : p.id)}
            >
              <strong>{p.label}</strong>
              <span>{p.legs.map((l) => `${l.ticker} ${l.weight}%`).join(' · ')}</span>
            </button>
          ))}
        </div>
        {previewPreset && preview && (
          <div className="etf-delta-strip" aria-live="polite">
            <div className="etf-delta-head">
              <strong>{previewPreset.label}</strong>
              <span className="etf-muted">{previewPreset.description}</span>
            </div>
            {preview.summary ? (
              <>
                <div className="etf-delta-grid num">
                  <span>성장 {fmtPct(current.effectiveGrowthRate)} → {fmtPct(preview.summary.effectiveGrowthRate)} ({deltaTag(current.effectiveGrowthRate, preview.summary.effectiveGrowthRate)})</span>
                  <span>배당 {fmtPct(current.effectiveDividendYield)} → {fmtPct(preview.summary.effectiveDividendYield)} ({deltaTag(current.effectiveDividendYield, preview.summary.effectiveDividendYield)})</span>
                  <span>보수 {fmtPct(current.weightedExpenseRatio, 3)} → {fmtPct(preview.summary.weightedExpenseRatio, 3)}</span>
                  <span>
                    {isShelteredScope
                      ? `합산 순수익률 ${fmtPct(current.effectiveTotalReturn)} → ${fmtPct(preview.summary.effectiveTotalReturn)}`
                      : `해외직투 ${fmtPct(current.overseasDirectRatio, 1)} → ${fmtPct(preview.summary.overseasDirectRatio, 1)}`}
                  </span>
                </div>
                {preview.applied.missing.length > 0 && (
                  <div className="etf-error">카탈로그에 없는 종목 제외 후 재배분: {preview.applied.missing.join(', ')}</div>
                )}
                {preview.applied.holdings.some((h) => presetRows.find((r) => r.ticker === h.ticker)?.isEstimated) && (
                  <div className="etf-muted">⚠ 일부 종목은 추정치(성장 4.5% / 배당 2.0%) 기반입니다.</div>
                )}
                <div className="etf-delta-actions">
                  <button type="button" className="etf-apply-btn" onClick={applyPreview}>
                    이 프리셋 적용 ({fmtEok(totalInvestment > 0 ? totalInvestment : holdingsTotal)} 배분)
                  </button>
                  <button type="button" className="etf-ghost-btn" onClick={() => setPreviewId(null)}>
                    취소
                  </button>
                </div>
              </>
            ) : (
              <div className="etf-error">총 투자금이 0원이거나 프리셋 종목을 찾을 수 없어 적용할 수 없습니다.</div>
            )}
          </div>
        )}
      </div>

      {/* 2. Current holdings */}
      <div className="etf-summary-strip num">
        <span>가중 성장 {fmtPct(current.effectiveGrowthRate)}</span>
        <span>배당 {fmtPct(current.effectiveDividendYield)}</span>
        <span>실부담보수 {fmtPct(current.weightedExpenseRatio, 3)}</span>
        <span>
          {isShelteredScope
            ? `합산 세전 ${fmtPct(current.effectiveTotalReturn)}`
            : `해외직투 ${fmtPct(current.overseasDirectRatio, 1)}`}
        </span>
        <span>보유 {holdings.length}종 · {fmtEok(holdingsTotal)}</span>
      </div>

      {isShelteredScope && (
        <div
          className="dock-mode-banner num"
          style={{
            marginTop: 6,
            marginBottom: 8,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span>
            🛡️ 절세계좌 반영 수익률: <strong>ISA 연 {inputs.accounts.isaExpectedReturnRate.toFixed(2)}%</strong> ·{' '}
            <strong>연금저축 연 {inputs.accounts.personalPensionReturnRate.toFixed(2)}%</strong> ·{' '}
            <strong>
              IRP 연 {(inputs.accounts.irpExpectedReturnRate ?? inputs.accounts.personalPensionReturnRate).toFixed(2)}%
            </strong>
          </span>
          <label className="dock-checkbox-inline" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={useIrpCap}
              onChange={(e) => {
                const nextCap = e.target.checked;
                const netReturn = current.effectiveTotalReturn;
                const nextIrpRate = nextCap
                  ? Number((netReturn * 0.7 + 3.5 * 0.3).toFixed(2))
                  : netReturn;
                onChange({
                  ...inputs,
                  accounts: {
                    ...inputs.accounts,
                    shelteredInputMode: 'detailed',
                    overrideSymmetricAccountReturns: true,
                    applyIrpRiskAssetCap: nextCap,
                    isaExpectedReturnRate: netReturn,
                    personalPensionReturnRate: netReturn,
                    irpExpectedReturnRate: nextIrpRate,
                  },
                });
              }}
            />
            <span>IRP 위험자산 70% 한도 적용 (주식형 70% + 안전자산 3.5%×30%)</span>
          </label>
        </div>
      )}

      {totalMismatch && (
        <div className="etf-mismatch-row">
          <span className="etf-error num">
            보유 합계 {fmtEok(holdingsTotal)} ≠ {isShelteredScope ? '절세계좌 합계' : '총 투자금'} {fmtEok(totalInvestment)}
          </span>
          <button
            type="button"
            className="etf-ghost-btn"
            onClick={() => commitHoldings(rebalanceHoldingsToTotal(holdings, totalInvestment), totalInvestment)}
          >
            비례 맞춤 → {fmtEok(totalInvestment)}
          </button>
        </div>
      )}

      <div className="etf-holdings-list">
        {holdings.length === 0 && (
          <div className="etf-empty">보유 종목이 없습니다. 아래 탐색기에서 종목을 추가하거나 추천 프리셋을 적용하세요.</div>
        )}
        {holdings.map((h, idx) => (
          <div key={h.ticker} className="etf-holding-row">
            <div className="etf-holding-meta">
              <strong>
                {h.ticker} <em className="etf-tag">{h.market}</em>
                {typeof h.ratio === 'number' && <em className="etf-tag etf-tag-ratio">{h.ratio}%</em>}
              </strong>
              <span>
                {h.name} · 성장 {h.expectedGrowthRate}% · 배당 {h.dividendYield}%
              </span>
            </div>
            <div className="etf-holding-actions">
              <NumericInput
                step={1000}
                min={0}
                fallback={0}
                value={Math.round((h.amount || 0) / 10_000)}
                onChange={(valMan) => editAmount(idx, valMan)}
              />
              <span className="unit-tag">만원</span>
              <button type="button" className="etf-remove-btn" aria-label={`${h.ticker} 제거`} onClick={() => removeAt(idx)}>
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 3. Explorer */}
      <div className="etf-explorer">
        <div className="etf-section-title">
          {isShelteredScope
            ? `절세·연금계좌 적격 국내상장(KRX) ETF 탐색기 · 상위 ${EXPLORER_PAGE_SIZE}`
            : `ETF 탐색기 · AUM 상위 ${EXPLORER_PAGE_SIZE} & 전종목 검색`}
        </div>
        <div className="etf-filter-row">
          <div className="etf-seg" role="tablist" aria-label="시장">
            {isShelteredScope ? (
              <button type="button" className="is-active" disabled title="절세·연금계좌에서는 국내상장(KRX) 적격 ETF만 편입 가능합니다">
                국내 상장 KRX 전용 (ISA·연금 적격)
              </button>
            ) : (
              (Object.keys(MARKET_LABELS) as MarketFilter[]).map((m) => (
                <button key={m} type="button" className={market === m ? 'is-active' : ''} onClick={() => setMarket(m)}>
                  {MARKET_LABELS[m]}
                </button>
              ))
            )}
          </div>
          <div className="etf-seg" role="tablist" aria-label="자산군">
            {(Object.keys(GROUP_LABELS) as GroupFilter[]).map((g) => (
              <button key={g} type="button" className={group === g ? 'is-active' : ''} onClick={() => setGroup(g)}>
                {GROUP_LABELS[g]}
              </button>
            ))}
          </div>
        </div>
        <div className="etf-search-bar">
          <input
            type="search"
            placeholder={
              isShelteredScope
                ? '국내상장 ETF 검색 (예: 360750, S&P500, 나스닥100, 미국배당다우존스, 코스피200, 채권)'
                : '티커 · 종목명 · 추종지수 · 운용사 검색 (예: SCHD, 미국배당다우존스, TIGER)'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="ETF 검색"
          />
        </div>
        <div className="etf-result-meta etf-muted num">
          {explorerState === 'loading' && 'ETF 유니버스 조회 중…'}
          {explorerState === 'error' && <span className="etf-error">카탈로그 조회 실패 — 잠시 후 다시 시도하세요.</span>}
          {explorerState === 'ready' && `${resultTotal.toLocaleString()}종 중 ${results.length}종 표시 (AUM 순)`}
        </div>
        <div className="etf-search-results">
          {explorerState === 'ready' && results.length === 0 && <div className="etf-empty">검색 결과가 없습니다.</div>}
          {results.map((row) => {
            const held = heldTickers.has(row.ticker);
            return (
              <button
                key={row.ticker}
                type="button"
                className={`etf-result-item${held ? ' is-held' : ''}`}
                disabled={held}
                onClick={() => addRow(row)}
                title={`${row.underlyingIndex || ''} ${row.issuer ? `· ${row.issuer}` : ''}`.trim()}
              >
                <span className="etf-result-main">
                  <strong>
                    <em className="etf-tag">{row.market}</em> {row.ticker}
                  </strong>{' '}
                  {row.name}
                  {row.isEstimated && <em className="etf-tag etf-tag-est">추정</em>}
                  {row.eligibleIsa && <em className="etf-tag etf-tag-ok">ISA</em>}
                  {row.eligiblePension && <em className="etf-tag etf-tag-ok">연금</em>}
                </span>
                <span className="num etf-result-stats">
                  성장 {row.expectedGrowthRate}% · 배당 {row.dividendYield}% · 보수 {row.actualExpenseRatio}% {held ? '✓' : '+'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
