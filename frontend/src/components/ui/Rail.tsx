import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * The page's shared two-column spine: quiet metadata on the left, content on
 * the right, both hanging off one vertical edge that runs the length of the
 * page.
 *
 * That single alignment is what stops the sections reading as a stack of
 * interchangeable blocks — every section uses the same rail, so the eye has a
 * fixed line to follow even though each section's content is shaped
 * differently. The aside is right-aligned so it sits flush against that edge.
 *
 * `spine` draws the edge as a real hairline. Reserve it for content that is a
 * sequence (the work history); the other sections share the alignment without
 * the rule, which is what keeps them visually distinct from one another.
 *
 * Trailing space belongs on the content column via `contentClassName`, not on
 * a wrapper: the rule is drawn by that column's left border, so padding placed
 * outside it would break the line into segments between entries.
 *
 * Below `sm` the rail collapses: no column, no rule, aside simply above.
 */
export function Rail({
  aside,
  spine,
  children,
  className,
  contentClassName,
}: {
  aside?: ReactNode;
  spine?: boolean;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div className={cn("grid gap-y-3 sm:grid-cols-[8.5rem_1fr]", className)}>
      <div className="sm:pr-7 sm:text-right">{aside}</div>
      <div
        className={cn(
          "min-w-0 sm:pl-7",
          spine && "sm:border-l sm:border-edge",
          contentClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}
