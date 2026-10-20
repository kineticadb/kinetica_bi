import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  trackAiDv, pendingAiDvDrop, installAiDvEffects, dropAllTrackedAiViews, __resetAiDvLifecycleForTest,
} from "./aiDvLifecycle";
import { materializeAiDynamicView, dropAiDynamicView, listAiDynamicViews } from "../../api/client";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { useDynamicViewStore } from "../../store/dynamicViewStore";
import { EMPTY_DERIVED } from "../aiSession/constants";
import type { SessionDerived } from "../aiSession/types";

type Sink = { onDerived(d: SessionDerived): void; onReset(): void };
const holder = vi.hoisted(() => ({ sink: null as unknown }));
vi.mock("../../store/aiSessionStore", async (orig) => {
  const m = await orig<typeof import("../../store/aiSessionStore")>();
  return { ...m, setAiDvSink: (s: unknown) => { holder.sink = s; m.setAiDvSink(s as never); } };
});
const captureSink = async (): Promise<Sink> => holder.sink as Sink;

const fetchMock = vi.fn();
const okJson = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } }));
const dropCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/api/ai/dynamic-view/drop"));
const bodyOf = (c: unknown[]) => JSON.parse((c[1] as RequestInit).body as string);
const derivedWith = (ids: number[]): SessionDerived =>
  ({ ...EMPTY_DERIVED, addedDynamicViews: ids.map((id) => ({ id, name: "v", spec: {}, baseTableId: 1, columns: [], aggregated: false })) }) as unknown as SessionDerived;
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => okJson({ dropped: true }));
  vi.stubGlobal("fetch", fetchMock);
  __resetAiDvLifecycleForTest();
  useAiSessionStore.getState().reset();
  installAiDvEffects();
});
afterEach(() => vi.unstubAllGlobals());

const T = (tempId: number, nonce = "0a1b2c3d") => ({ dashboardId: 12, nonce, tempId, gen: 0 });
describe("aiDvLifecycle (139)", () => {
  it("LIFEC-1: materialize POSTs JSON; 409 surfaces the server error text", async () => {
    fetchMock.mockImplementationOnce(() => okJson({ status: "dropped" }));
    const body = { dashboardId: 12, nonce: "0a1b2c3d", tempId: -3, gen: 0, spec: {} } as never;
    expect(await materializeAiDynamicView(body)).toEqual({ status: "dropped" });
    const c = fetchMock.mock.calls[0];
    expect(String(c[0])).toContain("/api/ai/dynamic-view/materialize");
    expect((c[1] as RequestInit).method).toBe("POST");
    const msg = "you already have 5 session views (limit 5); remove one first";
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ code: "AI_DV_CAP", error: msg }), { status: 409 })));
    await expect(materializeAiDynamicView(body)).rejects.toThrow(msg);
  });

  it("LIFEC-2: drop POSTs with keepalive; list GETs", async () => {
    await dropAiDynamicView({ dashboardId: 12, nonce: "0a1b2c3d", tempId: -3, gen: 0 });
    const c = fetchMock.mock.calls[0];
    expect(String(c[0])).toContain("/api/ai/dynamic-view/drop");
    expect((c[1] as RequestInit).keepalive).toBe(true);
    fetchMock.mockImplementationOnce(() => okJson({ views: ["a"] }));
    expect(await listAiDynamicViews()).toEqual({ views: ["a"] });
    expect(String(fetchMock.mock.calls[1][0])).toContain("/api/ai/dynamic-view/list");
  });

  it("LIFEC-3: undo drops the view once, bumps gen, clears the dv store, untracks", async () => {
    const clear = vi.spyOn(useDynamicViewStore.getState(), "clearView");
    trackAiDv(T(-3));
    const s = await captureSink();
    s.onDerived(derivedWith([]));
    expect(dropCalls()).toHaveLength(1);
    expect(bodyOf(dropCalls()[0])).toEqual({ dashboardId: 12, nonce: "0a1b2c3d", tempId: -3, gen: 0 });
    expect(useAiSessionStore.getState().dvGen[-3]).toBe(1);
    expect(clear).toHaveBeenCalledWith(-3);
    s.onDerived(derivedWith([]));
    expect(dropCalls()).toHaveLength(1);
    clear.mockRestore();
  });

  it("LIFEC-4: a still-live view is not dropped", async () => {
    trackAiDv(T(-3));
    (await captureSink()).onDerived(derivedWith([-3]));
    expect(dropCalls()).toHaveLength(0);
  });

  it("LIFEC-5: pendingAiDvDrop is in flight until settled; failure never throws and untracks", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("net")));
    trackAiDv(T(-3));
    const s = await captureSink();
    s.onDerived(derivedWith([]));
    const p = pendingAiDvDrop(-3);
    expect(p).toBeInstanceOf(Promise);
    await expect(p).resolves.toBeUndefined();
    await Promise.resolve();
    expect(pendingAiDvDrop(-3)).toBeUndefined();
    s.onDerived(derivedWith([]));
    expect(dropCalls()).toHaveLength(1);
  });

  it("LIFEC-6: reset drops every tracked view with its own nonce and clears dv store entries", async () => {
    const clear = vi.spyOn(useDynamicViewStore.getState(), "clearView");
    trackAiDv(T(-3, "aaaaaaaa"));
    trackAiDv(T(-4, "bbbbbbbb"));
    (await captureSink()).onReset();
    expect(dropCalls().map((c) => bodyOf(c).nonce).sort()).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    expect(clear).toHaveBeenCalledWith(-3);
    expect(clear).toHaveBeenCalledWith(-4);
    (await captureSink()).onReset();
    expect(dropCalls()).toHaveLength(2);
    clear.mockRestore();
  });

  it("LIFEC-7: dropAllTrackedAiViews resolves even when fetch rejects", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("net")));
    trackAiDv(T(-3));
    trackAiDv(T(-4));
    await expect(dropAllTrackedAiViews()).resolves.toBeUndefined();
    expect(dropCalls()).toHaveLength(2);
  });

  it("LIFEC-8: installAiDvEffects is idempotent", async () => {
    installAiDvEffects();
    installAiDvEffects();
    trackAiDv(T(-3));
    (await captureSink()).onDerived(derivedWith([]));
    expect(dropCalls()).toHaveLength(1);
  });
});

