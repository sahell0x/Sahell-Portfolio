"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTerminal } from "./terminal-store";
import {
  executeCommand,
  getSuggestion,
  listCompletions,
  Welcome,
  type CommandContext,
} from "./commands";
import { WindowControls } from "@/components/ui/WindowControls";
import { cn } from "@/lib/utils";

interface Entry {
  id: number;
  input?: string;
  output?: ReactNode;
}

const BOOT_LINES = [
  "booting sahil.sh …",
  "[ ok ] loading profile",
  "[ ok ] mounting /projects /experience /skills",
  "[ ok ] establishing secure shell",
];

function Prompt() {
  return (
    <span className="shrink-0 select-none">
      <span className="font-medium text-ink">visitor@sahilkhan</span>
      <span className="text-faint">:</span>
      <span className="text-dim">~</span>
      <span className="text-faint">$ </span>
    </span>
  );
}

export function Terminal() {
  const { isOpen, close, pending, consumePending } = useTerminal();
  const reduce = useReducedMotion();

  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [histIndex, setHistIndex] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [maximized, setMaximized] = useState(false);

  const idRef = useRef(0);
  const bootedRef = useRef(false);
  const runRef = useRef<(cmd: string) => void>(() => {});
  const historyRef = useRef<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // keep a ref of history so commands can read it without stale closures
  useEffect(() => {
    historyRef.current = cmdHistory;
  }, [cmdHistory]);

  // side-effect helpers handed to commands
  const openUrl = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);
  const download = useCallback((url: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = url.split("/").pop() || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const ctx = useMemo<CommandContext>(
    () => ({
      run: (cmd: string) => runRef.current(cmd),
      clear: () => setEntries([]),
      close,
      openUrl,
      download,
      getHistory: () => historyRef.current,
      navigate: (section: string) => {
        close();
        const hash = section === "top" ? "#top" : `#${section}`;
        requestAnimationFrame(() => {
          window.location.hash = hash;
        });
      },
    }),
    [close, openUrl, download]
  );

  const submit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        setEntries((prev) => [...prev, { id: idRef.current + 1, input: "" }]);
        idRef.current += 1;
        return;
      }
      setCmdHistory((prev) => [...prev, trimmed]);
      setHistIndex(null);

      const name = trimmed.split(/\s+/)[0].toLowerCase();
      if (name === "clear" || name === "cls") {
        setEntries([]);
        return;
      }
      const output = executeCommand(trimmed, ctx);
      idRef.current += 1;
      setEntries((prev) => [
        ...prev,
        { id: idRef.current, input: trimmed, output },
      ]);
    },
    [ctx]
  );

  // keep the ref pointing at the latest submit so clickable hints work
  useEffect(() => {
    runRef.current = submit;
  }, [submit]);

  // boot sequence on first open
  useEffect(() => {
    if (!isOpen || bootedRef.current) return;
    bootedRef.current = true;
    const timers: number[] = [];
    const step = reduce ? 0 : 150;

    BOOT_LINES.forEach((line, i) => {
      timers.push(
        window.setTimeout(() => {
          idRef.current += 1;
          setEntries((prev) => [
            ...prev,
            {
              id: idRef.current,
              output: <p className="text-faint">{line}</p>,
            },
          ]);
        }, step * (i + 1))
      );
    });
    timers.push(
      window.setTimeout(() => {
        idRef.current += 1;
        setEntries((prev) => [
          ...prev,
          { id: idRef.current, output: <Welcome ctx={ctx} /> },
        ]);
        setReady(true);
      }, step * (BOOT_LINES.length + 1) + 100)
    );

    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [isOpen, reduce, ctx]);

  // run a queued command (e.g. a nav link that jumps straight to `projects`)
  useEffect(() => {
    if (isOpen && ready && pending) {
      runRef.current(pending);
      consumePending();
    }
  }, [isOpen, ready, pending, consumePending]);

  // lock body scroll + focus input while open
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(t);
    };
  }, [isOpen]);

  // Esc to close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  // auto-scroll to bottom on new output
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries]);

  // zsh-style autosuggestion: best completion from history, then commands
  const suggestion = useMemo(() => {
    if (!input) return "";
    for (let i = cmdHistory.length - 1; i >= 0; i--) {
      const h = cmdHistory[i];
      if (h.length > input.length && h.startsWith(input)) return h;
    }
    return getSuggestion(input);
  }, [input, cmdHistory]);
  const ghost = suggestion.slice(input.length);

  const acceptSuggestion = () => {
    if (ghost) setInput(suggestion);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      submit(input);
      setInput("");
      return;
    }
    if ((e.key === "ArrowRight" || e.key === "End") && ghost) {
      e.preventDefault();
      acceptSuggestion();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdHistory.length === 0) return;
      const idx =
        histIndex === null
          ? cmdHistory.length - 1
          : Math.max(0, histIndex - 1);
      setHistIndex(idx);
      setInput(cmdHistory[idx]);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIndex === null) return;
      if (histIndex < cmdHistory.length - 1) {
        const idx = histIndex + 1;
        setHistIndex(idx);
        setInput(cmdHistory[idx]);
      } else {
        setHistIndex(null);
        setInput("");
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (ghost) {
        acceptSuggestion();
        return;
      }
      const items = listCompletions(input);
      if (items.length === 1) {
        const tokens = input.split(/\s+/);
        tokens[tokens.length - 1] = items[0];
        setInput(tokens.join(" ") + " ");
      } else if (items.length > 1) {
        idRef.current += 1;
        setEntries((prev) => [
          ...prev,
          {
            id: idRef.current,
            output: <p className="text-dim">{items.join("   ")}</p>,
          },
        ]);
      }
      return;
    }
    if (e.ctrlKey && (e.key === "l" || e.key === "L")) {
      e.preventDefault();
      setEntries([]);
      return;
    }
    if (e.ctrlKey && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      idRef.current += 1;
      setEntries((prev) => [
        ...prev,
        { id: idRef.current, input: input + "^C" },
      ]);
      setInput("");
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-stretch justify-center bg-scrim p-0 backdrop-blur-sm sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Interactive terminal"
        >
          <motion.div
            className={cn(
              "relative flex flex-col overflow-hidden border border-edge-strong bg-bg font-mono text-[13px] leading-relaxed",
              maximized
                ? "h-full w-full sm:h-[92vh] sm:max-w-[95vw] sm:rounded-xl"
                : "h-full w-full sm:h-[80vh] sm:max-w-3xl sm:rounded-xl"
            )}
            initial={reduce ? false : { opacity: 0, y: 16, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* title bar */}
            <div
              className="flex select-none items-center justify-between gap-3 border-b border-edge bg-surface px-4 py-2.5"
              onDoubleClick={() => setMaximized((v) => !v)}
            >
              <span className="truncate text-xs text-dim">
                visitor@sahilkhan: ~ — sahil.sh
              </span>
              <WindowControls
                onClose={close}
                onMinimize={close}
                onMaximize={() => setMaximized((v) => !v)}
              />
            </div>

            {/* output */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-4 py-3 text-ink"
              onClick={() => inputRef.current?.focus()}
            >
                {entries.map((entry) => (
                  <div key={entry.id} className="mb-2 last:mb-0">
                    {entry.input !== undefined && (
                      <div className="flex gap-1 break-all">
                        <Prompt />
                        <span className="text-ink">{entry.input}</span>
                      </div>
                    )}
                    {entry.output !== undefined && (
                      <div className="mt-1 whitespace-pre-wrap break-words">
                        {entry.output}
                      </div>
                    )}
                  </div>
                ))}

                {/* live input line with zsh-style autosuggestion */}
                <div className="flex items-start gap-1">
                  <Prompt />
                  <div className="relative min-w-0 flex-1">
                    <div className="pointer-events-none whitespace-pre-wrap break-all">
                      <span className="text-ink">{input}</span>
                      <span className="cursor-blink inline-block h-[1.05em] w-[0.5ch] translate-y-[0.18em] bg-ink align-baseline" />
                      {ghost && <span className="text-faint">{ghost}</span>}
                    </div>
                    <input
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={onKeyDown}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoComplete="off"
                      autoCorrect="off"
                      aria-label="Terminal input"
                      className="absolute inset-0 h-full w-full bg-transparent text-transparent caret-transparent outline-none"
                    />
                  </div>
                </div>
              </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
