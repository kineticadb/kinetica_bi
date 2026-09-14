import { FormEvent, useState } from "react";
import { useAuthStore } from "../store/auth";
import { API_BASE } from "../api/client";
import { useBrandStore } from "../store/brandStore";

const LoginPage = ({ deepLinkPending = false, deepLinkTablePending = false, onSignInCommit }: {
  /** Phase 115 (DLINK-V121-03): a dashboard link is waiting for this visitor. Computed by App
   *  from useDeepLinkDashboard — LoginPage deliberately does NOT re-derive it from the URL, so
   *  there is one source of truth and this stays testable without a router. */
  deepLinkPending?: boolean;
  /** Phase 116 (TLINK-V121-03): a TABLE link is waiting for this visitor. Computed by App from
   *  useDeepLinkTable — LoginPage deliberately does NOT re-derive it from the URL, so there is one
   *  source of truth and this stays testable without a router. */
  deepLinkTablePending?: boolean;
  /** Phase 115: fired at the moment the user commits to signing in, so App can persist the
   *  pending dashboard id before a full-page navigation destroys the query string. */
  onSignInCommit?: () => void;
} = {}) => {
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const reason = useAuthStore((s) => s.reason);
  const authMode = useAuthStore((s) => s.authMode);
  const appName = useBrandStore((s) => s.appName);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Phase 115 (DLINK-V121-03): ONE banner slot, never stacked. The session-ended message wins
  // outright when both apply — it is the more urgent and more informative fact, and the user
  // already knew which dashboard they were on (115-CONTEXT.md).
  // Non-leak check (v1.10): the deep-link line reveals only that a dashboard id was in the URL
  // the visitor pasted themselves. It says nothing about whether that id exists or who may see it.
  // Reuses the existing .login-banner class — no new class (CLAUDE.md).
  // Phase 116 (TLINK-V121-03): the non-leak check holds identically for tables — the line reveals
  // only that a table id was in the URL the visitor pasted themselves, and says nothing about
  // whether that id exists or who may see it. `deepLinkPending` is checked first so the
  // dashboard-wins precedence is consistent with App.tsx's handleSignInCommit/table-open effect.
  const bannerText =
    reason === "session-expired"
      ? "Your session has ended. Please sign in again."
      : deepLinkPending
        ? "Sign in to open this dashboard."
        : deepLinkTablePending
          ? "Sign in to open this table."
          : null;
  const banner = bannerText && (
    <div className="login-banner" role="status">{bannerText}</div>
  );

  // OIDC mode (OIDC-01): full-page navigation to /api/auth/oidc/start.
  if (authMode === "oidc") {
    return (
      <div className="login-shell">
        <div className="login-card">
          {banner}
          <div className="login-brand">{appName ?? "Kinetica BI"}</div>
          <h1 className="login-title">Sign in</h1>
          {/* Phase 115 (DLINK-V121-03): this anchor was deliberately handler-free in Phase 7
              ("Pure <a href> — no onClick"), because the only pre-redirect work then was the
              UNAUTHORIZED_EVENT write, which App.tsx already did before LoginPage rendered.
              That is no longer sufficient: a FRESH paste never fires UNAUTHORIZED_EVENT, so its
              id has no other moment to be captured. onClick (not pointerdown) is the correct
              seam — it also fires on keyboard activation. Synchronous sessionStorage write, and
              NO preventDefault, so the browser's default navigation still runs afterwards. */}
          <a
            href={`${API_BASE}/api/auth/oidc/start`}
            className="login-submit"
            onClick={() => onSignInCommit?.()}
          >
            Sign in with SSO
          </a>
        </div>
      </div>
    );
  }

  // authMode === "password" or null: existing password form (unchanged from v1.0).
  const message = localError ?? error;

  // Phase 115: password mode never leaves the page (no navigation happens on submit), so the
  // URL itself already carries the pending dashboard id through the in-place auth-status flip —
  // no onSignInCommit call here (Plan 01 Task 3 proves this end-to-end).
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        {banner}
        <div className="login-brand">{appName ?? "Kinetica BI"}</div>
        <h1 className="login-title">Sign in</h1>
        <p className="login-sub">Use your Kinetica credentials.</p>

        <label className="login-field">
          <span>Username</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
          />
        </label>

        <label className="login-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {message && <div className="login-error" role="alert">{message}</div>}

        <button type="submit" className="login-submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
};

export default LoginPage;
