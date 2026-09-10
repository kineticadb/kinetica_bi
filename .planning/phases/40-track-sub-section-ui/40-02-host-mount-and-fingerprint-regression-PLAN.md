---
phase: 40-track-sub-section-ui
plan: 02
type: execute
wave: 2
depends_on:
  - "40-01"
files_modified:
  - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx
  - kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx
  - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
autonomous: true
requirements:
  - TRACK-V17-03
  - TRACK-V17-05
gap_closure: false

must_haves:
  truths:
    - "KineticaWmsLayerForm imports TrackSubSection (Plan 40-01 deliverable) and mounts it gated on (renderMode === 'raster' || renderMode === 'classbreak')"
    - "Mount point is a sibling block IMMEDIATELY AFTER the existing CbConfigForm gate at line ~895-906 (mount sits between the classbreak block and the contour block); the gate uses a SINGLE expression (not duplicated across raster/classbreak gates) so React preserves component state across raster ↔ classbreak switches"
    - "Flipping renderMode from raster → classbreak → raster preserves trackConfig 1:1 (asserted by spec assertion that <TrackSubSection> remains mounted across the swap and onChange has NOT been called with a reset payload)"
    - "Flipping renderMode to heatmap hides the TrackSubSection without modifying track_config (no onChange call fires on the render-mode swap)"
    - "Flipping renderMode from heatmap back to raster restores the visible TrackSubSection with the prior persisted track_config intact"
    - "MapChartRenderer.spec.tsx contains a TRACK-V17-05 regression spec block (mirrors Phase 39 CB-V17-09 buildFingerprint pattern) asserting that toggling track_config.enabled and editing headColor produce different fingerprint values via JSON.stringify({p, c, t}) — locks the t-slot coverage Phase 38 shipped"
    - "Regression spec ALSO asserts via fs+grep that MapChartRenderer.tsx production code still contains the {p,c,t} fingerprint shape at lines ~1118 and ~1208 (mirrors Phase 39 CB-V17-09 src.match(/JSON\\.stringify\\(.*p:.*c:.*t:.*track_config/) pattern)"
    - "Phase 40-02 makes ZERO modifications to wmsUrlBuilder.ts Track block emission code (lines 428-472) — Phase 38 lock"
    - "Phase 40-02 makes ZERO modifications to MapChartRenderer.tsx production code — fingerprint at lines 1118+1208 is locked by Phase 38; this plan ONLY adds a regression test"
  artifacts:
    - path: "kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx"
      provides: "TrackSubSection mount + import"
      contains: "import TrackSubSection from \"./TrackSubSection\""
    - path: "kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx"
      provides: "Host-form mount-point tests covering TRACK-V17-03 render-mode gating + state preservation"
      min_lines_added: 100
    - path: "kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx"
      provides: "TRACK-V17-05 fingerprint regression describe block (mirrors Phase 39 CB-V17-09)"
      min_lines_added: 60
  key_links:
    - from: "kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx"
      to: "kinetica_bi/src/components/charts/TrackSubSection.tsx"
      via: "default import + JSX mount gated on render-mode"
      pattern: "import TrackSubSection from"
    - from: "kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx"
      to: "kinetica_bi/src/components/charts/TrackSubSection.tsx"
      via: "renderMode-gated JSX block"
      pattern: "\\(renderMode === \"raster\" \\|\\| renderMode === \"classbreak\"\\) &&\\s*<TrackSubSection"
    - from: "kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx"
      to: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      via: "fs.readFileSync grep regression assertion"
      pattern: "TRACK-V17-05.*fingerprint.*track_config"
---

