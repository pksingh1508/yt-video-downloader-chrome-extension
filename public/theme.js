// Apply appearance before rendering, including when served with a strict CSP.
(() => {
  let theme = 'system';
  try {
    theme = localStorage.getItem('postready-theme') || 'system';
  } catch {}
  const dark =
    theme === 'dark' ||
    (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark
    ? '#141413'
    : '#f8f7f4';
})();
