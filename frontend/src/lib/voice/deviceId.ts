/**
 * A stable id for this browser profile.
 *
 * Stored in `localStorage` precisely because localStorage is shared across every
 * tab of the same profile — which is what lets the server recognise a second tab
 * as the same visitor and refuse it, instead of handing out a second session.
 *
 * It is not a security control. Clearing site data mints a new one, and that is
 * fine: the server's per-IP and global caps are the real ceiling. This layer
 * exists so the common case — someone with three tabs open — gets a message that
 * tells them what to do, rather than a generic rate-limit wall.
 */

const STORAGE_KEY = "sahil-portfolio-device-id";

/** Must match `_DEVICE_ID` in backend `app/main.py`, or the server ignores it. */
const VALID = /^[A-Za-z0-9_-]{8,64}$/;

function mint(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  // Older Safari: any 32 hex chars will do, this is an identifier not a secret.
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}

/**
 * Held in memory so a browser with storage disabled still gets one id for the
 * life of the tab, rather than a fresh one on every request.
 */
let fallbackId: string | null = null;

export function getDeviceId(): string {
  if (typeof window === "undefined") return "";

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && VALID.test(stored)) return stored;

    const fresh = mint();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Private mode, or storage blocked. The visitor loses the multi-tab
    // message; every server-side cap still applies to them.
    fallbackId ??= mint();
    return fallbackId;
  }
}

/** Headers every voice API call carries, so the server can attribute it. */
export function deviceHeaders(): Record<string, string> {
  const id = getDeviceId();
  return id ? { "X-Device-Id": id } : {};
}
