import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { evaluateSensitivityBand, formatKRW, type OptimizationMasterPlan } from '../engine';
import { classifyPlanVerdict, pickActiveCard, survivalAssumptionText } from './planVerdict';

/** U6: 위저드 푸터 라이브 결과 칩 — 입력이 결과를 어떻게 바꾸는지 즉시 보여준다 (판정 함수는 U3 재사용). */
export const WizardLiveChip: React.FC<{ plan: OptimizationMasterPlan }> = ({ plan }) => {
  const { activeLedger } = plan;
  const card = pickActiveCard(plan);
  // MC 밴드는 입력 타이핑을 막지 않도록 지연 값으로 계산 (inputs와 r*를 같은 지연 plan에서 함께 읽어 순간 불일치 방지)
  const deferredPlan = useDeferredValue(plan);
  const band = useMemo(
    () => evaluateSensitivityBand(deferredPlan.inputs, deferredPlan.activeLedger.personalRatio),
    [deferredPlan],
  );
  const survival = band.survivalProbabilityPercent;
  const verdict = classifyPlanVerdict({
    allocationStatus: plan.allocationStatus,
    depletionAgeSelf: activeLedger.depletionAgeSelf,
    totalUnmetSpendingNeed: activeLedger.totalUnmetSpendingNeed,
    survivalProbabilityPercent: survival,
    monthlyBuffer: card.monthlyBuffer,
  });
  const net = activeLedger.finalDisposableNetWorth;
  const prevNet = useRef(net);
  const [delta, setDelta] = useState(0);
  useEffect(() => {
    if (prevNet.current !== net) {
      setDelta(net - prevNet.current);
      prevNet.current = net;
    }
  }, [net]);

  return (
    <span className={`wizard-live-chip verdict-tone-${verdict.level}`} aria-live="polite">
      <span
        className="wizard-live-badge"
        title={`100세 생존확률 ${survival}% · ${survivalAssumptionText(band.mcAssumptions, survival)}`}
      >
        {verdict.badge}
      </span>
      <span>
        100세 순자산 <strong>{formatKRW(net)}</strong>
        {delta !== 0 && (
          <em className={delta > 0 ? 'is-up' : 'is-down'}>
            {delta > 0 ? ' ▲' : ' ▼'}
            {formatKRW(Math.abs(delta))}
          </em>
        )}
      </span>
      <span>
        지속가능 월 <strong>{formatKRW(card.sustainableMonthlyLivingExpense)}</strong>
      </span>
    </span>
  );
};
