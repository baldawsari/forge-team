import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/dashboard.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['gateway/src/**', 'viadp/src/**', 'memory/src/**'],
      exclude: ['**/__tests__/**', '**/node_modules/**'],
    },
  },
});
