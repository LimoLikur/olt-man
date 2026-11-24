// Applies the stored colour theme before the first paint, so a dark-theme user never sees a light
// flash. A classic blocking script in <head>: the CSP (script-src 'self') allows no inline script,
// and the module bundle runs too late. Same key and rules as src/theme.ts.
(() => {
  let preference = null;
  try {
    preference = localStorage.getItem('oltman.theme');
  } catch {
    // Storage blocked (private mode, site data off): follow the system theme.
  }
  const dark = preference === 'dark' || (preference !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
