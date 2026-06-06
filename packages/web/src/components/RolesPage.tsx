/**
 * RolesPage.tsx — Phase 50, Plan 02
 * Two-pane Roles management page.
 * - Left: role list (built-ins badged, custom roles with delete control, [+ New role] at bottom)
 * - Right: permission matrix grouped into 5 categories with draft + Save
 * - Dirty guard on role switch; built-in Save confirm; SAFE-V18-02 UX mirrors
 * - NOT wired into App.tsx here — that is Plan 50-03.
 */

import { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock, faTrash, faPlus } from "@fortawesome/free-solid-svg-icons";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import { PERMISSIONS } from "../lib/permissions";
import {
  listRoles,
  updateRolePermissions,
  createRole,
  deleteRole,
} from "../api/client";
import type { RoleDto } from "../api/client";
import "./RolesPage.css";

// ─── Permission grouping constants ────────────────────────────────────────────

const NOUN_TO_GROUP: Record<string, string> = {
  dashboards: "Dashboards",
  widgets: "Design",
  layers: "Design",
  dynamic_views: "Design",
  data_filters: "Design",
  datasets: "Design",
  users: "Users",
  roles: "Roles",
  audit: "Audit",
};

const GROUP_ORDER = ["Dashboards", "Design", "Users", "Roles", "Audit"] as const;

// All 16 permission strings from the catalog (in canonical order for display)
const ALL_PERMISSIONS: string[] = Object.values(PERMISSIONS);

// Built-in role names reserved by the server
const BUILTIN_ROLE_NAMES = ["admin", "user_admin", "designer", "analyst"];

// Slug validation regex (matches server: lowercase letters, digits, underscore)
const SLUG_RE = /^[a-z0-9_]+$/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupPermissions(): Array<{ group: string; perms: string[] }> {
  const buckets = new Map<string, string[]>();
  for (const perm of ALL_PERMISSIONS) {
    const noun = perm.split(":")[0];
    const group = NOUN_TO_GROUP[noun] ?? "Other";
    if (!buckets.has(group)) buckets.set(group, []);
    buckets.get(group)!.push(perm);
  }

  const ordered: Array<{ group: string; perms: string[] }> = [];
  for (const g of GROUP_ORDER) {
    if (buckets.has(g)) {
      ordered.push({ group: g, perms: buckets.get(g)! });
    }
  }
  // Catch any "Other" perms that didn't map (never silently drop)
  if (buckets.has("Other")) {
    ordered.push({ group: "Other", perms: buckets.get("Other")! });
  }
  return ordered;
}

const PERMISSION_GROUPS = groupPermissions();

// ─── Component ────────────────────────────────────────────────────────────────

