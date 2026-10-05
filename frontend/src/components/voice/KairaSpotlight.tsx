"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LauncherBars } from "./LauncherBars";
import { KAIRA_NAVIGATED } from "@/lib/voice/bus";

const LABELS: Record<string, string> = {
  about: "About",
  experience: "Experience",
  skills: "Stack",
  projects: "Projects",
  contact: "Contact",
};

const SHOW_MS = 3200;

/**
 * When Kaira moves the page, say so. A note drops in under the nav naming
 * where she went, and that section's heading rule redraws in ink — the same
 * line that drew itself when the visitor first scrolled there, now marking
 * "this is what she meant".
 */
export function KairaSpotlight() {
  const [section, setSection] = useState<string | null>(null);

  useEffect(() => {
    let hide = 0;
    const onNavigate = (event: Event) => {
      const id = (event as CustomEvent<{ section: string }>).detail?.section;
      if (!id) return;
      setSection(id);

      const rule = document.querySelector<HTMLElement>(`#${id} [data-heading-rule]`);
      if (rule) {
        rule.classList.remove("kaira-rule");
        // Restart the animation even if it is already running.
        void rule.offsetWidth;
        rule.classList.add("kaira-rule");
        window.setTimeout(() => rule.classList.remove("kaira-rule"), SHOW_MS + 400);
      }

      window.clearTimeout(hide);
      hide = window.setTimeout(() => setSection(null), SHOW_MS);
    };
    window.addEventListener(KAIRA_NAVIGATED, onNavigate);
    return () => {
      window.removeEventListener(KAIRA_NAVIGATED, onNavigate);
      window.clearTimeout(hide);
    };
  }, []);

  return (
    <AnimatePresence>
      {section && (
        <motion.div
          key={section}
          role="status"
          initial={{ opacity: 0, y: -10, x: "-50%", scale: 0.96 }}
          animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
          exit={{ opacity: 0, y: -6, x: "-50%" }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="fixed top-[5.25rem] left-1/2 z-[60] flex w-max items-center gap-2.5 whitespace-nowrap rounded-full border border-edge-strong bg-bg/90 py-2 pr-4 pl-3 text-sm text-dim shadow-lg backdrop-blur-md"
        >
          <span className="text-ink">
            <LauncherBars />
          </span>
          Kaira brought you to
          <span className="font-medium text-ink">{LABELS[section] ?? section}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
