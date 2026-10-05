"use client";

import { ArrowDown, Mail } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { experience, profile, socials } from "@/content";
import { useTerminal } from "@/components/terminal/terminal-store";
import {
  GithubIcon,
  LeetCodeIcon,
  LinkedinIcon,
} from "@/components/ui/BrandIcons";
import { Rail } from "@/components/ui/Rail";
import { Signal } from "@/components/ui/Signal";
import { useSyncExternalStore } from "react";
import {
  subscribeVoiceBus,
  voiceBusServerSnapshot,
  voiceBusSnapshot,
} from "@/lib/voice/bus";

const KAIRA_STATE: Record<string, string> = {
  speaking: "Kaira is speaking",
  thinking: "Kaira is thinking",
  listening: "Kaira is listening",
};

const socialIcon: Record<string, React.ElementType> = {
  github: GithubIcon,
  linkedin: LinkedinIcon,
  leetcode: LeetCodeIcon,
  email: Mail,
};

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The page's one orchestrated entrance. The name rises letter by letter out of
 * its own baseline, the signal draws in under it, and only then does the
 * detail settle — so the first second has a single thing to watch.
 *
 * The second line of the name is indented to the rail edge that every section
 * below hangs from, so the hero is already on the page's grid rather than
 * floating above it.
 */
export function Hero() {
  const { open } = useTerminal();
  const kaira = useSyncExternalStore(
    subscribeVoiceBus,
    voiceBusSnapshot,
    voiceBusServerSnapshot,
  );
  const current = experience.find((job) => job.current);
  const [first, ...rest] = profile.name.split(" ");
  const lines = [first, rest.join(" ")];

  // Each letter's delay continues across both lines.
  let letterIndex = 0;
  const lettersDone = 0.25 + profile.name.length * 0.045;

  const settle = (delay: number) => ({
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay: lettersDone + delay, ease: EASE },
  });

  return (
    <section
      id="top"
      className="mx-auto w-full max-w-4xl px-5 pt-28 pb-10 sm:px-8 sm:pt-28 sm:pb-12"
    >
      <h1
        aria-label={profile.name}
        className="font-display text-[clamp(4.25rem,22vw,10.5rem)] leading-[0.86] font-bold tracking-[-0.045em] text-ink"
      >
        {lines.map((line, li) => (
          <span
            key={li}
            aria-hidden="true"
            className={li === 1 ? "block sm:pl-[9.6rem]" : "block"}
          >
            {line.split("").map((ch) => {
              const delay = 0.15 + letterIndex++ * 0.045;
              return (
                // Mask only the bottom edge: the letter rises out of its
                // baseline, but at this tracking neighbouring glyphs overlap,
                // so clipping the sides (overflow-hidden) shaved the K's arms
                // where the h begins. The padding gives descenders room.
                <span
                  key={`${li}-${delay}`}
                  className="-mb-[0.12em] inline-block pb-[0.12em] [clip-path:inset(-0.3em_-0.3em_0_-0.3em)]"
                >
                  <motion.span
                    className="inline-block"
                    initial={{ y: "105%" }}
                    animate={{ y: 0 }}
                    transition={{ duration: 0.9, delay, ease: EASE }}
                  >
                    {ch}
                  </motion.span>
                </span>
              );
            })}
          </span>
        ))}
      </h1>

      <motion.div
        className="relative mt-2 -mx-5 sm:mt-3 sm:-mx-8"
        initial={{ opacity: 0, clipPath: "inset(0 100% 0 0)" }}
        animate={{ opacity: 1, clipPath: "inset(0 0% 0 0)" }}
        transition={{ duration: 1.4, delay: lettersDone - 0.35, ease: EASE }}
      >
        <Signal className="block h-20 w-full sm:h-24" />
        {/* While a call is open the line is her voice; say so. */}
        <AnimatePresence>
          {kaira !== "off" && (
            <motion.p
              key="kaira"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute top-0 left-5 font-mono text-xs text-faint sm:left-8"
            >
              {KAIRA_STATE[kaira]}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>

      <Rail
        className="mt-4 sm:mt-6"
        aside={
          <motion.div
            {...settle(0)}
            className="flex items-center gap-x-4 gap-y-1 text-sm sm:flex-col sm:items-end sm:pt-1.5"
          >
            <span className="flex items-center gap-2 text-ink">
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-ink opacity-40 motion-reduce:hidden" />
                <span className="relative h-2 w-2 rounded-full bg-ink" />
              </span>
              Available
            </span>
            <span className="text-faint">{profile.location}</span>
          </motion.div>
        }
      >
        <motion.p
          {...settle(0.05)}
          className="font-display text-2xl leading-snug font-medium tracking-[-0.015em] text-ink sm:text-[1.75rem]"
        >
          {profile.title}
          {current && (
            <>
              {" "}
              {/* Breaks as one unit, so the company never splits across lines. */}
              <span className="whitespace-nowrap text-faint">
                at {current.company}
              </span>
            </>
          )}
        </motion.p>

        <motion.p
          {...settle(0.12)}
          className="mt-4 max-w-[34rem] text-[1.0625rem] leading-relaxed text-dim"
        >
          {profile.tagline}
        </motion.p>

        <motion.div
          {...settle(0.2)}
          className="mt-8 flex flex-wrap items-center gap-3"
        >
          <a
            href={profile.resumeUrl}
            download
            className="group inline-flex items-center justify-center gap-2.5 rounded-full border border-ink bg-ink py-3 pr-4 pl-5 text-sm font-medium text-bg transition-transform active:scale-[0.97] max-sm:flex-[1.4] whitespace-nowrap sm:pr-5 sm:pl-6"
          >
            Download résumé
            <span className="relative flex h-4 w-4 overflow-hidden">
              <ArrowDown className="h-4 w-4 transition-transform duration-300 ease-out group-hover:translate-y-full" />
              <ArrowDown className="absolute h-4 w-4 -translate-y-full transition-transform duration-300 ease-out group-hover:translate-y-0" />
            </span>
          </a>
          <a
            href="#contact"
            className="group/btn relative isolate inline-flex items-center justify-center overflow-hidden rounded-full border border-edge-strong px-4 py-3 text-sm text-ink transition-colors duration-300 hover:text-bg active:scale-[0.97] max-sm:flex-1 whitespace-nowrap sm:px-6"
          >
            {/* Fill rises from below on hover. */}
            <span className="absolute inset-0 -z-10 translate-y-full rounded-full bg-ink transition-transform duration-300 ease-out group-hover/btn:translate-y-0" />
            Get in touch
          </a>
        </motion.div>

        <motion.div
          {...settle(0.28)}
          className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4"
        >
          <div className="flex items-center gap-1">
            {socials.map((s) => {
              const Icon = socialIcon[s.cmd] ?? Mail;
              return (
                <a
                  key={s.name}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.name}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-faint transition-[color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-surface-2 hover:text-ink"
                >
                  <Icon className="h-[18px] w-[18px]" />
                </a>
              );
            })}
          </div>

          <button
            onClick={() => open()}
            className="group flex items-center gap-2 font-mono text-xs text-faint transition-colors hover:text-ink"
          >
            <span className="rounded border border-edge-strong px-1.5 py-0.5 text-dim transition-colors group-hover:border-ink group-hover:text-ink">
              ~/
            </span>
            this site is also a shell
          </button>
        </motion.div>
      </Rail>
    </section>
  );
}
