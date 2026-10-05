import { experience, projects, skillGroups } from "@/content";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { Rail } from "@/components/ui/Rail";
import { Tag } from "@/components/ui/Tag";

/* "React.js", "React" and "react" are the same thing; so are "Tailwind" and
   "Tailwind CSS". Normalise before comparing. */
const norm = (s: string) =>
  s.toLowerCase().replace(/\.js\b/g, "").replace(/[^a-z0-9+]/g, "");

/** The jobs and projects whose own stack lists this skill. */
function usedIn(skill: string): string[] {
  const keys = [
    norm(skill),
    // "LLMs (OpenAI, Gemini)" is evidenced by either name in the brackets.
    ...(skill.match(/\(([^)]+)\)/)?.[1].split(",").map(norm) ?? []),
  ].filter(Boolean);

  const matches = (item: string) => {
    const n = norm(item);
    return keys.some(
      (k) => k === n || (k.length > 3 && n.length > 3 && (n.includes(k) || k.includes(n)))
    );
  };

  return [
    ...experience.filter((j) => j.stack.some(matches)).map((j) => j.company),
    ...projects.filter((p) => p.stack.some(matches)).map((p) => p.name),
  ];
}

/**
 * Every skill carries the same weight. What a tag adds on hover or focus is
 * evidence: where on this page that skill was actually used.
 */
export function Skills() {
  return (
    <Section id="skills">
      <SectionHeading
        title="Stack"
        meta={`${new Set(skillGroups.flatMap((g) => g.items)).size} tools`}
        blurb="Hover a tool to see where I've used it."
        blurbClassName="max-sm:hidden"
      />

      <dl>
        {skillGroups.map((group, i) => (
          <Reveal
            key={group.key}
            delay={i * 0.04}
            /* The rule separates groups, so the first one does without. */
            className={i === 0 ? "pb-6" : "border-t border-edge py-6"}
          >
            <Rail
              aside={
                <dt className="font-display text-lg font-semibold tracking-tight text-ink sm:pt-0.5">
                  {group.label}
                </dt>
              }
            >
              <dd className="flex flex-wrap gap-2">
                {group.items.map((item) => {
                  const where = usedIn(item);
                  if (where.length === 0) {
                    return (
                      <Tag key={item} strong>
                        {item}
                      </Tag>
                    );
                  }
                  return (
                    <span
                      key={item}
                      tabIndex={0}
                      aria-label={`${item}, used at ${where.join(", ")}`}
                      className="group/tip relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                    >
                      <Tag strong>{item}</Tag>
                      <span
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full left-1/2 z-20 max-sm:hidden mb-2.5 w-max max-w-[16rem] -translate-x-1/2 translate-y-1 rounded-lg border border-edge-strong bg-bg px-3 py-2 text-xs leading-snug text-dim opacity-0 shadow-lg transition-[opacity,transform] duration-200 group-hover/tip:translate-y-0 group-hover/tip:opacity-100 group-focus-visible/tip:translate-y-0 group-focus-visible/tip:opacity-100"
                      >
                        <span className="text-faint">Used at </span>
                        <span className="text-ink">{where.join(", ")}</span>
                      </span>
                    </span>
                  );
                })}
              </dd>
            </Rail>
          </Reveal>
        ))}
      </dl>
    </Section>
  );
}
