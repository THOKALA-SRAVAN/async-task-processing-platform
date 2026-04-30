import { defineConfig } from 'vitest/config';
import { config as loadDotenv } from 'dotenv';

// Load test env before any module sees process.env — must run before vitest
// imports config/index.ts (which calls dotenv.config() without override: true)
loadDotenv({ path: '.env.test', override: true });

export default defineConfig({
  test: {
    globals:      true,
    environment:  'node',
    globalSetup:  './src/__tests__/setup/global.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: [
        'src/services/**/*.ts',
        'src/api/**/*.ts',
        'src/repositories/**/*.ts',
        'src/worker/processors/**/*.ts',
      ],
      exclude: ['src/__tests__/**'],
    },
  },
});
