"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";

/* Pull the impact metrics out of the prose so they land at a glance. */
/* Deliberately narrow: a latency, a percentage, or an "N+" count. A bare
   number would sweep up hardware names and years — RTX 3090, 2025. */
const METRIC_SPLIT = /(sub-second|sub-\d+\s?ms|\d[\d,]*%\+?|\d[\d,]*\+)/gi;
const IS_METRIC = /^(sub-second|sub-\d+\s?ms|\d[\d,]*%\+?|\d[\d,]*\+)$/i;

const metricClass =
  "font-semibold text-ink tabular-nums underline decoration-edge-strong decoration-2 underline-offset-[3px]";

/**
 * A metric that counts up to itself the first time it scrolls into view.
 *
 * The server renders the final figure, so it reads correctly without
 * JavaScript and to crawlers; the count only runs for a metric that starts
 * below the fold, so nobody watches a visible number reset to zero.
 */
function Metric({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const armed = useRef(false);

  const match = value.match(/^(\D*)(\d[\d,]*)(.*)$/);

  useEffect(() => {
    const el = ref.current;
    if (!el || !match || reduce) return;
    // Only arm metrics that are not already on screen at mount.
    if (el.getBoundingClientRect().top > window.innerHeight) {
      armed.current = true;
      el.textContent = `${match[1]}0${match[3]}`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !match || !inView || !armed.current) return;
    const target = Number(match[2].replace(/,/g, ""));
    const grouped = match[2].includes(",");
    const controls = animate(0, target, {
      duration: 1.4,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        const n = Math.round(v);
        el.textContent = `${match[1]}${grouped ? n.toLocaleString("en-US") : n}${match[3]}`;
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView]);

  return (
    <span ref={ref} className={metricClass}>
      {value}
    </span>
  );
}

export function Highlight({ text }: { text: string }): ReactNode {
  return (
    <>
      {text.split(METRIC_SPLIT).map((part, i) =>
        IS_METRIC.test(part) ? (
          <Metric key={i} value={part} />
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}
