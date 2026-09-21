/**
 * WidgetRenderer.customMetric.spec.tsx — Phase 121 Plan 06 (DXIM-V124-10 gap closure).
 *
 * Cross-environment proof for `AggregatedWidgetRenderer` resolving a custom metric's
 * expression LIVE via `applyLiveMetricExpr` instead of rendering the frozen text baked into
 * `widget.config.sql` at Apply time. See:
 *   - .planning/defect-frozen-config-sql-metric-expression.md (the defect)
 *   - packages/web/src/lib/liveMetricSql.ts (the pure resolver, unit-proven in Plan 05)
 *   - WidgetRenderer.tsx AggregatedWidgetRenderer (the wiring under test, Plan 06 Task 1)
 *
 * Fixture (the real Phase 121-04 round trip, reduced): table `demo.nyctaxi`, `tableId: 7`,
 * metric id `2` labelled `try_again`. `config.sql` freezes the SOURCE environment's definition
 * (`AVG(total_amount - tip_amount)`); the store is seeded with the TARGET environment's
 * definition (`AVG(total_amount - tip_amount) * 50.111111`).
 *
 * `widget.type` coverage: `bar` and `bignumber` are exercised directly. The remaining five
 * AggregatedWidgetRenderer types (`line`, `pie`, `scatter`, `table`, `heatmap`) route through
 * the SAME SQL-resolution path (WidgetRenderer.tsx switch at :788-806, unchanged by this plan)
 * and are therefore covered BY CONSTRUCTION, not by a dedicated per-type test — stated plainly
 * rather than implied.
 *
 * Harness copied from WidgetRenderer.spec.tsx lines 20-140 (selector-aware filterCombinationStore
 * mock, api/client partial mock, mandatory DashboardContextProvider wrapper — useDashboardContext()
 * THROWS without it). customMetricsStore and dynamicViewStore are the REAL stores (not mocked) —
 * this is what lets the reactive suspend/refetch/edit behaviors under test actually fire.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act, screen } from "@testing-library/react";
import WidgetRenderer from "./WidgetRenderer";
import { DashboardContextProvider } from "../DashboardContext";
import * as clientModule from "../../api/client";
import type { WidgetDto, DynamicViewRow, CustomMetricRow } from "../../api/client";
import { useCustomMetricsStore } from "../../store/customMetricsStore";
import { useDynamicViewStore } from "../../store/dynamicViewStore";
import * as fromSwapModule from "../../lib/fromSwap";

// Phase 121 (DXIM-V124-10) ordering lock: spy on the REAL fromSwap (delegates to the actual
// implementation — behavior is unchanged) so LIVEMETRIC-fromswap-composes can assert the
// structural precondition directly: fromSwap's first argument must ALREADY carry the resolved
// metric expression. A pure string-equality check on the final query can't distinguish
// "resolve-then-swap" from "swap-then-resolve" when neither the table name nor the metric
// expression contains a literal FROM token (the only case an ordinary regex-based fromSwap can
// ever conflate) — asserting the call argument is the only thing that actually discriminates.
vi.mock("../../lib/fromSwap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/fromSwap")>();
  return { ...actual, fromSwap: vi.fn(actual.fromSwap) };
});

// Phase 91 (READ-V118-01): selector-aware filterCombinationStore mock — mirrors
// WidgetRenderer.spec.tsx lines 42-61 exactly. vizKey convention: "w:<widgetId>".
let mockVizToHash: Record<string, string | undefined> = {};
let mockRegistry: Record<string, { viewName: string; expiresAt: number; materializing: boolean }> = {};
let mockCombinationVersion = 0;

vi.mock("../../store/filterCombinationStore", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const useFilterCombinationStore = ((selector?: (s: unknown) => unknown) => {
    const state = {
      vizToHash: mockVizToHash,
      registry: mockRegistry,
      combinationVersion: mockCombinationVersion,
    };
    return selector ? selector(state) : state;
  }) as unknown as { getState: () => unknown };
  useFilterCombinationStore.getState = () => ({
    vizToHash: mockVizToHash,
    registry: mockRegistry,
    combinationVersion: mockCombinationVersion,
    clearEntry: vi.fn(),
  });
  return { ...actual, useFilterCombinationStore };
});

// Phase 15-02 harness mocks, extended with listCustomMetrics (Phase 121 gap closure) —
// mirrors the existing listColumnDisplayConfig no-op so the new hydration effect never
// makes a real fetch by default. Tests that need a specific hydration outcome either seed
// useCustomMetricsStore directly (setConfig/upsertMetric) or override this mock's return
// with a deferred promise (LIVEMETRIC-suspend-no-query-before-hydration).
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    runSql: vi.fn(),
    materializeFilter: vi.fn(),
    dropFilterView: vi.fn(),
    listColumnDisplayConfig: vi.fn().mockResolvedValue([]),
    listCustomMetrics: vi.fn().mockResolvedValue([]),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockVizToHash = {};
  mockRegistry = {};
  mockCombinationVersion = 0;
  useCustomMetricsStore.getState().reset();
  useDynamicViewStore.getState().reset();
  (clientModule.listCustomMetrics as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

// A minimal Kinetica response shape that parseKineticaResponse treats as 0 rows —
// these tests assert on the EXECUTED QUERY STRING, not on rendered chart output.
const EMPTY_RESPONSE = {
  column_headers: [] as string[],
  column_datatypes: [] as string[],
};

const wrap = (ui: React.ReactNode, dynamicViews: DynamicViewRow[] = []) => (
  <DashboardContextProvider
    dashboardId={1}
    widgets={[]}
    dynamicViews={dynamicViews}
    retryDynamicView={() => {}}
  >
    {ui}
  </DashboardContextProvider>
);

const TABLE_ID = 7;
const METRIC_ID = 2;

const makeMetric = (expression: string, overrides: Partial<CustomMetricRow> = {}): CustomMetricRow => ({
  id: METRIC_ID,
  table_id: TABLE_ID,
  label: "try_again",
  expression,
  format_spec: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

// The SOURCE environment's definition — this is what gets frozen into config.sql at Apply
// time in the environment that saved the widget.
const FROZEN_SQL =
  "SELECT vendor_id, AVG(total_amount - tip_amount) AS value FROM demo.nyctaxi GROUP BY vendor_id ORDER BY value DESC LIMIT 100";

// The TARGET environment's definition — what the fix requires the executed query to carry.
const TARGET_EXPR = "AVG(total_amount - tip_amount) * 50.111111";
const TARGET_SQL =
  "SELECT vendor_id, AVG(total_amount - tip_amount) * 50.111111 AS value FROM demo.nyctaxi GROUP BY vendor_id ORDER BY value DESC LIMIT 100";

const makeWidget = (overrides: Partial<WidgetDto> = {}): WidgetDto => ({
  id: 1,
  dashboard_id: 1,
  title: "Test",
  type: "bar",
  position: 0,
  config: { sql: FROZEN_SQL, tableId: TABLE_ID, metricId: METRIC_ID },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

// Seeds the store SYNCHRONOUSLY (so the widget's first render already sees a hydrated,
// resolved expression) AND points the mocked listCustomMetrics at the SAME row. The
// renderer's own hydration effect (mirroring TimelineRenderer.tsx:156-163) always calls
// loadConfig on mount regardless of whether the store already looks hydrated — exactly like
// BarRenderer's pre-existing effect at WidgetRenderer.tsx:905-907. Without pointing the mock
// at matching data, that unconditional re-fetch would resolve to the default `[]` and
// clobber the seeded fixture out from under the test.
const seedMetric = (expression: string): void => {
  const metric = makeMetric(expression);
  vi.mocked(clientModule.listCustomMetrics).mockResolvedValue([metric]);
  useCustomMetricsStore.getState().setConfig(TABLE_ID, [metric]);
};

describe("AggregatedWidgetRenderer — live custom-metric SQL resolution (DXIM-V124-10)", () => {
  it("LIVEMETRIC-XENV-target-expression: executes the TARGET environment's expression, not the frozen one", async () => {
    vi.mocked(clientModule.runSql).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    seedMetric(TARGET_EXPR);

    render(wrap(<WidgetRenderer widget={makeWidget()} />));

    await waitFor(() => expect(clientModule.runSql).toHaveBeenCalledTimes(1));
    // Full-string toBe, never toContain — a half-rewritten query would also pass a toContain.
    expect(vi.mocked(clientModule.runSql).mock.calls[0][0]).toBe(TARGET_SQL);
  });

  it("LIVEMETRIC-singleenv-edit-refetches: editing the metric re-queries with no config-panel round trip", async () => {
    vi.mocked(clientModule.runSql).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    seedMetric(TARGET_EXPR);

    render(wrap(<WidgetRenderer widget={makeWidget()} />));

    await waitFor(() => expect(clientModule.runSql).toHaveBeenCalledTimes(1));
    expect(vi.mocked(clientModule.runSql).mock.calls[0][0]).toBe(TARGET_SQL);

    act(() => {
      useCustomMetricsStore
        .getState()
        .upsertMetric(TABLE_ID, makeMetric("AVG(total_amount - tip_amount) * 700"));
    });

    await waitFor(() => expect(clientModule.runSql).toHaveBeenCalledTimes(2));
    expect(vi.mocked(clientModule.runSql).mock.calls[1][0]).toBe(
      "SELECT vendor_id, AVG(total_amount - tip_amount) * 700 AS value FROM demo.nyctaxi GROUP BY vendor_id ORDER BY value DESC LIMIT 100",
    );
  });

  it("LIVEMETRIC-suspend-no-query-before-hydration: suspends (no query, Loading...) until the store hydrates, then queries the LIVE expression — never the frozen one", async () => {
    vi.mocked(clientModule.runSql).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    let resolveFetch!: (rows: CustomMetricRow[]) => void;
    const deferred = new Promise<CustomMetricRow[]>((resolve) => {
      resolveFetch = resolve;
    });
    vi.mocked(clientModule.listCustomMetrics).mockReturnValue(deferred);

    render(wrap(<WidgetRenderer widget={makeWidget()} />));

    // Pending window: the widget suspends (placeholder shown) and issues NO query.
    await waitFor(() => expect(screen.getByText("Loading...")).toBeInTheDocument());
    expect(clientModule.runSql).not.toHaveBeenCalled();

    // Resolve the hydration fetch — the effect's loadConfig().catch(() => {}) chain runs.
    await act(async () => {
      resolveFetch([makeMetric(TARGET_EXPR)]);
      await deferred;
    });

    await waitFor(() => expect(clientModule.runSql).toHaveBeenCalledTimes(1));
    expect(vi.mocked(clientModule.runSql).mock.calls[0][0]).toBe(TARGET_SQL);

    // The load-bearing assertion this fix exists for: the frozen string was NEVER queried,
    // not even transiently during the pending window.
    for (const [calledSql] of vi.mocked(clientModule.runSql).mock.calls) {
      expect(calledSql).not.toBe(FROZEN_SQL);
    }
  });

  it("LIVEMETRIC-orphan-uses-frozen-sql: a DELETED custom metric falls back to the frozen SQL, no error, no blank widget", async () => {
    vi.mocked(clientModule.runSql).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    // Deliberately do NOT pre-seed the store — this must go through the REAL pending -> ready
    // transition (unhydrated at mount; the hydration fetch resolves to [] i.e. the metric is
    // genuinely gone). `sql` is unchanged across that transition (applyLiveMetricExpr falls back
    // to storedSql both while pending AND once resolved-orphan), so this is precisely the case
    // mutation probe M4 guards: without `metricsPending` in Effect 2's dep array, the pending ->
    // ready flip would never re-fire the fetch and the widget would suspend forever. A deferred
    // promise (not the default auto-resolving mock) makes the pending window observable — same
    // technique as LIVEMETRIC-suspend-no-query-before-hydration.
    let resolveFetch!: (rows: CustomMetricRow[]) => void;
    const deferred = new Promise<CustomMetricRow[]>((resolve) => {
      resolveFetch = resolve;
    });
    vi.mocked(clientModule.listCustomMetrics).mockReturnValue(deferred);

    render(wrap(<WidgetRenderer widget={makeWidget()} />));

    // Pending window first — same suspend behavior as the hydration test above.
    await waitFor(() => expect(screen.getByText("Loading...")).toBeInTheDocument());
    expect(clientModule.runSql).not.toHaveBeenCalled();

    // Hydration resolves with the metric absent (orphan) — falls back to the frozen SQL.
    await act(async () => {
      resolveFetch([]);
      await deferred;
    });

    await waitFor(() => expect(clientModule.runSql).toHaveBeenCalledTimes(1));
    expect(vi.mocked(clientModule.runSql).mock.calls[0][0]).toBe(FROZEN_SQL);
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });

  it("LIVEMETRIC-noncustom-identity: a widget with no custom metric executes byte-identical config.sql", async () => {
    vi.mocked(clientModule.runSql).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    const widget = makeWidget({ config: { sql: FROZEN_SQL, tableId: TABLE_ID } });

    render(wrap(<WidgetRenderer widget={widget} />));

    await waitFor(() => expect(clientModule.runSql).toHaveBeenCalledTimes(1));
    expect(vi.mocked(clientModule.runSql).mock.calls[0][0]).toBe(FROZEN_SQL);
  });

  it("LIVEMETRIC-noncustom-no-metric-fetch: a widget with no custom metric fetches no metrics at all", async () => {
    vi.mocked(clientModule.runSql).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    const widget = makeWidget({ config: { sql: FROZEN_SQL, tableId: TABLE_ID } });

    render(wrap(<WidgetRenderer widget={widget} />));

    await waitFor(() => expect(clientModule.runSql).toHaveBeenCalledTimes(1));
    expect(clientModule.listCustomMetrics).not.toHaveBeenCalled();
  });

  it("LIVEMETRIC-fromswap-composes: the live expression substitutes BEFORE fromSwap — both compositions land, expression not clobbered", async () => {
    vi.mocked(clientModule.runSql).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    seedMetric(TARGET_EXPR);

    const vizKey = "w:1";
    const hash = "sabc12345";
    mockVizToHash[vizKey] = hash;
    mockRegistry[hash] = {
      viewName: "_kbi_filt_u1_d2_t7_sabc12345",
      expiresAt: Date.now() + 300000,
      materializing: false,
    };

    render(wrap(<WidgetRenderer widget={makeWidget({ id: 1 })} />));

    await waitFor(() => expect(clientModule.runSql).toHaveBeenCalledTimes(1));
    expect(vi.mocked(clientModule.runSql).mock.calls[0][0]).toBe(
      "SELECT vendor_id, AVG(total_amount - tip_amount) * 50.111111 AS value FROM _kbi_filt_u1_d2_t7_sabc12345 GROUP BY vendor_id ORDER BY value DESC LIMIT 100",
    );

    // Structural precondition (see the vi.mock comment above): fromSwap's first argument must
    // ALREADY carry the live-resolved expression — proving resolution happened BEFORE fromSwap,
    // not after. Table name and expression here contain no literal FROM token, so the final
    // query string alone cannot distinguish resolve-then-swap from swap-then-resolve; this can.
    expect(vi.mocked(fromSwapModule.fromSwap)).toHaveBeenCalledWith(
      TARGET_SQL, // still "FROM demo.nyctaxi" — the pre-fromSwap, post-metric-resolution string
      "_kbi_filt_u1_d2_t7_sabc12345",
    );
  });

  it("LIVEMETRIC-bignumber-scalar: a bignumber widget's scalar shape also resolves live — the fix is not bar-only", async () => {
    vi.mocked(clientModule.runSql).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    seedMetric(TARGET_EXPR);

    const scalarSql = "SELECT AVG(total_amount - tip_amount) AS value FROM demo.nyctaxi";
    const widget = makeWidget({
      type: "bignumber",
      config: { sql: scalarSql, tableId: TABLE_ID, metricId: METRIC_ID },
    });

    render(wrap(<WidgetRenderer widget={widget} />));

    await waitFor(() => expect(clientModule.runSql).toHaveBeenCalledTimes(1));
    expect(vi.mocked(clientModule.runSql).mock.calls[0][0]).toBe(
      "SELECT AVG(total_amount - tip_amount) * 50.111111 AS value FROM demo.nyctaxi",
    );
  });

  it("LIVEMETRIC-dv-bound-resolves: a dv-bound widget resolves the metric against tableId and FROM-swaps to the dv view", async () => {
    vi.mocked(clientModule.runSql).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    seedMetric(TARGET_EXPR);

    // dv-bound widget: persists BOTH dynamicViewId and tableId (= source_table_id, the
    // Phase 35 dual-write lock). Custom metrics are per SOURCE table, so resolution reads
    // cfg.tableId; fromSwap then redirects the FROM to the dv view.
    useDynamicViewStore.getState().setView(3, {
      viewName: "_kbi_dv_u1_d1_3",
      status: "materialized",
      expiresAt: Date.now() + 300000,
    });

    const widget = makeWidget({
      config: { sql: FROZEN_SQL, tableId: TABLE_ID, metricId: METRIC_ID, dynamicViewId: 3 },
    });

    const dynamicViews: DynamicViewRow[] = [
      {
        id: 3,
        dashboard_id: 1,
        source_table_id: TABLE_ID,
        name: "DV",
        template_sql: "SELECT * FROM {view}",
        max_records: 10000,
        columns_json: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];

    render(wrap(<WidgetRenderer widget={widget} />, dynamicViews));

    await waitFor(() => expect(clientModule.runSql).toHaveBeenCalledTimes(1));
    expect(vi.mocked(clientModule.runSql).mock.calls[0][0]).toBe(
      "SELECT vendor_id, AVG(total_amount - tip_amount) * 50.111111 AS value FROM _kbi_dv_u1_d1_3 GROUP BY vendor_id ORDER BY value DESC LIMIT 100",
    );
  });
});
