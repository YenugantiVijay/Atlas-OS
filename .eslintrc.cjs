module.exports = {
  root: true,
  env: {
    browser: true,
    es2020: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: [
    '@typescript-eslint',
    'react-hooks',
  ],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
  overrides: [
    {
      files: ['scripts/**/*.{js,mjs}'],
      env: {
        node: true,
        es2022: true,
      },
      rules: {
        'no-undef': 'error',
      },
    },
  ],
  ignorePatterns: [
    'dist',
    'node_modules',
    '*.config.ts',
    '*.config.js',
    '.eslintrc.cjs',
  ],
};
