// 137: whether the server has AI configured. Module-cached; never starts an ask (Pitfall 1).
import { useEffect, useState } from "react";
import { getAiConfig } from "../../api/client";

let cached: Promise<boolean> | null = null;

export function useAiConfigured(enabled = true): boolean | null {
  const [value, setValue] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    cached ??= Promise.resolve()
      .then(() => getAiConfig())
      .then((c) => c.enabled)
      .catch(() => false);
    void cached.then((v) => {
      if (live) setValue(v);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return enabled ? value : null;
}

export function __resetAiConfigCacheForTest(): void {
  cached = null;
}
