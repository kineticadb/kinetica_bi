// Phase 7 (UX-08): bootstrap() consumes /config and /me's authMode field.
// Latest-write-wins: /me overwrites /config when both succeed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAuthStore } from "./auth";

// Mock the client.ts module — control fetchAuthConfig and fetchMe per test.
vi.mock("../api/client", () => ({
  fetchAuthConfig: vi.fn(),
  fetchMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));

import { fetchAuthConfig, fetchMe } from "../api/client";

const fetchAuthConfigMock = fetchAuthConfig as unknown as ReturnType<typeof vi.fn>;
const fetchMeMock = fetchMe as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchAuthConfigMock.mockReset();
  fetchMeMock.mockReset();
});

describe("authStore initial state", () => {
  it("authMode defaults to null on initial state", () => {
    expect(useAuthStore.getState().authMode).toBeNull();
  });
});

describe("bootstrap() — latest-write-wins authMode", () => {
  it("writes authMode='password' from /config when /me returns null", async () => {
    fetchAuthConfigMock.mockResolvedValueOnce({ authMode: "password" });
    fetchMeMock.mockResolvedValueOnce(null);
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().authMode).toBe("password");
    expect(useAuthStore.getState().status).toBe("unauthenticated");
  });

  it("writes authMode='oidc' from /config when /me returns null", async () => {
    fetchAuthConfigMock.mockResolvedValueOnce({ authMode: "oidc" });
    fetchMeMock.mockResolvedValueOnce(null);
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().authMode).toBe("oidc");
  });

  it("/me overwrites /config when both succeed (latest-write-wins)", async () => {
    // /config says password, /me says oidc — /me wins.
    fetchAuthConfigMock.mockResolvedValueOnce({ authMode: "password" });
    fetchMeMock.mockResolvedValueOnce({
      user: { username: "alice" },
      authMode: "oidc",
    });
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().authMode).toBe("oidc");
    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(useAuthStore.getState().user).toEqual({ username: "alice" });
  });
});

describe("bootstrap() — fetchAuthConfig failure resilience (PITFALL I-03)", () => {
  it("silently swallows fetchAuthConfig rejection; authMode stays null", async () => {
    fetchAuthConfigMock.mockRejectedValueOnce(new Error("network failed"));
    fetchMeMock.mockResolvedValueOnce(null);
    await expect(useAuthStore.getState().bootstrap()).resolves.toBeUndefined();
    expect(useAuthStore.getState().authMode).toBeNull();
    expect(useAuthStore.getState().status).toBe("unauthenticated");
  });

  it("does NOT throw out of bootstrap when fetchAuthConfig rejects", async () => {
    fetchAuthConfigMock.mockRejectedValueOnce(new Error("boom"));
    fetchMeMock.mockResolvedValueOnce(null);
    // App.tsx awaits bootstrap() — must never see this error.
    let threw = false;
    try {
      await useAuthStore.getState().bootstrap();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe("bootstrap() — call order", () => {
  it("calls fetchAuthConfig BEFORE fetchMe (sequential, not parallel)", async () => {
    const callOrder: string[] = [];
    fetchAuthConfigMock.mockImplementationOnce(async () => {
      callOrder.push("config");
      return { authMode: "password" };
    });
    fetchMeMock.mockImplementationOnce(async () => {
      callOrder.push("me");
      return null;
    });
    await useAuthStore.getState().bootstrap();
    expect(callOrder).toEqual(["config", "me"]);
  });
});

describe("bootstrap() — fetchMe failure", () => {
  it("sets status='unauthenticated' when fetchMe throws", async () => {
    fetchAuthConfigMock.mockResolvedValueOnce({ authMode: "password" });
    fetchMeMock.mockRejectedValueOnce(new Error("network"));
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().status).toBe("unauthenticated");
    // authMode was already set by /config — preserved.
    expect(useAuthStore.getState().authMode).toBe("password");
  });
});

describe("hasPermission selector + setPermissions", () => {
  it("hasPermission(p) returns true when p is in user.permissions", () => {
    useAuthStore.setState({
      status: "authenticated",
      user: { username: "t", roles: ["designer"], permissions: ["dashboards:edit"] },
    });
    expect(useAuthStore.getState().hasPermission("dashboards:edit")).toBe(true);
  });

  it("hasPermission(p) returns false when p is not in user.permissions", () => {
    useAuthStore.setState({
      status: "authenticated",
      user: { username: "t", roles: ["analyst"], permissions: ["dashboards:view"] },
    });
    expect(useAuthStore.getState().hasPermission("dashboards:edit")).toBe(false);
  });

  it("hasPermission(p) returns false when user is null (unauthenticated)", () => {
    useAuthStore.setState({ user: null });
    expect(useAuthStore.getState().hasPermission("dashboards:edit")).toBe(false);
  });

  it("hasPermission reads CURRENT state — reflects update after setPermissions", () => {
    useAuthStore.setState({
      status: "authenticated",
      user: { username: "t", roles: ["analyst"], permissions: ["dashboards:view"] },
    });
    expect(useAuthStore.getState().hasPermission("dashboards:edit")).toBe(false);
    useAuthStore.getState().setPermissions(["designer"], ["dashboards:view", "dashboards:edit"]);
    expect(useAuthStore.getState().hasPermission("dashboards:edit")).toBe(true);
  });

  it("setPermissions updates user.roles + user.permissions in place (preserving username)", () => {
    useAuthStore.setState({
      status: "authenticated",
      user: { username: "alice", roles: ["analyst"], permissions: ["dashboards:view"] },
    });
    useAuthStore.getState().setPermissions(["designer"], ["dashboards:view", "dashboards:edit"]);
    const user = useAuthStore.getState().user;
    expect(user?.username).toBe("alice");
    expect(user?.roles).toEqual(["designer"]);
    expect(user?.permissions).toEqual(["dashboards:view", "dashboards:edit"]);
  });

  it("setPermissions is a safe no-op when user is null", () => {
    useAuthStore.setState({ user: null });
    useAuthStore.getState().setPermissions(["designer"], ["dashboards:edit"]);
    expect(useAuthStore.getState().user).toBeNull();
  });
});
