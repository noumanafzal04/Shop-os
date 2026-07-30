// crypto.randomUUID() only exists in a *secure context* (HTTPS or localhost),
// so it is undefined when the panel is served over plain HTTP — e.g. the
// staging droplet on http://<ip>:8080. Calling it there throws and crashes the
// page. This helper prefers randomUUID when available, then falls back to a
// getRandomValues-based v4 (getRandomValues DOES work over HTTP), and finally
// to Math.random. These IDs are client-side idempotency keys, not secrets, so
// the non-crypto last resort is acceptable.
export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;

  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }

  if (c && typeof c.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
