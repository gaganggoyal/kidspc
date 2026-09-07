import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    // apps/web is included for the handful of modules there that are plain
    // logic rather than components -- referral capture, preview scores. The
    // environment stays 'node': anything needing a DOM belongs in a browser,
    // not in a simulated one.
    include: ['packages/**/*.test.ts', 'services/**/*.test.ts', 'apps/**/*.test.ts'],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@kidpc/shared': r('./packages/shared/src/index.ts'),
      '@kidpc/policy': r('./packages/policy/src/index.ts'),
      '@kidpc/broker': r('./packages/broker/src/index.ts'),
    },
  },
});
