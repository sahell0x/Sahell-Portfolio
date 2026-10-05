"use client";

/**
 * Text fallback for the same agent.
 *
 * Reached when the microphone is denied or the voice limit is hit, so nobody
 * lands on a dead end. It costs a fraction of a voice session.
 */
import { useEffect, useRef, useState } from "react";
import { CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatTurn } from "@/lib/voice/types";

const API_BASE =
  process.env.NEXT_PUBLIC_VOICE_API_URL?.replace(/\/$/, "") ?? "";

export function VoiceTextChat() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, pending]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || pending) return;

    const history = turns;
    setTurns([...history, { role: "user", content: message }]);
    setDraft("");
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body.message ?? "That didn't go through. Try again.");
        return;
      }
      setTurns((prev) => [...prev, { role: "assistant", content: body.reply }]);
    } catch {
      setError("Couldn't reach Kaira. Try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {turns.length === 0 && !pending && (
          <p className="font-mono text-xs leading-relaxed text-faint">
            Ask about Sahil&apos;s work — his voice-agent platform, the RAG
            systems, or what he&apos;s building now.
          </p>
        )}

        {turns.map((turn, index) => (
          <div
            key={index}
            className={cn(
              "text-sm leading-relaxed",
              turn.role === "user" ? "text-dim" : "text-ink",
            )}
          >
            <span
              className={cn(
                "mr-2 font-mono text-xs",
                turn.role === "user" ? "text-faint" : "text-ink",
              )}
            >
              {turn.role === "user" ? "you" : "sahil-ai"}
            </span>
            {turn.content}
          </div>
        ))}

        {pending && (
          <div className="font-mono text-xs text-faint">
            <span className="mr-2 text-ink">sahil-ai</span>
            thinking<span className="animate-pulse">…</span>
          </div>
        )}

        {error && (
          <p className="font-mono text-xs text-danger" role="alert">
            {error}
          </p>
        )}

        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="mt-3 flex items-center gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type a question"
          maxLength={500}
          aria-label="Message"
          className="min-w-0 flex-1 rounded-md border border-edge bg-bg px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-faint focus-visible:border-edge-strong"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          aria-label="Send"
          className="rounded-md border border-edge bg-surface-2 p-2 text-ink transition-colors hover:border-edge-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CornerDownLeft className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
