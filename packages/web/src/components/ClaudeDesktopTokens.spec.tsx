import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClaudeDesktopTokens } from "./ClaudeDesktopTokens";
import * as client from "../api/client";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, listMcpTokens: vi.fn(), createMcpToken: vi.fn(), revokeMcpToken: vi.fn() };
});

const TOKEN = "kbi_0123456789abcdef_" + "a".repeat(43);
const row = { id: 3, name: "Laptop", createdAt: "2026-10-29 15:00:00", lastUsedAt: null, expiresAt: "2027-01-27 15:00:00" };

beforeEach(() => {
  vi.mocked(client.listMcpTokens).mockReset().mockResolvedValue([row]);
  vi.mocked(client.createMcpToken).mockReset().mockResolvedValue({ id: 4, token: TOKEN, name: "Claude Desktop", expiresAt: "2027-01-27 15:00:00" });
  vi.mocked(client.revokeMcpToken).mockReset().mockResolvedValue();
});

describe("ClaudeDesktopTokens", () => {
  it("CDT-1 lists the user's tokens without the secret", async () => {
    render(<ClaudeDesktopTokens />);
    expect(await screen.findByText("Laptop")).toBeTruthy();
    expect(screen.getByText(/never used/i)).toBeTruthy();
  });

  it("CDT-2 creating a token shows it once with the config to paste", async () => {
    render(<ClaudeDesktopTokens />);
    await screen.findByText("Laptop");
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(client.createMcpToken).toHaveBeenCalledWith("Claude Desktop"));
    const shown = await screen.findAllByText((t) => t.includes(TOKEN));
    expect(shown.length).toBeGreaterThan(0);
    expect(screen.getByText(/"KBI_TOKEN"/)).toBeTruthy();
    expect(screen.getByText(/shown once/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryAllByText((t) => t.includes(TOKEN))).toHaveLength(0);
  });

  it("CDT-6 without Use AI: existing tokens can be revoked, no Create form; with none, nothing shows", async () => {
    const { unmount } = render(<ClaudeDesktopTokens canCreate={false} />);
    expect(await screen.findByText("Laptop")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create token" })).toBeNull();
    expect(screen.getByRole("button", { name: "Revoke Laptop" })).toBeTruthy();
    unmount();
    vi.mocked(client.listMcpTokens).mockResolvedValue([]);
    const { container } = render(<ClaudeDesktopTokens canCreate={false} />);
    await waitFor(() => expect(client.listMcpTokens).toHaveBeenCalledTimes(2));
    expect(container.innerHTML).toBe("");
  });

  it("CDT-3 revoke asks first, then removes the token", async () => {
    render(<ClaudeDesktopTokens />);
    await screen.findByText("Laptop");
    fireEvent.click(screen.getByRole("button", { name: "Revoke Laptop" }));
    expect(client.revokeMcpToken).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(client.revokeMcpToken).toHaveBeenCalledWith(3));
  });

  it("CDT-4 a server error shows its message", async () => {
    vi.mocked(client.createMcpToken).mockRejectedValue(new Error("You already have 10 tokens. Revoke one first."));
    render(<ClaudeDesktopTokens />);
    await screen.findByText("Laptop");
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByText("You already have 10 tokens. Revoke one first.")).toBeTruthy();
  });
});
