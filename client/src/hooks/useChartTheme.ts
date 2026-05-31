import { useTheme } from './useTheme';

export interface ChartTheme {
  background: string;
  foreground: string;
  grid: string;
  primary: string;
  secondary: string;
  accent: string;
  tooltip: {
    background: string;
    foreground: string;
    border: string;
  };
}

export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();

  const isDark = resolvedTheme === 'dark';

  return {
    background: isDark ? '#020617' : '#ffffff',
    foreground: isDark ? '#f8fafc' : '#0f172a',
    grid: isDark ? '#334155' : '#e2e8f0',
    primary: isDark ? '#22c55e' : '#16a34a',
    secondary: isDark ? '#4ade80' : '#22c55e',
    accent: isDark ? '#86efac' : '#16a34a',
    tooltip: {
      background: isDark ? '#1e293b' : '#ffffff',
      foreground: isDark ? '#f8fafc' : '#0f172a',
      border: isDark ? '#475569' : '#e2e8f0',
    },
  };
}