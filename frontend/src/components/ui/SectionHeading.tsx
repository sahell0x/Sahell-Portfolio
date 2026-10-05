"use client";

import { motion } from "motion/react";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Section titles are the page's top level and are sized like it.
 *
 * On arrival the title rises out of a mask and the rule under it draws from
 * the left edge — the same gesture as the hero name, at section scale, so
 * every section opens the same way the page did.
 */
export function SectionHeading({
  title,
  blurb,
  blurbClassName,
  meta,
}: {
  title: string;
  blurb?: string;
  blurbClassName?: string;
  /** A fact about the section, set opposite the title — "3 roles", not decoration. */
  meta?: string;
}) {
  const view = { once: true, margin: "-80px" } as const;

  return (
    <div className="mb-10 sm:mb-14">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h2 className="overflow-hidden pb-[0.1em] font-display text-[2.5rem] leading-[1] font-semibold tracking-[-0.035em] text-ink sm:text-6xl">
          <motion.span
            className="inline-block"
            initial={{ y: "110%" }}
            whileInView={{ y: 0 }}
            viewport={view}
            transition={{ duration: 0.9, ease: EASE }}
          >
            {title}
          </motion.span>
        </h2>
        {meta && (
          <motion.p
            className="pb-1.5 text-sm text-faint tabular-nums"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={view}
            transition={{ duration: 0.8, delay: 0.35 }}
          >
            {meta}
          </motion.p>
        )}
      </div>
      {blurb && (
        <motion.p
          className={`mt-4 max-w-xl text-dim ${blurbClassName ?? ""}`}
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={view}
          transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
        >
          {blurb}
        </motion.p>
      )}
      <motion.div
        data-heading-rule
        className="mt-7 h-px w-full origin-left bg-edge"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={view}
        transition={{ duration: 1.2, delay: 0.1, ease: EASE }}
      />
    </div>
  );
}
