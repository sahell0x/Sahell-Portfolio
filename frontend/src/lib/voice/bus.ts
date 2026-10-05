/**
 * Kaira's voice, readable from anywhere on the page.
 *
 * The session writes here every animation frame; the hero signal and the
 * launcher read it from their own animation loops. It is a plain mutable object
 * on purpose — sixty updates a second through React state would re-render
 * every reader for nothing. Readers that need to *re-render* on a change (a
 * label that says "Kaira is speaking") subscribe to the coarse state instead,
 * which only notifies when `active` or `speaking` flips.
 */
export interface VoiceBus {
  /** A call is open. */
  active: boolean;
  /** Kaira is audibly talking right now. */
  speaking: boolean;
  /** Kaira is working out a reply. */
  thinking: boolean;
  /** 0..1, Kaira's own output level (not the visitor's mic). */
  level: number;
}

export const voiceBus: VoiceBus = {
  active: false,
  speaking: false,
  thinking: false,
  level: 0,
};

const listeners = new Set<() => void>();

/** Update the bus; notifies subscribers only when the coarse state changes. */
export function writeVoiceBus(next: Partial<VoiceBus>) {
  const before = `${voiceBus.active}${voiceBus.speaking}${voiceBus.thinking}`;
  Object.assign(voiceBus, next);
  const after = `${voiceBus.active}${voiceBus.speaking}${voiceBus.thinking}`;
  if (before !== after) listeners.forEach((l) => l());
}

export function resetVoiceBus() {
  writeVoiceBus({ active: false, speaking: false, thinking: false, level: 0 });
}

export function subscribeVoiceBus(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Snapshot for `useSyncExternalStore`; a string so equal states compare equal. */
export function voiceBusSnapshot(): string {
  if (!voiceBus.active) return "off";
  if (voiceBus.speaking) return "speaking";
  if (voiceBus.thinking) return "thinking";
  return "listening";
}

export const voiceBusServerSnapshot = () => "off";

/** Fired by page actions so the page can show where Kaira took the visitor. */
export const KAIRA_NAVIGATED = "kaira:navigated";
