import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import type { AiAuditRowDto, AiAuditDetailDto } from "../api/client";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    listAiAudit: vi.fn(),
    getAiAuditEntry: vi.fn(),
    listAiAuditDashboards: vi.fn(),
  };
});

import { listAiAudit, getAiAuditEntry, listAiAuditDashboards } from "../api/client";
import { AiActivityPage } from "./AiActivityPage";

const row = (o: Partial<AiAuditRowDto>): AiAuditRowDto => ({
  id: 1, ts: 1_700_000_000_000, username: "alice", dashboardId: 5, dashboardName: "Sales",
  dashboardState: "live", kind: "ask", question: "How many trips?", summary: null,
  outcome: "ok", outcomeDetail: null, steps: 4, durationMs: 1200, ...o,
});
const list = (rows: AiAuditRowDto[], total = rows.length, page = 1) => ({ rows, total, page, pageSize: 50 as const });
const detail = (o: Partial<AiAuditDetailDto> = {}): AiAuditDetailDto => ({
  ...row({}), answerText: "There were 42 trips.", provider: "gemini", model: "gemini-3-flash-preview",
  dataAccess: "user-scoped", allowListVersion: "v7", inputTokens: 1200, outputTokens: 300,
  tools: [{ name: "describe_table", result: "ok" }], changes: null,
  queries: [{ sql: "SELECT COUNT(*) FROM trips", rowCount: 200, durationMs: 35, outcome: "ok" }],
  outcomeDetail: "all good", ...o,
});
const lastCall = () => vi.mocked(listAiAudit).mock.calls.at(-1)![0];

beforeEach(() => {
  vi.mocked(listAiAudit).mockReset().mockResolvedValue(list([row({})]));
  vi.mocked(getAiAuditEntry).mockReset().mockResolvedValue(detail());
  vi.mocked(listAiAuditDashboards).mockReset().mockResolvedValue({
    dashboards: [{ id: 5, name: "Sales", state: "live" }, { id: 12, name: null, state: "deleted" }],
  });
});

