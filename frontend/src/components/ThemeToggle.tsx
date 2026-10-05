"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import {
  getServerTheme,
  getTheme,
  setTheme,
  subscribeTheme,
} from "@/lib/theme";

/**
 * Light/dark switch. The site follows the OS until the visitor picks for
 * themselves; from then on the choice is remembered and wins over the OS.
 * The terminal's `theme` command drives the same store, so the two agree.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);

  return (
    <button
      type="button"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={
        theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
      }
      className={`flex h-9 w-9 items-center justify-center rounded-full border border-edge text-dim transition-colors hover:border-edge-strong hover:text-ink ${className ?? ""}`}
    >
      {/* No icon until hydration: the server cannot know the visitor's theme. */}
      {theme === null ? null : theme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </button>
  );
}
