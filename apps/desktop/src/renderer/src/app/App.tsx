import { useEffect, useState } from 'react';
import type { SessionInfo } from '@flow/shared';
import { Button } from '@flow/ui';
import { SettingsPage } from './SettingsPage';
import { HistoryPage } from './HistoryPage';
import { Onboarding } from './Onboarding';
import { useSettings, useTheme } from './useSettings';

type Page = 'home' | 'settings';

const QUERY = new URLSearchParams(location.search);
const IS_SMOKE = QUERY.has('smoke');
const FORCE_ONBOARDING = QUERY.has('onboarding');
// Smoke screenshots default to Settings; FLOW_SMOKE_PAGE overrides via query.
const SMOKE_PAGE = (QUERY.get('page') as Page | null) ?? 'settings';

export function App() {
  const { settings, set } = useSettings();
  const [page, setPage] = useState<Page>(IS_SMOKE ? SMOKE_PAGE : 'home');
  useTheme(settings?.theme);

  if (settings && (FORCE_ONBOARDING || (!settings.onboardingComplete && !IS_SMOKE))) {
    return <Onboarding settings={settings} set={set} />;
  }

  return (
    <div style={styles.shell}>
      <nav style={styles.nav}>
        <div style={styles.brand}>Flow</div>
        {(['home', 'settings'] as const).map((target) => (
          <button
            key={target}
            onClick={() => setPage(target)}
            style={{
              ...styles.navItem,
              ...(page === target ? styles.navItemActive : {}),
            }}
          >
            {target === 'home' ? 'Home' : 'Settings'}
          </button>
        ))}
      </nav>
      <main style={styles.content}>
        {page === 'home' ? <HomePage /> : null}
        {page === 'settings' && settings ? <SettingsPage settings={settings} set={set} /> : null}
        {IS_SMOKE ? <SmokeInsertTarget /> : null}
      </main>
    </div>
  );
}

function HomePage() {
  return (
    <div>
      <HistoryPage />
      <AccountSection />
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
    const { quota, entitlements } = session;
    const pct =
      quota.limitWords !== null ? Math.min(100, (quota.usedWords / quota.limitWords) * 100) : null;
    return (
      <div style={{ marginTop: 32 }}>
        <h2 style={styles.h2}>Account</h2>
        <p style={{ color: 'var(--fg-secondary)' }}>
          Signed in as <strong style={{ color: 'var(--fg-primary)' }}>{session.user.email}</strong>{' '}
          ({entitlements.plan})
        </p>
        {pct !== null ? (
          <div style={{ maxWidth: 320, margin: '8px 0 12px' }}>
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: 'var(--bg-sunken)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--accent)',
                }}
              />
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 4 }}>
              {quota.usedWords.toLocaleString()} / {quota.limitWords!.toLocaleString()} words this
              week
            </div>
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 8 }}>
          {entitlements.plan === 'FREE' ? (
            <Button size="sm" onClick={() => void run(() => window.flow.invoke('billing:checkout'))}>
              Upgrade to Pro
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void run(() => window.flow.invoke('billing:portal'))}
            >
              Manage billing
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void window.flow.invoke('auth:logout')}>
            Sign out
          </Button>
        </div>
        {error ? <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>{error}</p> : null}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 32 }}>
      <h2 style={styles.h2}>Account</h2>
      {stage === 'email' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={styles.input}
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={styles.input}
            placeholder="6-digit code"
            value={code}
            maxLength={6}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <Button
            disabled={busy || code.length !== 6}
            onClick={() => void run(() => window.flow.invoke('auth:submitMagicCode', email, code))}
          >
            Sign in
          </Button>
          <Button variant="ghost" onClick={() => setStage('email')}>
            back
          </Button>
        </div>
      )}
      {error ? (
        <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>{error}</p>
      ) : null}
    </div>
  );
}

/** Paste target for `--smoke-insert` — rendered only in smoke runs. */
function SmokeInsertTarget() {
  return (
    <input
      autoFocus
      placeholder="smoke insert target"
      onChange={(e) => console.warn(`insert-target: ${e.target.value}`)}
      style={{ ...styles.input, marginTop: 24, width: 300, display: 'block' }}
    />
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex',
    fontFamily: 'var(--font-sans)',
    background: 'var(--bg-app)',
    color: 'var(--fg-primary)',
    minHeight: '100vh',
  },
  nav: {
    width: 180,
    padding: 'var(--s-6) var(--s-4)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flexShrink: 0,
  },
  brand: { fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--s-6)', paddingLeft: 10 },
  navItem: {
    textAlign: 'left',
    padding: '8px 10px',
    borderRadius: 'var(--r-sm)',
    border: 'none',
    background: 'transparent',
    color: 'var(--fg-secondary)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-base)',
    cursor: 'pointer',
  },
  navItemActive: { background: 'var(--bg-sunken)', color: 'var(--fg-primary)', fontWeight: 500 },
  content: { flex: 1, padding: 'var(--s-10)', overflowY: 'auto' },
  h2: { fontSize: 'var(--text-lg)', fontWeight: 600 },
  input: {
    flex: 1,
    padding: '8px 10px',
    borderRadius: 'var(--r-sm)',
    background: 'var(--bg-surface)',
    color: 'var(--fg-primary)',
    border: '1px solid var(--border-strong)',
    fontFamily: 'var(--font-sans)',
  },
};
