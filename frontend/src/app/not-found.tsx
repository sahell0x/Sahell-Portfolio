import Link from "next/link";
import { Signal } from "@/components/ui/Signal";

export const metadata = { title: "Page not found" };

/**
 * A dead line on the voice signal: the same waveform as the hero, here with
 * nothing to say.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[100svh] w-full max-w-4xl flex-col justify-center px-5 py-24 sm:px-8">
      <p className="font-mono text-sm text-faint">404</p>
      <h1 className="mt-3 font-display text-[clamp(3rem,10vw,6.5rem)] leading-[0.95] font-bold tracking-[-0.04em] text-ink">
        Nothing on
        <br />
        this line.
      </h1>
      <div className="-mx-5 mt-8 sm:-mx-8">
        <Signal className="block h-20 w-full" />
      </div>
      <p className="mt-8 max-w-md text-dim">
        The page you asked for doesn&apos;t exist, or it moved. Everything
        lives on the home page.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex w-fit items-center rounded-full bg-ink px-6 py-3 text-sm font-medium text-bg transition-transform active:scale-[0.97]"
      >
        Go to the home page
      </Link>
    </main>
  );
}
