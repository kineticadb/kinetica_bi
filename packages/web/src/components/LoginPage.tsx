import { FormEvent, useState } from "react";
import { useAuthStore } from "../store/auth";
import { API_BASE } from "../api/client";
import { useBrandStore } from "../store/brandStore";

const LoginPage = () => {
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const reason = useAuthStore((s) => s.reason);
  const authMode = useAuthStore((s) => s.authMode);
  const appName = useBrandStore((s) => s.appName);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // OIDC mode (OIDC-01): full-page navigation to /api/auth/oidc/start.
  // Pure <a href> — no onClick. Pre-redirect work (sessionStorage write) happens at
  // UNAUTHORIZED_EVENT time in App.tsx, BEFORE LoginPage renders.
  if (authMode === "oidc") {
    return (
      <div className="login-shell">
        <div className="login-card">
          {reason === "session-expired" && (
            <div className="login-banner" role="status">
              Your session has ended. Please sign in again.
            </div>
          )}
          <div className="login-brand">{appName ?? "Kinetica BI"}</div>
          <h1 className="login-title">Sign in</h1>
          <a href={`${API_BASE}/api/auth/oidc/start`} className="login-submit">
            Sign in with SSO
          </a>
        </div>
      </div>
    );
  }

  // authMode === "password" or null: existing password form (unchanged from v1.0).
  const message = localError ?? error;

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
        {reason === "session-expired" && (
          <div className="login-banner" role="status">
            Your session has ended. Please sign in again.
          </div>
        )}
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
