import { useEffect, useRef, useState } from 'react';
import type { Settings } from '@flow/shared';
import { Button, Select, SettingsRow } from '@flow/ui';
import { capture, listMicrophones } from '../audio/capture';

/** Device picker + live meter (§2 F2). */
export function MicSection({ settings }: { settings: Settings }) {
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
  useEffect(() => () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
  }, []);

  const test = async () => {
    if (testing) return;
    setTesting(true);
    try {
      await capture.start(settings.micDeviceId);
      void listMicrophones().then(setMics); // labels appear after first grant
      stopTimer.current = setTimeout(() => {
        void capture.stop().then(() => setTesting(false));
      }, 3000);
    } catch {
      setTesting(false);
    }
  };

  return (
    <>
      <SettingsRow label="Microphone">
        <Select
          value={settings.micDeviceId}
          onChange={(e) => void window.flow.invoke('settings:set', 'micDeviceId', e.target.value)}
        >
          <option value="default">System default</option>
          {mics.map((mic) => (
            <option key={mic.deviceId} value={mic.deviceId}>
              {mic.label}
            </option>
          ))}
        </Select>
      </SettingsRow>
      <SettingsRow label="Test microphone">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button size="sm" variant="secondary" onClick={() => void test()} disabled={testing}>
            {testing ? 'Listening…' : 'Test (3 s)'}
          </Button>
          <div
            style={{
              width: 120,
              height: 8,
              borderRadius: 4,
              background: 'var(--bg-sunken)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(100, level * 300)}%`,
                height: '100%',
                background: 'var(--accent)',
                transition: 'width 60ms linear',
              }}
            />
          </div>
        </div>
      </SettingsRow>
    </>
  );
}
