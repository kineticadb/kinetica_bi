import { describe, it, expect } from "vitest";
import { buildStarterQuestions, buildTemplateFollowUps, type StarterTable } from "./starterQuestions";

const trips: StarterTable = {
  id: 1,
  schema: "s",
  name: "trips",
  columns: {
    fare_amount: "double",
    payment_type: "string",
    pickup_latitude: "double",
    pickup_longitude: "double",
    pickup_datetime: "timestamp",
  },
};

describe("buildStarterQuestions", () => {
  it("SQ-1: three templates in priority order", () => {
    expect(buildStarterQuestions([trips])).toEqual([
      "Show total fare_amount by payment_type",
      "Add a heatmap of trips",
      "Show fare_amount over time",
    ]);
  });
  it("SQ-2: no geo/time falls back to count template, max 3, no duplicates", () => {
    const t: StarterTable = { id: 2, schema: "s", name: "trips", columns: { fare_amount: "double", payment_type: "string" } };
    const r = buildStarterQuestions([t, t]);
    expect(r).toEqual(["Show total fare_amount by payment_type", "Show the number of trips records by payment_type"]);
  });
  it("SQ-3: empty, id/lat/lon never metric, inspection caps", () => {
    expect(buildStarterQuestions([])).toEqual([]);
    const t: StarterTable = { id: 3, schema: "s", name: "x", columns: { id: "int", user_id: "long", lat: "double", lon: "double", kind: "string" } };
    expect(buildStarterQuestions([t])).not.toContain("Show total id by kind");
    expect(buildStarterQuestions([t]).some((q) => /total (id|user_id|lat|lon)/.test(q))).toBe(false);
    const cols: Record<string, string> = {};
    for (let i = 0; i < 40; i++) cols[`c${i}`] = "int";
    cols.late_cat = "string"; // 41st column is not inspected
    expect(buildStarterQuestions([{ id: 4, schema: "s", name: "w", columns: cols }])).toEqual([]);
    const four = [1, 2, 3].map((i) => ({ id: i, schema: "s", name: "e" + i, columns: {} }));
    four.push({ id: 9, schema: "s", name: "late", columns: { a: "string" } });
    expect(buildStarterQuestions(four)).toEqual([]);
  });
  it("SQ-4: follow-ups exclude the asked question", () => {
    const r = buildTemplateFollowUps([trips], "Show total fare_amount by payment_type");
    expect(r).toEqual(["Add a heatmap of trips", "Show fare_amount over time"]);
  });
});
