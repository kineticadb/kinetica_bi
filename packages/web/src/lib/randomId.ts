/**
 * UUID v4 generator that works on insecure origins.
 *
 * `crypto.randomUUID()` is exposed ONLY in a secure context (https:, or
 * http://localhost). A deployment reached over plain http:// at a hostname or
 * IP — e.g. http://172.31.40.253:8083 — has `crypto` but NOT `randomUUID`, so
 * calling it throws "crypto.randomUUID is not a function" and takes the whole
 * click handler down with it.
 *
 * `crypto.getRandomValues()` is NOT secure-context-gated, so the fallback is a
 * real random v4, not a counter. The final Math.random() branch exists only for
 * environments with no `crypto` at all; these ids are local React keys, never a
 * security boundary, so that degradation is acceptable.
 */

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const format = (h: string): string =>
  `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;

export const randomId = (): string => {
  const c: Crypto | undefined = typeof crypto !== "undefined" ? crypto : undefined;

  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  // RFC 4122 §4.4: version 4, variant 10xx.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return format(hex(bytes));
};
