import { useEffect, useState } from "react";
import { PermissionError, ReauthRequiredError, UpstreamError } from "../api/client";
import { useToastStore } from "../store/toast";

export type ApiQueryError = {
  kind: "permission" | "reauth" | "upstream" | "other";
  message: string;
};

export type ApiQueryResult<T> = {
  loading: boolean;
  data: T | null;
  error: ApiQueryError | null;
  refetch: () => void;
};

export function useApiQuery<T>(
  fetchFn: () => Promise<T>,
  deps: ReadonlyArray<unknown>
): ApiQueryResult<T> {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiQueryError | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const showToast = useToastStore((s) => s.showToast);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchFn()
      .then((result) => {
        if (!active) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof PermissionError) {
          setError({ kind: "permission", message: err.message });
          showToast("You don't have permission to view this data.", "permission");
          return;
        }
        if (err instanceof ReauthRequiredError) {
          // App.tsx UNAUTHORIZED_EVENT handler will route to LoginPage; nothing to display here.
          setError({ kind: "reauth", message: err.message });
          return;
        }
        if (err instanceof UpstreamError) {
          setError({ kind: "upstream", message: err.message });
          return;
        }
        setError({ kind: "other", message: (err as Error)?.message ?? "Unknown error" });
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadTick]);

  const refetch = () => setReloadTick((n) => n + 1);
  return { loading, data, error, refetch };
}
