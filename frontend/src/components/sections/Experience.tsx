"use client";

import { useRef } from "react";
import {
  motion,
  useScroll,
  useSpring,
} from "motion/react";
import { experience } from "@/content";

const firstYear = Math.min(
  ...experience.flatMap((j) => (j.period.match(/\d{4}/g) ?? []).map(Number))
);
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { Rail } from "@/components/ui/Rail";
import { Highlight } from "@/components/ui/Highlight";
import { Tag } from "@/components/ui/Tag";

/**
 * Work is the one section that is genuinely a sequence, so it is the one that
 * gets the drawn spine — dates hang on the left of a continuous rule and the
 * roles run down the right.
 *
 * The rule is drawn by scrolling: a faint track runs the full length and an
 * ink line grows down it as the reader moves through the history, with each
 * role's node filling as the line reaches it. It is motion the visitor causes,
 * which is why it can afford to be this literal.
 */
export function Experience() {
  const listRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: listRef,
    offset: ["start 65%", "end 55%"],
  });
  const drawn = useSpring(scrollYProgress, { stiffness: 140, damping: 30 });

  return (
    <Section id="experience">
      <SectionHeading
        title="Experience"
        meta={`${experience.length} roles since ${firstYear}`}
      />

      <div ref={listRef} className="relative">
        {/* Track + drawn line, on the rail edge (aside width = 8.5rem). */}
        <div
          aria-hidden="true"
          className="absolute top-2 bottom-0 left-[8.5rem] hidden w-px bg-edge sm:block"
        >
          <motion.div
            style={{ scaleY: drawn }}
            className="h-full w-full origin-top bg-ink"
          />
        </div>

        {experience.map((job, i) => (
          <Reveal key={job.company} delay={i * 0.05}>
            <Rail
              contentClassName={
                i < experience.length - 1 ? "relative pb-16 sm:pb-20" : "relative"
              }
              aside={
                <div className="flex items-center gap-2 sm:flex-col sm:items-end sm:gap-1.5 sm:pt-1.5">
                  {job.current && (
                    <span className="rounded-full bg-ink px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-bg">
                      now
                    </span>
                  )}
                  {/* Break a range at its dash, never inside a date. On the
                      rail the end date drops under the start, led by its
                      dash, so both lines stay flush right. */}
                  <span className="font-mono text-xs leading-relaxed text-faint tabular-nums">
                    {job.period.split(/\s+—\s+/).map((part, k) => (
                      <span key={k} className="whitespace-nowrap sm:block">
                        {k > 0 && " —\u00a0"}
                        {part}
                      </span>
                    ))}
                  </span>
                </div>
              }
            >
              {/* Node on the spine, filled once the line passes it. */}
              <motion.span
                aria-hidden="true"
                className="absolute top-[0.6rem] -left-[5px] hidden h-[11px] w-[11px] rounded-full border-2 border-ink sm:block"
                initial={{ backgroundColor: "var(--bg)", scale: 0.6 }}
                whileInView={{ backgroundColor: "var(--ink)", scale: 1 }}
                viewport={{ once: true, margin: "0px 0px -45% 0px" }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />

              <h3 className="font-display text-[1.75rem] leading-tight font-semibold tracking-[-0.025em] text-ink">
                {job.role}
              </h3>
              <p className="mt-1.5 text-[0.9375rem] text-dim">{job.company}</p>

              <p className="mt-5 max-w-[38rem] text-[1.0625rem] leading-relaxed text-ink">
                {job.summary}
              </p>

              <ul className="mt-5 space-y-3">
                {job.highlights.map((h, j) => (
                  <li
                    key={j}
                    className="flex max-w-[40rem] gap-3.5 text-[0.9375rem] leading-relaxed text-dim"
                  >
                    <span className="mt-[0.7rem] h-px w-3 shrink-0 bg-edge-strong" />
                    <span>
                      <Highlight text={h} />
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-6 flex flex-wrap gap-1.5">
                {job.stack.map((s) => (
                  <Tag key={s}>{s}</Tag>
                ))}
              </div>
            </Rail>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
