"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

interface TerminalContextValue {
  isOpen: boolean;
  /** a command to auto-run when the terminal opens (e.g. from a nav link) */
  pending: string | null;
  open: (cmd?: string) => void;
  close: () => void;
  toggle: () => void;
  consumePending: () => void;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const open = useCallback((cmd?: string) => {
    if (cmd) setPending(cmd);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);
  const consumePending = useCallback(() => setPending(null), []);

  const value = useMemo(
    () => ({ isOpen, pending, open, close, toggle, consumePending }),
    [isOpen, pending, open, close, toggle, consumePending]
  );

  return (
    <TerminalContext.Provider value={value}>
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminal() {
  const ctx = useContext(TerminalContext);
  if (!ctx) {
    throw new Error("useTerminal must be used within a TerminalProvider");
  }
  return ctx;
}