export function RolesPage() {
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draftPerms, setDraftPerms] = useState<Set<string>>(new Set());
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Inline create state
  const [showNewRoleInput, setShowNewRoleInput] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleError, setNewRoleError] = useState<string | null>(null);
  const [creatingRole, setCreatingRole] = useState(false);

  // Viewer context (SAFE-V18-02 UX mirror)
  const viewerIsAdmin = useAuthStore((s) =>
    (s.user?.roles ?? []).includes("admin"),
  );
  const heldPerms = useAuthStore((s) => s.user?.permissions ?? []);

  // ─── Fetch ──────────────────────────────────────────────────────────────────

  const fetchRoles = async (signal?: AbortSignal) => {
    try {
      const fetched = await listRoles(signal);
      setRoles(fetched);
      setError(null);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setError("Failed to load roles.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const ctrl = new AbortController();
    fetchRoles(ctrl.signal);
    return () => ctrl.abort();
  }, []);

  // ─── Role selection ─────────────────────────────────────────────────────────

  const selectedRole = roles.find((r) => r.id === selectedId) ?? null;

  const handleSelectRole = (roleId: number) => {
    if (roleId === selectedId) return;
    if (isDirty) {
      const ok = window.confirm("Discard unsaved changes?");
      if (!ok) return;
    }
    const role = roles.find((r) => r.id === roleId);
    if (!role) return;
    setSelectedId(roleId);
    setDraftPerms(new Set(role.permissions));
    setIsDirty(false);
    // Close inline create if open
    setShowNewRoleInput(false);
    setNewRoleName("");
    setNewRoleError(null);
  };

  // ─── Permission toggles ──────────────────────────────────────────────────────

  const handleTogglePerm = (perm: string) => {
    setDraftPerms((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
    setIsDirty(true);
  };

  // ─── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!selectedRole) return;
    if (selectedRole.built_in) {
      const ok = window.confirm(
        `Changes affect all users with the ${selectedRole.name} role — save?`,
      );
      if (!ok) return;
    }
    setSaving(true);
    const result = await updateRolePermissions(
      selectedRole.id,
      [...draftPerms],
    );
    setSaving(false);
    if (!result.ok) {
      useToastStore.getState().showToast(
        result.error ?? "Failed to save permissions.",
        "error",
      );
    } else {
      setIsDirty(false);
      await fetchRoles();
      // Re-sync draft from refetched role
      const refreshed = roles.find((r) => r.id === selectedId);
      if (refreshed) setDraftPerms(new Set(refreshed.permissions));
    }
  };

  // ─── Inline create ───────────────────────────────────────────────────────────

  const handleNewRoleClick = () => {
    if (isDirty) {
      const ok = window.confirm("Discard unsaved changes?");
      if (!ok) return;
    }
    setIsDirty(false);
    setSelectedId(null);
    setShowNewRoleInput(true);
    setNewRoleName("");
    setNewRoleError(null);
  };

  const validateSlug = (name: string): string | null => {
    if (!name) return "Role name is required.";
    if (!SLUG_RE.test(name))
      return "Role name must be a lowercase slug (letters, digits, underscore).";
    if (BUILTIN_ROLE_NAMES.includes(name))
      return `'${name}' is a reserved built-in role name.`;
    if (roles.some((r) => r.name.toLowerCase() === name.toLowerCase()))
      return `Role '${name}' already exists.`;
    return null;
  };

  const handleConfirmNewRole = async () => {
    const validationError = validateSlug(newRoleName);
    if (validationError) {
      setNewRoleError(validationError);
      return;
    }
    setCreatingRole(true);
    const result = await createRole(newRoleName, []);
    setCreatingRole(false);
    if (!result.ok) {
      setNewRoleError(result.error ?? "Failed to create role.");
    } else {
      setShowNewRoleInput(false);
      setNewRoleName("");
      setNewRoleError(null);
      await fetchRoles();
      // Select the newly created role
      if (result.role) {
        setSelectedId(result.role.id);
        setDraftPerms(new Set(result.role.permissions));
        setIsDirty(false);
      }
    }
  };

  const handleCancelNewRole = () => {
    setShowNewRoleInput(false);
    setNewRoleName("");
    setNewRoleError(null);
  };

  // ─── Delete ──────────────────────────────────────────────────────────────────

  const handleDelete = async (role: RoleDto) => {
    const ok = window.confirm(`Delete role ${role.name}?`);
    if (!ok) return;
    const result = await deleteRole(role.id);
    if (!result.ok) {
      useToastStore.getState().showToast(
        result.error ?? "Failed to delete role.",
        "error",
      );
    } else {
      if (selectedId === role.id) {
        setSelectedId(null);
        setDraftPerms(new Set());
        setIsDirty(false);
      }
      await fetchRoles();
    }
  };

  // ─── Derived display state ───────────────────────────────────────────────────

  const isAdminRoleSelected =
    selectedRole?.name === "admin" && !viewerIsAdmin;

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="roles-page-loading">Loading roles…</div>;
  }

  if (error) {
    return <div className="roles-page-error">{error}</div>;
  }

  return (
    <div className="roles-page">
      {/* ── Left pane: role list ── */}
      <aside className="roles-list-pane">
        <div className="roles-list-header">
          <h2 className="roles-list-title">Roles</h2>
        </div>

        <ul className="roles-list">
          {roles.map((role) => {
            const isAdminLocked = role.name === "admin" && !viewerIsAdmin;
            const isSelected = role.id === selectedId;

            return (
              <li
                key={role.id}
                className={`roles-list-item${isSelected ? " roles-list-item--selected" : ""}${isAdminLocked ? " roles-list-item--locked" : ""}`}
                onClick={() => handleSelectRole(role.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    handleSelectRole(role.id);
                }}
              >
                <span className="roles-list-name">
                  {isAdminLocked && (
                    <FontAwesomeIcon
                      icon={faLock}
                      className="roles-lock-icon"
                      title="Only admins can modify the admin role."
                    />
                  )}
                  {role.name}
                </span>

                <span className="roles-list-actions">
                  {role.built_in ? (
                    <span className="roles-badge-builtin">built-in</span>
                  ) : (
                    <button
                      className="roles-btn-delete"
                      title={
                        role.holders_count > 0
                          ? `${role.holders_count} user(s) hold this role`
                          : `Delete ${role.name}`
                      }
                      disabled={role.holders_count > 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(role);
                      }}
                      aria-label={`Delete role ${role.name}`}
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Inline create */}
        {showNewRoleInput ? (
          <div className="roles-new-role-form">
            <input
              className="roles-new-role-input"
              type="text"
              value={newRoleName}
              onChange={(e) => {
                setNewRoleName(e.target.value);
                setNewRoleError(null);
              }}
              placeholder="role_name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirmNewRole();
                if (e.key === "Escape") handleCancelNewRole();
              }}
              disabled={creatingRole}
            />
            {newRoleError && (
              <div className="roles-new-role-error">{newRoleError}</div>
            )}
            <div className="roles-new-role-buttons">
              <button
                className="roles-btn-confirm"
                onClick={handleConfirmNewRole}
                disabled={creatingRole}
              >
                {creatingRole ? "Creating…" : "Create"}
              </button>
              <button
                className="roles-btn-cancel"
                onClick={handleCancelNewRole}
                disabled={creatingRole}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="roles-btn-new-role" onClick={handleNewRoleClick}>
            <FontAwesomeIcon icon={faPlus} /> New role
          </button>
        )}
      </aside>

      {/* ── Right pane: permission matrix ── */}
      <main className="roles-detail-pane">
        {!selectedRole ? (
          <div className="roles-detail-empty">
            Select a role to view and edit its permissions.
          </div>
        ) : (
          <>
            <div className="roles-detail-header">
              <h2 className="roles-detail-title">{selectedRole.name}</h2>
              {selectedRole.description && (
                <p className="roles-detail-description">
                  {selectedRole.description}
                </p>
              )}
            </div>

            {isAdminRoleSelected ? (
              <div className="roles-admin-lock-notice">
                Only admins can modify the admin role.
              </div>
            ) : null}

            <div className="roles-permission-matrix">
              {PERMISSION_GROUPS.map(({ group, perms }) => (
                <section key={group} className="roles-perm-group">
                  <h3 className="roles-perm-group-header">{group}</h3>
                  <ul className="roles-perm-list">
                    {perms.map((perm) => {
                      const checked = draftPerms.has(perm);
                      const adminLocked = isAdminRoleSelected;
                      const unheldDisabled =
                        !viewerIsAdmin && !heldPerms.includes(perm);
                      const isDisabled = adminLocked || unheldDisabled;
                      const tooltipTitle = adminLocked
                        ? "Only admins can modify the admin role."
                        : unheldDisabled
                          ? "You can only grant permissions you hold."
                          : undefined;

                      return (
                        <li key={perm} className="roles-perm-item">
                          <label
                            className={`roles-perm-label${isDisabled ? " roles-perm-label--disabled" : ""}`}
                            title={tooltipTitle}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isDisabled}
                              onChange={() => handleTogglePerm(perm)}
                              className="roles-perm-checkbox"
                            />
                            <span className="roles-perm-name">{perm}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>

            {!isAdminRoleSelected && (
              <div className="roles-detail-footer">
                <button
                  className="roles-btn-save"
                  onClick={handleSave}
                  disabled={!isDirty || saving}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                {isDirty && (
                  <span className="roles-unsaved-indicator">
                    Unsaved changes
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
