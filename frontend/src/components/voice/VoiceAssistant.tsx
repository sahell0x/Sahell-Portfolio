"use client";

/**
 * The "talk to kaira" control and its panel.
 *
 * The launcher and the panel are one object: the pill grows into the panel and
 * shrinks back into it (a shared `layoutId`), so opening reads as the button
 * unfolding rather than a window appearing beside it. Hiding the panel does not
 * end a call — the pill stays live, its bars following Kaira's voice and the
 * clock running — and "end call" is the only thing that hangs up.
 *
 * Inside: the orb, a caption that reveals her words as she says them, starter
 * questions for a visitor who doesn't know what to ask, the transcript on
 * demand, and a closing card that points somewhere useful when the call ends.
 *
 * State reads through contrast rather than colour, in the site's own tokens.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, type PanInfo } from "motion/react";
import {
  ArrowDownToLine,
  AudioLines,
  Mail,
  MessageSquare,
  Minus,
  PhoneOff,
  RotateCcw,
  X,
} from "lucide-react";

import { profile } from "@/content";
import { useTerminal } from "@/components/terminal/terminal-store";
import { OPEN_ASSISTANT } from "@/components/CommandMenu";
import { runPageAction } from "@/lib/voice/actions";
import type {
  PageActionName,
  PageActionPayload,
  VoiceStatus,
} from "@/lib/voice/types";
import { useVoiceSession } from "@/lib/voice/useVoiceSession";
import {
  describeCost,
  describeQuota,
  formatSessionLength,
  formatWait,
} from "@/lib/voice/quotaMessage";
import { cn } from "@/lib/utils";
import { VoiceOrb } from "./VoiceOrb";
import { VoiceTextChat } from "./VoiceTextChat";
import { LauncherBars } from "./LauncherBars";
import { LiveCaption } from "./LiveCaption";
import { KairaSpotlight } from "./KairaSpotlight";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Shown under the orb. Lowercase to match the terminal voice of the site. */
const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: "ready when you are",
  "requesting-mic": "waiting for your mic",
  connecting: "connecting…",
  listening: "listening…",
  thinking: "thinking…",
  speaking: "speaking…",
  ended: "call ended",
  "rate-limited": "limit reached",
  "mic-denied": "mic blocked",
  error: "couldn't connect",
};

/** What a first-time visitor most often wants to know. */
const STARTERS = [
  "What is he building right now?",
  "Show me his projects",
  "Is he open to new roles?",
];

/**
 * Refusals show a sentence and nothing else.
 *
 * A visitor who is out of sessions is out of the assistant — offering a text
 * box beside the refusal spends the same model on the same questions and makes
 * the limit a formality. So the panel says what happened and when to come back,
 * and the only remaining control is the one that closes it.
 *
 * The microphone is the exception: that visitor has spent nothing, their
 * browser is simply in the way, and text is a real answer rather than a way
 * around a cap.
 */
const ELSEWHERE_NOTE =
  "You already have a conversation open in another tab. Close it and you can start again here.";
const UNAVAILABLE_NOTE = "The assistant isn't available right now.";

/**
 * A refusal on screen has to be able to lift itself. The other tab closes, or
 * the wait runs out, and neither event reaches this page on its own.
 */
const NOTICE_POLL_MS = 5000;

/**
 * Most visitors never notice a floating button, so the assistant introduces
 * itself on every page load — deliberately not remembered, so a visitor who
 * comes back always sees that voice is on offer. It shows as soon as the page
 * opens — the short delay only lets it animate in after first paint instead of
 * popping in mid-load — and it stays silent until asked.
 */
const INTRO_DELAY_MS = 400;
const INTRO_LIFETIME_MS = 16000;

/** Drag the sheet down this far (px) on a phone and it tucks away. */
const DISMISS_DRAG = 110;

function formatClock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

const MOBILE_QUERY = "(max-width: 639px)";
function useIsMobile() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(MOBILE_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

function StarterList({
  onPick,
  className,
}: {
  onPick: (question: string) => void;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-col gap-1.5", className)}>
      {STARTERS.map((q, i) => (
        <motion.li
          key={q}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 + i * 0.06, duration: 0.35, ease: EASE }}
        >
          <button
            onClick={() => onPick(q)}
            className="group flex w-full items-center justify-between gap-3 rounded-xl border border-edge bg-bg/60 px-3.5 py-2.5 text-left text-sm text-dim transition-[color,border-color,background-color] hover:border-edge-strong hover:bg-bg hover:text-ink"
          >
            {q}
            <AudioLines className="h-3.5 w-3.5 shrink-0 text-faint transition-colors group-hover:text-ink" />
          </button>
        </motion.li>
      ))}
    </ul>
  );
}

