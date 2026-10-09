import type { ReactNode } from "react";
import { profile, skillGroups, experience, projects, socials } from "@/content";
import { getThemeChoice, setTheme, systemTheme } from "@/lib/theme";

/* ------------------------------------------------------------------ *
 *  Command context — side-effects the engine hands to each command.
 * ------------------------------------------------------------------ */
export interface CommandContext {
  /** run another command programmatically (used by clickable hints) */
  run: (cmd: string) => void;
  clear: () => void;
  close: () => void;
  openUrl: (url: string) => void;
  download: (url: string) => void;
  /** close the terminal and scroll to a page section */
  navigate: (section: string) => void;
  /** current command history (most recent last) */
  getHistory: () => string[];
}

interface Command {
  name: string;
  aliases?: string[];
  description: string;
  hidden?: boolean;
  run: (args: string[], ctx: CommandContext) => ReactNode;
}

/* ------------------------------------------------------------------ *
 *  Small presentational helpers for command output.
 * ------------------------------------------------------------------ */
function Chip({
  cmd,
  ctx,
  label,
}: {
  cmd: string;
  ctx: CommandContext;
  label?: string;
}) {
  return (
    <button
      onClick={() => ctx.run(cmd)}
      className="rounded border border-edge bg-surface-2 px-1.5 text-ink transition-colors hover:border-edge-strong hover:text-ink"
    >
      {label ?? cmd}
    </button>
  );
}

