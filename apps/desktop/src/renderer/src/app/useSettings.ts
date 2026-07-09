import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '@flow/shared';

/** Live settings snapshot + typed setter (instant apply, no Save button — §19). */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void window.flow.invoke('settings:get').then(setSettings);
    return window.flow.on('settings:changed', (patch) => {
      setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    });
  }, []);

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev)); // optimistic
    void window.flow.invoke('settings:set', key, value);
  }, []);

  return { settings, set };
}

/** Applies the theme setting to the document (system = OS preference). */
export function useTheme(theme: Settings['theme'] | undefined) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' || !theme ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset['theme'] = resolved;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}
