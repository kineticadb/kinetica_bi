/**
 * ProfilePage.tsx — Phase 50.1
 * Read-only profile: username + auth mode + role chips + grouped effective permissions.
 * Reached only via the Topbar user menu — NOT in the Sidebar nav.
 */

import { useAuthStore } from "../store/auth";
import { groupPermissionList } from "../lib/permissionGroups";
import "./ProfilePage.css";

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const authMode = useAuthStore((s) => s.authMode);

  if (!user) return null;

  const authModeLabel =
    authMode === "oidc"
      ? "SSO"
      : authMode === "password"
        ? "password sign-in"
        : "";

  const permGroups = groupPermissionList(user.permissions);

  return (
    <div className="profile-page">
      <h1 className="profile-heading">PROFILE</h1>

      {/* ── Identity ─────────────────────────────────────────── */}
      <section className="profile-section">
        <div className="profile-username">{user.username}</div>
        {authModeLabel && (
          <div className="profile-auth-mode">{authModeLabel}</div>
        )}
      </section>

      {/* ── Roles ────────────────────────────────────────────── */}
      <section className="profile-section">
        <h2 className="profile-section-title">Roles</h2>
        <div className="profile-role-chips">
          {user.roles.length > 0 ? (
            user.roles.map((r) => (
              <span key={r} className="profile-role-chip">
                {r.replace(/_/g, " ")}
              </span>
            ))
          ) : (
            <span className="profile-role-chip profile-role-chip--default">
              analyst (default)
            </span>
          )}
        </div>
      </section>

      {/* ── Effective permissions ─────────────────────────────── */}
      <section className="profile-section">
        <h2 className="profile-section-title">Effective permissions</h2>
        {permGroups.length === 0 ? (
          <div className="profile-perm-empty">No permissions assigned.</div>
        ) : (
          <div className="profile-perm-groups">
            {permGroups.map(({ group, perms }) => (
              <div key={group} className="profile-perm-group">
                <span className="profile-perm-group-label">{group}:</span>{" "}
                <span className="profile-perm-group-values">
                  {perms.map((p) => p.split(":")[1] ?? p).join(", ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
