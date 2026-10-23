// Phase 142-05 Task 3: boot/sweep/logout wiring of the generated-dashboard discard in src/index.ts (source-regex gate).
// Lives in its own file: tests/bootstrap.spec.ts is in the server gate's KNOWN_FAILING set and would mask these.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const gateStart = src.lastIndexOf('if (process.env.NODE_ENV !== "test") {');
const gate = src.slice(gateStart);
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe("generated sweep wiring (GENSWEEP)", () => {
  it("GENSWEEP-1 boot sweep runs after the view sweep and before listen", () => {
    expect(gateStart).toBeGreaterThan(0);
    const a = gate.indexOf("await sweepAiViewsOnBoot(");
    const b = gate.indexOf("await sweepGeneratedOnBoot(");
    const l = gate.indexOf("app.listen(port");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(l).toBeGreaterThan(b);
    expect(count(src, "await sweepGeneratedOnBoot(")).toBe(1);
  });
  it("GENSWEEP-2 hourly sweep starts after the audit sweep, inside the gate", () => {
    expect(count(src, "startGeneratedSweep();")).toBe(1);
    const a = gate.indexOf("startAiAuditSweep();");
    const g = gate.indexOf("startGeneratedSweep();");
    expect(a).toBeGreaterThan(-1);
    expect(g).toBeGreaterThan(a);
  });
  it("GENSWEEP-3 logout discards between the view drop and the session delete, in a try/catch", () => {
    const start = src.indexOf('app.post("/api/auth/logout"');
    const body = src.slice(start, src.indexOf("app.get(", start));
    const d = body.indexOf("dropViewsForSid(");
    const p = body.indexOf("discardPendingForUser(");
    const s = body.indexOf("deleteSession(decoded.sid)");
    expect(d).toBeGreaterThan(-1);
    expect(p).toBeGreaterThan(d);
    expect(s).toBeGreaterThan(p);
    expect(/try\s*\{[^}]*discardPendingForUser\(/s.test(body)).toBe(true);
  });
});
