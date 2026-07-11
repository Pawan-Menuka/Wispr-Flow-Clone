import base from '@flow/config/eslint.base';

export default [
  ...base,
  {
    // AudioWorklet global scope (plain JS static asset, never bundled/linted).
    ignores: ['src/renderer/public/**'],
  },
  {
    // The main process logs to stdout by design (tray-ready line, smoke checks).
    files: ['src/main/**', 'src/preload/**', 'scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // Lazy require() of native/optional modules types itself via inline import().
    files: ['src/main/index.ts', 'src/main/services/focus.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
    },
  },
];
