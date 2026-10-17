import { defineConfig } from 'vitest/config';

// `npm test` runs unit tests only; `npm run test:e2e` (E2E=1) runs against a live local API.
const e2e = !!process.env.E2E;

export default defineConfig({
  test: {
    include: e2e ? ['test/e2e/**/*.e2e.test.ts'] : ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'dist/**', ...(e2e ? [] : ['test/e2e/**'])],
    // e2e files share one throwaway owner and shift, so they must not run in parallel
    fileParallelism: !e2e,
    testTimeout: e2e ? 20_000 : 5_000,
  },
});
