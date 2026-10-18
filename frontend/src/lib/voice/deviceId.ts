/**
 * A stable id for this browser profile using FingerprintJS.
 *
 * Stored in `localStorage` and resolved via `@fingerprintjs/fingerprintjs`
 * so that both normal browsing and incognito mode on the same machine
 * produce the exact same visitor identifier.
 */
import FingerprintJS from "@fingerprintjs/fingerprintjs";

const STORAGE_KEY = "sahil-portfolio-device-id";

/** Must match `_DEVICE_ID` in backend `app/main.py`, or the server ignores it. */
const VALID = /^[A-Za-z0-9_-]{8,64}$/;

function mint(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}

let cachedId: string | null = null;
let fpPromise: Promise<string> | null = null;

/**
 * Initializes FingerprintJS and resolves the stable visitor identifier.
 */
export async function getFingerprintId(): Promise<string> {
  if (typeof window === "undefined") return "";

  if (cachedId && VALID.test(cachedId)) return cachedId;

  // Check localStorage first for instant availability
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && VALID.test(stored)) {
      cachedId = stored;
    }
  } catch {
    // Storage blocked / private mode
  }

  if (!fpPromise) {
    fpPromise = FingerprintJS.load()
      .then((fp) => fp.get())
      .then((result) => {
        const id = result.visitorId;
        if (VALID.test(id)) {
          cachedId = id;
          try {
            window.localStorage.setItem(STORAGE_KEY, id);
          } catch {
            // Ephemeral in private browsing
          }
          return id;
        }
        return cachedId || mint();
      })
      .catch(() => cachedId || mint());
  }

  const id = await fpPromise;
  return id || cachedId || mint();
}

/**
 * Synchronous getter: returns the cached or stored ID if available.
 */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "";

  if (cachedId && VALID.test(cachedId)) return cachedId;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && VALID.test(stored)) {
      cachedId = stored;
      return stored;
    }
  } catch {
    // Storage blocked
  }

  // Trigger background initialization if not already started
  void getFingerprintId();

  return cachedId || "";
}

/**
 * Asynchronous header getter: ensures FingerprintJS has resolved before sending request.
 */
export async function getDeviceHeaders(): Promise<Record<string, string>> {
  const id = await getFingerprintId();
  return id ? { "X-Device-Id": id } : {};
}

/**
 * Synchronous header getter: used for unload/beacon where async is not possible.
 */
export function deviceHeaders(): Record<string, string> {
  const id = getDeviceId();
  return id ? { "X-Device-Id": id } : {};
}

// Start loading the fingerprint immediately on browser execution
if (typeof window !== "undefined") {
  void getFingerprintId();
}