describe("AiActivityPage", () => {
  it("AUDPAGE-1: layout", async () => {
    render(<AiActivityPage />);
    expect(await screen.findByRole("heading", { name: "AI activity" })).toBeTruthy();
    expect(screen.getByText("Query results are never logged.")).toBeTruthy();
    for (const h of ["Time", "User", "Dashboard", "Kind", "Question", "Outcome", "Steps", "Duration"]) {
      expect(screen.getByRole("columnheader", { name: h })).toBeTruthy();
    }
  });

  it("AUDPAGE-2: default range is last 7 days, no other params", async () => {
    render(<AiActivityPage />);
    await waitFor(() => expect(listAiAudit).toHaveBeenCalled());
    const q = vi.mocked(listAiAudit).mock.calls[0][0];
    expect(Math.abs(q.to! - Date.now())).toBeLessThan(5000);
    const day = 86_400_000;
    expect(Math.abs(q.to! - q.from! - 7 * day)).toBeLessThanOrEqual(day);
    expect(q.outcomes).toBeUndefined();
    expect(q.dashboardId).toBeUndefined();
  });

  it("AUDPAGE-3: rows", async () => {
    vi.mocked(listAiAudit).mockResolvedValue(list([
      row({ id: 1 }),
      row({ id: 2, kind: "generate", question: "Gen q", durationMs: 850 }),
      row({ id: 3, kind: "keep", question: "", summary: "Kept 3 added, 1 edited, 0 removed", outcome: "kept", durationMs: null }),
    ]));
    render(<AiActivityPage />);
    expect(await screen.findByText("How many trips?")).toBeTruthy();
    expect(screen.getAllByText("Ask").length).toBeGreaterThan(0);
    expect(within(screen.getByRole("table")).getAllByText("Answered").length).toBe(2);
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
    expect(screen.getByText("1.2 s")).toBeTruthy();
    expect(screen.getByText("850 ms")).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Generate")).toBeTruthy();
    expect(within(table).getByText("Keep")).toBeTruthy();
    expect(within(table).getByText("Kept 3 added, 1 edited, 0 removed")).toBeTruthy();
  });

  it("AUDPAGE-4: dashboard states", async () => {
    vi.mocked(listAiAudit).mockResolvedValue(list([
      row({ id: 1, dashboardName: "Live one" }),
      row({ id: 2, dashboardId: 12, dashboardName: null, dashboardState: "deleted" }),
      row({ id: 3, dashboardId: 13, dashboardName: null, dashboardState: "pending" }),
      row({ id: 4, dashboardId: null, dashboardName: null, dashboardState: "none" }),
    ]));
    render(<AiActivityPage />);
    expect(await screen.findByText("Live one")).toBeTruthy();
    const tbl = within(screen.getByRole("table"));
    const del = tbl.getByText("Deleted dashboard #12");
    expect(del.className).toContain("muted");
    expect(del.closest("a,button")).toBeNull();
    expect(tbl.getByText("Dashboard #13 (not kept yet)").className).toContain("muted");
    const rows = screen.getAllByRole("row");
    expect(within(rows[4]).getByText("—", { selector: "td, td *" })).toBeTruthy();
  });

  it("AUDPAGE-5: filters refetch; no user filter", async () => {
    render(<AiActivityPage />);
    await screen.findByText("How many trips?");
    expect(screen.queryByLabelText("User")).toBeNull();

    fireEvent.change(screen.getByLabelText("Outcome"), { target: { value: "keep_conflict" } });
    await waitFor(() => expect(lastCall().outcomes).toEqual(["keep_conflict"]));
    expect(lastCall().page).toBe(1);

    await waitFor(() => expect(screen.getByRole("option", { name: "Sales" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Dashboard"), { target: { value: "5" } });
    await waitFor(() => expect(lastCall().dashboardId).toBe(5));

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-02" } });
    await waitFor(() => expect(lastCall().from).toBe(new Date(2026, 0, 2, 0, 0, 0, 0).getTime()));
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-01-09" } });
    await waitFor(() => expect(lastCall().to).toBe(new Date(2026, 0, 9, 23, 59, 59, 999).getTime()));
  });

  it("AUDPAGE-6: paging", async () => {
    vi.mocked(listAiAudit).mockImplementation(async (q) => list([row({})], 120, q.page ?? 1));
    render(<AiActivityPage />);
    expect(await screen.findByText("Page 1 of 3 · 120 entries")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastCall().page).toBe(2));
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    await screen.findByText("Page 3 of 3 · 120 entries");
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("AUDPAGE-7: detail panel", async () => {
    render(<AiActivityPage />);
    fireEvent.click(await screen.findByText("How many trips?"));
    await waitFor(() => expect(getAiAuditEntry).toHaveBeenCalledWith(1, expect.anything()));
    const panel = await screen.findByLabelText("AI activity detail");
    expect(within(panel).getByText("There were 42 trips.")).toBeTruthy();
    expect(within(panel).getByText("describe_table (ok)")).toBeTruthy();
    expect(within(panel).getByText("SELECT COUNT(*) FROM trips")).toBeTruthy();
    expect(within(panel).getByText(/200 rows/)).toBeTruthy();
    expect(within(panel).getByText(/35 ms/)).toBeTruthy();
    expect(within(panel).getByText(/gemini-3-flash-preview/)).toBeTruthy();
    expect(within(panel).getByText("1200 in / 300 out")).toBeTruthy();
    expect(within(panel).getByText("user-scoped")).toBeTruthy();
    expect(within(panel).getByText("v7")).toBeTruthy();
    expect(within(panel).getByText("all good")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByLabelText("AI activity detail")).toBeNull();
  });

  it("AUDPAGE-7b: Enter opens detail", async () => {
    render(<AiActivityPage />);
    const cell = await screen.findByText("How many trips?");
    fireEvent.keyDown(cell.closest("tr")!, { key: "Enter" });
    await waitFor(() => expect(getAiAuditEntry).toHaveBeenCalled());
  });

  it("AUDPAGE-8: defensive detail", async () => {
    vi.mocked(getAiAuditEntry).mockResolvedValue(detail({
      tools: [], queries: null, changes: null, answerText: null, provider: null, model: null,
      dataAccess: null, allowListVersion: null, inputTokens: null, outputTokens: null, outcomeDetail: "timeout",
    }));
    render(<AiActivityPage />);
    fireEvent.click(await screen.findByText("How many trips?"));
    const panel = await screen.findByLabelText("AI activity detail");
    expect(within(panel).getByText("No tools recorded.")).toBeTruthy();
    expect(within(panel).queryByText("Queries")).toBeNull();
    expect(within(panel).getByText("The tools list can be incomplete for answers that timed out.")).toBeTruthy();
    expect(within(panel).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("AUDPAGE-9: plain text", async () => {
    vi.mocked(getAiAuditEntry).mockResolvedValue(detail({ answerText: "<img src=x onerror=alert(1)>" }));
    const { container } = render(<AiActivityPage />);
    fireEvent.click(await screen.findByText("How many trips?"));
    await screen.findByText("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img")).toBeNull();
  });

  it("AUDPAGE-10: empty and error", async () => {
    vi.mocked(listAiAudit).mockResolvedValue(list([]));
    const { unmount } = render(<AiActivityPage />);
    expect(await screen.findByText("No AI activity in this period.")).toBeTruthy();
    unmount();
    vi.mocked(listAiAudit).mockRejectedValue(new Error("Failed to load AI activity (500)"));
    const r = render(<AiActivityPage />);
    const err = await screen.findByText("Failed to load AI activity (500)");
    expect(err.className).toContain("error");
    r.unmount();
  });
});
