"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDownToLine,
  AtSign,
  Briefcase,
  Copy,
  CornerDownLeft,
  FolderGit2,
  Layers,
  Mic,
  Moon,
  Search,
  SquareTerminal,
  Sun,
  User,
} from "lucide-react";
import { profile, socials } from "@/content";
import { useTerminal } from "@/components/terminal/terminal-store";
import { getTheme, setTheme } from "@/lib/theme";
import {
  GithubIcon,
  LeetCodeIcon,
  LinkedinIcon,
} from "@/components/ui/BrandIcons";
import { cn } from "@/lib/utils";

/** Anything on the page can open the menu by dispatching this event. */
export const OPEN_COMMAND_MENU = "command-menu:open";
export const openCommandMenu = () =>
  window.dispatchEvent(new Event(OPEN_COMMAND_MENU));

/** Asks the voice assistant to open; it listens for this. */
export const OPEN_ASSISTANT = "assistant:open";

type Item = {
  id: string;
  group: "Go to" | "Do" | "Elsewhere";
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void | "keep-open";
};

const iconClass = "h-4 w-4";

function scrollToId(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * ⌘K. Every way to get around the site in one keyboard-first list: sections,
 * actions, and outside links, filtered as you type. Arrow keys move, Enter
 * runs, Escape closes. It stays out of the way of the terminal, which owns
 * the keyboard while it is open.
 */
export function CommandMenu() {
  const terminal = useTerminal();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    returnFocus.current?.focus?.();
  }, []);

  const show = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1600);
  };

  const items = useMemo<Item[]>(() => {
    const brand: Record<string, ReactNode> = {
      github: <GithubIcon className={iconClass} />,
      linkedin: <LinkedinIcon className={iconClass} />,
      leetcode: <LeetCodeIcon className={iconClass} />,
    };
    return [
      { id: "about", group: "Go to", label: "About", icon: <User className={iconClass} />, run: () => scrollToId("about") },
      { id: "experience", group: "Go to", label: "Experience", icon: <Briefcase className={iconClass} />, keywords: "work jobs career", run: () => scrollToId("experience") },
      { id: "skills", group: "Go to", label: "Stack", icon: <Layers className={iconClass} />, keywords: "skills tech tools", run: () => scrollToId("skills") },
      { id: "projects", group: "Go to", label: "Projects", icon: <FolderGit2 className={iconClass} />, run: () => scrollToId("projects") },
      { id: "contact", group: "Go to", label: "Contact", icon: <AtSign className={iconClass} />, keywords: "email hire message", run: () => scrollToId("contact") },
      {
        id: "copy-email",
        group: "Do",
        label: "Copy email address",
        hint: profile.email,
        icon: <Copy className={iconClass} />,
        keywords: "mail contact",
        run: () => {
          navigator.clipboard?.writeText(profile.email).then(
            () => flash("Email copied"),
            () => (window.location.href = `mailto:${profile.email}`)
          );
        },
      },
      {
        id: "resume",
        group: "Do",
        label: "Download résumé",
        hint: "PDF",
        icon: <ArrowDownToLine className={iconClass} />,
        keywords: "cv resume pdf",
        run: () => {
          const a = document.createElement("a");
          a.href = profile.resumeUrl;
          a.download = "";
          a.click();
        },
      },
      {
        id: "kaira",
        group: "Do",
        label: "Talk to Kaira",
        hint: "voice assistant",
        icon: <Mic className={iconClass} />,
        keywords: "voice ai assistant chat ask",
        run: () => window.dispatchEvent(new Event(OPEN_ASSISTANT)),
      },
      {
        id: "terminal",
        group: "Do",
        label: "Open the terminal",
        hint: "shell",
        icon: <SquareTerminal className={iconClass} />,
        keywords: "shell cli console",
        run: () => terminal.open(),
      },
      {
        id: "theme",
        group: "Do",
        label: "Switch theme",
        icon:
          typeof window !== "undefined" && getTheme() === "dark" ? (
            <Sun className={iconClass} />
          ) : (
            <Moon className={iconClass} />
          ),
        keywords: "dark light mode",
        run: () => {
          setTheme(getTheme() === "dark" ? "light" : "dark");
          return "keep-open";
        },
      },
      ...socials
        .filter((s) => s.cmd in brand)
        .map<Item>((s) => ({
          id: s.cmd,
          group: "Elsewhere",
          label: s.name,
          hint: s.handle,
          icon: brand[s.cmd],
          run: () => {
            window.open(s.url, "_blank", "noopener,noreferrer");
          },
        })),
    ];
    // `open` is a dependency so the theme icon is current each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminal.open, open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      `${it.label} ${it.hint ?? ""} ${it.keywords ?? ""} ${it.group}`
        .toLowerCase()
        .includes(q)
    );
  }, [items, query]);

  const activeIndex = Math.min(active, Math.max(filtered.length - 1, 0));

  const run = (item: Item | undefined) => {
    if (!item) return;
    const result = item.run();
    if (result !== "keep-open") close();
  };

  // Global shortcut and the open event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (terminal.isOpen) return;
        e.preventDefault();
        if (open) close();
        else show();
      }
    };
    const onOpen = () => show();
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_MENU, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_MENU, onOpen);
    };
  }, [open, show, close, terminal.isOpen]);

  // Keep the page still behind the dialog.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Keep the active row in view while arrowing.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % Math.max(filtered.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(
        (i) => (i - 1 + filtered.length) % Math.max(filtered.length, 1)
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  let lastGroup: string | null = null;

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="scrim"
            className="fixed inset-0 z-[100] bg-scrim backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
          />
        )}
        {open && (
          <motion.div
            key="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Command menu"
            className="fixed inset-x-4 top-[12vh] z-[101] mx-auto max-w-[36rem] overflow-hidden rounded-2xl border border-edge-strong bg-bg shadow-[0_24px_80px_-12px_rgba(0,0,0,0.45)]"
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -4 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onAnimationComplete={() => inputRef.current?.focus()}
          >
            <div className="flex items-center gap-3 border-b border-edge px-4">
              <Search className="h-4 w-4 shrink-0 text-faint" />
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKey}
                placeholder="Search or jump to…"
                aria-label="Search commands"
                aria-activedescendant={
                  filtered[activeIndex] ? `cmd-${filtered[activeIndex].id}` : undefined
                }
                role="combobox"
                aria-expanded="true"
                aria-controls="command-list"
                className="h-14 w-full bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-faint"
              />
              <kbd className="hidden rounded-md border border-edge px-1.5 py-0.5 font-mono text-[11px] text-faint sm:block">
                esc
              </kbd>
            </div>

            <div
              ref={listRef}
              id="command-list"
              role="listbox"
              className="max-h-[min(24rem,56vh)] overflow-y-auto overscroll-contain p-2"
            >
              {filtered.length === 0 && (
                <p className="px-3 py-10 text-center text-sm text-faint">
                  Nothing matches “{query}”. Try a section name, or “email”.
                </p>
              )}
              {filtered.map((item, i) => {
                const header = item.group !== lastGroup ? item.group : null;
                lastGroup = item.group;
                const isActive = i === activeIndex;
                return (
                  <div key={item.id}>
                    {header && (
                      <p className="px-3 pt-3 pb-1.5 text-xs text-faint first:pt-1">
                        {header}
                      </p>
                    )}
                    <button
                      id={`cmd-${item.id}`}
                      data-index={i}
                      role="option"
                      aria-selected={isActive}
                      onMouseMove={() => setActive(i)}
                      onClick={() => run(item)}
                      className={cn(
                        "relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                        isActive ? "text-ink" : "text-dim"
                      )}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="command-active"
                          className="absolute inset-0 rounded-lg bg-surface-2"
                          transition={{ type: "spring", stiffness: 500, damping: 40 }}
                        />
                      )}
                      <span className="relative flex h-7 w-7 items-center justify-center rounded-md border border-edge bg-bg text-dim">
                        {item.icon}
                      </span>
                      <span className="relative flex-1 truncate">{item.label}</span>
                      {item.hint && (
                        <span className="relative hidden truncate text-xs text-faint sm:block">
                          {item.hint}
                        </span>
                      )}
                      {isActive && (
                        <CornerDownLeft className="relative h-3.5 w-3.5 text-faint" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-4 border-t pointer-coarse:hidden border-edge px-4 py-2.5 text-xs text-faint">
              <span className="flex items-center gap-1.5">
                <kbd className="rounded border border-edge px-1 font-mono">↑</kbd>
                <kbd className="rounded border border-edge px-1 font-mono">↓</kbd>
                move
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="rounded border border-edge px-1 font-mono">↵</kbd>
                select
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            role="status"
            className="fixed bottom-6 left-1/2 z-[102] rounded-full bg-ink px-4 py-2 text-sm text-bg shadow-lg"
            initial={{ opacity: 0, y: 12, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 6, x: "-50%" }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
