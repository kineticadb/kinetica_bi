/**
 * Phase 78 (TTLKEEP-V115-01): Dashboard-level keep-alive hook.
 *
 * FRONTEND-ONLY. The touch is a READ via runSql("SELECT 1 FROM <viewName> LIMIT 1"), never a
 * materialize/drop/from-swap. AggregatedWidgetRenderer stays the SOLE materialize trigger.
 *
 * RE-ARM DESIGN (avoids the fixed-expiresAt tight-loop trap):
 *   A touch READ does NOT return a new expiresAt — the store's expiresAt stays fixed. If re-arm
 *   were keyed off the unchanged stored expiresAt, every re-arm would compute a negative delay
 *   (now > expiresAt - lead) and collapse to MIN_DELAY, hammering the server. Instead we capture
 *   W ≈ (expiresAt - Date.now()) at the first observation of a live view. After the first touch
 *   fires (assuming the read reset the server-side sliding TTL — the PREMISE this whole phase is
 *   built on, validated live in Phase 79), the next touch is scheduled at max(W - leadMs, MIN_INTERVAL)
 *   from now. That gives a stable interval: lead-time before the *next* (assumed-reset) expiry
 *   without referencing the stale stored expiresAt.
 *
 * ASSUME READ RESETS TTL: Phase 79 (TTLKEEP-V115-02) confirms live that a read actually resets
 * Kinetica's sliding TTL and provides the re-materialize fallback if it does not. This phase
 * is best-effort; failures are swallowed and the existing reactive view-not-found recovery in
 * WidgetRenderer/MapChartRenderer handles real expiry.
 *
 * Mount: DashboardsPage.tsx DashboardOpen, alongside useDynamicViewMaterializeChain and
 * useCombinationOrchestrator (the map-only spatial hook was removed in Phase 93.5-02).
 */

import { useEffect, useRef } from "react";

import { useFilterViewStore } from "../store/filterViewStore";
import { useDynamicViewStore } from "../store/dynamicViewStore";
import { useFilterCombinationStore } from "../store/filterCombinationStore";
import { useAuthStore } from "../store/auth";
import { runSql } from "../api/client";

// Floor for the FIRST touch delay when already inside the lead window — avoids a 0/negative
// timeout firing synchronously and hammering the server on every re-sync.
const MIN_DELAY = 1_000; // 1s

// Floor for the RE-ARM interval so a pathologically small TTL (where W - leadMs <= 0) cannot
// produce a sub-30-second touch cadence.
const MIN_INTERVAL = 30_000; // 30s

/**
 * Dashboard-level keep-alive hook.
 *
 * While a dashboard is open, fires a lightweight READ touch against each LIVE materialized
 * view (filter-views + dynamic-views) ~ttlKeepaliveLeadMinutes before that view's expiresAt.
 * Re-arms after each touch using a captured window length W so the re-arm interval is stable
 * across multiple TTL windows. Tears down all timers and in-flight AbortControllers on unmount.
 */
