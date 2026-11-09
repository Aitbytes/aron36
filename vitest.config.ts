import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    restoreMocks: true,
    clearMocks: true,
    // Les worktrees de travail (agents en parallèle) contiennent des copies du
    // dépôt : sans exclusion, Vitest ramasse leurs tests et fausse le total.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/types.ts',
        'src/**/index.ts',
        'src/application/ports/**',
        'src/main.tsx',
        'src/test/**',
        'src/**/*.test.{ts,tsx}',
      ],
    },
  },
});
