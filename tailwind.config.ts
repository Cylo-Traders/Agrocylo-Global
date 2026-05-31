import type { Config } from 'tailwindcss';

const config: Config = {
  // ... existing config ...
  
  darkMode: 'class', // Use class-based dark mode (not media query)
  
  theme: {
    extend: {
      colors: {
        // Light mode semantic colors
        background: {
          DEFAULT: '#ffffff',
          secondary: '#f8fafc',
          tertiary: '#f1f5f9',
        },
        foreground: {
          DEFAULT: '#0f172a',
          secondary: '#475569',
          muted: '#94a3b8',
        },
        border: {
          DEFAULT: '#e2e8f0',
          strong: '#cbd5e1',
        },
        primary: {
          DEFAULT: '#16a34a', // Agrocylo green
          foreground: '#ffffff',
          hover: '#15803d',
        },
        accent: {
          DEFAULT: '#22c55e',
          foreground: '#ffffff',
        },
        // Dark mode semantic colors 
        // define as CSS custom properties for flexibility
      },
    },
  },
  
  plugins: [
    // ... existing plugins ...
  ],
};

export default config;