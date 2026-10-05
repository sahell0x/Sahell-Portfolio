export type ClassValue = string | false | null | undefined;

/** Tiny classname joiner — no external deps. */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(" ");
}
