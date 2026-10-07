// Phase 131 (D-10..D-13): a dialog can close and the records widget can unmount while an export runs, so polling lives at module level. setTimeout chain (never setInterval) so a slow response never overlaps the next poll. App.tsx calls stopAllExportTracking() on logout. A reload re-attaches nothing (D-13).
import { create } from "zustand";
import {
  getExportJob,
  ReauthRequiredError,
  type ExportJobDto,
} from "../api/client";
import { exportDisplayName, isTerminalExportStatus } from "../lib/exportFormat";
import { startExportDownload } from "../lib/exportDownload";
import { useToastStore } from "./toast";

export const EXPORT_POLL_MS = 5000;

export type ExportTrackerState = {
  jobs: Record<string, ExportJobDto>;
  dialogJobId: string | null;
};

export const useExportTrackerStore = create<ExportTrackerState>(() => ({
  jobs: {},
  dialogJobId: null,
}));

const timers = new Map<string, ReturnType<typeof setTimeout>>();
let generation = 0;

function schedule(id: string): void {
  const existing = timers.get(id);
  if (existing !== undefined) clearTimeout(existing);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void poll(id, generation);
    }, EXPORT_POLL_MS),
  );
}

function dropEntry(id: string): void {
  useExportTrackerStore.setState((s) => {
    const jobs = { ...s.jobs };
    delete jobs[id];
    return { jobs };
  });
}

async function poll(id: string, gen: number): Promise<void> {
  let dto: ExportJobDto | null;
  try {
    dto = await getExportJob(id);
  } catch (e) {
    if (gen !== generation) return;
    if (e instanceof ReauthRequiredError) {
      stopAllExportTracking();
      return;
    }
    if (useExportTrackerStore.getState().jobs[id]) schedule(id);
    return;
  }
  if (gen !== generation || !useExportTrackerStore.getState().jobs[id]) return;
  if (dto === null) {
    untrackExport(id);
    return;
  }
  useExportTrackerStore.setState((s) => ({ jobs: { ...s.jobs, [id]: dto } }));
  if (!isTerminalExportStatus(dto.status)) {
    schedule(id);
    return;
  }
  if (useExportTrackerStore.getState().dialogJobId === id) return; // the open dialog renders the result
  notify(dto);
  dropEntry(id);
}

function notify(dto: ExportJobDto): void {
  const { showToast } = useToastStore.getState();
  if (dto.status === "complete") {
    showToast(`Export "${exportDisplayName(dto)}" is ready`, "info", {
      label: "Download",
      onClick: () => {
        void startExportDownload(dto.id);
      },
    });
  } else if (dto.status === "failed" || dto.status === "session_expired") {
    showToast(dto.errorMessage ?? "Export failed.", "error");
  }
}

export function trackExport(dto: ExportJobDto): void {
  useExportTrackerStore.setState((s) => ({
    jobs: { ...s.jobs, [dto.id]: dto },
  }));
  if (!isTerminalExportStatus(dto.status)) schedule(dto.id);
}

export function untrackExport(id: string): void {
  const t = timers.get(id);
  if (t !== undefined) clearTimeout(t);
  timers.delete(id);
  useExportTrackerStore.setState((s) => {
    const jobs = { ...s.jobs };
    delete jobs[id];
    return { jobs, dialogJobId: s.dialogJobId === id ? null : s.dialogJobId };
  });
}

export function setDialogJob(id: string | null): void {
  const prev = useExportTrackerStore.getState();
  if (id === null && prev.dialogJobId) {
    const job = prev.jobs[prev.dialogJobId];
    if (job && isTerminalExportStatus(job.status)) {
      const jobs = { ...prev.jobs };
      delete jobs[prev.dialogJobId];
      useExportTrackerStore.setState({ jobs, dialogJobId: null });
      return;
    }
  }
  useExportTrackerStore.setState({ dialogJobId: id });
}

export function stopAllExportTracking(): void {
  generation++;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  useExportTrackerStore.setState({ jobs: {}, dialogJobId: null });
}
