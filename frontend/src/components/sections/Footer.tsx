"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { profile, socials } from "@/content";
import { openCommandMenu } from "@/components/CommandMenu";
import { useModKey } from "@/lib/useModKey";

const TIME_ZONE = "Asia/Kolkata";
const city = profile.location.split(",")[0];

/** Local time where Sahil is, so a visitor knows when a reply is likely. */
function useLocalTime() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: TIME_ZONE,
    });
    const tick = () => setTime(fmt.format(new Date()).toLowerCase());
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  return time;
}

export function Footer() {
  const year = new Date().getFullYear();
  const time = useLocalTime();
  const mod = useModKey();

  return (
    <footer className="border-t border-edge">
      <div className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-14">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1 text-sm">
            <p className="text-ink">
              {time ? (
                <>
                  It&apos;s <span className="tabular-nums">{time}</span> in {city}
                </>
              ) : (
                <>Based in {city}</>
              )}
            </p>
            <p className="text-faint">
              © {year} {profile.name}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {socials.map((s) => (
              <a
                key={s.name}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative text-sm text-dim transition-colors hover:text-ink"
              >
                {s.name}
                <span className="absolute inset-x-0 -bottom-0.5 h-px origin-right scale-x-0 bg-ink transition-transform duration-300 group-hover:origin-left group-hover:scale-x-100" />
              </a>
            ))}
          </div>

          <a
            href="#top"
            className="group flex h-11 w-fit items-center gap-2 rounded-full border border-edge-strong pr-4 pl-3 text-sm text-dim transition-colors hover:border-ink hover:text-ink"
          >
            <span className="relative flex h-4 w-4 overflow-hidden">
              <ArrowUp className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-full" />
              <ArrowUp className="absolute h-4 w-4 translate-y-full transition-transform duration-300 group-hover:translate-y-0" />
            </span>
            Back to top
          </a>
        </div>

        <p className="mt-10 border-t border-edge pt-6 text-xs leading-relaxed text-faint">
          Built with Next.js and Motion, set in Bricolage
          Grotesque and Geist. Press{" "}
          <button
            onClick={openCommandMenu}
            className="rounded border border-edge px-1 font-mono text-dim transition-colors hover:border-edge-strong hover:text-ink"
          >
            {mod} K
          </button>{" "}
          to get around, or open the terminal and type <span className="font-mono text-dim">help</span>.
        </p>
      </div>
    </footer>
  );
}
