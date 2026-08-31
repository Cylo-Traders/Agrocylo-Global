import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Ensure the workspace-hoisted React copy is the only one seen by both
    // the component tree and @testing-library/react. Without this, two
    // React instances can coexist in the monorepo node_modules tree, causing
    // ReactCurrentDispatcher to be null and all hook calls to throw.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
    alias: {
      'next/link': path.resolve(__dirname, './__mocks__/next-link.tsx'),
      'next/navigation': path.resolve(__dirname, './__mocks__/next-navigation.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './setup.ts',
    include: ['src/**/*.test.{ts,tsx}'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});