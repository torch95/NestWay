import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActionGuideView, type AnalysisTileKey } from './components/ActionGuideView';
import { InputWizard } from './components/InputWizard';
import {
  defineInputs,
  solveNestWaySlider,
  type OptimizationMasterPlan,
  type SimulationInputs,
} from './engine';
import { buildScenarioFilename, parseScenarioJson, serializeScenario } from './lib/scenarioIo';

const THEME_KEY = 'retire_opt_theme_v1';
const LOCAL_INPUTS_KEY = 'retire_opt_inputs_v1';

export const App: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem(THEME_KEY) as 'light' | 'dark') || 'light';
  });

  const [inputs, setInputs] = useState<SimulationInputs>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_INPUTS_KEY);
      if (saved) return defineInputs(JSON.parse(saved));
    } catch {
      // ignore local parse error
    }
    return defineInputs();
  });

  const [appMode, setAppMode] = useState<'wizard' | 'briefing' | 'guide'>('wizard');
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [briefingStep, setBriefingStep] = useState<number>(1);
  const [selectedTile, setSelectedTile] = useState<AnalysisTileKey | null>('tile1');
  const [isPrintMode, setIsPrintMode] = useState(false);
  const prevModeBeforePrintRef = useRef<'wizard' | 'briefing' | 'guide' | null>(null);
  const [snapshotA, setSnapshotA] = useState<OptimizationMasterPlan | null>(null);
  const [syncNotice, setSyncNotice] = useState<string>('');
  const noticeTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const plan = useMemo(() => solveNestWaySlider(inputs), [inputs]);

  useEffect(() => {
    const handleBeforePrint = () => setIsPrintMode(true);
    const handleAfterPrint = () => {
      setIsPrintMode(false);
      if (prevModeBeforePrintRef.current) {
        setAppMode(prevModeBeforePrintRef.current);
        prevModeBeforePrintRef.current = null;
      }
    };
    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, []);

  const handlePrintReport = () => {
    if (appMode !== 'guide') {
      prevModeBeforePrintRef.current = appMode;
      setAppMode('guide');
    }
    setIsPrintMode(true);
    window.setTimeout(() => window.print(), 80);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_INPUTS_KEY, JSON.stringify(inputs));
    } catch {
      // ignore storage quota errors
    }
  }, [inputs]);

  const notify = (msg: string, ms = 2500) => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    setSyncNotice(msg);
    noticeTimerRef.current = window.setTimeout(() => {
      setSyncNotice('');
      noticeTimerRef.current = null;
    }, ms);
  };

  const handleExportScenario = () => {
    const blob = new Blob([serializeScenario(inputs)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildScenarioFilename(inputs);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    notify('✓ 시나리오 저장됨');
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 1_048_576) {
      notify('불러오기 실패: 파일 크기가 1MB를 초과합니다.', 4000);
      return;
    }
    try {
      const next = parseScenarioJson(await file.text());
      setInputs(next);
      notify('✓ 시나리오 불러옴');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '유효하지 않은 파일입니다.';
      notify(`불러오기 실패: ${msg}`, 4000);
    }
  };

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand-group">
          <span className="brand-emblem" aria-hidden="true">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              <path d="M9 7h6M9 11h6" />
            </svg>
          </span>
          <strong className="brand-title">NestWay</strong>
          <span className="brand-badge">Slider</span>
          <span className="brand-sub">은퇴 금융자산 최적화 워크벤치 · 1-Won Exact</span>
        </div>

        <div className="top-actions">
          {syncNotice && (
            <span className="sync-notice-pill" role="status" aria-live="polite">
              {syncNotice}
            </span>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />

          <button
            type="button"
            className="btn"
            onClick={handleExportScenario}
            title="현재 입력한 조건을 로컬 JSON 파일로 저장합니다"
            aria-label="시나리오 내보내기"
          >
            📥<span className="btn-label"> 내보내기</span>
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => fileInputRef.current?.click()}
            title="저장해 둔 시나리오 JSON 파일(또는 기존 user_state.json)을 불러옵니다"
            aria-label="시나리오 불러오기"
          >
            📤<span className="btn-label"> 불러오기</span>
          </button>

          <button
            type="button"
            className="btn print-report-btn"
            onClick={handlePrintReport}
            title="자산 컨설팅 마스터플랜 PDF 리포트 출력 (핵심 결과 브리핑 6단계 + 상세 분석 차트 + 51개년 원장 전체 수록)"
            aria-label="PDF 마스터플랜 리포트"
          >
            🖨️<span className="btn-label"> PDF 마스터플랜 리포트</span>
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
            aria-label={theme === 'light' ? '다크 테마' : '라이트 테마'}
          >
            {theme === 'light' ? '🌙' : '☀️'}
            <span className="btn-label">{theme === 'light' ? ' 다크' : ' 라이트'}</span>
          </button>
        </div>
      </header>

      <div className="binder-shell-wrap">
        <nav className="app-mode-switcher binder-tabs-bar" aria-label="화면 모드 전환">
          <button
            type="button"
            className={`app-mode-btn ${appMode === 'wizard' ? 'active' : ''}`}
            aria-current={appMode === 'wizard' ? 'page' : undefined}
            onClick={() => setAppMode('wizard')}
          >
            <span className="binder-tab-idx">STEP 01</span>
            <span className="label-full">① 조건 입력 (단계별 위저드)</span>
            <span className="label-short">① 입력</span>
          </button>
          <button
            type="button"
            className={`app-mode-btn ${appMode === 'briefing' ? 'active' : ''}`}
            aria-current={appMode === 'briefing' ? 'page' : undefined}
            onClick={() => setAppMode('briefing')}
          >
            <span className="binder-tab-idx">STEP 02</span>
            <span className="label-full">② 핵심 결과 브리핑 (단계별 슬라이드)</span>
            <span className="label-short">② 결과 브리핑</span>
          </button>
          <button
            type="button"
            className={`app-mode-btn ${appMode === 'guide' ? 'active' : ''}`}
            aria-current={appMode === 'guide' ? 'page' : undefined}
            onClick={() => setAppMode('guide')}
          >
            <span className="binder-tab-idx">STEP 03</span>
            <span className="label-full">③ 상세 분석 & 원장</span>
            <span className="label-short">③ 상세 분석</span>
          </button>
        </nav>

        <div className="binder-sheet">
          <div className="binder-arch-inner">
            {appMode === 'wizard' && (
              <main className="wizard-main-stage">
                <InputWizard
                  inputs={inputs}
                  plan={plan}
                  step={wizardStep}
                  onStepChange={setWizardStep}
                  onChange={setInputs}
                  onCompleteToGuide={() => {
                    setBriefingStep(1);
                    setAppMode('briefing');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              </main>
            )}

            {(appMode === 'briefing' || appMode === 'guide') && (
              <main className="guide-main-stage">
                <ActionGuideView
                  inputs={inputs}
                  plan={plan}
                  snapshotA={snapshotA}
                  guideSection={appMode === 'briefing' ? 'briefing' : 'analytics'}
                  briefingStep={briefingStep}
                  onBriefingStepChange={setBriefingStep}
                  selectedTile={selectedTile}
                  isPrintMode={isPrintMode}
                  onPrintReport={handlePrintReport}
                  onSelectTile={setSelectedTile}
                  onSwitchToBriefing={() => {
                    setAppMode('briefing');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onSwitchToAnalytics={() => {
                    setAppMode('guide');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onJumpToAnalyticsTile={(tile) => {
                    setSelectedTile(tile);
                    setAppMode('guide');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onPinSnapshotA={() => setSnapshotA(plan)}
                  onClearSnapshotA={() => setSnapshotA(null)}
                  onChangeInputs={setInputs}
                  onBackToWizard={() => setAppMode('wizard')}
                  onJumpToWizardStep={(step) => {
                    setWizardStep(step);
                    setAppMode('wizard');
                  }}
                />
              </main>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
