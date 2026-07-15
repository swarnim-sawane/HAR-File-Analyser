import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-utils/setupTests.ts'],
    globals: true,
    testTimeout: 10000,
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
});
