import { useEffect, useRef, useState } from 'react';
import type { DictationState } from '@flow/shared';
import { Waveform } from './Waveform';

interface Interim {
  text: string;
  stableWords: number;
}

/**
 * The overlay pill: sole in-flow UI (BLUEPRINT §5.1). Pure renderer of
 * `dictation:*` events — all state lives in the main process. The window is
 * shown/hidden by the main process; this component just draws the phase.
 */
export function OverlayPill() {
  const [state, setState] = useState<DictationState>({ phase: 'idle' });
  const [interim, setInterim] = useState<Interim>({ text: '', stableWords: 0 });
  const [result, setResult] = useState<{ id: string; text: string } | null>(null);
  const lastResultId = useRef<string | null>(null);

  useEffect(() => {
    const subs = [
      window.flow.on('dictation:state', (next) => {
        setState(next);
        if (next.phase === 'armed' || next.phase === 'listening') {
          setInterim({ text: '', stableWords: 0 });
          setResult(null);
        }
      }),
      window.flow.on('dictation:interim', setInterim),
      window.flow.on('dictation:result', ({ id, text }) => {
        lastResultId.current = id;
        setResult({ id, text });
      }),
    ];
    return () => subs.forEach((unsub) => unsub());
  }, []);

  if (state.phase === 'idle') return null;

  return (
    <div className="overlay-root">
      <div className={`pill ${state.phase}`} role="status" aria-live="polite">
        {renderContent(state, interim)}
        {state.offline ? <span className="offline-chip">offline</span> : null}
      </div>
      {state.phase === 'confirmed' && result ? <ActionChips dictationId={result.id} /> : null}
    </div>
  );
}

function renderContent(state: DictationState, interim: Interim) {
  switch (state.phase) {
    case 'armed':
      return <span className="state-label">Listening…</span>;
    case 'listening':
      return (
        <>
          <Waveform />
          {interim.text ? (
            <InterimText interim={interim} />
          ) : (
            <span className="state-label">Listening…</span>
          )}
        </>
      );
    case 'processing':
    case 'inserting':
      return (
        <>
          <span className="shimmer" aria-label="Processing" />
          {interim.text ? <InterimText interim={interim} /> : null}
        </>
      );
    case 'confirmed':
      return (
        <>
          <span className="check" aria-hidden="true">
            ✓
          </span>
          <span>Inserted</span>
        </>
      );
    case 'error':
      return <span className="message">{state.error?.message ?? 'Something went wrong'}</span>;
    default:
      return null;
  }
}

function InterimText({ interim }: { interim: Interim }) {
  const words = interim.text.split(/\s+/).filter(Boolean);
  const stable = words.slice(0, interim.stableWords).join(' ');
  const unstable = words.slice(interim.stableWords).join(' ');
  return (
    <span className="interim">
      <bdi>
        {stable}
        {unstable ? (
          <>
            {stable ? ' ' : ''}
            <span className="unstable">{unstable}</span>
          </>
        ) : null}
      </bdi>
    </span>
  );
}

function ActionChips({ dictationId }: { dictationId: string }) {
  return (
    <div className="chips">
      <button className="chip" onClick={() => void window.flow.invoke('insertion:undo')}>
        Undo
      </button>
      <button
        className="chip"
        onClick={() => void window.flow.invoke('clipboard:copyResult', dictationId)}
      >
        Copy
      </button>
    </div>
  );
}
