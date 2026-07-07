import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DictationState } from '@flow/shared';

/**
 * Overlay pill placeholder. The real state-machine renderer (waveform,
 * interim text, action chips) lands in Phase 3; this proves the reduced
 * bridge delivers dictation state.
 */
function OverlayPill() {
  const [state, setState] = useState<DictationState>({ phase: 'idle' });

  useEffect(() => window.flow.on('dictation:state', setState), []);

  return (
    <div style={styles.pill} data-phase={state.phase}>
      <span style={styles.dot} />
      <span style={styles.label}>{state.phase}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    height: 44,
    margin: '18px auto',
    width: 'fit-content',
    padding: '0 18px',
    borderRadius: 999,
    background: 'rgba(28,28,30,0.92)',
    color: '#F2F2F3',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 13,
    boxShadow: '0 8px 32px rgba(0,0,0,.35)',
  },
  dot: { width: 8, height: 8, borderRadius: 999, background: '#8B7CF0' },
  label: { textTransform: 'capitalize' },
};

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OverlayPill />
  </React.StrictMode>,
);
