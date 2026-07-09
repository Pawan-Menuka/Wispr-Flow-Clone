import { useEffect, useRef, useState } from 'react';
import type { SessionInfo, Settings } from '@flow/shared';
import { Button, Kbd } from '@flow/ui';
import { capture } from '../audio/capture';
import { ShortcutRecorder } from './ShortcutRecorder';

/**
 * First-run flow (BLUEPRINT §3.2): welcome → sign in → mic → hotkey →
 * practice → done. Activation metric = first insertion into the practice box.
 * Sign-in is skippable while dev auth is optional (REQUIRE_AUTH=false);
 * flip to mandatory when the API enforces auth.
 */

const STEPS = ['welcome', 'signin', 'mic', 'hotkey', 'practice', 'done'] as const;
type Step = (typeof STEPS)[number];

export function Onboarding({
  settings,
  set,
}: {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  const [step, setStep] = useState<Step>('welcome');
  const next = () => setStep(STEPS[STEPS.indexOf(step) + 1] ?? 'done');
  const finish = () => {
    set('onboardingComplete', true);
    window.close(); // close-to-tray: Flow lives in the tray from here on
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {step === 'welcome' && <Welcome onNext={next} />}
        {step === 'signin' && <SignIn onNext={next} />}
        {step === 'mic' && <MicPermission onNext={next} />}
        {step === 'hotkey' && <HotkeyTutorial settings={settings} set={set} onNext={next} />}
        {step === 'practice' && <Practice settings={settings} onNext={next} />}
        {step === 'done' && <Done onFinish={finish} />}
      </div>
      <div style={styles.dots} aria-hidden="true">
        {STEPS.map((s) => (
          <span
            key={s}
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: s === step ? 'var(--accent)' : 'var(--border-strong)',
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <>
      <h1 style={styles.title}>Welcome to Flow</h1>
      <p style={styles.body}>
        Speak anywhere your cursor is — email, chat, code — and polished text appears. Setup takes
        about a minute.
      </p>
      <Button onClick={onNext}>Get started</Button>
    </>
  );
}

function SignIn({ onNext }: { onNext: () => void }) {
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
      <>
        <h1 style={styles.title}>You're signed in</h1>
        <p style={styles.body}>
          {session.user.email} · {session.entitlements.plan}
        </p>
        <Button onClick={onNext}>Continue</Button>
      </>
    );
  }

  return (
    <>
      <h1 style={styles.title}>Sign in</h1>
      <p style={styles.body}>We'll email you a 6-digit code — no password needed.</p>
      {stage === 'email' ? (
        <div style={styles.row}>
          <input
            style={styles.input}
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <Button
            disabled={busy || !email.includes('@')}
            onClick={() =>
              void run(async () => {
                await window.flow.invoke('auth:sendMagicLink', email);
                setStage('code');
              })
            }
          >
            Send code
          </Button>
        </div>
      ) : (
        <div style={styles.row}>
          <input
            style={styles.input}
            placeholder="6-digit code"
            value={code}
            maxLength={6}
            autoFocus
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <Button
            disabled={busy || code.length !== 6}
            onClick={() =>
              void run(async () => {
                await window.flow.invoke('auth:submitMagicCode', email, code);
                onNext();
              })
            }
          >
            Sign in
          </Button>
        </div>
      )}
      {error ? <p style={styles.error}>{error}</p> : null}
      <button style={styles.skip} onClick={onNext}>
        Skip for now
      </button>
    </>
  );
}

function MicPermission({ onNext }: { onNext: () => void }) {
  const [state, setState] = useState<'ask' | 'checking' | 'denied'>('ask');

  const request = async () => {
    setState('checking');
    try {
      await capture.start('default');
      await capture.stop();
      onNext();
    } catch {
      setState('denied');
    }
  };

  return (
    <>
      <h1 style={styles.title}>Microphone access</h1>
      <p style={styles.body}>
        Flow listens only while you hold the shortcut. Audio is processed and immediately
        discarded — never stored.
      </p>
      {state !== 'denied' ? (
        <Button onClick={() => void request()} loading={state === 'checking'}>
          Enable microphone
        </Button>
      ) : (
        <>
          <p style={styles.error}>
            Microphone access is off. Enable it in Windows Settings, then check again.
          </p>
          <div style={styles.row}>
            <Button
              variant="secondary"
              onClick={() => void window.flow.invoke('app:openExternal', 'ms-settings:privacy-microphone')}
            >
              Open Windows Settings
            </Button>
            <Button onClick={() => void request()}>Check again</Button>
          </div>
        </>
      )}
    </>
  );
}

function HotkeyTutorial({
  settings,
  set,
  onNext,
}: {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onNext: () => void;
}) {
  return (
    <>
      <h1 style={styles.title}>Your dictation key</h1>
      <p style={styles.body}>
        <strong>Hold</strong> it while you speak, release to insert. Or <strong>tap</strong> it to
        toggle hands-free.
      </p>
      <div style={{ margin: '12px 0 24px' }}>
        <ShortcutRecorder chord={settings.hotkey} onChange={(chord) => set('hotkey', chord)} />
      </div>
      <Button onClick={onNext}>Continue</Button>
    </>
  );
}

function Practice({ settings, onNext }: { settings: Settings; onNext: () => void }) {
  const [gotResult, setGotResult] = useState(false);
  const [text, setText] = useState('');
  const succeeded = useRef(false);

  useEffect(() => window.flow.on('dictation:result', () => setGotResult(true)), []);

  const success = gotResult && text.trim().length > 0;
  if (success) succeeded.current = true;

  return (
    <>
      <h1 style={styles.title}>Try it</h1>
      <p style={styles.body}>
        Click the box, hold{' '}
        {settings.hotkey.split('+').map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}{' '}
        and say: <em>“Flow makes typing feel ancient.”</em>
      </p>
      <textarea
        style={{ ...styles.input, height: 96, width: '100%', resize: 'none' }}
        placeholder="Your words appear here…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
        <Button onClick={onNext} disabled={!succeeded.current}>
          {succeeded.current ? 'It worked!' : 'Waiting for your voice…'}
        </Button>
        <button style={styles.skip} onClick={onNext}>
          Skip practice
        </button>
      </div>
    </>
  );
}

function Done({ onFinish }: { onFinish: () => void }) {
  return (
    <>
      <h1 style={styles.title}>You're all set</h1>
      <p style={styles.body}>
        Flow lives in your system tray now. Hold your shortcut in any app and speak — that's it.
      </p>
      <Button onClick={onFinish}>Finish</Button>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-app)',
    color: 'var(--fg-primary)',
    fontFamily: 'var(--font-sans)',
    gap: 32,
  },
  card: { width: 440, minHeight: 260 },
  title: { fontSize: 'var(--text-2xl)', fontWeight: 600, marginBottom: 12 },
  body: { color: 'var(--fg-secondary)', lineHeight: 1.5, marginBottom: 24 },
  row: { display: 'flex', gap: 8 },
  input: {
    flex: 1,
    padding: '9px 12px',
    borderRadius: 'var(--r-sm)',
    background: 'var(--bg-surface)',
    color: 'var(--fg-primary)',
    border: '1px solid var(--border-strong)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-base)',
  },
  dots: { display: 'flex', gap: 8 },
  error: { color: 'var(--danger)', fontSize: 'var(--text-sm)', margin: '12px 0' },
  skip: {
    background: 'none',
    border: 'none',
    color: 'var(--fg-tertiary)',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    padding: 0,
    marginTop: 16,
    display: 'block',
  },
};
