import React, { useState } from 'react';
import {
  calculateAdditionalPensionIncrease,
  calculateCurrentShelteredTotal,
  DEFAULT_ACTIVE_SENIOR_CONFIG,
  evaluateHoldingsList,
  evaluatePortfolio,
  rebalanceHoldingsToTotal,
  STARTER_ETF_HOLDINGS,
  STARTER_SHELTERED_ETF_HOLDINGS,
  type CorporateTaxType,
  type LumpSumCashflowEvent,
  type SimulationInputs,
} from '../engine';
import { CORP_TAX_PCT, FieldHelpBadge, NumericInput } from './ControlDock';
import { EtfPortfolioBuilder } from './EtfPortfolioBuilder';

export interface PrecisionTunersProps {
  group: 'A' | 'B' | 'C' | 'D';
  inputs: SimulationInputs;
  onChange: (next: SimulationInputs) => void;
}

export const PrecisionTuners: React.FC<PrecisionTunersProps> = ({
  group,
  inputs,
  onChange,
}) => {
  const [etfBuilderScope, setEtfBuilderScope] = useState<'general' | 'sheltered'>('general');
  const hasSpouse = inputs.pension.hasSpouse ?? true;
  const activeSenior = inputs.cashflow.activeSeniorConfig ?? DEFAULT_ACTIVE_SENIOR_CONFIG;
  const reTransition = inputs.realEstate.transition ?? {
    strategy: 'keep',
    downsizingAge: 65,
    downsizedAssessedValue: 600_000_000,
    downsizingActualSurplusCash: 400_000_000,
    downsizingCorpAllocationRatio: 50,
    housingPensionStartAge: 65,
    housingPensionMonthlyPayout: 1_500_000,
    monthlyRentExpense: 0,
    targetLeaseDeposit: 300_000_000,
    targetMonthlyRent: 1_000_000,
  };

  if (group === 'A') {
    const rawDelta = activeSenior.activeSeniorDelta ?? 0.25;
    const displayDeltaPct = Math.round(rawDelta > 1 ? rawDelta : rawDelta * 100);
    const lumpSumEvents = inputs.cashflow.lumpSumEvents ?? [];

    const updateEvents = (nextEvents: LumpSumCashflowEvent[]) => {
      onChange({
        ...inputs,
        cashflow: {
          ...inputs.cashflow,
          lumpSumEvents: nextEvents.slice(0, 5),
        },
      });
    };

    const addPresetEvent = (
      label: string,
      type: 'outflow' | 'inflow',
      amount: number,
      ageOffset: number
    ) => {
      if (lumpSumEvents.length >= 5) return;
      const targetAge = Math.min(
        95,
        Math.max(inputs.pension.currentAgeSelf, inputs.transition.targetRetirementAgeSelf + ageOffset)
      );
      updateEvents([
        ...lumpSumEvents,
        {
          id: `evt-${Date.now()}-${lumpSumEvents.length + 1}`,
          ageSelf: targetAge,
          type,
          amount,
          label,
        },
      ]);
    };

    return (
      <div className="precision-drawer" aria-label="가계 연령 및 지출 정밀 설정">
        <div className="dock-row-2col">
          <label className="dock-field">
            <span className="dock-label">
              은퇴 후 월 고정지출 (순월생활비 외 별도 비용: 관리비·보험)
            </span>
            <div className="dock-input-unit">
              <NumericInput
                step={10}
                min={0}
                fallback={0}
                value={Math.round((inputs.cashflow.monthlyFixedExpense || 0) / 10_000)}
                onChange={(valMan) =>
                  onChange({
                    ...inputs,
                    cashflow: {
                      ...inputs.cashflow,
                      monthlyFixedExpense: valMan * 10_000,
                    },
                  })
                }
              />
              <span>만원</span>
            </div>
          </label>

          <label className="dock-field">
            <span className="dock-label">생애 지출 곡선 모드</span>
            <select
              value={inputs.cashflow.spendingMode ?? 'flat'}
              onChange={(e) => {
                const mode = e.target.value === 'active_senior' ? 'active_senior' : 'flat';
                const shockAmt = Math.max(0, activeSenior.careShockMonthlyExpense ?? 1_500_000);
                onChange({
                  ...inputs,
                  cashflow: {
                    ...inputs.cashflow,
                    spendingMode: mode,
                    activeSeniorConfig: {
                      ...activeSenior,
                      spendingMode: mode,
                      applyCareShock: shockAmt > 0,
                      careShockMonthlyExpense: shockAmt,
                    },
                  },
                });
              }}
            >
              <option value="flat">정액 실질유지 (CPI 연동)</option>
              <option value="active_senior">액티브 시니어 3단계 (Go/Slow/No-Go)</option>
            </select>
          </label>
        </div>

        {inputs.cashflow.spendingMode === 'active_senior' && (
          <div className="dock-subgrid">
            <label className="dock-field">
              <span className="dock-label">
                액티브기 종료 연령 / 가감폭(±%) <FieldHelpBadge helpKey="activeSeniorDelta" />
              </span>
              <div className="dock-row-2col">
                <NumericInput
                  min={60}
                  max={80}
                  fallback={65}
                  value={activeSenior.activeAgeEnd}
                  onChange={(nextEndAge) =>
                    onChange({
                      ...inputs,
                      cashflow: {
                        ...inputs.cashflow,
                        activeSeniorConfig: {
                          ...activeSenior,
                          spendingMode: 'active_senior',
                          activeAgeEnd: nextEndAge,
                        },
                      },
                    })
                  }
                />
                <NumericInput
                  step={5}
                  min={0}
                  max={50}
                  fallback={25}
                  value={displayDeltaPct}
                  onChange={(nextDeltaPct) =>
                    onChange({
                      ...inputs,
                      cashflow: {
                        ...inputs.cashflow,
                        activeSeniorConfig: {
                          ...activeSenior,
                          spendingMode: 'active_senior',
                          activeSeniorDelta: nextDeltaPct / 100,
                        },
                      },
                    })
                  }
                />
              </div>
            </label>

            <label className="dock-field">
              <span className="dock-label">케어기(78세+) 월 간병·의료 추가비 (현재가치 · {inputs.pension.currentAgeSelf}세부터 물가연동)</span>
              <div className="dock-input-unit">
                <NumericInput
                  step={20}
                  min={0}
                  fallback={0}
                  value={Math.round((activeSenior.careShockMonthlyExpense || 0) / 10_000)}
                  onChange={(valMan) => {
                    const shock = valMan * 10_000;
                    onChange({
                      ...inputs,
                      cashflow: {
                        ...inputs.cashflow,
                        activeSeniorConfig: {
                          ...activeSenior,
                          spendingMode: 'active_senior',
                          applyCareShock: shock > 0,
                          careShockMonthlyExpense: shock,
                        },
                      },
                    });
                  }}
                />
                <span>만원</span>
              </div>
            </label>
          </div>
        )}

        <div className="dock-subgrid lump-sum-events-section" aria-label="생애 일시 목돈 현금흐름 이벤트">
          <div className="lump-sum-events-header">
            <span className="dock-label">
              생애 일시 목돈 지출·유입 이벤트 (최대 5건 · 물가연동 적용)
            </span>
            <button
              type="button"
              className="btn-secondary lump-sum-add-btn"
              disabled={lumpSumEvents.length >= 5}
              onClick={() => addPresetEvent('일시 지출', 'outflow', 50_000_000, 2)}
            >
              + 직접 추가 ({lumpSumEvents.length}/5)
            </button>
          </div>

          <div className="lump-sum-preset-bar">
            <button
              type="button"
              className="lump-sum-preset-chip"
              disabled={lumpSumEvents.length >= 5}
              onClick={() => addPresetEvent('자녀 교육·유학', 'outflow', 50_000_000, 1)}
            >
              🎓 자녀 교육·유학 (-5,000만)
            </button>
            <button
              type="button"
              className="lump-sum-preset-chip"
              disabled={lumpSumEvents.length >= 5}
              onClick={() => addPresetEvent('자녀 결혼 지원', 'outflow', 150_000_000, 5)}
            >
              💍 자녀 결혼 지원 (-1.5억)
            </button>
            <button
              type="button"
              className="lump-sum-preset-chip"
              disabled={lumpSumEvents.length >= 5}
              onClick={() => addPresetEvent('주담대 완납', 'outflow', 100_000_000, 0)}
            >
              🏦 주담대 완납 (-1억)
            </button>
            <button
              type="button"
              className="lump-sum-preset-chip is-inflow"
              disabled={lumpSumEvents.length >= 5}
              onClick={() => addPresetEvent('상속·증여 유입', 'inflow', 200_000_000, 8)}
            >
              🎁 상속·증여 유입 (+2억)
            </button>
          </div>

          {lumpSumEvents.length > 0 && (
            <div className="lump-sum-event-list">
              {lumpSumEvents.map((evt, idx) => (
                <div key={evt.id} className="lump-sum-event-row">
                  <div className="dock-input-unit lump-sum-age-input">
                    <NumericInput
                      min={inputs.pension.currentAgeSelf}
                      max={100}
                      fallback={inputs.transition.targetRetirementAgeSelf}
                      value={evt.ageSelf}
                      onChange={(nextAge) => {
                        const copy = [...lumpSumEvents];
                        copy[idx] = { ...evt, ageSelf: nextAge };
                        updateEvents(copy);
                      }}
                    />
                    <span>세</span>
                  </div>

                  <select
                    aria-label="이벤트 유형"
                    value={evt.type}
                    onChange={(e) => {
                      const copy = [...lumpSumEvents];
                      copy[idx] = {
                        ...evt,
                        type: e.target.value === 'inflow' ? 'inflow' : 'outflow',
                      };
                      updateEvents(copy);
                    }}
                  >
                    <option value="outflow">일시 지출 (-)</option>
                    <option value="inflow">일시 유입 (+)</option>
                  </select>

                  <div className="dock-input-unit lump-sum-amount-input">
                    <NumericInput
                      step={500}
                      min={0}
                      fallback={1000}
                      value={Math.round(evt.amount / 10_000)}
                      onChange={(valMan) => {
                        const copy = [...lumpSumEvents];
                        copy[idx] = { ...evt, amount: valMan * 10_000 };
                        updateEvents(copy);
                      }}
                    />
                    <span>만원</span>
                  </div>

                  <input
                    type="text"
                    className="lump-sum-label-input"
                    aria-label="이벤트 항목명"
                    placeholder="항목명 (예: 자녀 결혼)"
                    value={evt.label}
                    onChange={(e) => {
                      const copy = [...lumpSumEvents];
                      copy[idx] = { ...evt, label: e.target.value };
                      updateEvents(copy);
                    }}
                  />

                  <button
                    type="button"
                    className="btn-secondary lump-sum-remove-btn"
                    aria-label="이벤트 삭제"
                    onClick={() => updateEvents(lumpSumEvents.filter((_, i) => i !== idx))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (group === 'B') {
    const holdings = inputs.asset.holdings ?? STARTER_ETF_HOLDINGS;

    return (
      <div className="precision-drawer" aria-label="절세계좌 및 ETF 포트폴리오 정밀 설정">
        <div className="dock-row-2col">
          <label className="dock-field">
            <span className="dock-label">
              해외직투 ETF 비중 (일반금융계좌 22% 양도세 대상)
              {inputs.asset.inputMode === 'detailed' && ' · 보유 ETF에서 자동 산출'}{' '}
              <FieldHelpBadge helpKey="overseasEtfRatio" />
            </span>
            <div className="dock-input-unit">
              {inputs.asset.inputMode === 'detailed' ? (
                <strong className="dock-value-badge num">
                  {evaluatePortfolio(inputs.asset).overseasDirectRatio.toFixed(1)}
                </strong>
              ) : (
                <NumericInput
                  min={0}
                  max={100}
                  fallback={70}
                  value={inputs.asset.overseasEtfRatio ?? 70}
                  onChange={(nextRatio) =>
                    onChange({
                      ...inputs,
                      asset: {
                        ...inputs.asset,
                        overseasEtfRatio: nextRatio,
                      },
                    })
                  }
                />
              )}
              <span>%</span>
            </div>
          </label>

          <label className="dock-field">
            <span className="dock-label">
              포트폴리오 입력 방식 <FieldHelpBadge helpKey="portfolioInputMode" />
            </span>
            <select
              value={inputs.asset.inputMode ?? 'macro'}
              onChange={(e) => {
                const mode = e.target.value === 'detailed' ? 'detailed' : 'macro';
                onChange({
                  ...inputs,
                  asset: {
                    ...inputs.asset,
                    inputMode: mode,
                    holdings:
                      mode === 'detailed'
                        ? rebalanceHoldingsToTotal(holdings, inputs.asset.totalInvestment || 0)
                        : inputs.asset.holdings,
                  },
                });
              }}
            >
              <option value="macro">요약 수익률 입력 (성장률·배당률)</option>
              <option value="detailed">1,274종 ETF 포트폴리오 직접 구성</option>
            </select>
          </label>
        </div>

        {inputs.asset.inputMode === 'detailed' && (
          <>
            <div
              className="wizard-return-mode-tabs"
              role="group"
              aria-label="ETF 구성 대상 계좌군 선택"
            >
              <button
                type="button"
                className={`wizard-return-mode-tab ${etfBuilderScope === 'general' ? 'active' : ''}`}
                onClick={() => setEtfBuilderScope('general')}
              >
                <strong>📊 일반·법인금융계좌 ETF</strong>
                <span>해외직투·국내 ETF (현재 {Math.round((inputs.asset.totalInvestment || 0) / 10_000).toLocaleString()}만원)</span>
              </button>
              <button
                type="button"
                className={`wizard-return-mode-tab ${etfBuilderScope === 'sheltered' ? 'active' : ''}`}
                onClick={() => {
                  setEtfBuilderScope('sheltered');
                  const shelteredTotal =
                    calculateCurrentShelteredTotal(inputs.accounts, hasSpouse) || 290_000_000;
                  const nextHoldings = rebalanceHoldingsToTotal(
                    inputs.accounts.shelteredHoldings?.length
                      ? inputs.accounts.shelteredHoldings
                      : STARTER_SHELTERED_ETF_HOLDINGS,
                    shelteredTotal
                  );
                  const shSummary = evaluateHoldingsList(nextHoldings);
                  const netReturn = shSummary ? shSummary.effectiveTotalReturn : 5.4;
                  const useCap = inputs.accounts.applyIrpRiskAssetCap ?? true;
                  const irpRate = useCap
                    ? Number((netReturn * 0.7 + 3.5 * 0.3).toFixed(2))
                    : Number(netReturn.toFixed(2));
                  onChange({
                    ...inputs,
                    accounts: {
                      ...inputs.accounts,
                      shelteredInputMode: 'detailed',
                      overrideSymmetricAccountReturns: true,
                      applyIrpRiskAssetCap: useCap,
                      shelteredHoldings: nextHoldings,
                      isaExpectedReturnRate: Number(netReturn.toFixed(2)),
                      personalPensionReturnRate: Number(netReturn.toFixed(2)),
                      irpExpectedReturnRate: irpRate,
                    },
                  });
                }}
              >
                <strong>🛡️ 절세·연금계좌 (ISA·연금저축·IRP) KRX ETF</strong>
                <span>국내상장 S&amp;P500·나스닥100·배당다우·코스피·채권 (현재 {Math.round(calculateCurrentShelteredTotal(inputs.accounts, hasSpouse) / 10_000).toLocaleString()}만원)</span>
              </button>
            </div>
            <EtfPortfolioBuilder
              inputs={inputs}
              scope={etfBuilderScope}
              onChange={onChange}
            />
          </>
        )}
      </div>
    );
  }

  if (group === 'C') {
    const selfIncreaseMonthly = Math.round(
      calculateAdditionalPensionIncrease(
        true,
        inputs.pension.additionalMonthsSelf || 60,
        inputs.pension.monthlyContributionSelf || 360_000
      ) / 10_000
    );
    const spouseIncreaseMonthly = Math.round(
      calculateAdditionalPensionIncrease(
        true,
        inputs.pension.additionalMonthsSpouse || 60,
        inputs.pension.monthlyContributionSpouse || 270_000
      ) / 10_000
    );

    return (
      <div className="precision-drawer" aria-label="주거 부동산 및 공적연금 정밀 설정">
        <div className="dock-row-2col">
          <label className="dock-field">
            <span className="dock-label">
              2024 건보 재산 1억 기본공제 <FieldHelpBadge helpKey="healthReform2024" />
            </span>
            <select
              value={inputs.realEstate.apply2024HealthReform ?? true ? 'yes' : 'no'}
              onChange={(e) =>
                onChange({
                  ...inputs,
                  realEstate: {
                    ...inputs.realEstate,
                    apply2024HealthReform: e.target.value === 'yes',
                  },
                })
              }
            >
              <option value="yes">적용 (2024.2 개정 1억 일괄공제)</option>
              <option value="no">미적용 (구법 차등공제)</option>
            </select>
          </label>

          <label className="dock-field">
            <span className="dock-label">국민연금 추납·임의계속가입 대상</span>
            <div className="dock-row-2col">
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
                <input
                  type="checkbox"
                  checked={Boolean(inputs.pension.applyAdditionalPensionSelf)}
                  onChange={(e) =>
                    onChange({
                      ...inputs,
                      pension: {
                        ...inputs.pension,
                        applyAdditionalPensionSelf: e.target.checked,
                      },
                    })
                  }
                />
                <span>본인 추납 적용</span>
              </label>
              {hasSpouse && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(inputs.pension.applyAdditionalPensionSpouse)}
                    onChange={(e) =>
                      onChange({
                        ...inputs,
                        pension: {
                          ...inputs.pension,
                          applyAdditionalPensionSpouse: e.target.checked,
                        },
                      })
                    }
                  />
                  <span>배우자 추납 적용</span>
                </label>
              )}
            </div>
          </label>
        </div>

        {(inputs.pension.applyAdditionalPensionSelf ||
          (hasSpouse && inputs.pension.applyAdditionalPensionSpouse)) && (
          <div className="dock-subgrid">
            {inputs.pension.applyAdditionalPensionSelf && (
              <div className="dock-row-2col">
                <label className="dock-field">
                  <span className="dock-label">
                    본인 추납 기간 (최대 119개월 · 예상 증액 +{selfIncreaseMonthly}만원/월)
                  </span>
                  <div className="dock-input-unit">
                    <NumericInput
                      min={1}
                      max={119}
                      fallback={60}
                      value={inputs.pension.additionalMonthsSelf || 60}
                      onChange={(months) =>
                        onChange({
                          ...inputs,
                          pension: {
                            ...inputs.pension,
                            additionalMonthsSelf: Math.min(119, Math.max(1, months)),
                          },
                        })
                      }
                    />
                    <span>개월</span>
                  </div>
                </label>
                <label className="dock-field">
                  <span className="dock-label">본인 월 추납 보험료</span>
                  <div className="dock-input-unit">
                    <NumericInput
                      step={5}
                      min={9}
                      max={60}
                      fallback={36}
                      value={Math.round((inputs.pension.monthlyContributionSelf || 360_000) / 10_000)}
                      onChange={(valMan) =>
                        onChange({
                          ...inputs,
                          pension: {
                            ...inputs.pension,
                            monthlyContributionSelf: valMan * 10_000,
                          },
                        })
                      }
                    />
                    <span>만원/월</span>
                  </div>
                </label>
              </div>
            )}

            {hasSpouse && inputs.pension.applyAdditionalPensionSpouse && (
              <div className="dock-row-2col">
                <label className="dock-field">
                  <span className="dock-label">
                    배우자 추납 기간 (최대 119개월 · 예상 증액 +{spouseIncreaseMonthly}만원/월)
                  </span>
                  <div className="dock-input-unit">
                    <NumericInput
                      min={1}
                      max={119}
                      fallback={60}
                      value={inputs.pension.additionalMonthsSpouse || 60}
                      onChange={(months) =>
                        onChange({
                          ...inputs,
                          pension: {
                            ...inputs.pension,
                            additionalMonthsSpouse: Math.min(119, Math.max(1, months)),
                          },
                        })
                      }
                    />
                    <span>개월</span>
                  </div>
                </label>
                <label className="dock-field">
                  <span className="dock-label">배우자 월 추납 보험료</span>
                  <div className="dock-input-unit">
                    <NumericInput
                      step={5}
                      min={9}
                      max={60}
                      fallback={27}
                      value={Math.round((inputs.pension.monthlyContributionSpouse || 270_000) / 10_000)}
                      onChange={(valMan) =>
                        onChange({
                          ...inputs,
                          pension: {
                            ...inputs.pension,
                            monthlyContributionSpouse: valMan * 10_000,
                          },
                        })
                      }
                    />
                    <span>만원/월</span>
                  </div>
                </label>
              </div>
            )}
          </div>
        )}

        {reTransition.strategy === 'downsize' && (
          <div className="dock-subgrid">
            <div className="dock-row-2col">
              <label className="dock-field">
                <span className="dock-label">다운사이징 실행 연령</span>
                <div className="dock-input-unit">
                  <NumericInput
                    min={50}
                    max={85}
                    fallback={65}
                    value={reTransition.downsizingAge ?? 65}
                    onChange={(nextAge) =>
                      onChange({
                        ...inputs,
                        realEstate: {
                          ...inputs.realEstate,
                          transition: {
                            ...reTransition,
                            downsizingAge: nextAge,
                          },
                        },
                      })
                    }
                  />
                  <span>세</span>
                </div>
              </label>

              <label className="dock-field">
                <span className="dock-label">다운사이징 순현금 유입액 (금융자산 편입)</span>
                <div className="dock-input-unit">
                  <NumericInput
                    step={1000}
                    min={0}
                    fallback={40000}
                    value={Math.round((reTransition.downsizingActualSurplusCash ?? 400_000_000) / 10_000)}
                    onChange={(valMan) => {
                      const cash = valMan * 10_000;
                      onChange({
                        ...inputs,
                        realEstate: {
                          ...inputs.realEstate,
                          transition: {
                            ...reTransition,
                            downsizingActualSurplusCash: cash,
                          },
                        },
                      });
                    }}
                  />
                  <span>만원</span>
                </div>
              </label>
            </div>

            <label className="dock-field">
              <span className="dock-label">다운사이징 후 거주주택 공시가격 (건보 재산과표 재설정)</span>
              <div className="dock-input-unit">
                <NumericInput
                  step={1000}
                  min={0}
                  fallback={60000}
                  value={Math.round((reTransition.downsizedAssessedValue ?? 600_000_000) / 10_000)}
                  onChange={(valMan) =>
                    onChange({
                      ...inputs,
                      realEstate: {
                        ...inputs.realEstate,
                        transition: {
                          ...reTransition,
                          downsizedAssessedValue: valMan * 10_000,
                        },
                      },
                    })
                  }
                />
                <span>만원</span>
              </div>
            </label>
          </div>
        )}

        {reTransition.strategy === 'sell_rent' && (
          <div className="dock-subgrid">
            <div className="dock-row-2col">
              <label className="dock-field">
                <span className="dock-label">매각 후 반전세·월세 전환 실행 연령</span>
                <div className="dock-input-unit">
                  <NumericInput
                    min={50}
                    max={85}
                    fallback={65}
                    value={reTransition.downsizingAge ?? 65}
                    onChange={(nextAge) =>
                      onChange({
                        ...inputs,
                        realEstate: {
                          ...inputs.realEstate,
                          transition: {
                            ...reTransition,
                            downsizingAge: nextAge,
                          },
                        },
                      })
                    }
                  />
                  <span>세</span>
                </div>
              </label>

              <label className="dock-field">
                <span className="dock-label">매각 순현금 유입액 (보증금 제외 금융자산 편입)</span>
                <div className="dock-input-unit">
                  <NumericInput
                    step={1000}
                    min={0}
                    fallback={70000}
                    value={Math.round((reTransition.downsizingActualSurplusCash ?? 700_000_000) / 10_000)}
                    onChange={(valMan) =>
                      onChange({
                        ...inputs,
                        realEstate: {
                          ...inputs.realEstate,
                          transition: {
                            ...reTransition,
                            downsizingActualSurplusCash: valMan * 10_000,
                          },
                        },
                      })
                    }
                  />
                  <span>만원</span>
                </div>
              </label>
            </div>

            <div className="dock-row-2col">
              <label className="dock-field">
                <span className="dock-label">전환 후 반전세·월세 보증금 (건보 재산과표 반영)</span>
                <div className="dock-input-unit">
                  <NumericInput
                    step={1000}
                    min={0}
                    fallback={30000}
                    value={Math.round((reTransition.targetLeaseDeposit ?? 300_000_000) / 10_000)}
                    onChange={(valMan) =>
                      onChange({
                        ...inputs,
                        realEstate: {
                          ...inputs.realEstate,
                          transition: {
                            ...reTransition,
                            targetLeaseDeposit: valMan * 10_000,
                          },
                        },
                      })
                    }
                  />
                  <span>만원</span>
                </div>
              </label>

              <label className="dock-field">
                <span className="dock-label">전환 후 월세 지출액 (현재가치, 매년 물가연동)</span>
                <div className="dock-input-unit">
                  <NumericInput
                    step={10}
                    min={0}
                    fallback={100}
                    value={Math.round(
                      ((reTransition.monthlyRentExpense || reTransition.targetMonthlyRent) ??
                        1_000_000) / 10_000
                    )}
                    onChange={(valMan) => {
                      const rent = valMan * 10_000;
                      onChange({
                        ...inputs,
                        realEstate: {
                          ...inputs.realEstate,
                          transition: {
                            ...reTransition,
                            monthlyRentExpense: rent,
                            targetMonthlyRent: rent,
                          },
                        },
                      });
                    }}
                  />
                  <span>만원/월</span>
                </div>
              </label>
            </div>
          </div>
        )}

        {reTransition.strategy === 'housing_pension' && (
          <div className="dock-row-2col">
            <label className="dock-field">
              <span className="dock-label">주택연금 개시 연령</span>
              <div className="dock-input-unit">
                <NumericInput
                  min={55}
                  max={85}
                  fallback={65}
                  value={reTransition.housingPensionStartAge ?? 65}
                  onChange={(nextStartAge) =>
                    onChange({
                      ...inputs,
                      realEstate: {
                        ...inputs.realEstate,
                        transition: {
                          ...reTransition,
                          housingPensionStartAge: nextStartAge,
                        },
                      },
                    })
                  }
                />
                <span>세</span>
              </div>
            </label>

            <label className="dock-field">
              <span className="dock-label">주택연금 예상 월수령액 (비과세)</span>
              <div className="dock-input-unit">
                <NumericInput
                  step={10}
                  min={0}
                  fallback={150}
                  value={Math.round((reTransition.housingPensionMonthlyPayout || 0) / 10_000)}
                  onChange={(valMan) =>
                    onChange({
                      ...inputs,
                      realEstate: {
                        ...inputs.realEstate,
                        transition: {
                          ...reTransition,
                          housingPensionMonthlyPayout: valMan * 10_000,
                        },
                      },
                    })
                  }
                />
                <span>만원</span>
              </div>
            </label>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="precision-drawer" aria-label="가족법인 세무 및 청산 정밀 설정">
      <div className="dock-row-2col">
        <label className="dock-field">
          <span className="dock-label">
            법인세 과세 체계 <FieldHelpBadge helpKey="corpTaxType" />
          </span>
          <select
            value={inputs.corporate.taxType}
            onChange={(e) =>
              onChange({
                ...inputs,
                corporate: {
                  ...inputs.corporate,
                  taxType: e.target.value as CorporateTaxType,
                },
              })
            }
          >
            <option value="transparent">
              소규모 성실신고확인 법인 ({CORP_TAX_PCT.transparent}% · 기본)
            </option>
            <option value="normal">
              일반법인 (2억 이하 {CORP_TAX_PCT.normalLow}% · 초과 {CORP_TAX_PCT.normalHigh}%)
            </option>
          </select>
        </label>

        <label className="dock-field">
          <span className="dock-label">
            연간 법인 기장·유지 고정비 <FieldHelpBadge helpKey="corpMaintenanceFee" />
          </span>
          <div className="dock-input-unit">
            <NumericInput
              step={50}
              min={0}
              fallback={0}
              value={Math.round((inputs.corporate.annualFixedMaintenanceFee || 0) / 10_000)}
              onChange={(valMan) =>
                onChange({
                  ...inputs,
                  corporate: {
                    ...inputs.corporate,
                    annualFixedMaintenanceFee: valMan * 10_000,
                  },
                })
              }
            />
            <span>만원/년</span>
          </div>
        </label>
      </div>

      <label className="dock-field">
        <span className="dock-label">
          법인 청산·출구 과세 기준 <FieldHelpBadge helpKey="corpLiquidationMode" />
        </span>
        <select
          value={inputs.corporate.liquidationTaxMode ?? 'capital_return_exempt'}
          onChange={(e) =>
            onChange({
              ...inputs,
              corporate: {
                ...inputs.corporate,
                liquidationTaxMode:
                  e.target.value === 'simple_gross' ? 'simple_gross' : 'capital_return_exempt',
              },
            })
          }
        >
          <option value="capital_return_exempt">출자원금 비과세 선회수</option>
          <option value="simple_gross">단순 일괄 배당과세 (보수적)</option>
        </select>
      </label>
    </div>
  );
};

