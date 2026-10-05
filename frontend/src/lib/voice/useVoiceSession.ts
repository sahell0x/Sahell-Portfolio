"use client";

/**
 * Owns the socket, the microphone and the speaker for one conversation.
 *
 * The backend speaks Vox's own web-call protocol: base64 PCM up, base64 PCM and
 * `mark` events down. Two things about that are worth knowing before reading
 * the dispatch below.
 *
 * **Marks are a promise.** The engine has no idea what the visitor heard; it
 * knows only what this page confirms. Every mark is held until the audio in
 * front of it has actually played and only then echoed, and a `clear` drops the
 * held ones unechoed. Get that wrong and an interruption credits the assistant
 * with sentences nobody heard, which is how a transcript starts lying.
 *
 * **Echo cancellation is not free here.** WebRTC used to loop capture and
 * playout through one pipeline. With a raw socket the browser's AEC has to
 * cancel the page's own Web Audio output, which Chromium does well and other
 * engines less so — hence the capture constraints below, and hence headphones
 * being the honest advice for a laptop with loud speakers.
 *
 * Page-control tools arrive as `page_action` frames. The handler's return value
 * is what the agent hears back and speaks around, so it is answered on the same
 * socket rather than acted on silently.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { Microphone, Playback, decodePcm, encodeBase64 } from "./audio";
import { resetVoiceBus, writeVoiceBus } from "./bus";
import { deviceHeaders } from "./deviceId";
import {
  type ClientMessage,
  type LimitsResponse,
  type PageActionName,
  type PageActionPayload,
  type Quota,
  type ServerMessage,
  type SessionCredentials,
  type SessionError,
  type TranscriptTurn,
  type VoiceStatus,
} from "./types";

const API_BASE =
  process.env.NEXT_PUBLIC_VOICE_API_URL?.replace(/\/$/, "") ?? "";

/** Above this RMS the assistant counts as actively speaking. */
const SPEAKING_THRESHOLD = 0.015;

/**
 * How long the assistant keeps the "speaking" label through a quiet patch.
 *
 * Speech is full of gaps — between words, at commas, and while the next
 * sentence synthesizes — and every one of them drops the measured level below
 * the threshold. Without this hold the label flickers speaking/listening
 * mid-sentence, which reads as the agent losing its turn.
 */
const SPEAKING_HOLD_MS = 900;

/**
 * How long "thinking" may last before the page stops claiming it.
 *
 * Thinking is inferred — the visitor's turn landed and no reply has started —
 * so a turn the agent decides not to answer would otherwise leave it on
 * forever.
 */
const THINKING_TIMEOUT_MS = 10_000;

/**
 * Tell the server a session is over.
 *
 * `sendBeacon` because this fires from `pagehide`, where a normal fetch is
 * routinely cancelled as the document goes away. It cannot set headers, so the
 * device id rides in the query string; the server accepts it from either.
 *
 * Closing the socket releases the slot too, but not a session whose socket was
 * never opened — a tab that dies between "start" and the handshake.
 */
function releaseSession(sessionId: string): void {
  const url = `${API_BASE}/session/${encodeURIComponent(sessionId)}/end`;
  const headers = deviceHeaders();

  if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
    const withDevice = `${url}?device_id=${encodeURIComponent(headers["X-Device-Id"] ?? "")}`;
    if (navigator.sendBeacon(withDevice)) return;
  }

  void fetch(url, { method: "POST", headers, keepalive: true }).catch(() => {
    // The socket's own close and the server's TTL both cover this.
  });
}

/**
 * Ask the server what this visitor has left.
 *
 * Deliberately state-free: it returns data rather than setting it, so the
 * effects that call it never touch state synchronously in their own body.
 * Never throws — showing no budget beats showing a wrong one.
 */
async function fetchLimits(): Promise<LimitsResponse | null> {
  try {
    const response = await fetch(`${API_BASE}/limits`, { headers: deviceHeaders() });
    return response.ok ? ((await response.json()) as LimitsResponse) : null;
  } catch {
    return null;
  }
}

/** Fulfils a page-control tool call; the returned sentence goes back to the agent. */
export type PageActionRunner = (
  action: PageActionName,
  payload: PageActionPayload,
) => string;

