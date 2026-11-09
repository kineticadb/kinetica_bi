// Phase 149 (FEEDBACK-V22-01): answer rating + per-user AI prefs. RATE-1..8, PREFS-1..5.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/index";
import { db } from "../src/db";
import { sessionFor, makeRole, resetAiTables, listenApp } from "./helpers/aiRouteKit";

let servers: Server[] = [];
let base = "";
let dee: { cookie: string }, eve: { cookie: string }, nora: { cookie: string };
let n = 0;

type Over = Partial<{ username: string; request_id: string | null; status: string; outcome: string | null; kind: string | null }>;
function answer(over: Over = {}): number {
  n++;
  const r = { username: "dee", request_id: `uuid-${n}`, status: "final", outcome: "ok" as string | null, kind: "ask" as string | null, ...over };
  const info = db
    .prepare(
      `INSERT INTO ai_audit (ts_ms, username, request_id, question, answer_text, status, outcome, counted, kind)
       VALUES (@ts, @username, @request_id, 'q', 'a', @status, @outcome, 1, @kind)`,
    )
    .run({ ts: Date.now(), ...r });
  return Number(info.lastInsertRowid);
}
const stored = (id: number) =>
  db.prepare("SELECT rating, rating_reasons, rating_note, rated_ts_ms FROM ai_audit WHERE id=?").get(id) as {
    rating: string | null; rating_reasons: string | null; rating_note: string | null; rated_ts_ms: number | null;
  };
const rate = (id: number | string, body: unknown, who: { cookie: string } | null = dee) =>
  fetch(`${base}/api/ai/answers/${id}/rating`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(who ? { Cookie: who.cookie } : {}) },
    body: JSON.stringify(body),
  });
const getPrefs = (who: { cookie: string } | null = dee) => fetch(`${base}/api/ai/prefs`, { headers: who ? { Cookie: who.cookie } : {} });
const putPrefs = (body: unknown, who: { cookie: string } | null = dee) =>
  fetch(`${base}/api/ai/prefs`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(who ? { Cookie: who.cookie } : {}) },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  resetAiTables();
  const app = await createApp();
  const l = await listenApp(app);
  servers.push(l.server);
  base = l.base;
  dee = sessionFor("dee", ["designer"]);
  eve = sessionFor("eve", ["designer"]);
  nora = sessionFor("nora", [makeRole("noai", ["dashboards:view"])]);
});
afterEach(() => {
  for (const s of servers) s.close();
  servers = [];
  vi.restoreAllMocks();
});

describe("RATE-1 rate own answer", () => {
  it("RATE-1: up is stored", async () => {
    const id = answer();
    const r = await rate(id, { rating: "up" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ rating: "up" });
    const s = stored(id);
    expect(s.rating).toBe("up");
    expect(s.rating_reasons).toBeNull();
    expect(s.rating_note).toBeNull();
    expect(typeof s.rated_ts_ms).toBe("number");
  });
});

describe("RATE-2 switch and clear", () => {
  it("RATE-2: down with reasons, up drops them, null clears", async () => {
    const id = answer();
    expect((await rate(id, { rating: "up" })).status).toBe(200);
    expect((await rate(id, { rating: "down", reasons: ["wrong_chart", "other"], note: "  chart is wrong  " })).status).toBe(200);
    let s = stored(id);
    expect(s.rating).toBe("down");
    expect(s.rating_reasons).toBe('["wrong_chart","other"]');
    expect(s.rating_note).toBe("chart is wrong");
    expect((await rate(id, { rating: "up" })).status).toBe(200);
    s = stored(id);
    expect(s).toMatchObject({ rating: "up", rating_reasons: null, rating_note: null });
    expect((await rate(id, { rating: "down", reasons: ["other"], note: "x" })).status).toBe(200);
    expect((await rate(id, { rating: null })).status).toBe(200);
    s = stored(id);
    expect(s).toMatchObject({ rating: null, rating_reasons: null, rating_note: null });
    expect((await rate(id, { rating: "down", reasons: [], note: "   " })).status).toBe(200);
    s = stored(id);
    expect(s).toMatchObject({ rating: "down", rating_reasons: null, rating_note: null });
    expect((await rate(id, { rating: "down", note: "y".repeat(500) })).status).toBe(200);
    expect(stored(id).rating_note).toBe("y".repeat(500));
  });
});

describe("RATE-3 rateable variants", () => {
  it("RATE-3: generate, legacy NULL kind, mixed-case username", async () => {
    const g = answer({ kind: "generate" });
    const legacy = answer({ kind: null, request_id: "uuid-legacy" });
    const mixed = answer({ username: "Dee" });
    for (const id of [g, legacy, mixed]) {
      expect((await rate(id, { rating: "up" })).status).toBe(200);
      expect(stored(id).rating).toBe("up");
    }
  });
});

