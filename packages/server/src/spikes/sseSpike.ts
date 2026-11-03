/**
 * sseSpike.ts — S2 spike (Phase 133): POST + fetch-ReadableStream SSE through the real
 * Express middleware (express.json 1mb, cookie-parser, requireAuth).
 *
 * PURPOSE: prove (or disprove) that a POST that streams `text/event-stream` is delivered
 * incrementally to a Node fetch() ReadableStream client, and record cookie-auth, 1 MB limit,
 * client-abort and mid-stream session-revocation behaviour for Phases 136/137.
 *
 * USAGE:
 *   cd packages/server && DB_PATH=:memory: SESSION_ENCRYPTION_KEY=<64 hex> AUTH_SECRET=<16+ chars> \
 *     KINETICA_URL=https://kinetica.test:9191 npx tsx src/spikes/sseSpike.ts
 *
 * NOT PART OF THE EXPRESS APP. No Kinetica or AI provider calls. Listens on an ephemeral port.
 */
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { requireAuth } from "../auth";
import { createSession, deleteSession } from "../sessionStore";

const t0 = Date.now();
const ts = () => Date.now() - t0;
const results: Record<string, { pass: boolean; detail: string }> = {};
const record = (id: string, pass: boolean, detail: string) => {
  results[id] = { pass, detail };
  console.log(`[${ts()}ms] ${id} ${pass ? "PASS" : "FAIL"} — ${detail}`);
};

let serverCloseAt: number | null = null;
let revokeTarget: string | null = null;
let streamEventsAfterRevoke = 0;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.post("/spike/stream", requireAuth, async (req, res) => {
  const mode = (req.body as { mode?: string } | undefined)?.mode ?? "normal";
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  let closed = false;
  res.on("close", () => {
    closed = true;
    serverCloseAt = Date.now();
  });
  res.write(": ping\n\n");
  const n = mode === "long" ? 6 : 3;
  for (let i = 1; i <= n; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (closed) return;
    if (mode === "long" && revokeTarget === null && i === 3) {
      // no-op marker
    }
    if (mode === "long" && i > 3) streamEventsAfterRevoke++;
    res.write(`data: ${JSON.stringify({ i, at: Date.now() })}\n\n`);
  }
  res.end();
});

// Mirrors errorMiddleware's body-parser branch (JSON 413).
app.use((err: Error & { type?: string; status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Payload too large", code: "PAYLOAD_TOO_LARGE" });
  return res.status(err.status ?? 500).json({ error: err.message });
});

const forge = () => {
  const username = "admin";
  const sid = createSession({ username, secret: "spike-secret", kineticaUrl: process.env.KINETICA_URL! });
  const token = jwt.sign({ sub: username, sid, v: 1 }, process.env.AUTH_SECRET!, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
};

const readEvents = async (resp: Response, onChunk: (text: string, at: number) => void) => {
  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(dec.decode(value, { stream: true }), Date.now());
  }
};

const main = async () => {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (cookie: string | null, body: unknown, signal?: AbortSignal) =>
    fetch(`${base}/spike/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal,
    });

  // C2 (no cookie) + C3 first (no stream involved)
  const noCookie = await post(null, {});
  const noCookieBody = await noCookie.text();
  const { cookie, sid } = forge();
  record("C2a", noCookie.status === 401 && noCookieBody.includes("REAUTH_REQUIRED"), `no cookie -> ${noCookie.status} ${noCookieBody}`);

  const big = await post(cookie, JSON.stringify({ pad: "x".repeat(1_100_000) }));
  const bigText = await big.text();
  record("C3", big.status === 413 && (big.headers.get("content-type") ?? "").includes("json"), `>1MB body -> ${big.status} ${big.headers.get("content-type")} ${bigText} (before stream: no event-stream content-type)`);

  // C1 + C2b + C6
  const events: { at: number; text: string }[] = [];
  const startedAt = Date.now();
  const ok = await post(cookie, {});
  record("C2b", ok.status === 200 && (ok.headers.get("content-type") ?? "").includes("text/event-stream"), `with cookie -> ${ok.status} ${ok.headers.get("content-type")} x-accel-buffering=${ok.headers.get("x-accel-buffering")}`);
  await readEvents(ok, (text, at) => events.push({ at: at - startedAt, text }));
  const dataEvents = events.filter((e) => e.text.includes("data:"));
  const times = dataEvents.map((e) => e.at);
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  record("C1", dataEvents.length === 3 && gaps.every((g) => g >= 350 && g <= 800), `data event receive times(ms since request)=${JSON.stringify(times)} gaps=${JSON.stringify(gaps)}`);
  record("C6", events.some((e) => e.text.startsWith(": ping\n\n")), `heartbeat chunk intact: ${JSON.stringify(events[0]?.text)} at ${events[0]?.at}ms`);

  // C4 abort after first data event
  serverCloseAt = null;
  const ac = new AbortController();
  const r4 = await post(cookie, {}, ac.signal);
  let abortedAt = 0;
  try {
    await readEvents(r4, (text) => {
      if (text.includes("data:") && !abortedAt) {
        abortedAt = Date.now();
        ac.abort();
      }
    });
  } catch {
    /* AbortError expected */
  }
  await new Promise((r) => setTimeout(r, 1000));
  const lag = serverCloseAt ? serverCloseAt - abortedAt : null;
  record("C4", lag !== null && lag <= 1000, `client abort -> server res 'close' observed after ${lag}ms`);

  // C5 revoke session mid-stream (long mode: 6 events, revoke after event 2)
  revokeTarget = sid;
  streamEventsAfterRevoke = 0;
  const r5 = await post(cookie, { mode: "long" });
  let seen = 0;
  let revoked = false;
  let total = 0;
  await readEvents(r5, (text) => {
    const c = (text.match(/data:/g) ?? []).length;
    seen += c;
    total += c;
    if (!revoked && seen >= 2) {
      revoked = true;
      deleteSession(sid);
    }
  });
  record("C5", total === 6, `session deleted after event 2; stream delivered ${total}/6 events (continues=${total === 6}); requireAuth runs only at request start`);
  const after = await post(cookie, {});
  record("C5b", after.status === 401, `new POST with revoked session -> ${after.status}`);
  await after.text();

  console.log("\nDECISION-RECORD");
  for (const [k, v] of Object.entries(results)) console.log(`  ${k}: ${v.pass ? "PASS" : "FAIL"} — ${v.detail}`);
  server.close();
  process.exit(Object.values(results).every((r) => r.pass) ? 0 : 1);
};

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