export interface VoiceSessionState {
  status: VoiceStatus;
  /** 0..1, drives the orb. */
  level: number;
  secondsLeft: number | null;
  errorMessage: string | null;
  isEnding: boolean;
  transcript: TranscriptTurn[];
  /** What's left, so the page can say so before the visitor is refused. */
  quota: Quota | null;
  /** Seconds until a refused visitor may retry; counts down while displayed. */
  retryAfter: number;
  /** How long one session lasts, for the "sessions are N minutes" note. */
  sessionSeconds: number | null;
}

/**
 * Fold one transcript message into the log.
 *
 * Assistant text streams in fragments, so it appends to the open assistant turn
 * and only starts a new one once the previous closed. User text always lands as
 * its own finished turn.
 */
function appendTranscript(
  turns: TranscriptTurn[],
  message: Extract<ServerMessage, { type: "transcript" }>,
): TranscriptTurn[] {
  const last = turns[turns.length - 1];
  const open = last && last.role === message.role && !last.done;

  if (open) {
    // Assistant text arrives a sentence at a time, so join rather than splice.
    // A closing message carries no text and only marks the turn done.
    const addition = message.text.trim();
    const merged: TranscriptTurn = {
      ...last,
      text: addition ? `${last.text} ${addition}`.trim() : last.text,
      done: message.final,
    };
    return [...turns.slice(0, -1), merged];
  }

  if (!message.text.trim()) return turns;

  return [
    ...turns,
    {
      id: `${message.role}-${turns.length}-${message.text.slice(0, 8)}`,
      role: message.role,
      text: message.text.trimStart(),
      done: message.final,
    },
  ];
}

