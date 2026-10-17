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

/**
 * Fast 32-character hex hash from an arbitrary string.
 * Generates four 32-bit mixed integers -> 32 hex characters.
 */
function hashString(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  let h3 = 0x811c9dc5;
  let h4 = 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
    h3 = Math.imul(h3 ^ ch, 2246822519);
    h4 = Math.imul(h4 ^ ch, 3266489917);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822519);
  h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489917);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2654435761);
  h4 = Math.imul(h4 ^ (h4 >>> 13), 1597334677);
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0") +
    (h3 >>> 0).toString(16).padStart(8, "0") +
    (h4 >>> 0).toString(16).padStart(8, "0")
  );
}

/**
 * Computes a stable browser and hardware fingerprint.
 *
 * It combines signals that are identical in both normal and incognito windows
 * on the same machine:
 * - Screen geometry & color depth
 * - Timezone & offset
 * - System language & languages list
 * - Hardware concurrency (logical CPU cores)
 * - Canvas 2D font rasterization & subpixel antialiasing
 * - WebGL unmasked GPU renderer and vendor
 */
function computeFingerprint(): string {
  if (typeof window === "undefined") return "";

  const components: string[] = [];

  // Hardware & screen
  const screen = window.screen;
  if (screen) {
    components.push(`${screen.width}x${screen.height}x${screen.colorDepth}`);
    components.push(`${screen.availWidth}x${screen.availHeight}`);
  }

  // Locale & Timezone
  try {
    components.push(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
  } catch {
    // ignore
  }
  components.push(String(new Date().getTimezoneOffset()));
  components.push(navigator.language || "");
  if (Array.isArray(navigator.languages)) {
    components.push(navigator.languages.join(","));
  }

  // System capabilities
  components.push(String(navigator.hardwareConcurrency || ""));
  components.push(navigator.userAgent || "");

  // WebGL & Canvas rendering (deterministic per GPU / driver / OS font rendering)
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.textBaseline = "alphabetic";
      ctx.font = "14px 'Arial', sans-serif";
      ctx.fillStyle = "#f60";
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("KairaVoiceAgent,123!?", 2, 15);
      ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
      ctx.fillText("KairaVoiceAgent,123!?", 4, 17);
      components.push(canvas.toDataURL());
    }

    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (gl && "getExtension" in gl) {
      const debugInfo = (gl as WebGLRenderingContext).getExtension(
        "WEBGL_debug_renderer_info",
      );
      if (debugInfo) {
        const renderer = (gl as WebGLRenderingContext).getParameter(
          debugInfo.UNMASKED_RENDERER_WEBGL,
        );
        const vendor = (gl as WebGLRenderingContext).getParameter(
          debugInfo.UNMASKED_VENDOR_WEBGL,
        );
        components.push(`${vendor}~${renderer}`);
      }
    }
  } catch {
    // Canvas or WebGL blocked
  }

  return hashString(components.join("###"));
}

function mint(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}

let cachedId: string | null = null;

export function getDeviceId(): string {
  if (typeof window === "undefined") return "";

  if (cachedId) return cachedId;

  // 1. Stable hardware/browser fingerprint:
  // Identical in normal mode and incognito mode on the same machine.
  const fp = computeFingerprint();
  if (VALID.test(fp)) {
    cachedId = fp;
    try {
      window.localStorage.setItem(STORAGE_KEY, cachedId);
    } catch {
      // Ephemeral / private mode
    }
    return cachedId;
  }

  // 2. Fallback to localStorage if available
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && VALID.test(stored)) {
      cachedId = stored;
      return stored;
    }
  } catch {
    // Private mode, or storage blocked.
  }

  // 3. Fallback to minting a fresh ID
  cachedId = mint();
  try {
    window.localStorage.setItem(STORAGE_KEY, cachedId);
  } catch {
    // Ephemeral
  }

  return cachedId;
}

/** Headers every voice API call carries, so the server can attribute it. */
export function deviceHeaders(): Record<string, string> {
  const id = getDeviceId();
  return id ? { "X-Device-Id": id } : {};
}

