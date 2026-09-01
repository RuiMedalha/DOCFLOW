import { defineConfig } from '@playwright/test';
import { API_BASE, loadEnvFiles } from './helpers/env';

loadEnvFiles();

export default defineConfig({
  testDir: './specs',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: '../test-results/e2e-html', open: 'never' }],
    ['json', { outputFile: '../test-results/e2e-results.json' }],
    ['./reporters/readiness-reporter.ts'],
  ],
  use: {
    baseURL: API_BASE,
    extraHTTPHeaders: { 'X-Request-Id': 'wave3-e2e' },
    ignoreHTTPSErrors: true,
  },
  outputDir: '../test-results/e2e-artifacts',
});
