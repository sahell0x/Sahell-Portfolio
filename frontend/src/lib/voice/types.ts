/** Shared types for the voice assistant. */

/** Sections the assistant can scroll to — must match SECTIONS in backend app/tools.py. */
export const PAGE_SECTIONS = [
  "about",
  "experience",
  "skills",
  "projects",
  "contact",
] as const;

export type PageSection = (typeof PAGE_SECTIONS)[number];

/** Tool names the agent invokes on this page — must match TOOL_NAMES in backend app/tools.py. */
export const PAGE_ACTIONS = [
  "show_section",
  "open_terminal",
  "download_resume",
  "open_contact_form",
] as const;

export type PageActionName = (typeof PAGE_ACTIONS)[number];

/** Arguments an action arrives with. Only show_section takes any. */
export interface PageActionPayload {
  section?: unknown;
}

/**
 * Every frame the backend can send down the conversation socket.
 *
 * The first five are Vox's own web-call protocol and the page has to honour
 * them precisely — in particular `mark`, which the page echoes back once the
 * audio in front of it has played. That echo is the only way the engine learns
 * what the visitor actually *heard*, which is what makes an interruption record
 * a truthful history instead of crediting the agent with words it never spoke.
 *
 * The rest are this project's own: transcripts, the session clock, and page
 * control. `page_action` is the one that expects an answer — the agent needs to
 * know what it did, or why it couldn't, to speak around it.
 */
export type ServerMessage =
  /** The `init` handshake landed; the assistant is about to speak. */
  | { type: "ack" }
  /** base64 signed 16-bit PCM at the session's `output_sample_rate`. */
  | { type: "audio"; data: string }
  | { type: "text"; data: string }
  /** Echo this back once everything sent before it has finished playing. */
  | { type: "mark"; name: string }
  /** The visitor cut in: drop whatever is still queued, unplayed and uncredited. */
  | { type: "clear"; data?: null }
  | { type: "session_warning"; remaining_seconds: number }
  | { type: "session_ended"; reason: string }
  /**
   * A line of the conversation. Assistant text streams in as it is synthesized,
   * so `text` is a fragment to append and `final` closes the turn. User text
   * arrives once, already final.
   */
  | { type: "transcript"; role: "user" | "assistant"; text: string; final: boolean }
  /** A page-control tool call awaiting a `page_action_result` with the same id. */
  | { type: "page_action"; id: string; method: PageActionName; payload: PageActionPayload };

/** Every frame the page sends back. */
export type ClientMessage =
  /** Sent once on open. Vox stays silent until it arrives. */
  | { type: "init"; meta_data: { context_data: Record<string, unknown> } }
  /** base64 signed 16-bit PCM at the session's `input_sample_rate`. */
  | { type: "audio"; data: string }
  /** A turn the visitor typed instead of spoke. */
  | { type: "text"; data: string }
  | { type: "mark"; name: string }
  | { type: "page_action_result"; id: string; ok: boolean; result?: string; error?: string };

export interface TranscriptTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** False while the assistant is still speaking this turn. */
  done: boolean;
}

export type VoiceStatus =
  | "idle"
  | "requesting-mic"
  | "connecting"
  | "listening"
  /** The visitor finished a turn; Kaira hasn't started answering yet. */
  | "thinking"
  | "speaking"
  | "ended"
  | "rate-limited"
  | "mic-denied"
  | "error";

/**
 * What this visitor has left, so the page can say so before they try.
 *
 * Mirrors `Quota` in backend `app/limits.py`. `remaining_*` is already the
 * smaller of the device's and the network's budgets, so it can be shown as-is.
 */
export interface Quota {
  remaining_hour: number;
  remaining_day: number;
  /** The whole daily allowance, so the warning can say "1 of 3" not just "3 left". */
  per_day: number;
  /** Seconds until the hourly budget frees a slot; 0 when one is free now. */
  resets_in: number;
  /** A session is already open on this browser — almost always another tab. */
  active_elsewhere: boolean;
  /** Seconds before this browser may start again. */
  cooldown_remaining: number;
  allowed: boolean;
}

/** `GET /limits` — the quota plus the constants needed to explain it. */
export interface LimitsResponse extends Quota {
  session_seconds: number;
  cooldown_seconds: number;
}

/**
 * The rates the two sides have to agree on, reported rather than hardcoded.
 *
 * Neither is recoverable from the bytes: PCM carries no header. Guessing the
 * input rate mishears the visitor, and guessing the output rate detunes the
 * assistant's voice, so the server names both.
 */
export interface AudioFormat {
  input_sample_rate: number;
  output_sample_rate: number;
}

export interface SessionCredentials {
  session_id: string;
  /** Absolute ws:// or wss:// url for this conversation's socket. */
  url: string;
  /** One-shot ticket, spent on the handshake. */
  token: string;
  session_seconds: number;
  warn_seconds: number;
  audio: AudioFormat;
  quota: Quota;
}

/** Stable codes from `LimitReason` in backend `app/limits.py`. */
export type LimitCode =
  | "device_active"
  | "cooldown"
  | "device_hourly"
  | "device_daily"
  | "ip_hourly"
  | "ip_daily"
  | "ip_concurrency"
  | "concurrency"
  | "daily_ceiling"
  | "unknown";

export interface SessionError {
  error: LimitCode | string;
  message: string;
  retry_after?: number;
  text_fallback?: boolean;
  quota?: Quota;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
