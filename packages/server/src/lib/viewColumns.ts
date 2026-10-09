// Phase 133 (AISAFE-V20-01): dv column source = the S1-decided Kinetica lookup (133-SPIKES.md). NEVER dashboard_dynamic_views.columns_json — it is client-asserted.
// Pure helpers + an injectable-clock TTL cache (no express/kinetica imports).

export function buildViewColumnsProbeSql(viewName: string): string {
  return `SELECT * FROM ${viewName} LIMIT 0`;
}

export function parseProbeColumns(result: unknown): string[] {
  const headers = (result as { column_headers?: unknown } | null | undefined)?.column_headers;
  if (!Array.isArray(headers)) return [];
  return headers.filter((h): h is string => typeof h === "string");
}

export type ViewColumnsCache = {
  get(view: string): string[] | undefined;
  set(view: string, cols: string[]): void;
  delete(view: string): void;
  clear(): void;
};

export function createViewColumnsCache(opts: { ttlMs: number; now?: () => number }): ViewColumnsCache {
  const now = opts.now ?? Date.now;
  const store = new Map<string, { cols: string[]; expires: number }>();
  return {
    get(view) {
      const e = store.get(view);
      if (!e) return undefined;
      if (now() >= e.expires) {
        store.delete(view);
        return undefined;
      }
      return e.cols;
    },
    set(view, cols) {
      store.set(view, { cols, expires: now() + opts.ttlMs });
    },
    delete(view) {
      store.delete(view);
    },
    clear() {
      store.clear();
    },
  };
}
