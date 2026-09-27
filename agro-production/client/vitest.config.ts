import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Issue #1041: a duplicate React installation makes React's internal
    // dispatcher a different object per copy, so a hook called by a component
    // from one copy and a renderer from the other throws "Invalid hook call".
    // dedupe forces every import -- app code, Testing Library, Radix, Sentry --
    // to resolve to one hoisted copy. This is the defensive half of the fix;
    // the root package.json `overrides` are the half that actually collapses
    // the tree. `react/jsx-runtime` is included because the automatic JSX
    // runtime is a separate module that would otherwise resolve separately.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
