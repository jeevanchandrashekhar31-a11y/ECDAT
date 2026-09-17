const js = require('@eslint/js');

const nodeGlobals = {
  Buffer: 'readonly',
  __dirname: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  module: 'writable',
  process: 'readonly',
  require: 'readonly',
  setTimeout: 'readonly'
};

module.exports = [
  { ignores: ['node_modules', 'coverage'] },
  {
    files: ['src/**/*.js'],
    ...js.configs.recommended,
    languageOptions: { sourceType: 'commonjs', globals: nodeGlobals },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['tests/**/*.js'],
    ...js.configs.recommended,
    languageOptions: { sourceType: 'commonjs', globals: nodeGlobals },
    rules: {
      'no-unused-vars': 'off'
    }
  }
];
