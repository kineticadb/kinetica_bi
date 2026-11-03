import { describe, it, expect, beforeEach } from "vitest";
import { useDashboardVersionStore } from "./dashboardVersionStore";

const s = () => useDashboardVersionStore.getState();
const reads = (id: number, v: [number, number, number, number]) => {
  s().noteRead(id, "widgets", v[0]);
  s().noteRead(id, "layers", v[1]);
  s().noteRead(id, "dynamic-views", v[2]);
  s().noteRead(id, "tables", v[3]);
};

describe("dashboardVersionStore", () => {
  beforeEach(() => {
    useDashboardVersionStore.setState({ byDashboard: {} });
  });
  it("KVS-1: no reads -> undefined", () => {
    expect(s().baseline(12)).toBeUndefined();
  });
  it("KVS-2: min over four lists", () => {
    reads(12, [5, 5, 6, 5]);
    expect(s().baseline(12)).toBe(5);
  });
  it("KVS-3: own chain advances", () => {
    reads(12, [5, 5, 6, 5]);
    s().noteWrite(12, 5, 6);
    s().noteWrite(12, 6, 9);
    expect(s().baseline(12)).toBe(9);
  });
  it("KVS-4: out-of-order own writes still fold", () => {
    reads(12, [5, 5, 5, 5]);
    s().noteWrite(12, 6, 7);
    expect(s().baseline(12)).toBe(5);
    s().noteWrite(12, 5, 6);
    expect(s().baseline(12)).toBe(7);
  });
  it("KVS-5: foreign write breaks chain", () => {
    reads(12, [5, 5, 5, 5]);
    s().noteWrite(12, 5, 6);
    s().noteWrite(12, 7, 8);
    expect(s().baseline(12)).toBe(6);
  });
  it("KVS-6: no-op write changes nothing", () => {
    reads(12, [5, 5, 5, 5]);
    s().noteWrite(12, 5, 5);
    expect(s().baseline(12)).toBe(5);
  });
  it("KVS-7: dashboards isolated", () => {
    reads(12, [5, 5, 5, 5]);
    reads(13, [2, 2, 2, 2]);
    s().noteWrite(13, 2, 3);
    expect(s().baseline(12)).toBe(5);
    expect(s().baseline(13)).toBe(3);
  });
  it("KVS-8: clear resets", () => {
    reads(12, [5, 5, 5, 5]);
    s().clear(12);
    expect(s().baseline(12)).toBeUndefined();
    reads(12, [8, 8, 8, 8]);
    expect(s().baseline(12)).toBe(8);
  });
});
