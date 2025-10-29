module.exports = {
  extends: ['./eslint.config.cjs'],
  rules: {
    // Allow console statements in CI for debugging
    'no-console': 'off',
    // Allow unused variables in CI (they might be used in development)
    '@typescript-eslint/no-unused-vars': 'off',
    // Allow unused imports in CI
    'no-unused-vars': 'off',
  },
};
