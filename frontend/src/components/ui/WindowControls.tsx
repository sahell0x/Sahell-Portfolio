"use client";

import { Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface WindowControlsProps {
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  className?: string;
}

/**
 * Plain window controls for the terminal chrome: three neutral glyph buttons,
 * no traffic-light colors. Renders as static glyphs when no handlers are given.
 */
export function WindowControls({
  onClose,
  onMinimize,
  onMaximize,
  className,
}: WindowControlsProps) {
  const interactive = Boolean(onClose || onMinimize || onMaximize);
  const dot =
    "flex h-6 w-6 items-center justify-center rounded text-faint transition-colors";

  const controls = [
    { key: "minimize", label: "Minimize", Icon: Minus, handler: onMinimize },
    { key: "maximize", label: "Maximize", Icon: Square, handler: onMaximize },
    { key: "close", label: "Close", Icon: X, handler: onClose },
  ] as const;

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {controls.map((c) =>
        interactive ? (
          <button
            key={c.key}
            type="button"
            aria-label={c.label}
            onClick={(e) => {
              e.stopPropagation();
              c.handler?.();
            }}
            className={cn(dot, "hover:bg-surface-2 hover:text-ink")}
          >
            <c.Icon
              className={c.key === "maximize" ? "h-2.5 w-2.5" : "h-3.5 w-3.5"}
              strokeWidth={2}
            />
          </button>
        ) : (
          <span key={c.key} className={dot}>
            <c.Icon
              className={c.key === "maximize" ? "h-2.5 w-2.5" : "h-3.5 w-3.5"}
              strokeWidth={2}
            />
          </span>
        )
      )}
    </div>
  );
}
