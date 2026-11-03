// TEST-ONLY providers. Never import from production code (135-11 enforces).
import { isOutboundRequest, type OutboundRequest } from "../outbound";
import type { Capabilities, LlmEvent, LlmProvider } from "../provider";

export type ScriptStep = LlmEvent[] | ((req: OutboundRequest, callIndex: number) => LlmEvent[]);

const CAPS: Capabilities = { nativeTools: true, parallelTools: true, streaming: true, usageInStream: true, forcedToolChoice: false, opaqueReplay: false };

export class ScriptedProvider implements LlmProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: Capabilities = CAPS;
  readonly requests: OutboundRequest[] = [];
  private calls = 0;
  constructor(private readonly steps: ScriptStep[], opts: { id?: string; model?: string } = {}) {
    this.id = opts.id ?? "scripted";
    this.model = opts.model ?? "scripted-model";
  }
  async *complete(req: OutboundRequest, signal: AbortSignal): AsyncIterable<LlmEvent> {
    if (!isOutboundRequest(req)) throw new Error("ScriptedProvider: request is not an OutboundRequest");
    this.requests.push(req);
    const i = this.calls++;
    if (signal.aborted) {
      yield { type: "error", kind: "aborted" };
      return;
    }
    const step = this.steps[i];
    if (step === undefined) throw new Error(`ScriptedProvider: call ${i + 1} exceeds the script (${this.steps.length} steps)`);
    yield* typeof step === "function" ? step(req, i) : step;
  }
}

export class RecordingProvider implements LlmProvider {
  readonly requests: OutboundRequest[] = [];
  constructor(private readonly inner: LlmProvider) {}
  get id() { return this.inner.id; }
  get model() { return this.inner.model; }
  get capabilities() { return this.inner.capabilities; }
  async *complete(req: OutboundRequest, signal: AbortSignal): AsyncIterable<LlmEvent> {
    this.requests.push(req);
    yield* this.inner.complete(req, signal);
  }
}
