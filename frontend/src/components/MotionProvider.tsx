"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * One switch for reduced motion. With `reducedMotion="user"`, Motion drops
 * transform and layout animation for visitors who ask for less, while
 * components keep a single `initial` state — so the server-rendered HTML and
 * the hydrated tree always agree, and nothing is left stranded at opacity 0.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
