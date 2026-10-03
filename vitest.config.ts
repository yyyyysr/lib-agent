import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/desktop/src/core/**/*.test.ts',
      'apps/desktop/src/main/**/*.test.ts',
    ],
    environment: 'node',
  },
});
