import { useEffect, useState } from 'react';
import type { DictionaryTerm, Settings } from '@flow/shared';
import { Button, Select, SettingsRow, Slider, Switch } from '@flow/ui';
import { ShortcutRecorder } from './ShortcutRecorder';
import { MicSection } from './MicSection';

/** Settings screen, §5.4 subset covering every implemented settings key. */
export function SettingsPage({
  settings,
  set,
}: {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  return (
    <div style={{ maxWidth: 560 }}>
      <Section title="General">
        <SettingsRow label="Launch at login" description="Start Flow when you sign in to Windows">
          <Switch
            checked={settings.launchAtLogin}
            onChange={(v) => set('launchAtLogin', v)}
            aria-label="Launch at login"
          />
        </SettingsRow>
        <SettingsRow label="Theme">
          <Select value={settings.theme} onChange={(e) => set('theme', e.target.value as Settings['theme'])}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        </SettingsRow>
        <SettingsRow label="Overlay size">
          <Select
            value={settings.overlayScale}
            onChange={(e) => set('overlayScale', e.target.value as Settings['overlayScale'])}
          >
            <option value="s">Small</option>
            <option value="m">Medium</option>
            <option value="l">Large</option>
          </Select>
        </SettingsRow>
      </Section>

      <Section title="Dictation">
        <SettingsRow label="Dictation shortcut" description="Hold to talk, or tap to toggle">
          <ShortcutRecorder chord={settings.hotkey} onChange={(chord) => set('hotkey', chord)} />
        </SettingsRow>
        <SettingsRow label="Shortcut mode" description="Hold = release to finish; Toggle = tap to start and stop">
          <Select
            value={settings.hotkeyMode}
            onChange={(e) => set('hotkeyMode', e.target.value as Settings['hotkeyMode'])}
          >
            <option value="hold">Hold (push-to-talk)</option>
            <option value="toggle">Toggle</option>
          </Select>
        </SettingsRow>
        <SettingsRow
          label="Voice sensitivity"
          description="Higher picks up quieter speech (and more background noise)"
        >
          <Slider
            value={settings.vadSensitivity}
            min={0.2}
            max={0.8}
            step={0.05}
            onChange={(v) => set('vadSensitivity', v)}
            aria-label="Voice sensitivity"
          />
        </SettingsRow>
        <SettingsRow label="Spoken language">
          <Select value={settings.language} onChange={(e) => set('language', e.target.value)}>
            <option value="auto">Auto-detect</option>
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="pt">Portuguese</option>
            <option value="hi">Hindi</option>
            <option value="ja">Japanese</option>
          </Select>
        </SettingsRow>
        <MicSection settings={settings} />
      </Section>

      <Section title="Formatting">
        <SettingsRow label="Remove filler words" description={'Drops "um", "uh", "you know"'}>
          <Switch checked={settings.fillerRemoval} onChange={(v) => set('fillerRemoval', v)} />
        </SettingsRow>
        <SettingsRow label="Spoken punctuation" description={'"comma" and "new line" become , and a line break'}>
          <Switch
            checked={settings.spokenPunctuation}
            onChange={(v) => set('spokenPunctuation', v)}
          />
        </SettingsRow>
        <SettingsRow label="Tone">
          <Select value={settings.tone} onChange={(e) => set('tone', e.target.value as Settings['tone'])}>
            <option value="match-app">Match the app</option>
            <option value="neutral">Neutral</option>
            <option value="formal">Always formal</option>
            <option value="casual">Always casual</option>
          </Select>
        </SettingsRow>
      </Section>

      <Section title="Dictionary">
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 12 }}>
          Names and jargon Flow should always spell correctly — boosted in recognition and
          formatting.
        </p>
        <DictionarySection />
      </Section>

      <Section title="Privacy">
        <SettingsRow label="History retention" description="Dictations are stored on this device only">
          <Select
            value={settings.historyRetention}
            onChange={(e) => set('historyRetention', e.target.value as Settings['historyRetention'])}
          >
            <option value="forever">Keep forever</option>
            <option value="30d">30 days</option>
            <option value="off">Don't store</option>
          </Select>
        </SettingsRow>
        <SettingsRow label="Release microphone immediately" description="Re-acquires the mic on every dictation (slower start, stricter privacy)">
          <Switch
            checked={settings.releaseMicImmediately}
            onChange={(v) => set('releaseMicImmediately', v)}
          />
        </SettingsRow>
        <SettingsRow label="Usage analytics" description="Anonymous usage counts — never your words">
          <Switch checked={settings.telemetry} onChange={(v) => set('telemetry', v)} />
        </SettingsRow>
      </Section>
    </div>
  );
}

function DictionarySection() {
  const [terms, setTerms] = useState<DictionaryTerm[]>([]);
  const [draft, setDraft] = useState('');

  const reload = () => void window.flow.invoke('dictionary:list').then(setTerms);
  useEffect(reload, []);

  const add = async () => {
    const phrase = draft.trim();
    if (!phrase) return;
    setDraft('');
    await window.flow.invoke('dictionary:add', phrase);
    reload();
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          style={{
            flex: 1,
            padding: '8px 10px',
            borderRadius: 'var(--r-sm)',
            background: 'var(--bg-surface)',
            color: 'var(--fg-primary)',
            border: '1px solid var(--border-strong)',
            fontFamily: 'var(--font-sans)',
          }}
          placeholder="Add a word or phrase…"
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <Button size="sm" disabled={!draft.trim()} onClick={() => void add()}>
          Add
        </Button>
      </div>
      {terms.length === 0 ? (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
          No entries yet — try your name or a product term.
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {terms.map((term) => (
            <span
              key={term.phrase}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 'var(--r-pill)',
                background: 'var(--bg-sunken)',
                border: '1px solid var(--border)',
                fontSize: 'var(--text-sm)',
              }}
            >
              {term.phrase}
              <button
                aria-label={`Remove ${term.phrase}`}
                onClick={() =>
                  void window.flow.invoke('dictionary:remove', term.phrase).then(reload)
                }
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--fg-tertiary)',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 14,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 'var(--s-10)' }}>
      <h2
        style={{
          fontSize: 'var(--text-lg)',
          fontWeight: 600,
          color: 'var(--fg-primary)',
          marginBottom: 'var(--s-2)',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
