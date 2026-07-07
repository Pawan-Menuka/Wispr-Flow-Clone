import base from '@flow/config/eslint.base';

export default [
  ...base,
  {
    // The main process logs to stdout by design (tray-ready line, smoke checks).
    files: ['src/main/**', 'src/preload/**', 'scripts/**'],
    rules: { 'no-console': 'off' },
  },
];
