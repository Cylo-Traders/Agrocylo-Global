import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
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