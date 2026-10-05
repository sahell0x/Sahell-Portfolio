"use client";

/**
 * The orb — a fluid outline that deforms with the measured audio level, with
 * two delayed ghosts trailing behind it.
 *
 * The shape is a circle whose radius is displaced by three sine harmonics.
 * Integer harmonic numbers matter: they keep the curve continuous where it
 * wraps at 2π, so the outline never shows a seam. Loudness scales the
 * displacement amplitude, not just the radius, so the blob gets *more liquid*
 * as it talks rather than merely bigger.
 *
 * State reads through contrast rather than hue — solid ink while the assistant
 * speaks, dimmer while it listens, hairline grey before the call connects.
 * Colours are read from the `globals.css` tokens at runtime, so the light/dark
 * toggle re-themes the orb with no work here.
 */
import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

interface VoiceOrbProps {
  /** 0..1 loudness of whichever side is talking. */
  level: number;
  speaking: boolean;
  /** False before the call connects — the orb sits still and quiet. */
  active: boolean;
  /** Kaira is working out a reply: a comet circles while the outline breathes. */
  thinking?: boolean;
  /** A smaller orb, for when the transcript needs the room. */
  compact?: boolean;
}

/** [harmonic, amplitude, angular speed] — see the note above on integer k. */
const HARMONICS: ReadonlyArray<readonly [number, number, number]> = [
  [3, 0.55, 0.0011],
  [5, 0.35, -0.0016],
  [7, 0.22, 0.0009],
];

/** Geometry was tuned against a 380px stage; everything scales off that. */
const REFERENCE_SIZE = 380;

export function VoiceOrb({
  level,
  speaking,
  active,
  thinking = false,
  compact = false,
}: VoiceOrbProps) {
  const reduce = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The animation loop runs outside React, so the latest props reach it
  // through refs rather than by restarting the loop on every level change.
  const props = useRef({ level, speaking, active, thinking });
  useEffect(() => {
    props.current = { level, speaking, active, thinking };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let size = 0;
    let frame = 0;
    let smoothed = 0;
    // 0..1, eased, so the comet fades in and out instead of popping.
    let think = 0;

    // Token lookups force a style recalc, so they are refreshed a few times a
    // second rather than every frame. Fast enough that a theme switch reads as
    // instant, cheap enough to be free.
    let ink = "";
    let edgeStrong = "";
    const readTokens = () => {
      const s = getComputedStyle(canvas);
      ink = s.getPropertyValue("--ink").trim();
      edgeStrong = s.getPropertyValue("--edge-strong").trim();
    };

    const resize = () => {
      const next = canvas.clientWidth;
      if (!next || next === size) return;
      size = next;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /** One closed blob outline. `phase` offsets a ghost in time. */
    const trace = (t: number, radius: number, amp: number) => {
      const c = size / 2;
      ctx.beginPath();
      for (let i = 0; i <= 220; i++) {
        const th = (i / 220) * Math.PI * 2;
        let d = 0;
        for (const [k, a, sp] of HARMONICS) d += a * Math.sin(k * th + t * sp);
        const r = radius + amp * d;
        const x = c + Math.cos(th) * r;
        const y = c + Math.sin(th) * r;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    };

    const draw = (t: number) => {
      const {
        level: raw,
        speaking: isSpeaking,
        active: isActive,
        thinking: isThinking,
      } = props.current;
      think += ((isThinking ? 1 : 0) - think) * (reduce ? 1 : 0.08);

      // Measured level is jumpy; ease toward it so the outline flows.
      const want = isActive ? Math.min(Math.max(raw, 0), 1) : 0;
      smoothed += (want - smoothed) * (reduce ? 1 : 0.12);
      const l = smoothed;

      const u = size / REFERENCE_SIZE;
      ctx.clearRect(0, 0, size, size);

      // Thinking: a slow inhale/exhale, so the wait reads as work, not a stall.
      const breath = think * Math.sin(t * 0.0032) * 4;
      const radius = (100 + l * 17 + breath) * u;
      const amp = (5 + l * 22) * u;

      // Ghosts: the same outline sampled further back in time, so they read as
      // a wake rather than as separate rings.
      if (!reduce) {
        ctx.lineWidth = Math.max(1, 1.4 * u);
        ctx.strokeStyle = edgeStrong;
        ctx.globalAlpha = 0.55;
        trace(t - 900, (104 + l * 16) * u, amp);
        ctx.globalAlpha = 0.35;
        trace(t - 1800, (108 + l * 15) * u, amp);
      }

      ctx.globalAlpha = isActive ? (isSpeaking ? 1 : 0.7) : 1;
      ctx.strokeStyle = isActive ? ink : edgeStrong;
      ctx.lineWidth = Math.max(1.25, 2.2 * u);
      trace(t, radius, amp);

      // Comet orbiting just outside the outline while she thinks.
      if (think > 0.01) {
        const c = size / 2;
        const orbit = radius + 14 * u;
        const head = reduce ? -Math.PI / 2 : t * 0.0042;
        const tail = 1.1;
        const steps = 24;
        ctx.lineCap = "round";
        for (let i = 0; i < steps; i++) {
          const a0 = head - tail * (i / steps);
          const a1 = head - tail * ((i + 1) / steps);
          ctx.globalAlpha = think * (1 - i / steps) * 0.9;
          ctx.strokeStyle = ink;
          ctx.lineWidth = Math.max(1.5, 3 * u) * (1 - i / steps / 2);
          ctx.beginPath();
          ctx.arc(c, c, orbit, a1, a0);
          ctx.stroke();
        }
        ctx.lineCap = "butt";
        ctx.globalAlpha = 1;
      }

      // Centre mark — the only filled element, and the clearest read on level.
      ctx.globalAlpha = isActive ? 0.25 + l * 0.5 : 0.18;
      ctx.fillStyle = isActive ? ink : edgeStrong;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, (9 + l * 7) * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    };

    // The loop runs either way. Under reduced motion the clock is pinned to
    // zero — the shape never undulates — but the loop still repaints, so a
    // change of state (connecting, speaking) is reflected rather than frozen.
    let raf = 0;
    const loop = (t: number) => {
      resize();
      if (frame++ % 20 === 0) readTokens();
      if (size) draw(reduce ? 0 : t);
      raf = requestAnimationFrame(loop);
    };

    readTokens();
    resize();
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  return (
    <div
      className={
        compact
          ? "relative grid h-24 w-24 place-items-center transition-[width,height] duration-300"
          : "relative grid h-44 w-44 place-items-center transition-[width,height] duration-300 sm:h-52 sm:w-52"
      }
    >
      <canvas ref={canvasRef} aria-hidden className="h-full w-full" />
    </div>
  );
}
