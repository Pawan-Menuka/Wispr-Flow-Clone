import { useEffect, useState } from 'react';
import type { Settings } from '@flow/shared';

/**
 * Placeholder shell for the main window. Real routes (onboarding, history,
 * settings) arrive in Phases 3/11/12/13 — this exists to prove the typed
 * bridge round-trips: invoke, settings mutation, and event subscription.
 */
export function App() {
  const [version, setVersion] = useState('…');
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void window.flow.invoke('app:getVersion').then(setVersion);
    void window.flow.invoke('settings:get').then(setSettings);
    return window.flow.on('settings:changed', (patch) => {
      setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    });
  }, []);

  const cycleTheme = () => {
    if (!settings) return;
    const order = ['system', 'light', 'dark'] as const;
    const next = order[(order.indexOf(settings.theme) + 1) % order.length]!;
    void window.flow.invoke('settings:set', 'theme', next);
  };

  return (
    <div style={styles.shell}>
      <h1 style={styles.title}>Flow</h1>
      <p style={styles.subtitle}>System-wide voice dictation — development shell</p>
      <dl style={styles.grid}>
        <dt style={styles.dt}>App version</dt>
        <dd style={styles.dd}>{version}</dd>
        <dt style={styles.dt}>Hotkey</dt>
        <dd style={styles.dd}>{settings?.hotkey ?? '…'}</dd>
        <dt style={styles.dt}>Theme</dt>
        <dd style={styles.dd}>
          {settings?.theme ?? '…'}{' '}
          <button style={styles.button} onClick={cycleTheme}>
            cycle
          </button>
        </dd>
      </dl>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    fontFamily: 'system-ui, sans-serif',
    background: '#161618',
    color: '#F2F2F3',
    minHeight: '100vh',
    padding: 48,
    boxSizing: 'border-box',
  },
  title: { fontSize: 28, fontWeight: 600, margin: 0 },
  subtitle: { color: '#A2A2A8', marginTop: 8 },
  grid: { marginTop: 32, display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 12 },
  dt: { color: '#A2A2A8' },
  dd: { margin: 0 },
  button: {
    marginLeft: 8,
    background: '#8B7CF0',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '2px 10px',
    cursor: 'pointer',
  },
};
