import React from 'react';

// Must match LOCAL_INPUTS_KEY in App.tsx (persisted inputs are restored before the first render).
const INPUTS_KEY = 'retire_opt_inputs_v1';

/** Render-crash guard: recovery card instead of a blank page that recurs on reload (inputs persist in localStorage). */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error }; // React itself logs the caught error + component stack to the console.
  }

  private resetInputs = () => {
    try {
      const saved = localStorage.getItem(INPUTS_KEY);
      if (saved) localStorage.setItem(`${INPUTS_KEY}_crash_backup`, saved);
      localStorage.removeItem(INPUTS_KEY);
    } catch {
      // storage unavailable: the reload below still retries
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-shell" role="alert" style={{ alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center' }}>
        <strong>화면을 표시하는 중 오류가 발생했습니다.</strong>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          저장된 입력값이 원인일 수 있습니다. 초기화하면 기본 시나리오로 다시 시작하며, 기존 입력값은 브라우저에 백업됩니다.
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={() => window.location.reload()}>다시 시도</button>
          <button type="button" className="btn" onClick={this.resetInputs}>입력값 초기화 후 다시 시작</button>
        </div>
      </div>
    );
  }
}
