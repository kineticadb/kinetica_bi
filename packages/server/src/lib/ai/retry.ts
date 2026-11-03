// Phase 135-04 / D-14: wait-and-retry budget for provider 429 / overloaded.
// This file only decides "wait" vs "give up"; the answer-level guarantee that nothing from a failed answer is
// applied lives in the agent loop. Events are buffered per attempt: a failed attempt's partial output is dropped.
import type { OutboundRequest } from "./outbound";
import type { LlmEvent, LlmProvider } from "./provider";

export type RetryBudget = { readonly budgetMs: number; spentMs: number };
export function createRetryBudget(budgetMs = 20_000): RetryBudget {
  return { budgetMs, spentMs: 0 };
}

const abortError = (): Error => {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
};

export function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const MAX_RETRIES = 3;

export async function* withProviderRetry(
  provider: LlmProvider,
  req: OutboundRequest,
  signal: AbortSignal,
  deps: { budget: RetryBudget; sleep: (ms: number, signal: AbortSignal) => Promise<void>; onWait: (seconds: number) => void },
): AsyncGenerator<LlmEvent> {
  const { budget } = deps;
  for (let attempt = 0; ; attempt++) {
    const evs: LlmEvent[] = [];
    let err: Extract<LlmEvent, { type: "error" }> | undefined;
    for await (const e of provider.complete(req, signal)) {
      if (e.type === "error") err = e;
      else evs.push(e);
    }
    if (!err) {
      yield* evs;
      return;
    }
    const wait =
      err.kind === "rate_limited"
        ? (err.retryAfterMs ?? 2000 * 2 ** attempt)
        : err.kind === "overloaded" && attempt === 0
          ? 1500
          : null;
    if (wait === null || attempt >= MAX_RETRIES || budget.spentMs + wait > budget.budgetMs) {
      yield err;
      return;
    }
    deps.onWait(Math.ceil(wait / 1000));
    await deps.sleep(wait, signal);
    budget.spentMs += wait;
  }
}
