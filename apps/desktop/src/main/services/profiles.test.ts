import { describe, expect, it } from 'vitest';
import { resolveProfile } from './profiles';

describe('resolveProfile', () => {
  it('maps known apps to built-in profiles', () => {
    expect(resolveProfile('slack.exe', {})).toBe('slack');
    expect(resolveProfile('Discord.exe', {})).toBe('slack');
    expect(resolveProfile('outlook.exe', {})).toBe('email');
    expect(resolveProfile('Code.exe', {})).toBe('code');
    expect(resolveProfile('WindowsTerminal.exe', {})).toBe('terminal');
    expect(resolveProfile('powershell.exe', {})).toBe('terminal');
  });

  it('unknown apps and null get default', () => {
    expect(resolveProfile('randomapp.exe', {})).toBe('default');
    expect(resolveProfile(null, {})).toBe('default');
  });

  it('user rules override built-ins, keyed lowercase', () => {
    expect(resolveProfile('slack.exe', { 'slack.exe': 'email' })).toBe('email');
    expect(resolveProfile('SLACK.EXE', { 'slack.exe': 'off' })).toBe('off');
    expect(resolveProfile('myapp.exe', { 'myapp.exe': 'code' })).toBe('code');
  });

  it('does not false-match substrings', () => {
    expect(resolveProfile('codecheck.exe', {})).toBe('default'); // not "code"
    expect(resolveProfile('wtutil.exe', {})).toBe('default'); // not "wt"
  });
});
