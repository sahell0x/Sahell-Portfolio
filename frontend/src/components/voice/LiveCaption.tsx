"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";

/** A calm speaking pace; captions run slightly ahead rather than behind. */
const WORDS_PER_SECOND = 2.9;
/** Fall this far behind the text and the reveal hurries to catch up. */
const CATCH_UP_AT = 10;

/**
 * Kaira's current line, revealed word by word while she speaks.
 *
 * The server sends a sentence as its audio goes out, so the whole sentence
 * is known before it is heard. Revealing it at speaking pace — and only while
 * she is audibly talking — keeps the words roughly under her voice instead of
 * the full paragraph landing at once. When the turn is over, whatever is left
 * is shown immediately. Keyed by turn, so each turn starts its own reveal.
 */
export function LiveCaption({
  text,
  speaking,
  done,
}: {
  text: string;
  speaking: boolean;
  done: boolean;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (done && !speaking) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShown(words.length);
      return;
    }
    if (!speaking) return;
    const id = window.setInterval(() => {
      setShown((n) => {
        if (n >= words.length) return n;
        return words.length - n > CATCH_UP_AT ? n + 2 : n + 1;
      });
    }, 1000 / WORDS_PER_SECOND);
    return () => window.clearInterval(id);
  }, [speaking, done, words.length]);

  const visible = words.slice(0, Math.min(shown, words.length));

  return (
    <p
      aria-live="off"
      className="flex max-h-[4.6em] flex-wrap content-end gap-x-[0.3em] overflow-hidden text-center text-[0.9375rem] leading-[1.5] text-ink [justify-content:center]"
    >
      {visible.map((w, i) => (
        <motion.span
          key={`${i}-${w}`}
          initial={{ opacity: 0, y: 4, filter: "blur(3px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className={i < visible.length - 8 ? "text-dim" : undefined}
        >
          {w}
        </motion.span>
      ))}
    </p>
  );
}
