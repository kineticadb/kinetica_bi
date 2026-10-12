// Phase 135-11 Task 2: KEY sentinel matrix through the REAL OpenAI-compatible adapter (AIPRV-V20-05).
// KEY_SENTINEL is configured as AI_API_KEY; it may appear only in the provider Authorization header.
// Positive controls: KEY-P1 (the header carries it), KEY-P2 (console capture + detector fire), KEY-P3 (BODYSENTINEL is in the fixtures).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/index";
import { db } from "../src/db";
import { __setAiProviderFactoryForTest } from "../src/lib/ai/providers";
import { __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { KEY_SENTINEL, FAKE_PROVIDER_BASE_URL, findLeak, captureConsole, forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeDashboard, makeTableOn, makeRole, resetAiTables, validAsk, listenApp, pollUntil } from "./helpers/aiRouteKit";

const realFetch = globalThis.fetch;
const FIX = join(__dirname, "fixtures/ai/openai");
const fx = (f: string) => readFileSync(join(FIX, f), "utf8");
const BODY_SENTINEL = "BODYSENTINEL";

type Reply = (signal?: AbortSignal | null) => Response | Promise<Response>;
const sse = (text: string): Reply => () => new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
const json = (status: number, text: string): Reply => () => new Response(text, { status, headers: { "content-type": "application/json" } });
const tool = (name: string, args: unknown): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", tool_calls: [{ index: 0, id: "c1", type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] })}\n\n` +
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`;

let restoreEnv: (() => void) | null = null;
let servers: Server[] = [];
let providerCalls: { url: string; headers: Record<string, string>; body: string }[] = [];
let queue: Reply[] = [];
let cap: ReturnType<typeof captureConsole>;
let consoleAll = "";

function installNetwork(): void {
  forbidProviderNetwork(
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url).hostname === "provider.test") {
        providerCalls.push({ url, headers: { ...(init?.headers as Record<string, string>) }, body: String(init?.body ?? "") });
        const sig = init?.signal;
        if (sig?.aborted) throw new DOMException("aborted", "AbortError");
        const r = queue.length > 1 ? queue.shift()! : queue[0];
        return r ? r(sig) : new Response("{}", { status: 500 });
      }
      // kinetica.test: schema probe
      const body = { status: "OK", message: "", data_type: "execute_sql_response", data_str: JSON.stringify({ json_encoded_response: JSON.stringify({ column_headers: ["zone", "fare"] }) }) };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch,
    { allowHosts: ["provider.test"] },
  );
}

async function boot(env: Record<string, string> = {}) {
  restoreEnv = enableAiEnv(env);
  const app = await createApp();
  const { base, server } = await listenApp(app);
  servers.push(server);
  const dash = makeDashboard();
  makeTableOn(dash.id);
  const user = sessionFor("dee", ["designer"]);
  const post = (over: Record<string, unknown> = {}, cookie = user.cookie, signal?: AbortSignal) =>
    realFetch(`${base}/api/ai/ask`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(validAsk(dash.id, over)), signal });
  const get = async (path: string) => (await realFetch(`${base}${path}`, { headers: { Cookie: user.cookie } })).text();
  return { base, dash, user, post, get };
}

beforeEach(() => {
  resetAiTables();
  __clearLiveSchemaCacheForTest();
  providerCalls = [];
  queue = [];
  cap = captureConsole();
  installNetwork();
});
afterEach(() => {
  consoleAll += "\n" + cap.text();
  cap.restore();
  vi.unstubAllGlobals();
  __setAiProviderFactoryForTest(null);
  for (const s of servers) s.close();
  servers = [];
  restoreEnv?.();
  restoreEnv = null;
});

const auditText = () => JSON.stringify(db.prepare("SELECT * FROM ai_audit").all());

/** Runs one scenario and returns every surface the browser/operator could see. */
async function collect(env: Record<string, string>, replies: Reply[], opts: { abort?: boolean; waitFinal?: boolean } = {}) {
  queue = replies;
  const { post, get } = await boot(env);
  let sseBytes = "";
  if (opts.abort) {
    const ctl = new AbortController();
    const res = await post({}, undefined, ctl.signal);
    const reader = res.body!.getReader();
    while (!sseBytes.includes("event: status")) {
      const { value, done } = await reader.read();
      if (done) break;
      sseBytes += new TextDecoder().decode(value);
    }
    ctl.abort();
    expect(await pollUntil(() => (db.prepare("SELECT COUNT(*) c FROM ai_audit WHERE status='final'").get() as any).c === 1)).toBe(true);
  } else {
    sseBytes = await (await post()).text();
  }
  const surfaces = {
    sse: sseBytes,
    config: await get("/api/ai/config"),
    me: await get("/api/auth/me"),
    audit: auditText(),
    console: cap.text(),
  };
  return surfaces;
}
function expectKeyFree(s: Record<string, string>): string[] {
  for (const [name, text] of Object.entries(s)) expect(findLeak(text, KEY_SENTINEL), `${name} leaked the key`).toBeNull();
  return Object.keys(s);
}
const SURFACES = ["sse", "config", "me", "audit", "console"];

const TOOL_STEPS = { AI_MAX_TOOL_STEPS: "6" };

describe("KEY sentinel matrix (real OpenAI-compatible adapter)", () => {
  it("KEY-1 ok (text)", async () => {
    const s = await collect({}, [sse(fx("text.sse.txt"))]);
    expect(s.sse).toContain("outcome");
    expect(s.sse).toContain("Hello world");
    expect(expectKeyFree(s)).toEqual(SURFACES);
  });

  it("KEY-2 ok with a tool call then final text", async () => {
    const s = await collect(TOOL_STEPS, [sse(fx("tool_whole_args.sse.txt")), sse(fx("text.sse.txt"))]);
    expect(providerCalls).toHaveLength(2);
    expect(expectKeyFree(s)).toEqual(SURFACES);
  });

  it("KEY-3 provider 401", async () => {
    const s = await collect({}, [json(401, fx("error_401.json"))]);
    expect(s.sse).toContain("event: error");
    expectKeyFree(s);
    expect(findLeak(s.sse + s.audit + cap.text(), BODY_SENTINEL)).toBeNull();
  });

  it("KEY-4 provider 429 with a retry delay beyond budget", async () => {
    const s = await collect({}, [json(429, fx("error_429_gemini_array.json"))]);
    expect(s.sse).toContain("AI_RATE_LIMITED");
    expectKeyFree(s);
    expect(findLeak(s.sse + s.audit + cap.text(), BODY_SENTINEL)).toBeNull();
  });

  it("KEY-5 provider 500", async () => {
    const s = await collect({}, [json(500, `{"error":{"message":"${BODY_SENTINEL} upstream boom"}}`)]);
    expect(s.sse).toContain("event: error");
    expectKeyFree(s);
    expect(findLeak(s.sse + s.audit + cap.text(), BODY_SENTINEL)).toBeNull();
  });

  it("KEY-6 client abort", async () => {
    const hang: Reply = (sig) =>
      new Promise<Response>((_res, rej) => sig?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")), { once: true }));
    const s = await collect({}, [hang], { abort: true });
    expect(expectKeyFree(s)).toEqual(SURFACES);
  });

  it("KEY-7 step cap", async () => {
    const s = await collect({ AI_MAX_TOOL_STEPS: "1" }, [sse(fx("tool_whole_args.sse.txt")), sse(fx("tool_whole_args.sse.txt"))]);
    expect(s.sse).toContain("AI_CAPPED");
    expect(expectKeyFree(s)).toEqual(SURFACES);
  });

  it("KEY-8 gateway rejection", async () => {
    const s = await collect(TOOL_STEPS, [sse(tool("add_widget", { type: "bar" })), sse(fx("text.sse.txt"))]);
    expect(s.sse).toContain("shape");
    expect(expectKeyFree(s)).toEqual(SURFACES);
  });

  it("KEY-9 pre-stream refusals (403 / 400 / 404 / 429 cap)", async () => {
    const { post, get, dash } = await boot({ AI_MAX_ANSWERS_PER_USER_PER_HOUR: "1" });
    const noPerm = sessionFor("nobody", [makeRole("none", [])]);
    const bodies: string[] = [];
    const r403 = await post({}, noPerm.cookie);
    expect(r403.status).toBe(403);
    bodies.push(await r403.text());
    const r400 = await post({ question: "" });
    expect(r400.status).toBe(400);
    bodies.push(await r400.text());
    const r404 = await post({ dashboardId: dash.id + 999 });
    expect(r404.status).toBe(404);
    bodies.push(await r404.text());
    queue = [sse(fx("text.sse.txt"))];
    expect((await post()).status).toBe(200);
    const r429 = await post();
    expect(r429.status).toBe(429);
    bodies.push(await r429.text(), JSON.stringify([...r429.headers.entries()]));
    bodies.push(await get("/api/ai/config"), await get("/api/auth/me"), auditText(), cap.text());
    expect(findLeak(bodies.join("\n"), KEY_SENTINEL)).toBeNull();
    expect(bodies.length).toBe(9);
  });

  it("KEY-10 disabled (503)", async () => {
    const { post } = await boot({ AI_ENABLED: "false" });
    const res = await post();
    expect(res.status).toBe(503);
    expect(findLeak(await res.text(), KEY_SENTINEL)).toBeNull();
  });

  // ---- positive controls ----
  it("KEY-P1 the provider Authorization header carries the key (it is configured and used)", async () => {
    await collect({}, [sse(fx("text.sse.txt"))]);
    expect(providerCalls.length).toBeGreaterThan(0);
    for (const c of providerCalls) {
      expect(c.url).toBe(`${FAKE_PROVIDER_BASE_URL}/chat/completions`);
      expect(c.headers.Authorization).toBe(`Bearer ${KEY_SENTINEL}`);
      expect(findLeak(c.body, KEY_SENTINEL)).toBeNull(); // ...and only the header, never the body
    }
  });

  it("KEY-P2 console capture + detector fire on a deliberate leak", () => {
    console.log("leak " + KEY_SENTINEL);
    expect(findLeak(cap.text(), KEY_SENTINEL)).toBe("raw");
    console.error(new Error("x " + KEY_SENTINEL));
    expect(cap.text().split(KEY_SENTINEL).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("KEY-P3 the provider error fixtures really carry BODYSENTINEL", () => {
    for (const f of ["error_400.json", "error_401.json", "error_429_gemini_array.json"]) expect(findLeak(fx(f), BODY_SENTINEL)).toBe("raw");
    expect(findLeak("clean", BODY_SENTINEL)).toBeNull();
  });
});