describe("RATE-4 ownership", () => {
  it("RATE-4: another user's id and a missing id give the same 404", async () => {
    const id = answer();
    const other = await rate(id, { rating: "up" }, eve);
    const missing = await rate(999999, { rating: "up" }, eve);
    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    const body = await other.json();
    expect(body).toEqual({ error: "Answer not found.", code: "AI_ANSWER_NOT_FOUND" });
    expect(body).toEqual(await missing.json());
    expect(stored(id).rating).toBeNull();
  });
});

describe("RATE-5 not rateable", () => {
  it("RATE-5: 409 and nothing stored", async () => {
    const cases: Over[] = [
      { outcome: "cancelled" },
      { outcome: "capped" },
      { outcome: "provider_error" },
      { outcome: "rate_limited" },
      { status: "running", outcome: null },
      { kind: "keep", request_id: "keep-1-a", outcome: "kept" },
      { kind: "mcp", request_id: "mcp-1-1", outcome: "ok" },
      { kind: null, request_id: "keep-9-x", outcome: "ok" },
    ];
    for (const c of cases) {
      const id = answer(c);
      const r = await rate(id, { rating: "up" });
      expect(r.status, JSON.stringify(c)).toBe(409);
      expect(await r.json()).toMatchObject({ code: "AI_NOT_RATEABLE" });
      expect(stored(id).rating).toBeNull();
    }
  });
});

describe("RATE-6 validation", () => {
  it("RATE-6: bad bodies and ids give 400", async () => {
    const id = answer();
    const bodies: unknown[] = [
      { rating: "meh" },
      {},
      { rating: "up", reasons: ["wrong_data"] },
      { rating: "up", note: "x" },
      { rating: null, note: "x" },
      { rating: "down", reasons: ["nope"] },
      { rating: "down", reasons: ["other", "other"] },
      { rating: "down", note: "x".repeat(501) },
      { rating: "down", extra: 1 },
    ];
    for (const b of bodies) {
      const r = await rate(id, b);
      expect(r.status, JSON.stringify(b)).toBe(400);
      expect(await r.json()).toMatchObject({ code: "AI_RATE_BAD_REQUEST" });
      expect(stored(id).rating).toBeNull();
    }
    for (const bad of ["abc", "0"]) {
      const r = await rate(bad, { rating: "up" });
      expect(r.status).toBe(400);
      expect(await r.json()).toMatchObject({ code: "AI_RATE_BAD_REQUEST" });
    }
  });
});

describe("RATE-7 gate", () => {
  it("RATE-7: 401 without a session, 403 without ai:use", async () => {
    const id = answer();
    expect((await rate(id, { rating: "up" }, null)).status).toBe(401);
    const r = await rate(id, { rating: "up" }, nora);
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: "PERMISSION_DENIED", permission: "ai:use" });
  });
});

describe("RATE-8 no note in logs", () => {
  it("RATE-8: the note is never logged", async () => {
    const id = answer();
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const r = await rate(id, { rating: "down", note: "SECRET_NOTE_149" });
    expect(r.status).toBe(200);
    for (const s of spies) for (const call of s.mock.calls) expect(call.join(" ")).not.toContain("SECRET_NOTE_149");
  });
});

describe("PREFS", () => {
  it("PREFS-1: default shows rating buttons", async () => {
    const r = await getPrefs();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ showRatingButtons: true });
  });
  it("PREFS-2: persists per lower-cased username across sessions", async () => {
    const r = await putPrefs({ showRatingButtons: false });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ showRatingButtons: false });
    expect(await (await getPrefs()).json()).toEqual({ showRatingButtons: false });
    expect(await (await getPrefs(sessionFor("dee", ["designer"]))).json()).toEqual({ showRatingButtons: false });
    expect(await (await getPrefs(sessionFor("DEE", ["designer"]))).json()).toEqual({ showRatingButtons: false });
    expect((await putPrefs({ showRatingButtons: true })).status).toBe(200);
    expect(await (await getPrefs()).json()).toEqual({ showRatingButtons: true });
  });
  it("PREFS-3: other users are unaffected", async () => {
    await putPrefs({ showRatingButtons: false });
    expect(await (await getPrefs(eve)).json()).toEqual({ showRatingButtons: true });
  });
  it("PREFS-4: strict partial body, else 400", async () => {
    for (const b of [{}, { showRatingButtons: "no" }, { showRatingButtons: true, approveFirst: true }]) {
      const r = await putPrefs(b);
      expect(r.status, JSON.stringify(b)).toBe(400);
      expect(await r.json()).toMatchObject({ code: "AI_PREFS_BAD_REQUEST" });
    }
  });
  it("PREFS-5: 401 and 403 gates on GET and PUT", async () => {
    expect((await getPrefs(null)).status).toBe(401);
    expect((await putPrefs({ showRatingButtons: false }, null)).status).toBe(401);
    expect((await getPrefs(nora)).status).toBe(403);
    expect((await putPrefs({ showRatingButtons: false }, nora)).status).toBe(403);
  });
});
