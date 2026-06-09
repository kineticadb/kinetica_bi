/**
 * Phase 56 Plan 01 (GRANTUI-V110-01/02): DashboardAccessModal
 *
 * Manages per-dashboard user and role grants:
 *  - Lists current user grants and role grants in separate sections.
 *  - Adds user grants via free-text input (pre-provisioning supported).
 *  - Adds role grants via a dropdown populated from listRoles().
 *  - Removes grants via × controls.
 *
 * All mutations use the Phase 56 grant CRUD client fns (listDashboardGrants /
 * addDashboardGrant / removeDashboardGrant) and refresh from the returned list.
 *
 * Chrome mirrors VisualizationPickerModal / TablePickerModal in DashboardsPage.tsx:
 * modal-overlay → modal-content (stopPropagation) → modal-header + modal-body.
 * Theme tokens + green accent only; no hardcoded colors.
 */

import React, { useState, useEffect } from "react";
import {
  listDashboardGrants,
  addDashboardGrant,
  removeDashboardGrant,
  listRoles,
  listUsers,
} from "../api/client";
import type { DashboardGrantDto, RoleDto, UserRow } from "../api/client";

// ─── Props ────────────────────────────────────────────────────────────────────

interface DashboardAccessModalProps {
  dashboardId: number;
  dashboardName: string;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

const DashboardAccessModal: React.FC<DashboardAccessModalProps> = ({
  dashboardId,
  dashboardName,
  onClose,
}) => {
  // ── grant list state ──────────────────────────────────────────────────────
  const [grants, setGrants] = useState<DashboardGrantDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── add-row state ─────────────────────────────────────────────────────────
  const [granteeType, setGranteeType] = useState<"user" | "role">("user");
  const [userInput, setUserInput] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // ── on mount: load grants + roles + users ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    listDashboardGrants(dashboardId)
      .then((g) => { if (!cancelled) { setGrants(g); setLoading(false); } })
      .catch((err: Error) => { if (!cancelled) { setError(err.message); setLoading(false); } });

    listRoles()
      .then((r) => { if (!cancelled) setRoles(r); })
      .catch(() => { /* non-critical */ });

    listUsers()
      .then((u) => { if (!cancelled) setUsers(u); })
      .catch(() => { /* non-critical — free text still works */ });

    return () => { cancelled = true; };
  }, [dashboardId]);

  // ── split grants into sections ────────────────────────────────────────────
  const userGrants = grants.filter((g) => g.grantee_type === "user");
  const roleGrants = grants.filter((g) => g.grantee_type === "role");

  // ── add handler ───────────────────────────────────────────────────────────
  const handleAdd = async () => {
    const grantee =
      granteeType === "user" ? userInput.trim() : selectedRole;
    if (!grantee) return;

    setAdding(true);
    setAddError(null);
    try {
      const updated = await addDashboardGrant(dashboardId, {
        grantee_type: granteeType,
        grantee,
      });
      setGrants(updated);
      if (granteeType === "user") setUserInput("");
      else setSelectedRole("");
    } catch (err) {
      setAddError((err as Error).message || "Failed to add grant");
    } finally {
      setAdding(false);
    }
  };

  // ── remove handler ────────────────────────────────────────────────────────
  const handleRemove = async (granteeTypeArg: "user" | "role", grantee: string) => {
    setAddError(null);
    try {
      const updated = await removeDashboardGrant(dashboardId, {
        grantee_type: granteeTypeArg,
        grantee,
      });
      setGrants(updated);
    } catch (err) {
      setAddError((err as Error).message || "Failed to remove grant");
    }
  };

  // ── render ────────────────────────────────────────────────────────────────
  const addDisabled =
    adding ||
    (granteeType === "user" ? !userInput.trim() : !selectedRole);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="modal-header">
          <span className="modal-title">Share: {dashboardName}</span>
          <button className="ghost-sm" onClick={onClose}>
            Close
          </button>
        </div>

        {/* body */}
        <div className="modal-body">
          {/* informational bypass line */}
          <div className="muted" style={{ marginBottom: "12px" }}>
            Admins and designers always have access to every dashboard.
          </div>

          {/* loading / error */}
          {loading && <div className="muted">Loading…</div>}
          {error && <div className="error">{error}</div>}

          {!loading && (
            <>
              {/* ── People section ── */}
              <h3 className="modal-section-title">People</h3>
              {userGrants.length === 0 ? (
                <div className="muted" style={{ marginBottom: "8px" }}>
                  No users have direct access.
                </div>
              ) : (
                <div className="datasets-table" style={{ marginBottom: "8px" }}>
                  {userGrants.map((g) => (
                    <div
                      key={`user-${g.grantee}`}
                      className="ds-row"
                      style={{ gridTemplateColumns: "1fr auto" }}
                    >
                      <span>{g.grantee}</span>
                      <button
                        className="ghost-sm ghost-danger"
                        aria-label={`Remove user ${g.grantee}`}
                        onClick={() => handleRemove("user", g.grantee)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Roles section ── */}
              <h3 className="modal-section-title modal-section-title-spaced">Roles</h3>
              {roleGrants.length === 0 ? (
                <div className="muted" style={{ marginBottom: "8px" }}>
                  No roles have access.
                </div>
              ) : (
                <div className="datasets-table" style={{ marginBottom: "8px" }}>
                  {roleGrants.map((g) => (
                    <div
                      key={`role-${g.grantee}`}
                      className="ds-row"
                      style={{ gridTemplateColumns: "1fr auto" }}
                    >
                      <span>{g.grantee}</span>
                      <button
                        className="ghost-sm ghost-danger"
                        aria-label={`Remove role ${g.grantee}`}
                        onClick={() => handleRemove("role", g.grantee)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Add-row ── */}
              <h3 className="modal-section-title modal-section-title-spaced">Add access</h3>

              {/* type toggle */}
              <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
                <button
                  className={granteeType === "user" ? "btn-primary btn-sm" : "ghost-sm"}
                  onClick={() => setGranteeType("user")}
                  type="button"
                >
                  User
                </button>
                <button
                  className={granteeType === "role" ? "btn-primary btn-sm" : "ghost-sm"}
                  onClick={() => setGranteeType("role")}
                  type="button"
                >
                  Role
                </button>
              </div>

              {/* input */}
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {granteeType === "user" ? (
                  <>
                    <input
                      type="text"
                      value={userInput}
                      onChange={(e) => setUserInput(e.target.value)}
                      placeholder="Username"
                      list="access-modal-users"
                      style={{ flex: 1, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "4px", background: "var(--input-bg, var(--panel))", color: "var(--text)" }}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                    />
                    {/* datalist for autocomplete suggestions — free text still allowed */}
                    <datalist id="access-modal-users">
                      {users.map((u) => (
                        <option key={u.username} value={u.username} />
                      ))}
                    </datalist>
                  </>
                ) : (
                  <select
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value)}
                    style={{ flex: 1, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "4px", background: "var(--input-bg, var(--panel))", color: "var(--text)" }}
                  >
                    <option value="">Select a role…</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  className="btn-primary btn-sm"
                  onClick={handleAdd}
                  disabled={addDisabled}
                  type="button"
                >
                  {adding ? "Adding…" : "Add"}
                </button>
              </div>

              {/* add/remove error */}
              {addError && (
                <div className="error" style={{ marginTop: "8px" }}>
                  {addError}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardAccessModal;
