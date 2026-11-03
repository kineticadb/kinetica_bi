import { describe, it, expect } from "vitest";
import {
  buildOutboundRequest, deriveOutboundRequest, isOutboundRequest, EgressViolation, part,
  type OutboundMessage, type OutboundPart,
} from "../src/lib/ai/outbound";
import { CANARY_ROW_VALUE_9f3 as C, findLeak } from "./helpers/aiTestKit";

const build = (over: { system?: OutboundPart[]; messages?: OutboundMessage[]; dataAccess?: "schema" | "query" } = {}) =>
  buildOutboundRequest({ system: [part.system("sys")], messages: [], tools: [], dataAccess: "schema", ...over });

const violation = (fn: () => unknown): EgressViolation => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EgressViolation);
    return e as EgressViolation;
  }
  throw new Error("expected EgressViolation, nothing thrown");
};

describe("outbound choke point", () => {
  it("EGR-1: schema mode admits safe classes, joins text in order, brand is not copyable", () => {
    const req = build({
      system: [part.system("S1"), part.schema("S2"), part.config("S3")],
      messages: [
        { role: "user", parts: [part.user("U1"), part.history("U2")] },
        { role: "assistant", parts: [part.history("A1")] },
        { role: "tool", toolCallId: "t1", name: "n", parts: [part.schema("T1"), part.config("T2")] },
      ],
    });
    expect(req.system).toBe("S1\nS2\nS3");
    expect(req.messages).toEqual([
      { role: "user", text: "U1\nU2" },
      { role: "assistant", text: "A1" },
      { role: "tool", toolCallId: "t1", name: "n", content: "T1\nT2" },
    ]);
    expect(isOutboundRequest(req)).toBe(true);
    expect(isOutboundRequest({ ...req })).toBe(false);
  });

  it("EGR-2: schema mode rejects values/rows anywhere without echoing the text", () => {
    for (const cls of ["rows", "values"] as const) {
      const bad = part[cls](C);
      const cases: (() => unknown)[] = [
        () => build({ system: [bad] }),
        () => build({ messages: [{ role: "user", parts: [bad] }] }),
        () => build({ messages: [{ role: "tool", toolCallId: "1", name: "n", parts: [part.schema("ok"), bad] }] }),
        () => build({ messages: [{ role: "assistant", parts: [bad] }] }),
      ];
      for (const c of cases) {
        const err = violation(c);
        expect(err.cls).toBe(cls);
        expect(err.message).not.toContain(C);
      }
    }
  });

  it("EGR-3: query mode accepts values/rows", () => {
    const req = build({ dataAccess: "query", messages: [{ role: "tool", toolCallId: "1", name: "n", parts: [part.rows(C), part.values("v")] }] });
    expect(req.messages[0]).toMatchObject({ content: `${C}\nv` });
  });

  it("EGR-4: leak detector positive control (raw, url, base64) and clean negative", () => {
    expect(findLeak(JSON.stringify({ x: `...${C}...` }), C)).not.toBeNull();
    expect(findLeak(`q=${encodeURIComponent(C + " é")}`, C + " é")).toBe("url");
    expect(findLeak(`blob ${Buffer.from(C).toString("base64")} end`, C)).toBe("base64");
    expect(findLeak("nothing here", C)).toBeNull();
  });

  it("EGR-5: request is deep-frozen", () => {
    const req = build({ messages: [{ role: "user", parts: [part.user("hi")] }] });
    expect(() => (req.messages as unknown[]).push({})).toThrow(TypeError);
    expect(() => {
      (req.messages[0] as { text: string }).text = "x";
    }).toThrow(TypeError);
  });

  it("EGR-6: deriveOutboundRequest is branded, class-checked, and refuses unbranded bases", () => {
    const req = build({ messages: [{ role: "user", parts: [part.user("hi")] }] });
    const d = deriveOutboundRequest(req, { appendSystem: [part.schema("tools...")], tools: [] });
    expect(isOutboundRequest(d)).toBe(true);
    expect(d.system).toBe("sys\ntools...");
    expect(d.tools).toEqual([]);
    expect(d.messages).toEqual([{ role: "user", text: "hi" }]);
    expect(violation(() => deriveOutboundRequest(req, { appendSystem: [part.rows(C)] })).cls).toBe("rows");
    expect(() => deriveOutboundRequest({ ...req }, {})).toThrow();
  });
});