function Tags({ items }: { items: string[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span
          key={t}
          className="rounded border border-edge bg-surface px-1.5 py-0.5 text-[11px] text-dim"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-ink underline underline-offset-2 decoration-edge-strong hover:decoration-current"
    >
      {children}
    </a>
  );
}

/* ------------------------------------------------------------------ *
 *  Commands
 * ------------------------------------------------------------------ */
const commands: Command[] = [
  {
    name: "help",
    description: "list all available commands",
    run: (_args, ctx) => (
      <div>
        <p className="text-dim">Available commands — click one or type it:</p>
        <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {commands
            .filter((c) => !c.hidden)
            .map((c) => (
              <div key={c.name} className="contents">
                <button
                  onClick={() => ctx.run(c.name)}
                  className="text-left text-ink hover:underline"
                >
                  {c.name}
                </button>
                <span className="text-faint">{c.description}</span>
              </div>
            ))}
        </div>
        <p className="mt-3 text-faint">
          Tip: <span className="text-dim">→</span> or{" "}
          <span className="text-dim">Tab</span> accepts the suggestion,{" "}
          <span className="text-dim">↑ / ↓</span> walks history,{" "}
          <span className="text-dim">cd &lt;section&gt;</span> jumps around,{" "}
          <span className="text-dim">exit</span> returns to the site.
        </p>
      </div>
    ),
  },
  {
    name: "whoami",
    description: "quick intro",
    run: () => (
      <div className="space-y-1">
        <p>
          <span className="text-ink">{profile.name}</span>{" "}
          <span className="text-faint">— {profile.title}</span>
        </p>
        <p className="text-dim">{profile.tagline}</p>
        <p className="text-faint">
          <span className="text-ink">location</span> {profile.location}
          {"   "}
          <span className="text-ink">status</span> {profile.availability}
        </p>
      </div>
    ),
  },
  {
    name: "about",
    description: "the longer story",
    run: () => (
      <div className="space-y-2 text-dim">
        {profile.bio.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        <p className="pt-1 text-faint">
          <span className="text-ink">education</span>{" "}
          {profile.education.degree}, {profile.education.school} (
          {profile.education.period}, CGPA {profile.education.cgpa}).
        </p>
      </div>
    ),
  },
  {
    name: "skills",
    aliases: ["stack"],
    description: "tech I work with",
    run: (args) => {
      const filter = args[0]?.toLowerCase();
      const groups = filter
        ? skillGroups.filter(
            (g) => g.key === filter || g.label.toLowerCase().includes(filter)
          )
        : skillGroups;
      if (groups.length === 0) {
        return (
          <p className="text-dim">
            no skill group “{filter}”. try: {skillGroups.map((g) => g.key).join(", ")}
          </p>
        );
      }
      return (
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g.key}>
              <span className="text-ink">
                {g.label.padEnd(14, " ")}
              </span>
              <span className="text-dim">{g.items.join(" · ")}</span>
            </div>
          ))}
        </div>
      );
    },
  },
  {
    name: "experience",
    aliases: ["work", "cv"],
    description: "where I've worked",
    run: () => (
      <div className="space-y-4">
        {experience.map((job) => (
          <div key={job.company}>
            <p>
              <span className="text-ink">{job.role}</span>
              <span className="text-faint"> @ {job.company}</span>
            </p>
            <p className="text-faint">{job.period}</p>
            <ul className="mt-1 space-y-0.5 text-dim">
              {job.highlights.map((h, i) => (
                <li key={i}>
                  <span className="text-dim">›</span> {h}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    ),
  },
  {
    name: "projects",
    aliases: ["proj"],
    description: "things I've built",
    run: (_args, ctx) => (
      <div className="space-y-2">
        {projects.map((p, i) => (
          <div key={p.slug}>
            <p>
              <span className="text-faint">{i + 1}.</span>{" "}
              <span className="text-ink">{p.name}</span>{" "}
              <span className="text-faint">— {p.tagline}</span>
            </p>
          </div>
        ))}
        <p className="pt-1 text-faint">
          run <Chip cmd="open hootpr" ctx={ctx} label="open <name>" /> for
          details.
        </p>
      </div>
    ),
  },
  {
    name: "ls",
    description: "list directories — ls, ls skills, ls projects…",
    run: (args, ctx) => {
      const dirs = ["about", "experience", "skills", "projects", "contact"];
      const dir = (args[0] ?? "").toLowerCase().replace(/\/+$/, "");
      if (!dir || dir === "~" || dir === "." || dir === "/") {
        return (
          <p className="text-dim">
            {dirs.map((d) => (
              <span key={d} className="text-dim">
                {d}/{"  "}
              </span>
            ))}
            <span className="text-ink">resume.pdf</span>
          </p>
        );
      }
      const target = resolveCommand(dir);
      if (dirs.includes(dir) && target) {
        return target.run([], ctx);
      }
      return (
        <p className="text-dim">
          ls: cannot access &apos;{args[0]}&apos;: no such directory
        </p>
      );
    },
  },
  {
    name: "open",
    aliases: ["cat", "view"],
    description: "open a project — open <name>",
    run: (args, ctx) => {
      const q = (args[0] ?? "").toLowerCase();
      if (!q) {
        return (
          <p className="text-dim">
            usage: open &lt;name&gt; — try{" "}
            <Chip cmd="open hootpr" ctx={ctx} label="open hootpr" />
          </p>
        );
      }
      if (q === "resume" || q === "resume.pdf") {
        return resolveCommand("resume")?.run([], ctx);
      }
      const project =
        projects.find((p) => p.slug === q || p.name.toLowerCase() === q) ??
        projects[Number(q) - 1];
      if (!project) {
        return (
          <p className="text-dim">
            no project “{args[0]}”. run{" "}
            <Chip cmd="projects" ctx={ctx} label="projects" />
          </p>
        );
      }
      return (
        <div className="space-y-1.5">
          <p>
            <span className="text-ink">{project.name}</span>{" "}
            <span className="text-faint">— {project.tagline}</span>
          </p>
          <p className="text-dim">{project.description}</p>
          <ul className="space-y-0.5 text-dim">
            {project.features
              ? project.features.map((f) => (
                  <li key={f.title}>
                    <span className="text-dim">›</span>{" "}
                    <span className="text-ink">{f.title}</span> — {f.detail}
                  </li>
                ))
              : project.highlights.map((h, i) => (
                  <li key={i}>
                    <span className="text-dim">›</span> {h}
                  </li>
                ))}
          </ul>
          <Tags items={project.stack} />
          {project.links.github && (
            <p className="pt-1">
              <span className="text-ink">code</span>{" "}
              <ExtLink href={project.links.github}>
                {project.links.github}
              </ExtLink>
            </p>
          )}
          {project.links.demo && (
            <p>
              <span className="text-ink">live</span>{" "}
              <ExtLink href={project.links.demo}>{project.links.demo}</ExtLink>
            </p>
          )}
        </div>
      );
    },
  },
  {
    name: "contact",
    aliases: ["hire", "email"],
    description: "how to reach me",
    run: (_args, ctx) => (
      <div className="space-y-1">
        <p>
          <span className="text-ink">email</span>{" "}
          <ExtLink href={`mailto:${profile.email}`}>{profile.email}</ExtLink>
        </p>
        <p>
          <span className="text-ink">phone</span>{" "}
          <ExtLink href={`tel:${profile.phone.replace(/\s/g, "")}`}>
            {profile.phone}
          </ExtLink>
        </p>
        {socials
          .filter((s) => s.cmd !== "email")
          .map((s) => (
            <p key={s.name}>
              <span className="text-ink">{s.name.toLowerCase()}</span>{" "}
              <ExtLink href={s.url}>{s.url}</ExtLink>
            </p>
          ))}
        <p className="pt-1 text-faint">
          prefer a form? <Chip cmd="exit" ctx={ctx} label="exit" /> and scroll to
          the contact section.
        </p>
      </div>
    ),
  },
  {
    name: "resume",
    aliases: ["cv-download"],
    description: "open my résumé (PDF)",
    run: (_args, ctx) => {
      ctx.openUrl(profile.resumeUrl);
      return (
        <p className="text-dim">
          opening résumé… if it didn&apos;t open,{" "}
          <ExtLink href={profile.resumeUrl}>click here</ExtLink>.
        </p>
      );
    },
  },
  {
    name: "social",
    aliases: ["links"],
    description: "all my links",
    run: () => (
      <div className="space-y-1">
        {socials.map((s) => (
          <p key={s.name}>
            <span className="text-ink">{s.name.toLowerCase().padEnd(10)}</span>{" "}
            <ExtLink href={s.url}>{s.handle}</ExtLink>
          </p>
        ))}
      </div>
    ),
  },
  {
    name: "github",
    hidden: true,
    description: "open GitHub",
    run: (_a, ctx) => {
      ctx.openUrl("https://github.com/sahell0x");
      return <p className="text-dim">opening github.com/sahell0x…</p>;
    },
  },
  {
    name: "linkedin",
    hidden: true,
    description: "open LinkedIn",
    run: (_a, ctx) => {
      ctx.openUrl("https://linkedin.com/in/sahell0x");
      return <p className="text-dim">opening linkedin.com/in/sahell0x…</p>;
    },
  },
  {
    name: "leetcode",
    hidden: true,
    description: "open LeetCode",
    run: (_a, ctx) => {
      ctx.openUrl("https://leetcode.com/Sahell");
      return <p className="text-dim">opening leetcode.com/Sahell…</p>;
    },
  },
  {
    name: "neofetch",
    description: "system info card",
    run: () => {
      const totalSkills = skillGroups.reduce((n, g) => n + g.items.length, 0);
      const info: [string, string][] = [
        ["user", `${profile.handle}@portfolio`],
        ["role", profile.title],
        ["shell", "sahil.sh v1.0"],
        ["location", profile.location],
        ["projects", String(projects.length)],
        ["experience", `${experience.length} roles`],
        ["skills", `${totalSkills} technologies`],
        ["status", profile.availability],
      ];
      return (
        <div className="flex flex-col gap-5 sm:flex-row">
          {/* Drawn with elements, not box-drawing characters: those glyphs
              come from a fallback font whose advance width doesn't match the
              mono grid, so the borders never line up. */}
          <div className="shrink-0">
            <div className="flex h-24 w-32 flex-col items-center justify-center gap-3.5 rounded-xl border border-edge-strong">
              <div className="flex gap-5">
                <span className="h-2.5 w-4 rounded-sm bg-ink" />
                <span className="h-2.5 w-4 rounded-sm bg-ink" />
              </div>
              <span className="h-1.5 w-10 rounded-b-full bg-ink" />
            </div>
            <p className="mt-2 text-center text-dim">sahil.sh</p>
          </div>
          <div className="space-y-0.5">
            {info.map(([k, v]) => (
              <p key={k}>
                <span className="text-ink">{k.padEnd(11)}</span>
                <span className="text-dim">{v}</span>
              </p>
            ))}
          </div>
        </div>
      );
    },
  },
  {
    name: "echo",
    hidden: true,
    description: "echo text",
    run: (args) => <p className="text-dim">{args.join(" ")}</p>,
  },
  {
    name: "date",
    hidden: true,
    description: "current date/time",
    run: () => <p className="text-dim">{new Date().toString()}</p>,
  },
  {
    name: "sudo",
    hidden: true,
    description: "superuser do",
    run: (args) => (
      <p className="text-dim">
        {args.join(" ") || "su"}: permission denied — nice try 😏. This portfolio
        runs on trust, not root.
      </p>
    ),
  },
  {
    name: "cd",
    description: "cd <section> — jump to a section of the site",
    run: (args, ctx) => {
      const sections = [
        "about",
        "skills",
        "experience",
        "projects",
        "contact",
      ];
      const target = (args[0] ?? "").toLowerCase().replace(/^[#/]/, "");
      if (!target || target === "~" || target === "..") {
        ctx.navigate("top");
        return <p className="text-dim">→ ~ (home)</p>;
      }
      if (sections.includes(target)) {
        ctx.navigate(target);
        return <p className="text-dim">→ /{target}</p>;
      }
      return (
        <p className="text-dim">
          cd: no such section: {args[0]} — try {sections.join(", ")}
        </p>
      );
    },
  },
  {
    name: "history",
    aliases: ["hist"],
    description: "show recent commands",
    run: (_args, ctx) => {
      const h = ctx.getHistory();
      if (h.length === 0)
        return <p className="text-faint">no history yet</p>;
      return (
        <div className="space-y-0.5">
          {h.map((cmd, i) => (
            <p key={i} className="text-dim">
              <span className="text-faint">{String(i + 1).padStart(3)}</span>{" "}
              {cmd}
            </p>
          ))}
        </div>
      );
    },
  },
  {
    name: "pwd",
    hidden: true,
    description: "print working directory",
    run: () => <p className="text-dim">/home/visitor/sahil.sh</p>,
  },
  {
    name: "uname",
    hidden: true,
    description: "system info",
    run: () => (
      <p className="text-dim">
        sahil.sh 1.0.0 x86_64 — AI / Backend portfolio shell
      </p>
    ),
  },
  {
    name: "banner",
    aliases: ["motd"],
    hidden: true,
    description: "reprint the welcome banner",
    run: (_args, ctx) => <Welcome ctx={ctx} />,
  },
  {
    name: "theme",
    description: "theme [dark|light|system] — switch the site theme",
    run: (args) => {
      const arg = (args[0] ?? "").toLowerCase();

      if (arg === "dark" || arg === "light") {
        setTheme(arg);
        return <p className="text-dim">theme → {arg}</p>;
      }

      if (arg === "system" || arg === "auto") {
        setTheme(null);
        return <p className="text-dim">theme → system ({systemTheme()})</p>;
      }

      if (arg) {
        return (
          <p className="text-dim">
            theme: unknown option {args[0]} — try dark, light, or system
          </p>
        );
      }

      const choice = getThemeChoice();
      return (
        <p className="text-dim">
          <span className="text-ink">
            {choice ?? `system (${systemTheme()})`}
          </span>{" "}
          · usage: theme dark|light|system
        </p>
      );
    },
  },
  {
    name: "joke",
    hidden: true,
    description: "a developer joke",
    run: (_args, ctx) => {
      const jokes = [
        "There are 10 kinds of people: those who understand binary and those who don't.",
        "It works on my machine ¯\\_(ツ)_/¯",
        "A SQL query walks into a bar, sees two tables and asks: can I join you?",
        "Why do programmers prefer dark mode? Because light attracts bugs.",
        "!false — it's funny because it's true.",
      ];
      return (
        <p className="text-dim">
          {jokes[ctx.getHistory().length % jokes.length]}
        </p>
      );
    },
  },
  {
    name: "vim",
    aliases: ["nano", "emacs"],
    hidden: true,
    description: "open an editor",
    run: () => (
      <p className="text-dim">
        entering editor… just kidding — type{" "}
        <span className="text-ink">exit</span>, you can always leave here 😌
      </p>
    ),
  },
  {
    name: "exit",
    aliases: ["quit", "gui", "close"],
    description: "return to the visual site",
    run: (_a, ctx) => {
      ctx.close();
      return <p className="text-dim">closing shell…</p>;
    },
  },
  {
    name: "clear",
    aliases: ["cls"],
    description: "clear the screen",
    // handled specially by the engine
    run: () => null,
  },
];

/* ------------------------------------------------------------------ *
 *  Engine helpers
 * ------------------------------------------------------------------ */
export function resolveCommand(name: string): Command | undefined {
  const n = name.toLowerCase();
  return commands.find((c) => c.name === n || c.aliases?.includes(n));
}

export function executeCommand(input: string, ctx: CommandContext): ReactNode {
  const parts = input.trim().split(/\s+/);
  const name = parts[0];
  const args = parts.slice(1);
  const cmd = resolveCommand(name);
  if (!cmd) {
    return (
      <p className="text-danger">
        command not found: {name}. type{" "}
        <Chip cmd="help" ctx={ctx} label="help" /> to see what I can do.
      </p>
    );
  }
  return cmd.run(args, ctx);
}

export function getCompletions(prefix: string): string[] {
  const p = prefix.toLowerCase();
  if (!p) return [];
  const names = commands.flatMap((c) => [c.name, ...(c.aliases ?? [])]);
  return names.filter((n) => n.startsWith(p));
}

const allCommandNames = () =>
  commands.flatMap((c) => [c.name, ...(c.aliases ?? [])]);

/** Valid argument values for a given command (drives arg autocompletion). */
function argOptionsFor(cmdName: string): string[] {
  const c = cmdName.toLowerCase();
  if (["open", "cat", "view"].includes(c)) return projects.map((p) => p.slug);
  if (c === "cd")
    return ["about", "skills", "experience", "projects", "contact", "~"];
  if (c === "ls")
    return ["about", "experience", "skills", "projects", "contact"];
  if (["skills", "stack"].includes(c)) return skillGroups.map((g) => g.key);
  return [];
}

/** All candidate tokens for the current cursor position (used by Tab listing). */
export function listCompletions(input: string): string[] {
  const endsSpace = /\s$/.test(input);
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  if (tokens.length === 1 && !endsSpace) {
    const p = tokens[0].toLowerCase();
    return allCommandNames().filter((n) => n.startsWith(p));
  }
  const opts = argOptionsFor(tokens[0]);
  const partial = endsSpace ? "" : tokens[tokens.length - 1].toLowerCase();
  return opts.filter((o) => o.toLowerCase().startsWith(partial));
}

/**
 * Best single ghost suggestion for the current input — a full line guaranteed
 * to start with `input`. Completes the command name while typing it, and the
 * argument once a command + partial argument is present.
 */
export function getSuggestion(input: string): string {
  if (!input) return "";
  const endsSpace = /\s$/.test(input);
  const tokens = input.split(/\s+/);
  const last = tokens[tokens.length - 1];

  // still typing the command name
  if (tokens.length === 1 && !endsSpace) {
    const m = allCommandNames().find(
      (n) =>
        n.toLowerCase().startsWith(last.toLowerCase()) && n.length > last.length
    );
    return m ? input + m.slice(last.length) : "";
  }

  // completing an argument (skip when the arg is still empty)
  if (endsSpace) return "";
  const opts = argOptionsFor(tokens[0]);
  const partial = last.toLowerCase();
  const m = opts.find(
    (o) => o.toLowerCase().startsWith(partial) && o.length > partial.length
  );
  return m ? input + m.slice(last.length) : "";
}

export const primaryCommands = commands
  .filter((c) => !c.hidden)
  .map((c) => c.name);

/* Boot banner shown after the startup sequence. */
export function Welcome({ ctx }: { ctx: CommandContext }) {
  return (
    <div className="space-y-2">
      {/* A real border, not box-drawing characters — those come from a
          fallback font and never align with the mono grid. */}
      <p className="inline-block border border-edge-strong px-3 py-1.5 text-ink">
        {profile.name} · interactive shell v1.0
      </p>
      <p className="text-dim">
        {profile.title}. Welcome to my terminal — this reads from the same data
        as the site.
      </p>
      <p className="text-faint">
        type <Chip cmd="help" ctx={ctx} label="help" /> to begin, or try{" "}
        <Chip cmd="whoami" ctx={ctx} />, <Chip cmd="projects" ctx={ctx} />,{" "}
        <Chip cmd="neofetch" ctx={ctx} />.
      </p>
    </div>
  );
}
