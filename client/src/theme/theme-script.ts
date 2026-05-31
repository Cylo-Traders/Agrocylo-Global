/**
 * Theme initialization script.
 * Runs synchronously in <head> to prevent flash of wrong theme.
 * Must be inlined — no external dependencies.
 */
export const themeScript = `
(function() {
  function getTheme() {
    const stored = localStorage.getItem('agrocylo-theme');
    if (stored === 'dark' || stored === 'light') return stored;
    
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }
  
  const theme = getTheme();
  const root = document.documentElement;
  
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  
  root.style.colorScheme = theme;
})();
`;