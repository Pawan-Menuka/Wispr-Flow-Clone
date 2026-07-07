import base from '@flow/config/eslint.base';

export default [
  ...base,
  {
    rules: { 'no-console': 'off' }, // server logs to stdout until pino lands (§25)
  },
];
