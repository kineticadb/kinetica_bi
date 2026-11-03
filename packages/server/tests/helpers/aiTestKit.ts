// Phase 135 AI test kit: canary, key sentinel, leak detector, console capture, provider-network guard.
// Call `vi.unstubAllGlobals()` in afterEach - `vi.restoreAllMocks` does NOT undo stubGlobal (research Pitfall 7).
import { vi } from "vitest";

export const CANARY_ROW_VALUE_9f3 = "CANARY_ROW_VALUE_9f3";
export const KEY_SENTINEL = "sk-test-KEYSENTINEL";
export const FAKE_PROVIDER_BASE_URL = "https://provider.test/v1";

/** Returns which encoded form of `needle` appears in `haystack` (raw / url / base64), or null. */
export function findLeak(haystack: string, needle: string): string | null {
  if (haystack.includes(needle)) return "raw";
  if (haystack.includes(encodeURIComponent(needle))) return "url";
  if (haystack.includes(Buffer.from(needle, "utf8").toString("base64"))) return "base64";
  return null;
}

export function captureConsole(): { text(): string; restore(): void } {
  const lines: string[] = [];
  const fmt = (a: unknown): string => {
    if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
    if (typeof a === "object" && a !== null) {
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    }
    return String(a);
  };
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(fmt).join(" "));
    }),
  );
  return { text: () => lines.join("\n"), restore: () => spies.forEach((s) => s.mockRestore()) };
}

export class ProviderNetworkForbidden extends Error {
  constructor(host: string) {
    super(`ProviderNetworkForbidden: ${host}`);
    this.name = "ProviderNetworkForbidden";
  }
}

const hostOf = (input: RequestInfo | URL): string => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
};

/** Stubs global fetch: delegates to `inner` only for kinetica.test or `allowHosts`; everything else throws. */
export function forbidProviderNetwork(inner?: typeof fetch, opts: { allowHosts?: string[] } = {}): void {
  const allowed = new Set(["kinetica.test", ...(opts.allowHosts ?? [])]);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const host = hostOf(input);
    if (allowed.has(host) && inner) return inner(input, init);
    return Promise.reject(new ProviderNetworkForbidden(host));
  });
}