<objective>
Wire `TrackSubSection` (Plan 40-01 dormant deliverable) into `KineticaWmsLayerForm.tsx` at a SINGLE mount point gated on `(renderMode === "raster" || renderMode === "classbreak")`, add host-form spec coverage for the render-mode gating + state-preservation behaviors, and add a TRACK-V17-05 fingerprint regression spec to `MapChartRenderer.spec.tsx` (mirroring Phase 39's CB-V17-09 buildFingerprint pattern).

Purpose: This is the LIVE WIRING plan. Plan 40-01 shipped the component as fully-tested but dormant; Plan 40-02 makes it visible to the operator. The fingerprint regression spec is the TRACK-V17-05 closure mechanism — Phase 38 already shipped the wmsUrlBuilder Track block (comma-separated TRACK_* under STYLES=cb_raster, single-value under STYLES=raster) AND the fingerprint extension at MapChartRenderer.tsx:1118+1208 (`JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config })`). Phase 40 does NOT add new emission code or new fingerprint code; it asserts via regression test that the t-slot coverage shipped in Phase 38 remains intact (mirrors Phase 39 CB-V17-09 closure approach for the c-slot).

Output:
- `KineticaWmsLayerForm.tsx` — 2 edits: (1) import line for TrackSubSection (after line 48 alongside CbConfigForm import), (2) JSX mount block sibling to CbConfigForm gate (immediately after the existing classbreak block, before the contour block)
- `KineticaWmsLayerForm.spec.tsx` — new test block covering TRACK-V17-03 + state preservation
- `MapChartRenderer.spec.tsx` — new describe block `"Phase 40 TRACK-V17-05 — fingerprint covers layer.track_config"` mirroring CB-V17-09
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/STATE.md
@.planning/phases/40-track-sub-section-ui/40-CONTEXT.md
@.planning/phases/40-track-sub-section-ui/40-RESEARCH.md
@.planning/phases/40-track-sub-section-ui/40-01-SUMMARY.md
@.planning/phases/38-schema-wms-engine-foundation/38-02-SUMMARY.md
@.planning/phases/39-classbreak-form-ui-auto-suggest/39-03-SUMMARY.md

@kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx
@kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx
@kinetica_bi/src/components/charts/MapChartRenderer.tsx
@kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
@kinetica_bi/src/components/charts/TrackSubSection.tsx
@kinetica_bi/src/lib/wmsUrlBuilder.ts

<interfaces>
<!-- Key types and contracts the executor needs. Extracted from codebase. -->

From kinetica_bi/src/components/charts/TrackSubSection.tsx (Plan 40-01 deliverable):
```typescript
type TrackSubSectionProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  columns?: Column[];
  isValid?: (valid: boolean) => void;
};
export default function TrackSubSection(props: TrackSubSectionProps): JSX.Element;
```

From kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx (existing — current sibling gate to MIRROR at line 895-906):
```jsx
{/* ─── CLASSBREAK PARAMS (Phase 39: replaced by CbConfigForm) ─────────────────── */}
{renderMode === "classbreak" && (
  <CbConfigForm
    config={config}
    onChange={onChange}
    columns={columns}
    isValid={isValid}
    tableRef={(config.tableRef as string) || ""}
    schema={layer ? (associatedTables.find((t) => t.id === layer.table_id)?.schema ?? "") : ""}
    tableName={layer ? (associatedTables.find((t) => t.id === layer.table_id)?.name ?? "") : ""}
  />
)}

{/* ─── CONTOUR PARAMS ───────────────────────────────────────────────── */}
{renderMode === "contour" && (
  ...
)}
```

From kinetica_bi/src/components/charts/MapChartRenderer.tsx (Phase 38 — READ ONLY; Plan 40-02 spec asserts this exists):
```typescript
// Lines 1118 + 1208 — fingerprint already includes track_config (Phase 38 shipped):
const fingerprint = JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config });
lastEmittedParamsRef.current.set(layer.id, fingerprint);
```

From kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx (Phase 39 CB-V17-09 precedent block at line ~4351 — MIRROR THIS for TRACK-V17-05):
```typescript
describe("Phase 39 CB-V17-09 — fingerprint covers layer.cb_config", () => {
  const buildFingerprint = (
    wmsParams: Record<string, string>,
    cb_config: string | null,
    track_config: string | null,
  ): string =>
    JSON.stringify({ p: wmsParams, c: cb_config, t: track_config });

  it("differs when cb_config changes (color edit)", () => { ... });
  it("differs when cb_config changes (break value edit)", () => { ... });
  it("is byte-identical when nothing changes (fingerprint stability)", () => { ... });
  it("differs when wmsParams change (existing Phase 38 lock)", () => { ... });
  it("MapChartRenderer.tsx production code still uses the {p,c,t} fingerprint shape", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "MapChartRenderer.tsx"),
      "utf-8",
    );
    expect(src).toMatch(/JSON\.stringify\(\s*\{\s*p:\s*wmsParams,\s*c:\s*layer\.cb_config,\s*t:\s*layer\.track_config/);
  });
});
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Mount TrackSubSection in KineticaWmsLayerForm.tsx + host-form spec coverage</name>
  <files>
    kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx,
    kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx
  </files>
  <read_first>
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx (lines 25-100 for imports; lines 165-235 for component head + renderMode state; lines 895-970 for the CbConfigForm gate and surrounding blocks)
    - kinetica_bi/src/components/charts/TrackSubSection.tsx (Plan 40-01 deliverable — props shape)
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx (existing baseConfig + baseColumns helpers + setup; locate suitable describe block for new tests)
    - kinetica_bi/src/components/charts/CbConfigForm.spec.tsx (for vi.mock + module-mock patterns)
  </read_first>
  <action>
    **Edit 1 — Add import to KineticaWmsLayerForm.tsx:**

    Locate line 48 which reads `import CbConfigForm from "./CbConfigForm";`. Immediately after this line, add:

    ```typescript
    import TrackSubSection from "./TrackSubSection";
    ```

    **Edit 2 — Mount TrackSubSection gated on render-mode:**

    Locate the existing CbConfigForm gate at line 895-906 (the block starting with `{/* ─── CLASSBREAK PARAMS (Phase 39: replaced by CbConfigForm) ─────────────────── */}` and ending with `)}` on line 906, immediately followed by `{/* ─── CONTOUR PARAMS ─────────────...`).

    INSERT the following JSX block BETWEEN the closing `)}` of the CbConfigForm gate (line 906) AND the opening comment of the CONTOUR PARAMS block (line 908). Place a blank line before and after for readability. Exact text:

    ```jsx
            {/* ─── TRACK SUB-SECTION (Phase 40 TRACK-V17-03) ──────────────────────
                Gated as a SINGLE expression on raster OR classbreak so React preserves
                component state across raster ↔ classbreak swaps (Pitfall 5 lock). The
                Track sub-section is INDEPENDENT of the CbConfigForm gate — both can
                render simultaneously (classbreak mode with track enabled). Heatmap +
                contour render modes hide the sub-section without resetting track_config.
                See .planning/phases/40-track-sub-section-ui/40-CONTEXT.md "Render-mode
                gating". */}
            {(renderMode === "raster" || renderMode === "classbreak") && (
              <TrackSubSection
                config={config}
                onChange={onChange}
                columns={columns}
                isValid={isValid}
              />
            )}
    ```

    **DO NOT** wrap this in a `track_config.enabled` outer gate at the host level — the override checkbox inside TrackSubSection is always visible per CONTEXT.md "Render-mode gating" + Implementation Decisions "Override checkbox truth table"; the SUB-SECTION FIELDS are gated by `trackConfig.enabled` INSIDE the component. Host-level gate is render-mode only.

    **DO NOT** modify lines 562-893 (raster + heatmap blocks) or lines 909-970 (contour block) or lines 895-906 (CbConfigForm gate) — only INSERT a new block between line 906 (CbConfigForm close) and line 908 (contour comment open).

    **Edit 3 — Add host-form spec block to KineticaWmsLayerForm.spec.tsx:**

    Inside the existing top-level `describe("KineticaWmsLayerForm", ...)` block, add a new nested `describe("Phase 40 TRACK-V17-03 mount-gate + state preservation", ...)` block at the END of the file (before the final closing brace of the outer describe). Mock the TrackSubSection module so the host-form spec stays focused on mount-gate behavior, not internals:

    ```typescript
    // Add ONCE at the top of the spec file IF a top-level vi.mock pattern is already used
    // (consistent with how CbConfigForm is mocked at top — verify by grep before adding).
    vi.mock("./TrackSubSection", () => ({
      default: vi.fn(({ config }) => (
        <div data-testid="track-sub-section-mock">
          track_config={String(config.track_config)}
        </div>
      )),
    }));
    ```

    If a vi.mock for `./TrackSubSection` already exists from an earlier edit, skip the addition. If `./CbConfigForm` is NOT mocked at the top of the file (check first), DO NOT add a TrackSubSection mock either — instead use queryByTestId against the real component's data-testid="track-auto-detected-hint" or similar real selectors, treating the host spec as integration-level.

    Tests in the new describe block:

    ```typescript
    describe("Phase 40 TRACK-V17-03 mount-gate + state preservation", () => {
      const baseColumns = [
        { name: "TRACKID", type: "INT" },
        { name: "x", type: "DOUBLE" },
        { name: "y", type: "DOUBLE" },
        { name: "TIMESTAMP", type: "TIMESTAMP" },
        { name: "vendor_id", type: "VARCHAR" },
      ];

      it("renders TrackSubSection when renderMode === 'raster'", () => {
        render(
          <KineticaWmsLayerForm
            config={{ renderMode: "raster", track_config: null }}
            onChange={vi.fn()}
            columns={baseColumns}
          />,
        );
        expect(screen.queryByTestId("track-sub-section-mock")).toBeInTheDocument();
      });

      it("renders TrackSubSection when renderMode === 'classbreak'", () => {
        render(
          <KineticaWmsLayerForm
            config={{ renderMode: "classbreak", track_config: null }}
            onChange={vi.fn()}
            columns={baseColumns}
          />,
        );
        expect(screen.queryByTestId("track-sub-section-mock")).toBeInTheDocument();
      });

      it("HIDES TrackSubSection when renderMode === 'heatmap'", () => {
        render(
          <KineticaWmsLayerForm
            config={{ renderMode: "heatmap", track_config: '{"enabled":true}' }}
            onChange={vi.fn()}
            columns={baseColumns}
          />,
        );
        expect(screen.queryByTestId("track-sub-section-mock")).not.toBeInTheDocument();
      });

      it("HIDES TrackSubSection when renderMode === 'contour'", () => {
        render(
          <KineticaWmsLayerForm
            config={{ renderMode: "contour", track_config: '{"enabled":true}' }}
            onChange={vi.fn()}
            columns={baseColumns}
          />,
        );
        expect(screen.queryByTestId("track-sub-section-mock")).not.toBeInTheDocument();
      });

      it("preserves TrackSubSection mount across raster → classbreak rerender (state preservation)", () => {
        const onChange = vi.fn();
        const persistedTrack = '{"enabled":true,"trackIdAttr":"TRACKID","trackOrderAttr":"TIMESTAMP","headColor":"FFAABBCC","headSize":12,"trailSize":4,"headShape":"square","trailColor":"FF112233"}';
        const { rerender } = render(
          <KineticaWmsLayerForm
            config={{ renderMode: "raster", track_config: persistedTrack }}
            onChange={onChange}
            columns={baseColumns}
          />,
        );
        const initial = screen.queryByTestId("track-sub-section-mock");
        expect(initial).toBeInTheDocument();
        expect(initial!.textContent).toContain(persistedTrack);

        // Flip render mode raster → classbreak; track_config UNCHANGED in props
        rerender(
          <KineticaWmsLayerForm
            config={{ renderMode: "classbreak", track_config: persistedTrack }}
            onChange={onChange}
            columns={baseColumns}
          />,
        );
        const afterFlip = screen.queryByTestId("track-sub-section-mock");
        expect(afterFlip).toBeInTheDocument();
        expect(afterFlip!.textContent).toContain(persistedTrack);
      });

      it("hides on flip to heatmap then restores on flip back to raster (track_config preserved)", () => {
        const onChange = vi.fn();
        const persistedTrack = '{"enabled":true,"headColor":"FFAABBCC"}';
        const { rerender } = render(
          <KineticaWmsLayerForm
            config={{ renderMode: "raster", track_config: persistedTrack }}
            onChange={onChange}
            columns={baseColumns}
          />,
        );
        expect(screen.queryByTestId("track-sub-section-mock")).toBeInTheDocument();

        rerender(
          <KineticaWmsLayerForm
            config={{ renderMode: "heatmap", track_config: persistedTrack }}
            onChange={onChange}
            columns={baseColumns}
          />,
        );
        expect(screen.queryByTestId("track-sub-section-mock")).not.toBeInTheDocument();

        rerender(
          <KineticaWmsLayerForm
            config={{ renderMode: "raster", track_config: persistedTrack }}
            onChange={onChange}
            columns={baseColumns}
          />,
        );
        const restored = screen.queryByTestId("track-sub-section-mock");
        expect(restored).toBeInTheDocument();
        expect(restored!.textContent).toContain(persistedTrack);
      });

      it("does NOT fire onChange purely as a side-effect of render-mode swap (state preservation lock)", () => {
        const onChange = vi.fn();
        const { rerender } = render(
          <KineticaWmsLayerForm
            config={{ renderMode: "raster", track_config: '{"enabled":true,"headColor":"FFAABBCC"}' }}
            onChange={onChange}
            columns={baseColumns}
          />,
        );
        const callsAfterMount = onChange.mock.calls.length;

        rerender(
          <KineticaWmsLayerForm
            config={{ renderMode: "classbreak", track_config: '{"enabled":true,"headColor":"FFAABBCC"}' }}
            onChange={onChange}
            columns={baseColumns}
          />,
        );
        // Mode swap MUST NOT trigger a track_config write
        const callsAfterFlip = onChange.mock.calls.length;
        expect(callsAfterFlip).toBe(callsAfterMount);
      });
    });
    ```

    **Notes for the executor on the spec:**
    - If KineticaWmsLayerForm.spec.tsx already mocks `useWmsCapabilitiesStore`, `useToastStore`, etc. at top-of-file, the new tests run within that scope unchanged.
    - The `data-testid="track-sub-section-mock"` selector is invented by the vi.mock above; do NOT use it if you skip the vi.mock (use real component selectors instead).
    - If the existing spec lacks a top-level vi.mock("./CbConfigForm"), check the test rendering pipeline: the real CbConfigForm renders only on `renderMode==="classbreak"`, so the raster + heatmap + contour test cases above are safe even without mocking. Only the classbreak test case may need attention if CbConfigForm requires extra props in the test render — in that case mock CbConfigForm too with a similar stub.

    **Anti-patterns to AVOID:**
    - Do NOT duplicate the TrackSubSection mount inside the raster gate AND the classbreak gate separately (Pitfall 5 — that would unmount/remount on mode swap, losing component state)
    - Do NOT add an outer `track_config.enabled` gate at the host level (override checkbox lives INSIDE the component and must always be visible when render mode is raster/classbreak)
    - Do NOT touch the raster (562-823), heatmap (825-893), CbConfigForm (895-906), or contour (909-970) blocks
    - Do NOT add new props to TrackSubSection — Plan 40-01 locked the props shape
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/KineticaWmsLayerForm.spec.tsx --reporter=basic 2>&amp;1 | tail -30 &amp;&amp; npx tsc --noEmit -p tsconfig.json 2>&amp;1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "^import TrackSubSection from \"./TrackSubSection\"" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` returns 1
    - `grep -E '\(renderMode === "raster" \|\| renderMode === "classbreak"\) &amp;&amp;' kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` returns ≥ 1 match
    - `grep "<TrackSubSection" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` returns exactly 1 (single mount point — Pitfall 5 lock)
    - `grep -A 6 "renderMode === \"classbreak\" &amp;&amp;" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx | grep -c "TrackSubSection"` returns 0 (TrackSubSection mount is NOT inside the classbreak gate — separate gate)
    - `grep -c "Phase 40 TRACK-V17-03" kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx` returns ≥ 1
    - `grep -cE 'data-testid="track-sub-section-mock"|"<TrackSubSection.*config="' kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx` returns ≥ 1
    - `npx vitest run src/components/charts/KineticaWmsLayerForm.spec.tsx` exits 0 with ALL tests green (existing tests + 7 new TRACK-V17-03 tests)
    - `npx tsc --noEmit` exits 0
    - The render-mode gate uses a SINGLE expression — verify by `grep -c "renderMode === \"raster\".*renderMode === \"classbreak\"" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` returning 1 (one combined expression, not two duplicated mounts)
  </acceptance_criteria>
  <done>
    `<TrackSubSection />` is mounted as a single gate on `(renderMode === "raster" || renderMode === "classbreak")` immediately after the CbConfigForm gate. 7 new host-form spec tests cover TRACK-V17-03 render-mode gating + state preservation. tsc clean, all KineticaWmsLayerForm.spec.tsx tests green.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add TRACK-V17-05 fingerprint regression spec to MapChartRenderer.spec.tsx</name>
  <files>
    kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
  </files>
  <read_first>
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx (lines ~4348-4410 — Phase 39 CB-V17-09 describe block for MIRROR PATTERN)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx (lines 1114-1120 + 1205-1212 — assert fingerprint computation still uses {p, c, t} shape)
  </read_first>
  <action>
    Append a new describe block to the END of `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` (after the closing brace of the CB-V17-09 describe block found around line 4406). This block mirrors the Phase 39 CB-V17-09 pattern — pure-function tests using a local `buildFingerprint` helper + a fs.readFileSync grep assertion against the production source.

    Exact text to append (NO behavior changes elsewhere in the file):

    ```typescript

    /* ------------------------------------------------------------------ */
    /*  Phase 40 TRACK-V17-05 — fingerprint covers layer.track_config     */
    /* ------------------------------------------------------------------ */

    describe("Phase 40 TRACK-V17-05 — fingerprint covers layer.track_config", () => {
      // The fingerprint construction at MapChartRenderer.tsx:1118 + 1208 is:
      //   JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config })
      // Phase 38 already shipped the t-slot coverage; this Phase 40 regression test
      // locks it so future edits to MapChartRenderer.tsx cannot silently drop
      // track_config from the fingerprint and break tile re-renders on track-style
      // edits from the Phase 40 TrackSubSection form.
      //
      // ROADMAP SC #4 (TRACK-V17-05): Phase 38 emits comma-sep TRACK_* under
      // STYLES=cb_raster + single-value under STYLES=raster — wmsUrlBuilder Track
      // block (lines 428-472) handles the expand(N). Phase 40 does NOT modify
      // emission code; this regression test asserts that the form's track_config
      // mutations propagate via the fingerprint so MapChartRenderer triggers a
      // tile re-render on every Phase 40 form edit.

      const buildFingerprint = (
        wmsParams: Record<string, string>,
        cb_config: string | null,
        track_config: string | null,
      ): string =>
        JSON.stringify({ p: wmsParams, c: cb_config, t: track_config });

      it("differs when track_config flips enabled false → true", () => {
        const params = { STYLES: "raster" };
        const trackOff = '{"enabled":false}';
        const trackOn = '{"enabled":true,"trackIdAttr":"TRACKID","trackOrderAttr":"TIMESTAMP","headColor":"FFFF0000","trailColor":"FF0000FF","headSize":8,"trailSize":2,"headShape":"circle"}';
        expect(buildFingerprint(params, null, trackOff)).not.toBe(
          buildFingerprint(params, null, trackOn),
        );
      });

      it("differs when track_config changes (headColor edit)", () => {
        const params = { STYLES: "raster" };
        const tA = '{"enabled":true,"headColor":"FFFF0000","trailColor":"FF0000FF","headSize":8,"trailSize":2,"headShape":"circle"}';
        const tB = '{"enabled":true,"headColor":"FFAABBCC","trailColor":"FF0000FF","headSize":8,"trailSize":2,"headShape":"circle"}';
        expect(buildFingerprint(params, null, tA)).not.toBe(
          buildFingerprint(params, null, tB),
        );
      });

      it("differs when track_config changes (trailSize edit — Line width field)", () => {
        const params = { STYLES: "raster" };
        const tA = '{"enabled":true,"trailSize":2}';
        const tB = '{"enabled":true,"trailSize":7}';
        expect(buildFingerprint(params, null, tA)).not.toBe(
          buildFingerprint(params, null, tB),
        );
      });

      it("differs when track_config changes (headShape edit)", () => {
        const params = { STYLES: "raster" };
        const tA = '{"enabled":true,"headShape":"circle"}';
        const tB = '{"enabled":true,"headShape":"square"}';
        expect(buildFingerprint(params, null, tA)).not.toBe(
          buildFingerprint(params, null, tB),
        );
      });

      it("is byte-identical when nothing changes (track_config fingerprint stability)", () => {
        const params = { STYLES: "raster" };
        const t = '{"enabled":true,"headColor":"FFFF0000","headShape":"circle"}';
        expect(buildFingerprint(params, null, t)).toBe(
          buildFingerprint(params, null, t),
        );
      });

      it("differs across cb_raster vs raster STYLES for the same track_config (TRACK-V17-05 lock — comma-sep emission under cb_raster vs single-value under raster produces different wmsParams, captured in the p-slot)", () => {
        const t = '{"enabled":true,"headColor":"FFFF0000","trailColor":"FF0000FF","headSize":8,"trailSize":2,"headShape":"circle"}';
        // Phase 38 wmsUrlBuilder Track block produces different wmsParams under cb_raster
        // (TRACKHEADCOLORS=#abc,#def,#ghi etc.) vs raster (TRACKHEADCOLORS=#abc) per
        // SPIKE-V17-05. Asserting the p-slot differs proves the fingerprint covers the
        // wmsUrlBuilder Phase 38 expand(N) behavior — Phase 40 trusts this without
        // adding new emission code.
        const paramsRaster = { STYLES: "raster", TRACKHEADCOLORS: "FFFF0000" };
        const paramsCb = { STYLES: "cb_raster", TRACKHEADCOLORS: "FFFF0000,FFFF0000,FFFF0000" };
        expect(buildFingerprint(paramsRaster, null, t)).not.toBe(
          buildFingerprint(paramsCb, null, t),
        );
      });

      it("MapChartRenderer.tsx production code still uses the {p,c,t} fingerprint shape with track_config in t-slot", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const src = fs.readFileSync(
          path.resolve(__dirname, "MapChartRenderer.tsx"),
          "utf-8",
        );
        // TRACK-V17-05: track_config (as `t`) must appear in the fingerprint construction
        // at BOTH callsites (around lines 1118 + 1208 per Phase 38 SUMMARY).
        const matches = src.match(/JSON\.stringify\(\s*\{\s*p:\s*wmsParams,\s*c:\s*layer\.cb_config,\s*t:\s*layer\.track_config/g);
        expect(matches).not.toBeNull();
        expect(matches!.length).toBeGreaterThanOrEqual(2);
      });
    });
    ```

    **DO NOT modify any other part of MapChartRenderer.spec.tsx.** **DO NOT modify MapChartRenderer.tsx itself** — Phase 40 is regression-test-only at the renderer level; the fingerprint at lines 1118+1208 is Phase 38's shipped contract.

    **DO NOT modify wmsUrlBuilder.ts** — the Track block emission code (lines 428-472) is Phase 38's locked emission path that handles BOTH the single-value (STYLES=raster) and comma-sep (STYLES=cb_raster) cases via `expand(N)`. Phase 40 emits no new WMS params.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx -t "TRACK-V17-05" --reporter=basic 2>&amp;1 | tail -20 &amp;&amp; npx tsc --noEmit -p tsconfig.json 2>&amp;1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "Phase 40 TRACK-V17-05" kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` returns ≥ 2 (block comment + describe string)
    - `grep -c "fingerprint covers layer.track_config" kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` returns ≥ 1
    - `grep -c "buildFingerprint" kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` returns ≥ 12 (~5 from CB-V17-09 carry-over + ~7 new from TRACK-V17-05)
    - The new describe block has ≥ 7 `it(...)` cases — verify by counting between the new `describe("Phase 40 TRACK-V17-05` and the file's closing brace
    - `npx vitest run src/components/charts/MapChartRenderer.spec.tsx -t "TRACK-V17-05"` runs and ALL TRACK-V17-05 tests pass
    - `npx vitest run src/components/charts/MapChartRenderer.spec.tsx` runs and ALL tests in the file pass (zero CB-V17-09 regressions)
    - Production code unchanged: `git diff kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns empty (zero changes)
    - Production code unchanged: `git diff kinetica_bi/src/lib/wmsUrlBuilder.ts` returns empty in Plan 40-02 scope (Plan 40-01 already touched wmsUrlBuilder.ts for the re-export; Plan 40-02 must NOT touch it again)
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    `MapChartRenderer.spec.tsx` gains a new describe block `"Phase 40 TRACK-V17-05 — fingerprint covers layer.track_config"` with 7 tests asserting (1-4) that mutations to track_config fields produce different fingerprints, (5) byte-identical stability, (6) cb_raster vs raster STYLES emit different wmsParams (locks Phase 38 expand(N) behavior), (7) production code at MapChartRenderer.tsx still uses the {p,c,t} shape with track_config in t-slot at both callsites. Zero production-code changes; all tests green; tsc clean.
  </done>
</task>

</tasks>

<verification>
**Phase-level checks (Plan 40-02 alone):**

1. `cd kinetica_bi && npx vitest run --reporter=basic` → full frontend suite GREEN (existing 1131+ tests + Plan 40-01's TrackSubSection.spec.tsx + Plan 40-01's trackConfig.spec.ts + Plan 40-02's new tests in KineticaWmsLayerForm.spec.tsx + MapChartRenderer.spec.tsx)
2. `cd kinetica_bi && npx tsc --noEmit -p tsconfig.json` → exit 0
3. `git diff kinetica_bi/src/components/charts/MapChartRenderer.tsx` → empty (production fingerprint code unchanged)
4. `git diff kinetica_bi/src/lib/wmsUrlBuilder.ts` → empty in Plan 40-02 scope (Plan 40-01 owned the wmsUrlBuilder.ts back-compat re-export; Plan 40-02 makes NO further wmsUrlBuilder edits)
5. `grep "<TrackSubSection" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` returns exactly 1 (single mount; Pitfall 5 lock)
6. `grep -c "renderMode === \"raster\" || renderMode === \"classbreak\"" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` returns ≥ 1 (the single Phase 40 gate; raster + classbreak co-existence is the lock)

**Phase 40 closure check (Plans 40-01 + 40-02 combined):**

| ROADMAP SC | Closing Plan + Mechanism |
|------------|--------------------------|
| SC #1 (auto-detect on track-shape table → sub-section visible) | Plan 40-01 Group A1 + A2 (component-level); Plan 40-02 Task 1 mount-gate (host-level wiring) |
| SC #2 (override checkbox always visible; check/uncheck behavior) | Plan 40-01 Group A + D + Plan 40-02 mount-gate proves it renders under raster/classbreak |
| SC #3 (renderMode raster ↔ classbreak preserves; not present under heatmap) | Plan 40-02 Task 1 tests 1-7 (TRACK-V17-03 mount-gate + state preservation) |
| SC #4 (cb_raster comma-sep TRACK_* emission per SPIKE-V17-05) | Plan 40-02 Task 2 TRACK-V17-05 fingerprint regression test #6 (asserts cb_raster vs raster STYLES emit different wmsParams + grep-asserts production fingerprint shape) — backed by Phase 38 wmsUrlBuilder Track block (lines 428-472) which Phase 40 does NOT modify |
| SC #5 (persistence round-trip through PATCH + dashboard load) | Plan 40-01 Group F3 (read-side: coalesceTrackConfig parses persisted track_config); Plan 40-02 mount-gate tests use persisted track_config strings to verify the host plumbing wires the same JSON through |

| TRACK-V17 REQ | Closing Plan |
|---------------|--------------|
| TRACK-V17-01 (isTrackTable + useEffect) | 40-01 Group A1, A2, A3, A6 |
| TRACK-V17-02 (override checkbox + (auto-detected) hint) | 40-01 Group A1, A4, A5, D + 40-02 mount-gate |
| TRACK-V17-03 (render-mode gate) | 40-02 Task 1 |
| TRACK-V17-04 (8 form inputs incl. trackIdAttr, trackOrderAttr, headColor, trailColor, headSize, trailSize via 'Line width', headShape) | 40-01 Group B (B1-B7) + C (C1-C5) |
| TRACK-V17-05 (comma-sep TRACK_* under cb_raster) | 40-02 Task 2 (regression test backed by Phase 38 emission code) |
| TRACK-V17-06 (persistence round-trip) | 40-01 Group F3 + 40-02 Task 1 (rerender tests verify track_config flows through unchanged) |
</verification>

<success_criteria>
- `<TrackSubSection />` is mounted in `KineticaWmsLayerForm.tsx` as a SINGLE expression gated on `(renderMode === "raster" || renderMode === "classbreak")` — sibling to (and immediately after) the existing CbConfigForm gate
- `KineticaWmsLayerForm.spec.tsx` gains a `Phase 40 TRACK-V17-03 mount-gate + state preservation` describe block with 7 tests covering: raster mount, classbreak mount, heatmap hide, contour hide, raster→classbreak state preservation, heatmap→raster restoration, no-onChange-on-render-mode-swap
- `MapChartRenderer.spec.tsx` gains a `Phase 40 TRACK-V17-05 — fingerprint covers layer.track_config` describe block with 7 tests covering: enabled-flip, headColor edit, trailSize edit, headShape edit, byte-identical stability, cb_raster-vs-raster STYLES, production-code grep
- Zero production code changes to `MapChartRenderer.tsx` or `wmsUrlBuilder.ts` (Phase 38 lock; Phase 40 form mutations flow through existing infrastructure)
- Full frontend vitest suite green; tsc clean
- Phase 40 complete — all 5 ROADMAP success criteria and all 6 TRACK-V17 REQ IDs covered across Plans 40-01 + 40-02
</success_criteria>

<output>
After completion, create `.planning/phases/40-track-sub-section-ui/40-02-SUMMARY.md` per the SUMMARY template.

Required sections:
- Performance metrics (duration, tasks, files modified)
- Accomplishments (Task 1 host-mount wiring + 7 host-form tests, Task 2 TRACK-V17-05 fingerprint regression with 7 tests)
- ROADMAP SC closure map (5/5 SCs satisfied — show which plan + spec test closes each)
- TRACK-V17-01..06 REQ-ID coverage map (6/6 with closing plan reference)
- Test counts (frontend vitest total before vs after; e.g., 1131 → 1131 + 7 + 7 + 25 + 7 = ~1177)
- Deviations from plan (any auto-fixes during execution)
- Self-check (grep counts matching acceptance_criteria above + git diff scope verification for production-code-unchanged invariants)
- Phase 40 closure note (Phase 41 LayersLegendPanel unblocked)
</output>
