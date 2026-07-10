import type { Settings } from '@flow/shared';

/**
 * Process name → style profile resolution (F11). User rules win over the
 * built-in table; unknown apps get 'default'. Pure — fully unit-tested.
 */

export type AppProfile = 'default' | 'slack' | 'email' | 'code' | 'terminal' | 'off';

const BUILTIN_RULES: [pattern: RegExp, profile: Exclude<AppProfile, 'off'>][] = [
  [/^(slack|discord|teams|ms-teams|telegram|whatsapp|signal)\b/, 'slack'],
  [/^(outlook|olk|thunderbird|mailspring|em client)\b/, 'email'],
  [/^(code|code - insiders|devenv|idea64|webstorm64|pycharm64|rider64|sublime_text|zed)\b/, 'code'],
  [/^(windowsterminal|wt|cmd|powershell|pwsh|conhost|mintty|alacritty|wezterm|hyper)\b/, 'terminal'],
];

export function resolveProfile(
  processName: string | null,
  userRules: Settings['appRules'],
): AppProfile {
  if (!processName) return 'default';
  const name = processName.toLowerCase();

  const userRule = userRules[name];
  if (userRule) return userRule;

  const base = name.replace(/\.exe$/, '');
  for (const [pattern, profile] of BUILTIN_RULES) {
    if (pattern.test(base)) return profile;
  }
  return 'default';
}
