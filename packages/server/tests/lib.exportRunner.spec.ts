import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSession, getSession } from "../src/sessionStore";
import {
  principalForSession,
  SessionEndedError,
  getExportDir,
  getExportViewTtlMinutes,
} from "../src/lib/exportRunner";
import path from "node:path";

describe("runner primitives", () => {
  it("EXPRUN-principal-fresh: principalForSession maps a password session like auth.ts and returns a new object per call", () => {
    const sid = createSession({ username: "alice", secret: "export-test-secret", kineticaUrl: process.env.KINETICA_URL! });
    const a = principalForSession(sid);
    const b = principalForSession(sid);
    expect(a).not.toBe(b);
    expect(a.user!.sub).toBe("alice");
    expect(a.user!.sid).toBe(sid);
    expect(a.user!.credentialType).toBe("password");
    expect(a.user!.creds.username).toBe("alice");
    expect(a.user!.creds.password).toBe("export-test-secret");
    expect(a.user!.creds.token).toBe("");
    expect(a.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a.requestId).not.toBe(b.requestId);
  });

  it("EXPRUN-principal-dead: a deleted session throws SessionEndedError", async () => {
    const { deleteSession } = await import("../src/sessionStore");
    const sid = createSession({ username: "bob", secret: "s", kineticaUrl: process.env.KINETICA_URL! });
    deleteSession(sid);
    expect(() => principalForSession(sid)).toThrow(SessionEndedError);
  });

  it("EXPRUN-principal-url-mismatch: another kineticaUrl throws SessionEndedError and the row is deleted", () => {
    const sid = createSession({ username: "carol", secret: "s", kineticaUrl: "https://other.test:9191" });
    expect(() => principalForSession(sid)).toThrow(SessionEndedError);
    expect(getSession(sid)).toBeNull();
  });

  it("EXPRUN-env-defaults: blank envs give <cwd>/data/exports and 60", () => {
    process.env.EXPORT_DIR = "";
    process.env.EXPORT_VIEW_TTL_MINUTES = "";
    expect(getExportDir()).toBe(path.join(process.cwd(), "data", "exports"));
    expect(getExportViewTtlMinutes()).toBe(60);
  });

  it("EXPRUN-env-ttl-bad: invalid TTL falls back to 60 and warns once per bad value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const bad of ["abc", "0"]) {
        process.env.EXPORT_VIEW_TTL_MINUTES = bad;
        expect(getExportViewTtlMinutes()).toBe(60);
        expect(getExportViewTtlMinutes()).toBe(60);
      }
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      process.env.EXPORT_VIEW_TTL_MINUTES = "";
    }
  });
});
