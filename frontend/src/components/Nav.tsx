"use client";

import { useEffect, useState } from "react";
import { Menu, SquareTerminal, X } from "lucide-react";
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useScroll,
  useSpring,
} from "motion/react";
import { nav, profile } from "@/content";
import { useTerminal } from "@/components/terminal/terminal-store";
import { ThemeToggle } from "@/components/ThemeToggle";
import { openCommandMenu } from "@/components/CommandMenu";
import { cn } from "@/lib/utils";
import { useModKey } from "@/lib/useModKey";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Which section is under the reading line, a third of the way down. */
function useActiveSection() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const ids = nav.map((item) => item.href.slice(1));
    const onScroll = () => {
      const line = window.innerHeight * 0.33;
      let current: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      // The last section is short; claim it once the page bottoms out.
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
        current = ids[ids.length - 1];
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return active;
}

/**
 * A floating bar rather than a full-width strip: at the top of the page it is
 * just a quiet row over the hero; once the reader scrolls it gains a surface,
 * and once the hero's big name has left the screen the monogram opens out to
 * carry the name itself, so it is never on screen twice.
 */
export function Nav() {
  const { open } = useTerminal();
  const [scrolled, setScrolled] = useState(false);
  const [pastHero, setPastHero] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const active = useActiveSection();
  const mod = useModKey();

  const { scrollY, scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, {
    stiffness: 200,
    damping: 40,
    restDelta: 0.001,
  });

  useMotionValueEvent(scrollY, "change", (y) => {
    setScrolled(y > 12);
    setPastHero(y > window.innerHeight * 0.55);
  });

  // Close the mobile sheet on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const [first, last] = profile.name.split(" ");
  const raised = scrolled || menuOpen;

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, delay: 0.1, ease: EASE }}
      className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4"
    >
      <div
        className={cn(
          "relative mx-auto max-w-4xl overflow-hidden rounded-2xl border transition-[background-color,border-color,box-shadow] duration-500",
          menuOpen
            ? "border-edge bg-bg shadow-[0_8px_32px_-12px_rgba(0,0,0,0.25)]"
            : raised
            ? "border-edge bg-bg/75 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.25)] backdrop-blur-xl backdrop-saturate-150"
            : "border-transparent bg-transparent"
        )}
      >
        <nav className="flex h-14 items-center justify-between gap-3 pr-2 pl-2.5 sm:pr-2.5">
          <a
            href="#top"
            aria-label={`${profile.name}, back to top`}
            className="group flex items-center gap-2.5 rounded-full py-1 pr-2"
          >
            {/* Monogram inside a ring that fills as the page is read. */}
            <span className="relative flex h-10 w-10 items-center justify-center">
              <svg
                aria-hidden="true"
                viewBox="0 0 40 40"
                className={cn(
                  "absolute inset-0 -rotate-90 transition-opacity duration-300",
                  scrolled ? "opacity-100" : "opacity-0"
                )}
              >
                <circle cx="20" cy="20" r="18.5" fill="none" strokeWidth="1.5" className="stroke-edge" />
                <motion.circle
                  cx="20"
                  cy="20"
                  r="18.5"
                  fill="none"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  className="stroke-ink"
                  style={{ pathLength: progress }}
                />
              </svg>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink font-display text-[0.75rem] font-bold tracking-tight text-bg transition-transform duration-300 group-hover:rotate-[-8deg]">
                {first[0]}
                {last?.[0]}
              </span>
            </span>
            <AnimatePresence initial={false}>
              {pastHero && (
                <motion.span
                  key="name"
                  initial={{ opacity: 0, x: -6, width: 0 }}
                  animate={{ opacity: 1, x: 0, width: "auto" }}
                  exit={{ opacity: 0, x: -6, width: 0 }}
                  transition={{ duration: 0.35, ease: EASE }}
                  className="overflow-hidden font-display text-[0.9375rem] font-semibold tracking-tight whitespace-nowrap text-ink"
                >
                  {profile.name}
                </motion.span>
              )}
            </AnimatePresence>
          </a>

          <div className="hidden items-center md:flex">
            {nav.map((item) => {
              const isActive = active === item.href.slice(1);
              return (
                <a
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "relative isolate rounded-full px-3.5 py-1.5 text-sm transition-colors duration-200",
                    isActive ? "text-ink" : "text-dim hover:text-ink"
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 -z-10 rounded-full bg-surface-2 ring-1 ring-edge"
                      transition={{ type: "spring", stiffness: 420, damping: 36 }}
                    />
                  )}
                  {item.label}
                </a>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={openCommandMenu}
              aria-label="Open command menu"
              className="hidden h-9 items-center gap-2 rounded-full border border-edge pr-1.5 pl-3.5 text-sm text-faint transition-colors hover:border-edge-strong hover:text-ink sm:flex"
            >
              Search
              <kbd className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-dim">
                {mod} K
              </kbd>
            </button>

            <button
              onClick={() => open()}
              aria-label="Open the terminal"
              title="Terminal"
              className="hidden h-9 w-9 items-center justify-center rounded-full border border-edge text-dim transition-colors hover:border-edge-strong hover:text-ink sm:flex"
            >
              <SquareTerminal className="h-4 w-4" />
            </button>

            <ThemeToggle />

            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-edge text-dim transition-colors hover:text-ink md:hidden"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={menuOpen ? "x" : "menu"}
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
        </nav>

        {/* Mobile sheet: grows out of the bar itself. */}
        <AnimatePresence initial={false}>
          {menuOpen && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: "auto" }}
              exit={{ height: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="md:hidden"
            >
              <div className="flex flex-col border-t border-edge px-4 pt-3 pb-4">
                {nav.map((item, i) => (
                  <motion.a
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.04 * i + 0.08, ease: EASE }}
                    className={cn(
                      "py-2 font-display text-[1.75rem] font-semibold tracking-[-0.02em]",
                      active === item.href.slice(1) ? "text-ink" : "text-faint"
                    )}
                  >
                    {item.label}
                  </motion.a>
                ))}
                <div className="mt-3 flex gap-2 border-t border-edge pt-4">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      openCommandMenu();
                    }}
                    className="flex h-10 flex-1 items-center justify-center rounded-full border border-edge text-sm text-dim"
                  >
                    Search
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      open();
                    }}
                    className="flex h-10 flex-1 items-center justify-center gap-2 rounded-full border border-edge text-sm text-dim"
                  >
                    <SquareTerminal className="h-4 w-4" />
                    Terminal
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </motion.header>
  );
}