export function useViewKeepAlive(dashboardId: number): void {
  // Per-view timers (keyed by "f:<tableId>" or "d:<dvId>")
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Per-view in-flight AbortControllers (one per concurrent touch)
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  // Per-view captured window length W (captured once when a key is first observed live)
  const windowRef = useRef<Map<string, number>>(new Map());

  // --- Primitive subscriptions: re-run re-sync effect when any live-view signature changes ---
  // Including viewName + expiresAt + version/status so the effect re-runs whenever a view
  // appears, disappears, re-materializes, or changes its expiry.
  const filterKey = useFilterViewStore((s) =>
    Object.entries(s.views)
      .map(([tid, e]) => `${tid}:${e.viewName}:${e.expiresAt}:${e.materializeVersion}`)
      .sort()
      .join(","),
  );

  const dynamicKey = useDynamicViewStore((s) =>
    Object.entries(s.views)
      .map(([id, e]) => `${id}:${e.status}:${e.viewName}:${e.expiresAt ?? 0}`)
      .sort()
      .join(","),
  );

  // Phase 89 (COMBO-V118-02): primitive subscription for combination-registry views.
  // Primitive-string projection (S-02 compliant) — does NOT subscribe to the registry
  // object reference; encodes viewName + expiresAt + materializeVersion for each entry
  // so the re-sync effect fires whenever a combination view appears, disappears, or changes.
  const combinationKey = useFilterCombinationStore((s) =>
    Object.entries(s.registry)
      .map(([hash, e]) => `${hash}:${e.viewName}:${e.expiresAt}:${e.materializeVersion}`)
      .sort()
      .join(","),
  );

  // --- Touch helper: fires a single best-effort READ, swallows errors ---
  function touch(key: string, viewName: string): void {
    // Abort + delete any prior in-flight controller for this view
    controllersRef.current.get(key)?.abort();
    controllersRef.current.delete(key);

    const ctrl = new AbortController();
    controllersRef.current.set(key, ctrl);

    runSql(`SELECT 1 FROM ${viewName} LIMIT 1`, {}, ctrl.signal)
      .catch(() => {})
      .finally(() => {
        // Prune the controller only if it's still ours (not replaced by a subsequent touch)
        if (controllersRef.current.get(key) === ctrl) {
          controllersRef.current.delete(key);
        }
      });
  }

  // --- Scheduling helper: sets the FIRST touch timer; on fire, sets a stable RE-ARM timer ---
  function schedule(key: string, viewName: string, expiresAt: number): void {
    // Read lead-time at schedule time (deploy-config; effectively constant per session)
    const leadMs =
      useAuthStore.getState().ttlKeepaliveLeadMinutes * 60_000;

    // Capture W once per view key (not on every re-sync — recapture happens only when the
    // entry for this key is deleted from windowRef, which we do when a view re-materializes
    // or disappears, see re-sync below).
    if (!windowRef.current.has(key)) {
      windowRef.current.set(key, Math.max(expiresAt - Date.now(), MIN_INTERVAL));
    }
    const W = windowRef.current.get(key)!;

    // FIRST touch: fire ~leadMs before expiresAt; clamp to MIN_DELAY when already inside lead
    const firstDelay = Math.max(expiresAt - leadMs - Date.now(), MIN_DELAY);

    // RE-ARM interval: stable W-based cadence; floor at MIN_INTERVAL to avoid hammer
    const reArmInterval = Math.max(W - leadMs, MIN_INTERVAL);

    // Clear any existing timer for this key before scheduling
    const prev = timersRef.current.get(key);
    if (prev !== undefined) clearTimeout(prev);

    // Self-rescheduling fire function: first invocation at firstDelay; subsequent at reArmInterval
    function fire(): void {
      touch(key, viewName);
      // Re-arm at the stable interval (NOT firstDelay — that avoids the fixed-expiresAt trap)
      timersRef.current.set(key, setTimeout(fire, reArmInterval));
    }

    timersRef.current.set(key, setTimeout(fire, firstDelay));
  }

  // --- RE-SYNC EFFECT: runs whenever a live-view signature changes ---
  useEffect(() => {
    // Build the current live-view set
    const liveKeys = new Map<string, { viewName: string; expiresAt: number }>();

    // Filter-views: live when viewName is non-empty AND expiresAt > 0 AND not expired
    for (const [tidStr, entry] of Object.entries(
      useFilterViewStore.getState().views,
    )) {
      if (
        entry.viewName &&
        entry.expiresAt > 0 &&
        Date.now() < entry.expiresAt
      ) {
        liveKeys.set(`f:${tidStr}`, {
          viewName: entry.viewName,
          expiresAt: entry.expiresAt,
        });
      }
    }

    // Dynamic-views: live when status === "materialized" AND expiresAt is set and > 0 AND not expired
    for (const [idStr, entry] of Object.entries(
      useDynamicViewStore.getState().views,
    )) {
      if (
        entry.status === "materialized" &&
        entry.expiresAt !== undefined &&
        entry.expiresAt > 0 &&
        Date.now() < entry.expiresAt
      ) {
        liveKeys.set(`d:${idStr}`, {
          viewName: entry.viewName,
          expiresAt: entry.expiresAt,
        });
      }
    }

    // Phase 89 (COMBO-V118-02): combination-registry views. Live when viewName non-empty AND
    // expiresAt > 0 AND not expired. Key prefix "c:" avoids collision with "f:" and "d:".
    // The existing schedule/touch/prune loops operate generically over liveKeys — c: keys
    // flow through automatically without any additional change.
    for (const [hash, entry] of Object.entries(
      useFilterCombinationStore.getState().registry,
    )) {
      if (entry.viewName && entry.expiresAt > 0 && Date.now() < entry.expiresAt) {
        liveKeys.set(`c:${hash}`, {
          viewName: entry.viewName,
          expiresAt: entry.expiresAt,
        });
      }
    }

    // For each live view: schedule if no timer exists yet for this key.
    // Strategy: on each effect run, if the key is already scheduled, leave the running timer
    // in place (the dep-key already incorporates viewName+expiresAt+version so a
    // re-materialization bumps the dep key, causing this effect to re-run; we then clear
    // windowRef[key] below so W recaptures from the fresh expiresAt).
    for (const [key, { viewName, expiresAt }] of liveKeys.entries()) {
      if (!timersRef.current.has(key)) {
        // Newly live view — delete any stale windowRef so W is recaptured from fresh expiresAt
        windowRef.current.delete(key);
        schedule(key, viewName, expiresAt);
      }
      // If the key already has a timer, the currently-running fire/reArm loop continues.
      // If the view re-materialized (same key, new expiresAt), the dep-key change fires
      // this effect again; the key won't be in timersRef if the prune below cleared it.
    }

    // Prune keys that are no longer live (disappeared, expired, or status changed)
    for (const key of Array.from(timersRef.current.keys())) {
      if (!liveKeys.has(key)) {
        clearTimeout(timersRef.current.get(key)!);
        timersRef.current.delete(key);
        controllersRef.current.get(key)?.abort();
        controllersRef.current.delete(key);
        windowRef.current.delete(key);
      }
    }
    // Also prune controller keys that are no longer live (in case they appeared without a timer)
    for (const key of Array.from(controllersRef.current.keys())) {
      if (!liveKeys.has(key)) {
        controllersRef.current.get(key)?.abort();
        controllersRef.current.delete(key);
      }
    }

    // Do NOT return a cleanup here — that would tear down timers on every dep-key bump.
    // The empty-deps unmount effect below is the sole teardown point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, dynamicKey, combinationKey, dashboardId]);

  // --- UNMOUNT TEARDOWN EFFECT (empty deps): clears all timers + aborts all controllers ---
  // Mirrors useDynamicViewMaterializeChain:256-263. No orphaned timer may fire after unmount.
  useEffect(
    () => () => {
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
      controllersRef.current.forEach((c) => c.abort());
      controllersRef.current.clear();
      windowRef.current.clear();
    },
    [],
  );
}
