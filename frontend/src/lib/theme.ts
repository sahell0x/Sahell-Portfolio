export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";
const QUERY = "(prefers-color-scheme: dark)";

/**
 * The theme lives outside React: a stored choice if the visitor made one,
 * otherwise whatever the OS asks for. Keeping it in an external store means
 * the nav toggle and the terminal's `theme` command drive the same state,
 * with no component copy to fall out of sync.
 *
 * The `data-theme` attribute is set before first paint by an inline script in
 * the document head (see `app/layout.tsx`); everything here keeps it current.
 */
const listeners = new Set<() => void>();

export function subscribeTheme(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  window.addEventListener("storage", onChange); // another tab
  listeners.add(onChange);
  return () => {
    mq.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
    listeners.delete(onChange);
  };
}

export function systemTheme(): Theme {
  return window.matchMedia(QUERY).matches ? "dark" : "light";
}

/** The visitor's explicit choice, or null when following the OS. */
export function getThemeChoice(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* private mode — treat as no choice */
  }
  return null;
}

/** What is actually on screen right now. */
export function getTheme(): Theme {
  return getThemeChoice() ?? systemTheme();
}

/** The server cannot know the visitor's theme. */
export const getServerTheme = () => null;

/** Pass null to clear the choice and follow the OS again. */
export function setTheme(next: Theme | null) {
  const root = document.documentElement;
  try {
    if (next) {
      root.dataset.theme = next;
      localStorage.setItem(STORAGE_KEY, next);
    } else {
      delete root.dataset.theme;
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* private mode — the choice applies but won't persist */
    if (next) root.dataset.theme = next;
    else delete root.dataset.theme;
  }
  listeners.forEach((l) => l());
}
