import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Several UI suites intentionally exercise shared browser/session fixtures
    // and Excel/report generation. Running files concurrently makes those
    // suites race on mocks and CPU, producing order-dependent failures that do
    // not represent product behavior. Keep the default CI run deterministic.
    fileParallelism: false,
    testTimeout: 15000,
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
  },
});
