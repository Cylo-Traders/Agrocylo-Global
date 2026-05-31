import React from 'react';
import { useTheme } from '../hooks/useTheme';

export default function ThemeToggle() {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();

  return (
    <div className="flex items-center gap-2">
      {/* Icon Button Toggle */}
      <button
        onClick={toggleTheme}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-foreground hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
        title={`Currently ${resolvedTheme} mode (click to toggle)`}
      >
        {resolvedTheme === 'dark' ? (
          <SunIcon className="h-4 w-4" />
        ) : (
          <MoonIcon className="h-4 w-4" />
        )}
      </button>

      {/* Dropdown for explicit selection */}
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
        className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Select theme"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </div>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
      />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
      />
    </svg>
  );
}