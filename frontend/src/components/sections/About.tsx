import { profile } from "@/content";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { Rail } from "@/components/ui/Rail";

/**
 * The four-up grid of headline numbers is gone. Standing on their own they
 * read as a dashboard rather than as work, and the same figures already appear
 * where they mean something — inside the sentence that earned them, marked by
 * `Highlight`. `profile.stats` is left in the content file in case it is
 * wanted elsewhere.
 */
export function About() {
  return (
    <Section id="about">
      <SectionHeading title="About" />

      <Reveal>
        <Rail contentClassName="space-y-6">
          {/* The first paragraph is the answer to "who is this"; it is set as
              a lead so a skim stops there, and the rest reads as detail. */}
          {profile.bio.map((p, i) =>
            i === 0 ? (
              <p
                key={i}
                className="max-w-[36rem] font-display text-[1.3125rem] leading-[1.5] font-medium tracking-[-0.01em] text-ink sm:text-[1.5rem]"
              >
                {p}
              </p>
            ) : (
              <p key={i} className="max-w-[38rem] text-[1.0625rem] leading-relaxed text-dim">
                {p}
              </p>
            )
          )}
        </Rail>
      </Reveal>

      <Reveal delay={0.05} className="mt-12 border-t border-edge pt-8">
        <Rail
          aside={
            <p className="font-display text-lg font-semibold tracking-tight text-ink">Education</p>
          }
        >
          <p className="text-[1.0625rem] font-medium text-ink">{profile.education.degree}</p>
          <p className="mt-1 text-sm text-dim">{profile.education.school}</p>
          <p className="mt-1 text-sm text-faint">
            {profile.education.period} · CGPA {profile.education.cgpa}
          </p>
        </Rail>
      </Reveal>
    </Section>
  );
}
