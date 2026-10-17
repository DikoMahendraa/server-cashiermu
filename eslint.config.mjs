// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'prisma/migrations/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier, // turns off rules that clash with Prettier — keep last
  {
    rules: {
      // Use the shared winston logger (src/utils/logger.ts), not console.*
      'no-console': 'error',
      // Unused things are bugs waiting to happen; prefix with _ to opt out on purpose
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    // Express middleware augments the global namespace on purpose (req.user)
    files: ['src/middleware/authenticate.ts'],
    rules: { '@typescript-eslint/no-namespace': 'off' },
  },
  {
    // Scripts may print
    files: ['prisma/seed.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Tests build loose fakes of Prisma/HTTP objects, so `any` is acceptable here
    files: ['test/**/*.ts'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
);
