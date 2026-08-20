(function () {
  var root = document.documentElement;
  var storageKey = 'theme';
  var savedTheme = null;

  try {
    savedTheme = window.localStorage.getItem(storageKey);
  } catch (error) {
    savedTheme = null;
  }

  var hasSavedTheme = savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'redwood';
  var prefersDark = false;

  try {
    prefersDark =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (error) {
    prefersDark = false;
  }

  var theme = hasSavedTheme ? savedTheme : prefersDark ? 'dark' : 'light';
  root.dataset.theme = theme;
  root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
})();
