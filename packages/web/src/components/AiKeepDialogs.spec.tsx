import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { KEEP_CONFLICT_MESSAGE } from "@kinetica-bi/shared";
import AiKeepDialog from "./AiKeepDialog";
import AiKeepConflictDialog from "./AiKeepConflictDialog";

const counts = { added: 3, edited: 2, removed: 1 };

describe("AiKeepDialog", () => {
  it("KDLG-1: labelled portalled confirm with counts and filters note", () => {
    render(<AiKeepDialog counts={counts} onSave={vi.fn()} onCancel={vi.fn()} />);
    const dlg = screen.getByRole("dialog", { name: "Save AI changes?" });
    expect(dlg.textContent).toContain("3 added · 2 edited · 1 removed. Filters are not saved.");
    expect(dlg.closest(".modal-overlay")!.parentElement).toBe(document.body);
    expect(dlg.textContent).not.toContain("View on/off changes are not saved.");
  });

  it("KDLG-2: classes, shared ds-actions, save/cancel routing", () => {
    const save = vi.fn();
    const cancel = vi.fn();
    render(<AiKeepDialog counts={counts} onSave={save} onCancel={cancel} />);
    const s = screen.getByRole("button", { name: "Save" });
    const c = screen.getByRole("button", { name: "Cancel" });
    expect(s.className).toBe("btn-primary btn-sm");
    expect(c.className).toBe("ghost-sm");
    expect(s.parentElement!.classList.contains("ds-actions")).toBe(true);
    expect(c.parentElement).toBe(s.parentElement);
    fireEvent.click(s);
    expect(save).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(c);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(document.querySelector(".modal-overlay")!);
    expect(cancel).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("KDLG-3: Cancel focused under StrictMode", () => {
    render(
      <React.StrictMode>
        <AiKeepDialog counts={counts} onSave={vi.fn()} onCancel={vi.fn()} />
      </React.StrictMode>,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("KDLG-5: view-toggle note only when flagged, in its own paragraph", () => {
    render(<AiKeepDialog counts={counts} viewTogglesNotSaved onSave={vi.fn()} onCancel={vi.fn()} />);
    const dlg = screen.getByRole("dialog");
    const p = Array.from(dlg.querySelectorAll("p")).find((n) => n.textContent === "View on/off changes are not saved.");
    expect(p).toBeTruthy();
  });
});

describe("AiKeepConflictDialog", () => {
  it("KDLG-4: exact message, classes, focus, routing", () => {
    const stay = vi.fn();
    const reload = vi.fn();
    render(
      <React.StrictMode>
        <AiKeepConflictDialog onStay={stay} onReload={reload} />
      </React.StrictMode>,
    );
    const dlg = screen.getByRole("dialog", { name: "This dashboard changed" });
    expect(dlg.querySelector(".modal-body p")!.textContent).toBe(KEEP_CONFLICT_MESSAGE);
    const st = screen.getByRole("button", { name: "Stay" });
    const rl = screen.getByRole("button", { name: "Discard and reload the latest" });
    expect(st.className).toBe("btn-primary btn-sm");
    expect(rl.className).toBe("ghost-sm ghost-danger");
    expect(rl.parentElement).toBe(st.parentElement);
    expect(st.parentElement!.classList.contains("ds-actions")).toBe(true);
    expect(document.activeElement).toBe(st);
    fireEvent.keyDown(dlg, { key: "Escape" });
    fireEvent.click(document.querySelector(".modal-overlay")!);
    expect(stay).toHaveBeenCalledTimes(2);
    fireEvent.click(rl);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
