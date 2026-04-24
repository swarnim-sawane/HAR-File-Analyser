import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-utils/setupTests.ts'],
    globals: true,
    environmentMatchGlobs: [['backend/src/**/*.test.ts', 'node']],
    include: ['src/**/*.test.{ts,tsx}', 'backend/src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
});