export function useVoiceSession(onAction: PageActionRunner) {
  const [state, setState] = useState<VoiceSessionState>({
    status: "idle",
    level: 0,
    secondsLeft: null,
    errorMessage: null,
    isEnding: false,
    transcript: [],
    quota: null,
    retryAfter: 0,
    sessionSeconds: null,
  });

  const socketRef = useRef<WebSocket | null>(null);
  const micRef = useRef<Microphone | null>(null);
  const playbackRef = useRef<Playback | null>(null);
  /** The live session, so closing the tab can hand its slot straight back. */
  const sessionIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  /** When the visitor's last turn landed with no reply yet; null otherwise. */
  const thinkingSinceRef = useRef<number | null>(null);
  /** The welcome has finished; typed questions sent before it would be dropped. */
  const welcomeDoneRef = useRef(false);
  /** A question asked before the call could take it. */
  const pendingAskRef = useRef<string | null>(null);
  // Held in a ref so the frame handlers never close over a stale callback.
  const onActionRef = useRef(onAction);
  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  const patch = useCallback((next: Partial<VoiceSessionState>) => {
    setState((prev) => ({ ...prev, ...next }));
  }, []);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  const teardown = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    rafRef.current = null;
    timerRef.current = null;

    thinkingSinceRef.current = null;
    welcomeDoneRef.current = false;
    resetVoiceBus();

    micRef.current?.close();
    micRef.current = null;
    playbackRef.current?.close();
    playbackRef.current = null;

    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      // Detached first: a close we asked for must not re-enter `stop`.
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.close();
    }

    // Hand the slot back now rather than waiting for the server to time out.
    // Without this, closing a tab and reopening the page is met with "you
    // already have a conversation open in another tab".
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sessionId) releaseSession(sessionId);
  }, []);

  const stop = useCallback(() => {
    teardown();
    setState((prev) => ({
      ...prev,
      status: prev.status === "idle" ? "idle" : "ended",
      level: 0,
      secondsLeft: null,
      isEnding: false,
    }));
  }, [teardown]);

  // Disconnect if the tab closes mid-session, so the seat is released promptly.
  useEffect(() => {
    const onUnload = () => teardown();
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      teardown();
    };
  }, [teardown]);

  const applyLimits = useCallback((body: LimitsResponse | null) => {
    if (!body) return;
    setState((prev) => ({
      ...prev,
      quota: body,
      sessionSeconds: body.session_seconds,
      retryAfter: body.cooldown_remaining || body.resets_in,
      // A refusal that no longer applies — the other tab closed, the hour
      // rolled over — has to release the UI, or the visitor is left staring at
      // a reason that stopped being true.
      ...(prev.status === "rate-limited" && body.allowed
        ? { status: "idle" as VoiceStatus, errorMessage: null }
        : null),
    }));
  }, []);

  const refreshLimits = useCallback(
    () => fetchLimits().then(applyLimits),
    [applyLimits],
  );

  // A refusal's countdown has to actually count down, or it reads as stuck.
  const isCountingDown = state.retryAfter > 0;
  useEffect(() => {
    if (!isCountingDown) return;
    const id = window.setInterval(() => {
      setState((prev) => ({ ...prev, retryAfter: Math.max(0, prev.retryAfter - 1) }));
    }, 1000);
    return () => window.clearInterval(id);
  }, [isCountingDown]);

  // Fetch the budget on mount, so the button carries its state before anyone
  // clicks, and again once a call ends, because its slot has just come back.
  const hasEnded = state.status === "ended";
  useEffect(() => {
    let live = true;
    void fetchLimits().then((body) => {
      if (live) applyLimits(body);
    });
    return () => {
      live = false;
    };
  }, [hasEnded, applyLimits]);

  const startMeter = useCallback(() => {
    // Wall-clock of the last frame the assistant was audibly above threshold.
    let lastHeardAt = 0;

    const tick = () => {
      const local = micRef.current?.level() ?? 0;
      const remote = playbackRef.current?.level() ?? 0;

      const now = performance.now();
      if (remote > SPEAKING_THRESHOLD) lastHeardAt = now;
      // Hold the turn across the gaps inside a sentence, not just the loud parts.
      const assistantSpeaking = lastHeardAt > 0 && now - lastHeardAt < SPEAKING_HOLD_MS;

      // Her voice arriving ends the wait, whatever the transcript says.
      if (assistantSpeaking) thinkingSinceRef.current = null;
      const since = thinkingSinceRef.current;
      if (since !== null && now - since > THINKING_TIMEOUT_MS) thinkingSinceRef.current = null;
      const thinking = thinkingSinceRef.current !== null;

      writeVoiceBus({
        active: true,
        speaking: assistantSpeaking,
        thinking: thinking && !assistantSpeaking,
        level: Math.min(1, remote * 6),
      });

      setState((prev) =>
        prev.status === "listening" || prev.status === "speaking" || prev.status === "thinking"
          ? {
              ...prev,
              // Show whichever side is louder, so the orb tracks the conversation.
              level: Math.min(1, Math.max(local, remote) * 6),
              status: assistantSpeaking ? "speaking" : thinking ? "thinking" : "listening",
            }
          : prev,
      );

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const runPageAction = useCallback(
    (message: Extract<ServerMessage, { type: "page_action" }>) => {
      try {
        send({
          type: "page_action_result",
          id: message.id,
          ok: true,
          result: onActionRef.current(message.method, message.payload ?? {}),
        });
      } catch (error) {
        // The message crosses the wire and the agent explains it out loud, so a
        // rejected argument has to say what was wrong with it.
        send({
          type: "page_action_result",
          id: message.id,
          ok: false,
          error: error instanceof Error ? error.message : "That didn't work.",
        });
      }
    },
    [send],
  );

  const handleFrame = useCallback(
    (message: ServerMessage) => {
      const playback = playbackRef.current;

      switch (message.type) {
        case "audio":
          playback?.enqueue(decodePcm(message.data));
          return;
        case "mark":
          playback?.mark(message.name);
          return;
        case "clear":
          playback?.clear();
          return;
        case "transcript":
          if (message.role === "user") {
            thinkingSinceRef.current = performance.now();
          } else {
            thinkingSinceRef.current = null;
            // The first assistant turn to close is the welcome.
            if (message.final && !welcomeDoneRef.current) {
              welcomeDoneRef.current = true;
              const pending = pendingAskRef.current;
              pendingAskRef.current = null;
              if (pending) send({ type: "text", data: pending });
            }
          }
          setState((prev) => ({
            ...prev,
            transcript: appendTranscript(prev.transcript, message),
          }));
          return;
        case "page_action":
          runPageAction(message);
          return;
        case "session_warning":
          // The server owns the clock; trust it over our local countdown.
          setState((prev) => ({
            ...prev,
            secondsLeft: message.remaining_seconds,
            isEnding: message.remaining_seconds <= 30,
          }));
          return;
        case "session_ended":
          stop();
          return;
        default:
          // `ack` and `text` need nothing from us; anything else is newer than
          // this client and safe to ignore.
          return;
      }
    },
    [runPageAction, send, stop],
  );

  const start = useCallback(async () => {
    if (socketRef.current) return;

    patch({ status: "requesting-mic", errorMessage: null, isEnding: false, transcript: [] });

    // Ask for the microphone before creating a session, so a denied permission
    // never burns one of the visitor's rate-limited slots. The stream is kept —
    // it is the one the capture graph runs on.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Without cancellation the assistant hears herself through laptop
          // speakers and interrupts her own sentence.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch {
      patch({
        status: "mic-denied",
        errorMessage:
          "I need microphone access to talk. You can still chat by text.",
      });
      return;
    }

    patch({ status: "connecting" });

    const abandon = (errorMessage: string, status: VoiceStatus = "error") => {
      stream.getTracks().forEach((track) => track.stop());
      patch({ status, errorMessage });
    };

    let credentials: SessionCredentials;
    try {
      const response = await fetch(`${API_BASE}/session`, {
        method: "POST",
        headers: deviceHeaders(),
      });
      if (!response.ok) {
        const body: SessionError = await response.json().catch(() => ({
          error: "unknown",
          message: "Could not start the assistant.",
        }));
        stream.getTracks().forEach((track) => track.stop());
        patch({
          status: response.status === 429 ? "rate-limited" : "error",
          errorMessage: body.message,
          quota: body.quota ?? null,
          retryAfter: body.retry_after ?? 0,
        });
        return;
      }
      credentials = await response.json();
      sessionIdRef.current = credentials.session_id;
      patch({
        quota: credentials.quota ?? null,
        retryAfter: 0,
        sessionSeconds: credentials.session_seconds,
      });
    } catch {
      abandon("Couldn't reach the assistant. Please try again.");
      return;
    }

    const rawUrl = `${credentials.url}?token=${encodeURIComponent(credentials.token)}`;
    const wsUrl =
      typeof window !== "undefined" && window.location.protocol === "https:"
        ? rawUrl.replace(/^ws:\/\//i, "wss://")
        : rawUrl;
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onmessage = (event) => {
      try {
        handleFrame(JSON.parse(event.data as string) as ServerMessage);
      } catch {
        // Non-JSON traffic isn't ours; ignore it.
      }
    };
    socket.onerror = () => {
      // `onclose` always follows, and it is the one that knows whether the
      // conversation had started; nothing useful to do twice.
    };
    socket.onclose = () => {
      if (socketRef.current === socket) stop();
    };

    try {
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        // A socket that closes before it opens never fired onopen; the handler
        // above would then resolve nothing and `start` would hang.
        socket.addEventListener("close", () => reject(new Error("refused")), { once: true });
      });

      const playback = new Playback(credentials.audio.output_sample_rate, (name) =>
        send({ type: "mark", name }),
      );
      // Autoplay needs a user gesture; the button click is ours.
      await playback.resume();
      playbackRef.current = playback;

      micRef.current = await Microphone.open(
        stream,
        credentials.audio.input_sample_rate,
        (pcm) =>
          send({
            type: "audio",
            data: encodeBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)),
          }),
      );

      // Vox stays silent until this lands: it is what plays the welcome message
      // and arms audio output for the call.
      send({ type: "init", meta_data: { context_data: {} } });
    } catch {
      teardown();
      stream.getTracks().forEach((track) => track.stop());
      patch({
        status: "error",
        errorMessage: "Couldn't connect. Please try again.",
      });
      return;
    }

    patch({ status: "listening", secondsLeft: credentials.session_seconds });
    startMeter();

    timerRef.current = window.setInterval(() => {
      setState((prev) => {
        if (prev.secondsLeft === null) return prev;
        const next = Math.max(0, prev.secondsLeft - 1);
        return { ...prev, secondsLeft: next, isEnding: next <= 30 };
      });
    }, 1000);
  }, [handleFrame, patch, send, startMeter, stop, teardown]);

  /**
   * Put a typed question to Kaira. Mid-call it is sent at once; before the
   * call can take it — not started, or still on the welcome — it waits and is
   * sent the moment the welcome finishes.
   */
  const ask = useCallback(
    (text: string) => {
      const question = text.trim();
      if (!question) return;
      if (socketRef.current?.readyState === WebSocket.OPEN && welcomeDoneRef.current) {
        send({ type: "text", data: question });
      } else {
        pendingAskRef.current = question;
      }
    },
    [send],
  );

  return { ...state, start, stop, refreshLimits, ask };
}
