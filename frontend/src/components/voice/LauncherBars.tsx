"use client";

import { useEffect, useRef } from "react";
import { voiceBus } from "@/lib/voice/bus";

const BARS = 4;

/**
 * The launcher's icon is a tiny live meter. At rest the bars drift at a
 * murmur so the button reads as a voice, not a menu; in a call they follow
 * Kaira's actual output, so the button shows she's talking even with the panel
 * closed or the page scrolled away.
 */
export function LauncherBars({ className }: { className?: string }) {
  const refs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const heights = new Array(BARS).fill(0.35);
    let raf = 0;

    const tick = (t: number) => {
      for (let i = 0; i < BARS; i++) {
        let target: number;
        if (voiceBus.active && voiceBus.speaking) {
          // Each bar takes the level with its own wobble, so they don't move as one.
          const wobble = 0.55 + 0.45 * Math.sin(t * 0.018 + i * 1.7);
          target = 0.25 + voiceBus.level * wobble * 0.95;
        } else if (voiceBus.active && voiceBus.thinking) {
          // A travelling ripple: "working on it".
          target = 0.3 + 0.35 * Math.max(0, Math.sin(t * 0.008 - i * 0.9));
        } else if (voiceBus.active) {
          target = 0.22;
        } else {
          target = reduce ? 0.45 : 0.3 + 0.22 * (0.5 + 0.5 * Math.sin(t * 0.0024 + i * 1.3));
        }
        heights[i] += (Math.min(1, target) - heights[i]) * 0.25;
        const el = refs.current[i];
        if (el) el.style.transform = `scaleY(${heights[i].toFixed(3)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <span aria-hidden="true" className={`flex h-4 items-center gap-[3px] ${className ?? ""}`}>
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="block h-full w-[2.5px] origin-center rounded-full bg-current"
          style={{ transform: "scaleY(0.35)" }}
        />
      ))}
    </span>
  );
}
