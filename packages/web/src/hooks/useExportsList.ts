// Phase 131 (D-17): own setTimeout chain, only while a non-terminal row exists; useApiQuery is avoided because its refetch flashes the loading state.
import { useCallback, useEffect, useRef, useState } from "react";
import { listExportJobs, PermissionError, type ExportJobDto } from "../api/client";
import { isTerminalExportStatus } from "../lib/exportFormat";

export const EXPORTS_LIST_POLL_MS = 5000;

export type ExportsListError = { kind: "permission" | "other"; message: string };

const sortNewest = (list: ExportJobDto[]): ExportJobDto[] =>
  [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

export function useExportsList(): {
  jobs: ExportJobDto[];
  loading: boolean;
  error: ExportsListError | null;
  reload: () => void;
  replaceJob: (dto: ExportJobDto) => void;
  removeJob: (id: string) => void;
} {
  const [jobs, setJobs] = useState<ExportJobDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ExportsListError | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const jobsRef = useRef<ExportJobDto[]>([]);
  const loadRef = useRef<(reportErrors: boolean) => Promise<void>>(async () => {});

  const schedule = useCallback((list: ExportJobDto[]) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!mountedRef.current) return;
    if (list.some((j) => !isTerminalExportStatus(j.status))) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void loadRef.current(false);
      }, EXPORTS_LIST_POLL_MS);
    }
  }, []);

  const apply = useCallback(
    (list: ExportJobDto[]) => {
      jobsRef.current = list;
      setJobs(list);
      schedule(list);
    },
    [schedule]
  );

  const load = useCallback(
    async (reportErrors: boolean) => {
      try {
        const list = sortNewest(await listExportJobs());
        if (!mountedRef.current) return;
        setError(null);
        apply(list);
      } catch (e) {
        if (!mountedRef.current) return;
        if (reportErrors) {
          setError(
            e instanceof PermissionError
              ? { kind: "permission", message: e.message }
              : { kind: "other", message: (e as Error).message }
          );
        } else {
          schedule(jobsRef.current);
        }
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [apply, schedule]
  );
  loadRef.current = load;

  useEffect(() => {
    mountedRef.current = true;
    void load(true);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-lifetime effect
  }, []);

  const reload = useCallback(() => {
    void load(true);
  }, [load]);

  const replaceJob = useCallback(
    (dto: ExportJobDto) => {
      apply(jobsRef.current.map((j) => (j.id === dto.id ? dto : j)));
    },
    [apply]
  );

  const removeJob = useCallback(
    (id: string) => {
      apply(jobsRef.current.filter((j) => j.id !== id));
    },
    [apply]
  );

  return { jobs, loading, error, reload, replaceJob, removeJob };
}
