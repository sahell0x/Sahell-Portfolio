import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * `strong` inverts the tag to solid ink. Reserved for the handful of things
 * worth seeing first — with no accent colour, fill is what carries emphasis.
 */
export function Tag({
  children,
  strong,
  className,
}: {
  children: ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs transition-[transform,background-color,color,border-color] duration-200",
        strong
          ? "border-ink bg-ink px-2.5 py-1 font-medium text-bg hover:-translate-y-0.5"
          : "border-edge-strong text-dim hover:border-ink hover:text-ink",
        className
      )}
    >
      {children}
    </span>
  );
}
