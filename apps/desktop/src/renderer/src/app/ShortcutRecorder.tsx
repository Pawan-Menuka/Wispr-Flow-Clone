import { useEffect, useState } from 'react';
import { Button, Kbd } from '@flow/ui';

/**
 * Capture-next-chord widget (§6). The actual key capture happens in the main
 * process via the global hook — the Win key never reaches a renderer cleanly.
 */
export function ShortcutRecorder({
  chord,
  onChange,
}: {
  chord: string;
  onChange: (chord: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  useEffect(() => {
    return window.flow.on('shortcut:captured', ({ chord: captured, conflict: hit }) => {
      setRecording(false);
      setConflict(hit);
      if (captured && !hit) onChange(captured);
    });
  }, [onChange]);

  useEffect(() => {
    // Leaving the screen mid-recording must not wedge the global hook.
    return () => {
      if (recording) void window.flow.invoke('shortcut:cancelCapture');
    };
  }, [recording]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {recording ? (
        <span style={{ color: 'var(--accent)', fontSize: 'var(--text-sm)' }}>
          Press keys… (Esc cancels)
        </span>
      ) : (
        <span style={{ display: 'flex', gap: 4 }}>
          {chord.split('+').map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </span>
      )}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setConflict(null);
          setRecording(true);
          void window.flow.invoke('shortcut:beginCapture');
        }}
        disabled={recording}
      >
        {recording ? 'Recording…' : 'Change'}
      </Button>
      {conflict ? (
        <span style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
          Conflicts with {conflict}
        </span>
      ) : null}
    </div>
  );
}
