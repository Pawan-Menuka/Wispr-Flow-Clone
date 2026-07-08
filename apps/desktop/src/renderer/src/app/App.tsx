import { useEffect, useRef, useState } from 'react';
import type { SessionInfo, Settings } from '@flow/shared';
import { capture, listMicrophones } from '../audio/capture';

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
      <AccountSection />
      {settings ? <MicSection settings={settings} /> : null}
      {new URLSearchParams(location.search).has('smoke') ? <SmokeInsertTarget /> : null}
    </div>
  );
}

/** Magic-link sign-in (§11). Becomes the onboarding auth step in Phase 12. */
function AccountSection() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.flow.invoke('auth:getSession').then(setSession);
    return window.flow.on('session:changed', setSession);
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (session) {
    return (
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Account</h2>
        <p>
          Signed in as <strong>{session.user.email}</strong> ({session.entitlements.plan})
        </p>
        <button style={styles.button} onClick={() => void window.flow.invoke('auth:logout')}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div style={sectionStyle}>
      <h2 style={{ fontSize: 16, fontWeight: 600 }}>Account</h2>
      {stage === 'email' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={inputStyle}
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            style={styles.button}
            disabled={busy || !email.includes('@')}
            onClick={() =>
              void run(async () => {
                await window.flow.invoke('auth:sendMagicLink', email);
                setStage('code');
              })
            }
          >
            Send code
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={inputStyle}
            placeholder="6-digit code"
            value={code}
            maxLength={6}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <button
            style={styles.button}
            disabled={busy || code.length !== 6}
            onClick={() =>
              void run(() => window.flow.invoke('auth:submitMagicCode', email, code))
            }
          >
            Sign in
          </button>
          <button style={{ ...styles.button, background: 'transparent' }} onClick={() => setStage('email')}>
            back
          </button>
        </div>
      )}
      {error ? <p style={{ color: '#d64545', fontSize: 13 }}>{error}</p> : null}
    </div>
  );
}

const sectionStyle: React.CSSProperties = { marginTop: 40, maxWidth: 420 };
const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '8px 10px',
  borderRadius: 6,
  background: '#1f1f22',
  color: '#f2f2f3',
  border: '1px solid rgba(255,255,255,0.2)',
};

/** Paste target for `--smoke-insert` — rendered only in smoke runs. */
function SmokeInsertTarget() {
  return (
    <input
      autoFocus
      placeholder="smoke insert target"
      onChange={(e) => console.warn(`insert-target: ${e.target.value}`)}
      style={{ marginTop: 24, padding: 8, width: 300, display: 'block' }}
    />
  );
}

/** Device picker + live meter (BLUEPRINT §2 F2). Becomes Settings → Dictation in Phase 11. */
function MicSection({ settings }: { settings: Settings }) {
  const [mics, setMics] = useState<{ deviceId: string; label: string }[]>([]);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void listMicrophones().then(setMics);
    const onChange = () => void listMicrophones().then(setMics);
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange);
  }, []);

  useEffect(() => capture.onLevel(setLevel), []);

  const test = async () => {
    if (testing) return;
    setTesting(true);
    try {
      await capture.start(settings.micDeviceId);
      // Labels are only exposed after a permission grant — refresh the list.
      void listMicrophones().then(setMics);
      stopTimer.current = setTimeout(() => {
        void capture.stop().then(() => setTesting(false));
      }, 3000);
    } catch {
      setTesting(false);
    }
  };

  return (
    <div style={{ marginTop: 40, maxWidth: 420 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600 }}>Microphone</h2>
      <select
        value={settings.micDeviceId}
        onChange={(e) => void window.flow.invoke('settings:set', 'micDeviceId', e.target.value)}
        style={{
          width: '100%',
          padding: '8px 10px',
          borderRadius: 6,
          background: '#1f1f22',
          color: '#f2f2f3',
          border: '1px solid rgba(255,255,255,0.2)',
        }}
      >
        <option value="default">System default</option>
        {mics.map((mic) => (
          <option key={mic.deviceId} value={mic.deviceId}>
            {mic.label}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <button style={styles.button} onClick={() => void test()} disabled={testing}>
          {testing ? 'Listening…' : 'Test mic (3 s)'}
        </button>
        <div
          style={{
            flex: 1,
            height: 8,
            borderRadius: 4,
            background: 'rgba(255,255,255,0.12)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.min(100, level * 300)}%`,
              height: '100%',
              background: '#8b7cf0',
              transition: 'width 60ms linear',
            }}
          />
        </div>
      </div>
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
