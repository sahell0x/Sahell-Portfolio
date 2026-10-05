import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Section({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "mx-auto w-full max-w-4xl scroll-mt-16 px-5 py-14 sm:px-8 sm:py-20",
        className
      )}
    >
      {children}
    </section>
  );
}
