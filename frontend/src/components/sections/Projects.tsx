import { projects } from "@/content";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { Rail } from "@/components/ui/Rail";
import { Highlight } from "@/components/ui/Highlight";
import { Tag } from "@/components/ui/Tag";
import { ArrowUpRight } from "lucide-react";
import { GithubIcon } from "@/components/ui/BrandIcons";

/**
 * Projects share the rail with everything else but deliberately not its rule:
 * these are a set, not a sequence. The aside used to carry "01 / 02", which
 * claimed an order that isn't there; it now carries what kind of project each
 * one is, which is the thing a skim actually wants.
 */
export function Projects() {
  return (
    <Section id="projects">
      <SectionHeading title="Projects" meta={`${projects.length} selected`} />

      {projects.map((project, i) => (
        <Reveal
          key={project.slug}
          delay={i * 0.05}
          className={
            i < projects.length - 1
              ? "mb-16 border-b border-edge pb-16 sm:mb-20 sm:pb-20"
              : undefined
          }
        >
          <Rail
            aside={
              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-faint sm:flex-col sm:items-end sm:pt-2.5">
                {project.tags.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            }
          >
            <div className="flex items-start justify-between gap-6">
              <div>
                <h3 className="font-display text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.03em] text-ink sm:text-[2.75rem]">
                  {project.name}
                </h3>
                <p className="mt-2 text-[0.9375rem] text-dim">
                  {project.tagline}
                </p>
              </div>

              <div className="mt-1.5 flex shrink-0 items-center gap-2">
                {project.links.demo && (
                  <a
                    href={project.links.demo}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${project.name} live demo`}
                    className="group flex h-11 items-center gap-1.5 rounded-full bg-ink pr-3.5 pl-4 text-sm font-medium text-bg transition-opacity duration-300 hover:opacity-85"
                  >
                    Live
                    {/* The arrow leaves through the corner and a fresh one
                        arrives behind it — same gesture as the hero buttons. */}
                    <span className="relative flex h-4 w-4 overflow-hidden">
                      <ArrowUpRight className="h-4 w-4 transition-transform duration-300 ease-out group-hover:translate-x-full group-hover:-translate-y-full" />
                      <ArrowUpRight className="absolute h-4 w-4 -translate-x-full translate-y-full transition-transform duration-300 ease-out group-hover:translate-x-0 group-hover:translate-y-0" />
                    </span>
                  </a>
                )}
                {project.links.github && (
                  <a
                    href={project.links.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${project.name} on GitHub`}
                    className="group flex h-11 w-11 items-center justify-center rounded-full border border-edge-strong text-dim transition-[color,background-color,border-color,transform] duration-300 hover:rotate-[-8deg] hover:border-ink hover:bg-ink hover:text-bg"
                  >
                    <GithubIcon className="h-[18px] w-[18px]" />
                  </a>
                )}
              </div>
            </div>

            <p className="mt-6 max-w-[38rem] text-[1.0625rem] leading-relaxed text-ink">
              {project.description}
            </p>

            {project.features ? (
              <ul className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2">
                {project.features.map((f) => (
                  <li key={f.title}>
                    <h4 className="flex items-center gap-2.5 text-[0.9375rem] font-semibold text-ink">
                      <span className="h-px w-3 shrink-0 bg-ink" />
                      {f.title}
                    </h4>
                    <p className="mt-1.5 text-[0.875rem] leading-relaxed text-dim">
                      {f.detail}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="mt-5 space-y-3">
                {project.highlights.map((h, j) => (
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
            )}

            <div className="mt-8 flex flex-wrap gap-1.5">
              {project.stack.map((s) => (
                <Tag key={s}>{s}</Tag>
              ))}
            </div>
          </Rail>
        </Reveal>
      ))}
    </Section>
  );
}
