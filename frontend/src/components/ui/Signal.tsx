"use client";

import { useEffect, useRef } from "react";
import { voiceBus } from "@/lib/voice/bus";

/**
 * A voice signal drawn across the hero.
 *
 * It is the one decorative thing on the page, and it is here because it is
 * the work: the line idles near flat, then "speaks" in short syllable-shaped
 * bursts the way a voice agent's output does. Bringing the pointer close
 * makes it louder there, so the visitor can see it respond.
 *
 * During a call with Kaira it stops pretending: the line carries her actual
 * output level while she talks and lies nearly flat while she listens.
 *
 * Three traces share one envelope with different phases — the ink one in
 * front, two faint ones behind — which reads as a waveform rather than a
 * sine. Colours are read from the theme tokens every frame, so the toggle
 * repaints it without a remount. It stops drawing when scrolled out of view
 * and renders one still frame under reduced motion.
 */
export function Signal({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let raf = 0;
    let visible = true;

    // Pointer influence, eased so the bump glides instead of snapping.
    const pointer = { x: -1, target: 0, strength: 0 };

    // Speech envelope: a queue of syllables, each a short swell.
    let syllableStart = 0;
    let syllableLength = 0;
    let syllablePeak = 0;
    let nextSyllableAt = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const envelope = (t: number) => {
      if (t >= nextSyllableAt) {
        // Words come in runs with short gaps; sentences end in longer pauses.
        syllableStart = t;
        syllableLength = 140 + Math.random() * 220;
        syllablePeak = 0.35 + Math.random() * 0.65;
        const pause = Math.random() < 0.18 ? 700 + Math.random() * 900 : 30 + Math.random() * 90;
        nextSyllableAt = t + syllableLength + pause;
      }
      const p = (t - syllableStart) / syllableLength;
      if (p < 0 || p > 1) return 0;
      return Math.sin(p * Math.PI) ** 2 * syllablePeak;
    };

    let level = 0;

    const draw = (t: number) => {
      const styles = getComputedStyle(document.documentElement);
      const ink = styles.getPropertyValue("--ink").trim() || "#000";
      const faint = styles.getPropertyValue("--faint").trim() || "#888";

      // Smooth the envelope so syllables blend into each other.
      const target = reduce
        ? 0.55
        : voiceBus.active
          ? voiceBus.speaking
            ? Math.min(1, voiceBus.level * 1.25)
            : voiceBus.thinking
              ? 0.08 + 0.06 * Math.sin(t * 0.004)
              : 0.03
          : envelope(t);
      level += (target - level) * 0.12;
      pointer.strength += (pointer.target - pointer.strength) * 0.08;

      ctx.clearRect(0, 0, width, height);
      const mid = height / 2;
      const traces = [
        { color: faint, alpha: 0.35, phase: 1.9, scale: 0.7, width: 1 },
        { color: faint, alpha: 0.55, phase: 0.8, scale: 0.85, width: 1 },
        { color: ink, alpha: 1, phase: 0, scale: 1, width: 1.5 },
      ];

      for (const tr of traces) {
        ctx.beginPath();
        ctx.globalAlpha = tr.alpha;
        ctx.strokeStyle = tr.color;
        ctx.lineWidth = tr.width;
        ctx.lineJoin = "round";
        for (let x = 0; x <= width; x += 2) {
          const u = x / width;
          // Taper both ends so the line fades into the margins.
          const taper = Math.sin(u * Math.PI) ** 1.5;
          const near =
            pointer.x < 0 ? 0 : Math.exp(-(((x - pointer.x) / 110) ** 2)) * pointer.strength;
          const amp = (level * 0.8 + near * 0.9 + 0.04) * taper * tr.scale * (mid - 4);
          const s = t / 1000;
          const y =
            mid +
            amp *
              (Math.sin(u * 38 + s * 9 + tr.phase) * 0.55 +
                Math.sin(u * 91 - s * 14 + tr.phase * 2) * 0.3 +
                Math.sin(u * 7 + s * 3) * 0.15);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const loop = (t: number) => {
      if (visible) draw(t);
      raf = requestAnimationFrame(loop);
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) draw(0);
    });
    ro.observe(canvas);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(canvas);

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const inside = e.clientY > rect.top - 160 && e.clientY < rect.bottom + 160;
      pointer.x = e.clientX - rect.left;
      pointer.target = inside ? 1 : 0;
    };
    const onLeave = () => {
      pointer.target = 0;
    };

    if (reduce) {
      draw(0);
    } else {
      raf = requestAnimationFrame(loop);
      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerleave", onLeave);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
