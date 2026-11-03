// Phase 143 (AIMCP-V20-04): personal access tokens for the Claude Desktop connector.
import { describe, it, expect, beforeEach } from "vitest";
import { db, createDb } from "../src/db";
import { createSession, getSession } from "../src/sessionStore";
import {
  createMcpToken,
  redeemMcpToken,
  listMcpTokens,
  revokeMcpToken,
  recordMcpTokenSession,
  MCP_TOKEN_RE,
} from "../src/lib/mcp/mcpTokens";

const URL_ = "http://kinetica.test:9191";
const make = (over: Partial<Parameters<typeof createMcpToken>[0]> = {}) =>
  createMcpToken({ username: "Dee", secret: "s3cret-pw", kineticaUrl: URL_, name: "Claude Desktop", ttlDays: 90, ...over });

beforeEach(() => {
  db.exec("DELETE FROM mcp_tokens; DELETE FROM mcp_token_sessions;");
});

describe("mcpTokens", () => {
  it("MCPTOK-1 a new token is shown once and redeems to the user's Kinetica credential", () => {
    const { token, id } = make();
    expect(token).toMatch(MCP_TOKEN_RE);
    expect(redeemMcpToken(token)).toEqual({ tokenId: id, username: "dee", secret: "s3cret-pw", kineticaUrl: URL_ });
    const [row] = listMcpTokens("DEE");
    expect(row).toMatchObject({ id, name: "Claude Desktop" });
    expect(row.lastUsedAt).not.toBeNull();
    expect(Object.keys(row)).not.toContain("token_hash");
  });

  it("MCPTOK-2 the stored row holds neither the token nor the password", () => {
    const { token } = make();
    const raw = JSON.stringify(db.prepare("SELECT * FROM mcp_tokens").all(), (_k, v) => (Buffer.isBuffer(v) || (v && v.type === "Buffer") ? Buffer.from(v.data ?? v).toString("latin1") : v));
    expect(raw).not.toContain("s3cret-pw");
    expect(raw).not.toContain(token.split("_")[2]);
  });

  it("MCPTOK-3 wrong, tampered, malformed, expired and other users' tokens do not redeem", () => {
    const { token, id } = make();
    const [, pub, secret] = token.split("_");
    const flipped = secret.slice(0, -1) + (secret.endsWith("A") ? "B" : "A");
    expect(redeemMcpToken(`kbi_${pub}_${flipped}`)).toBeNull();
    expect(redeemMcpToken("kbi_nope")).toBeNull();
    expect(redeemMcpToken("")).toBeNull();
    db.prepare("UPDATE mcp_tokens SET expires_at = datetime('now', '-1 minute') WHERE id = ?").run(id);
    expect(redeemMcpToken(token)).toBeNull();
    const other = make({ username: "eve" });
    expect(revokeMcpToken("dee", other.id)).toBe(false);
    expect(redeemMcpToken(other.token)).not.toBeNull();
  });

  it("MCPTOK-4 revoking ends the sessions the token opened, not the user's others", () => {
    const { token, id } = make();
    expect(redeemMcpToken(token)).not.toBeNull();
    const viaToken = createSession({ username: "dee", secret: "s3cret-pw", kineticaUrl: URL_ });
    recordMcpTokenSession(viaToken, id);
    const browser = createSession({ username: "dee", secret: "s3cret-pw", kineticaUrl: URL_ });
    expect(revokeMcpToken("dee", id)).toBe(true);
    expect(redeemMcpToken(token)).toBeNull();
    expect(getSession(viaToken)).toBeNull();
    expect(getSession(browser)).not.toBeNull();
    expect(listMcpTokens("dee")).toEqual([]);
  });

  it("MCPTOK-5 the schema creates the token tables", () => {
    const fresh = createDb(":memory:");
    const names = fresh.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => (r as { name: string }).name);
    expect(names).toEqual(expect.arrayContaining(["mcp_tokens", "mcp_token_sessions"]));
  });
});
