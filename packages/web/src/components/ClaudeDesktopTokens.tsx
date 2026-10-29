/**
 * Phase 143 (AIMCP-V20-04): the Profile page's Claude Desktop section. A user creates a personal access token for the
 * Kinetica BI connector (shown once, with the config to paste) and revokes tokens. The token wraps the user's Kinetica
 * password on the server, so it only works with password sign-in.
 */
import { useEffect, useState } from "react";
import { API_BASE, createMcpToken, listMcpTokens, revokeMcpToken, type McpTokenCreatedDto, type McpTokenDto } from "../api/client";

const day = (sqlTs: string) => sqlTs.slice(0, 10);

/** The part of claude_desktop_config.json that carries the token (the rest is in packages/mcp/README.md). */
export function claudeDesktopEnv(token: string): string {
  const url = /^https?:\/\//.test(API_BASE) ? API_BASE : window.location.origin;
  return JSON.stringify({ env: { KBI_URL: url, KBI_TOKEN: token } }, null, 2);
}

export function ClaudeDesktopTokens() {
  const [tokens, setTokens] = useState<McpTokenDto[] | null>(null);
  const [name, setName] = useState("Claude Desktop");
  const [created, setCreated] = useState<McpTokenCreatedDto | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = () =>
    listMcpTokens()
      .then(setTokens)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load access tokens"));

  useEffect(() => {
    void refresh();
  }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      setCreated(await createMcpToken(name.trim()));
      setCopied(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create the access token");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      await revokeMcpToken(id);
      setConfirmId(null);
      if (created?.id === id) setCreated(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke the access token");
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
  };

  return (
    <section className="profile-section">
      <h2 className="profile-section-title">Claude Desktop</h2>
      <p className="config-hint">
        Create an access token for the Kinetica BI connector in Claude Desktop. It signs in as you, with your permissions;
        revoke it here at any time.
      </p>

      {created ? (
        <div className="profile-token-created">
          <div className="config-hint">Copy this token now. It is shown once.</div>
          <code className="config-sql-code">{created.token}</code>
          <div className="config-hint">Put it in the connector's entry in claude_desktop_config.json, then quit and reopen Claude Desktop:</div>
          <code className="config-sql-code">{claudeDesktopEnv(created.token)}</code>
          <div className="ds-actions">
            <button type="button" className="btn-primary btn-sm" onClick={() => copy(claudeDesktopEnv(created.token))}>
              {copied ? "Copied" : "Copy config"}
            </button>
            <button type="button" className="ghost-sm" onClick={() => setCreated(null)}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="profile-token-form">
          <label className="ds-field">
            <span className="ds-field-label">Token name</span>
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="ds-actions">
            <button type="button" className="btn-primary btn-sm" disabled={busy || name.trim() === ""} onClick={() => void create()}>
              Create token
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="profile-token-error" role="alert">
          {error}
        </div>
      )}

      {tokens && tokens.length > 0 && (
        <ul className="profile-token-list">
          {tokens.map((t) => (
            <li key={t.id} className="profile-token-row">
              <div>
                <div className="profile-token-name">{t.name}</div>
                <div className="profile-token-meta">
                  Created {day(t.createdAt)} · {t.lastUsedAt ? `last used ${day(t.lastUsedAt)}` : "never used"} · expires {day(t.expiresAt)}
                </div>
              </div>
              {confirmId === t.id ? (
                <div className="ds-actions">
                  <button type="button" className="ghost-sm ghost-danger" disabled={busy} onClick={() => void revoke(t.id)}>
                    Revoke
                  </button>
                  <button type="button" className="ghost-sm" onClick={() => setConfirmId(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" className="ghost-sm ghost-danger" aria-label={`Revoke ${t.name}`} onClick={() => setConfirmId(t.id)}>
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