export function VoiceAssistant() {
  const [open, setOpen] = useState(false);
  const [intro, setIntro] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  // Whether the cost has been put to the visitor and is awaiting an answer.
  const [confirming, setConfirming] = useState(false);
  // Once told, they know. Asking again every call would be nagging, not warning.
  const warned = useRef(false);
  const { open: openTerminal } = useTerminal();
  const logRef = useRef<HTMLDivElement | null>(null);
  const isMobile = useIsMobile();

  // Returns the sentence the assistant hears back, so it can speak around what
  // it just did — or explain why it couldn't.
  const handleAction = useCallback(
    (action: PageActionName, payload: PageActionPayload) => {
      // On a phone the sheet covers the page she is trying to show; get it out
      // of the way while she keeps talking.
      if (window.matchMedia(MOBILE_QUERY).matches) setOpen(false);
      return runPageAction(action, payload, { openTerminal });
    },
    [openTerminal],
  );

  const session = useVoiceSession(handleAction);
  const {
    status,
    level,
    secondsLeft,
    errorMessage,
    isEnding,
    transcript,
    quota,
    retryAfter,
    sessionSeconds,
    start,
    stop,
    refreshLimits,
    ask,
  } = session;

  // What the visitor has left, and how long a conversation runs. Shown before
  // they click, so a refusal is never the first they hear of a limit.
  const quotaNote = describeQuota(quota, retryAfter);
  const sessionLength = formatSessionLength(sessionSeconds);
  const costNote = describeCost(quota, sessionSeconds);

  // A session is spent on the first click, not on a good conversation, so the
  // price is named while backing out is still free — once per page view.
  const beginCall = useCallback(() => {
    if (warned.current || !costNote) {
      warned.current = true;
      setConfirming(false);
      start();
      return;
    }
    setConfirming(true);
  }, [costNote, start]);

  const confirmCall = useCallback(() => {
    warned.current = true;
    setConfirming(false);
    start();
  }, [start]);

  const live = status === "listening" || status === "speaking" || status === "thinking";
  const busy = status === "connecting" || status === "requesting-mic";
  // Only in the states where this tab holds nothing of its own. The server
  // counts *our* live session as active too, so trusting the flag while
  // connecting or just after hanging up would accuse the visitor of their own
  // call.
  const elsewhere =
    quota?.active_elsewhere === true &&
    (status === "idle" || status === "rate-limited");
  const micDenied = status === "mic-denied";

  // Every "you can't start right now" collapses to one sentence and, when
  // there is a wait worth naming, a countdown that actually counts.
  const notice: { text: string; wait: number | null } | null = elsewhere
    ? { text: ELSEWHERE_NOTE, wait: null }
    : status === "rate-limited"
      ? { text: errorMessage ?? UNAVAILABLE_NOTE, wait: retryAfter }
      : null;
  const refused = notice !== null;

  useEffect(() => {
    if (!open || !refused) return;
    const id = window.setInterval(() => void refreshLimits(), NOTICE_POLL_MS);
    return () => window.clearInterval(id);
  }, [open, refused, refreshLimits]);

  // Follow the conversation as it grows.
  useEffect(() => {
    if (showTranscript && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [transcript, showTranscript]);

  const hide = useCallback(() => setOpen(false), []);

  const endCall = useCallback(() => {
    stop();
    setConfirming(false);
  }, [stop]);

  const dismissIntro = useCallback(() => setIntro(false), []);

  useEffect(() => {
    const timer = window.setTimeout(() => setIntro(true), INTRO_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Say it once and get out of the way.
  useEffect(() => {
    if (!intro) return;
    const timer = window.setTimeout(dismissIntro, INTRO_LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [intro, dismissIntro]);

  const openAssistant = useCallback(
    (talk: boolean) => {
      dismissIntro();
      setOpen(true);
      if (talk && !live && !busy) beginCall();
    },
    [dismissIntro, beginCall, live, busy],
  );

  /** A starter question: open, dial if needed, and queue it for her. */
  const askQuestion = useCallback(
    (question: string) => {
      ask(question);
      openAssistant(true);
    },
    [ask, openAssistant],
  );

  // The command menu's "Talk to Kaira" opens the panel without starting a call.
  useEffect(() => {
    const onOpen = () => openAssistant(false);
    window.addEventListener(OPEN_ASSISTANT, onOpen);
    return () => window.removeEventListener(OPEN_ASSISTANT, onOpen);
  }, [openAssistant]);

  // Escape tucks the panel away (it never hangs up).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > DISMISS_DRAG || info.velocity.y > 600) setOpen(false);
  };

  // The line being spoken now, and the visitor's last question while she thinks.
  const lastTurn = transcript[transcript.length - 1];
  const assistantTurn = [...transcript].reverse().find((t) => t.role === "assistant");
  const userTurn = lastTurn?.role === "user" ? lastTurn : null;
  const askedAnything = transcript.some((t) => t.role === "user");
  const showStarters =
    !confirming && !refused && !micDenied && (status === "idle" || (live && !askedAnything));
  const ended = status === "ended";

  const launcherLabel = live
    ? status === "speaking"
      ? "kaira is talking"
      : status === "thinking"
        ? "kaira is thinking"
        : "kaira is listening"
    : busy
      ? "connecting…"
      : "talk to kaira";

  return (
    <>
      <KairaSpotlight />

      <AnimatePresence>
        {intro && !open && !elsewhere && (
          <motion.div
            role="region"
            aria-label="Kaira introduction"
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.35, ease: EASE }}
            style={{ transformOrigin: "bottom right" }}
            className="fixed right-5 bottom-[5.25rem] z-[90] w-[calc(100vw-2.5rem)] max-w-[21rem] rounded-3xl border border-edge-strong bg-surface/95 p-4 shadow-2xl backdrop-blur-md"
          >
            <button
              onClick={() => dismissIntro()}
              aria-label="Dismiss introduction"
              className="absolute top-3 right-3 grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>

            <div className="flex items-center gap-2.5 pr-8">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-bg">
                <LauncherBars className="h-3" />
              </span>
              <div>
                <p className="text-sm font-medium text-ink">Hi, I&apos;m Kaira</p>
                <p className="text-xs text-faint">Sahil&apos;s AI assistant</p>
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-dim">
              Ask me about his work out loud, or tap a question to start.
            </p>

            <StarterList onPick={askQuestion} className="mt-3" />

            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={() => openAssistant(true)}
                className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-bg transition-transform active:scale-[0.97]"
              >
                <AudioLines className="h-3.5 w-3.5" />
                Talk to me
              </button>
              <button
                onClick={() => dismissIntro()}
                className="rounded-full px-3 py-2 text-sm text-faint transition-colors hover:text-ink"
              >
                Not now
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {!open ? (
          <motion.button
            key="launcher"
            layoutId="kaira-shell"
            onClick={() => openAssistant(false)}
            aria-label={live ? "Show Kaira" : "Talk to Kaira, Sahil's assistant"}
            aria-expanded={false}
            style={{ borderRadius: 999 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            whileTap={{ scale: 0.96 }}
            className={cn(
              "fixed right-5 bottom-5 z-[90] flex items-center gap-2.5 border px-4 py-3 text-sm shadow-lg backdrop-blur-md",
              live
                ? "border-ink bg-ink text-bg"
                : "border-edge bg-surface/95 text-ink hover:border-edge-strong",
            )}
          >
            <motion.span layout="position" className="flex items-center gap-2.5">
              <LauncherBars />
              <span className={cn("font-mono", !live && !busy && "hidden sm:inline")}>
                {launcherLabel}
              </span>
              {live && secondsLeft !== null && (
                <span className="font-mono text-xs tabular-nums opacity-60">
                  {formatClock(secondsLeft)}
                </span>
              )}
            </motion.span>
          </motion.button>
        ) : (
          <motion.div
            key="panel"
            layoutId="kaira-shell"
            role="dialog"
            aria-label="Kaira, Sahil's voice assistant"
            style={{ borderRadius: 28 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            drag={isMobile ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={onDragEnd}
            className="fixed inset-x-3 bottom-3 z-[90] flex max-h-[82vh] flex-col overflow-hidden border border-edge bg-surface/95 shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[24rem]"
          >
            <motion.div
              className="flex min-h-0 flex-1 flex-col"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: 0.12, duration: 0.25 } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
            >
              {isMobile && (
                <div aria-hidden className="flex justify-center pt-2.5">
                  <span className="h-1 w-10 rounded-full bg-edge-strong" />
                </div>
              )}

              <header className="flex items-center gap-2 px-4 pt-3.5">
                {refused ? (
                  <span aria-hidden className="h-8 w-8" />
                ) : (
                  <button
                    onClick={() => setShowTranscript((v) => !v)}
                    aria-label={showTranscript ? "Hide transcript" : "Show transcript"}
                    aria-pressed={showTranscript}
                    title="Transcript"
                    className={cn(
                      "grid h-8 w-8 place-items-center rounded-full border transition-colors",
                      showTranscript
                        ? "border-edge-strong bg-surface-2 text-ink"
                        : "border-edge text-dim hover:border-edge-strong hover:text-ink",
                    )}
                  >
                    <MessageSquare className="h-4 w-4" />
                  </button>
                )}

                <div className="flex flex-1 items-center justify-center gap-2 text-sm">
                  <span className="font-medium text-ink">Kaira</span>
                  {secondsLeft !== null && live && (
                    <span
                      className={cn(
                        "font-mono text-xs tabular-nums",
                        isEnding ? "text-ink" : "text-faint",
                      )}
                      aria-label={`${secondsLeft} seconds remaining`}
                    >
                      {formatClock(secondsLeft)}
                    </span>
                  )}
                </div>

                <button
                  onClick={hide}
                  aria-label={live ? "Hide Kaira (the call continues)" : "Hide Kaira"}
                  title={live ? "Hide — the call continues" : "Hide"}
                  className="grid h-8 w-8 place-items-center rounded-full border border-edge text-dim transition-colors hover:border-edge-strong hover:text-ink"
                >
                  <Minus className="h-4 w-4" />
                </button>
              </header>

              {notice ? (
                <div aria-live="polite" className="px-4 pt-4 pb-6">
                  <p className="text-sm leading-relaxed text-dim">{notice.text}</p>
                  {notice.wait !== null && (
                    <p className="mt-2 font-mono text-xs text-faint">
                      {notice.wait > 0
                        ? `You can try again in ${formatWait(notice.wait)}.`
                        : "Try again a little later."}
                    </p>
                  )}
                </div>
              ) : micDenied ? (
                <div className="flex min-h-0 flex-1 flex-col px-4 pt-3 pb-4">
                  {errorMessage && (
                    <p className="mb-3 text-sm leading-relaxed text-dim">{errorMessage}</p>
                  )}
                  <VoiceTextChat />
                </div>
              ) : (
                <>
                  {/* With the transcript open this block keeps its size (compact orb,
                      no starters) so the transcript is the only thing that scrolls. */}
                  <div
                    className={cn(
                      "flex flex-col items-center px-4 pt-1 pb-3",
                      showTranscript ? "shrink-0" : "min-h-0 overflow-y-auto",
                    )}
                  >
                    <VoiceOrb
                      compact={showTranscript}
                      level={level}
                      speaking={status === "speaking"}
                      active={live}
                      thinking={status === "thinking"}
                    />

                    <AnimatePresence mode="wait" initial={false}>
                      <motion.p
                        key={status === "error" ? `e-${errorMessage}` : status}
                        aria-live="polite"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.18 }}
                        className="-mt-1 font-mono text-xs text-faint"
                      >
                        {status === "error" ? errorMessage : STATUS_LABEL[status]}
                      </motion.p>
                    </AnimatePresence>

                    {/* The words: her current line, or the question she's on. */}
                    {(live || ended) && !showTranscript && (
                      <div className="mt-3 min-h-[4.6em] w-full">
                        {status === "thinking" && userTurn ? (
                          <motion.p
                            key={userTurn.id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="text-center text-[0.9375rem] leading-[1.5] text-faint"
                          >
                            “{userTurn.text}”
                          </motion.p>
                        ) : assistantTurn ? (
                          <LiveCaption
                            key={assistantTurn.id}
                            text={assistantTurn.text}
                            speaking={status === "speaking"}
                            done={assistantTurn.done}
                          />
                        ) : null}
                      </div>
                    )}

                    {status === "idle" && !confirming && !showTranscript && (quotaNote || sessionLength) && (
                      <p className="mt-1 text-center font-mono text-xs text-faint">
                        {quotaNote?.text}
                        {quotaNote && !quotaNote.blocking && sessionLength
                          ? `, ${sessionLength} each`
                          : null}
                        {!quotaNote && sessionLength ? `Sessions run ${sessionLength}` : null}
                      </p>
                    )}

                    {showStarters && !showTranscript && (
                      <div className="mt-4 w-full">
                        <p className="mb-2 text-xs text-faint">
                          {live ? "Or tap a question" : "Try asking"}
                        </p>
                        <StarterList onPick={askQuestion} />
                      </div>
                    )}
                  </div>

                  {showTranscript && (
                    <div
                      ref={logRef}
                      className="min-h-[8rem] flex-1 space-y-2 overflow-y-auto border-t border-edge px-4 py-3"
                    >
                      {transcript.length === 0 ? (
                        <p className="py-4 text-center font-mono text-xs text-faint">
                          Your conversation will appear here.
                        </p>
                      ) : (
                        transcript.map((turn) => (
                          <motion.div
                            key={turn.id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={cn(
                              "flex",
                              turn.role === "user" ? "justify-end" : "justify-start",
                            )}
                          >
                            <p
                              className={cn(
                                "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                                turn.role === "user"
                                  ? "rounded-br-sm bg-ink text-bg"
                                  : "rounded-bl-sm bg-surface-2 text-ink",
                              )}
                            >
                              {turn.text}
                            </p>
                          </motion.div>
                        ))
                      )}
                    </div>
                  )}

                  {confirming && !live ? (
                    <div className="border-t border-edge px-4 py-4">
                      <p className="text-sm leading-relaxed text-dim">{costNote}</p>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          onClick={confirmCall}
                          disabled={busy}
                          className="flex items-center gap-2.5 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <AudioLines className="h-4 w-4" />
                          Start the call
                        </button>
                        <button
                          onClick={() => setConfirming(false)}
                          className="rounded-full px-3 py-2.5 text-sm text-faint transition-colors hover:text-ink"
                        >
                          Not yet
                        </button>
                      </div>
                    </div>
                  ) : ended && transcript.length > 0 ? (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, ease: EASE }}
                      className="border-t border-edge px-4 py-4"
                    >
                      <p className="text-sm font-medium text-ink">Thanks for talking with Kaira.</p>
                      <p className="mt-0.5 text-sm text-dim">Want to take it further with Sahil?</p>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <a
                          href={`mailto:${profile.email}`}
                          className="flex flex-col items-center gap-1.5 rounded-xl border border-edge px-2 py-3 text-xs text-dim transition-colors hover:border-ink hover:text-ink"
                        >
                          <Mail className="h-4 w-4" />
                          Email him
                        </a>
                        <a
                          href={profile.resumeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex flex-col items-center gap-1.5 rounded-xl border border-edge px-2 py-3 text-xs text-dim transition-colors hover:border-ink hover:text-ink"
                        >
                          <ArrowDownToLine className="h-4 w-4" />
                          Résumé
                        </a>
                        <button
                          onClick={beginCall}
                          className="flex flex-col items-center gap-1.5 rounded-xl border border-edge px-2 py-3 text-xs text-dim transition-colors hover:border-ink hover:text-ink"
                        >
                          <RotateCcw className="h-4 w-4" />
                          Talk again
                        </button>
                      </div>
                    </motion.div>
                  ) : (
                    <div className="flex items-center justify-center border-t border-edge px-4 py-4">
                      {live ? (
                        <button
                          onClick={endCall}
                          className="flex items-center gap-2.5 rounded-full border border-edge-strong px-5 py-3 text-sm text-dim transition-colors hover:border-danger/50 hover:text-danger"
                        >
                          <PhoneOff className="h-4 w-4" />
                          End call
                        </button>
                      ) : (
                        <button
                          onClick={beginCall}
                          disabled={busy}
                          className="flex items-center gap-2.5 rounded-full bg-ink px-5 py-3 text-sm font-medium text-bg transition-[opacity,transform] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <AudioLines className={cn("h-4 w-4", busy && "animate-pulse")} />
                          {busy ? "Connecting…" : status === "idle" ? "Start talking" : "Start again"}
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
