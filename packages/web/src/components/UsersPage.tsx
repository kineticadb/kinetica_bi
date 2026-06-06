/**
 * UsersPage.tsx — Phase 49, Plan 02
 * Users table: username | role chips | last-seen | actions.
 * - Role chips with × to revoke (gated on users:assign_roles).
 * - Edit-roles checkbox popover per row.
 * - Bulk row-select + "Assign role to N selected" bar.
 * - Humanized last-seen column.
 * - Bootstrap row is always locked (no ×, no Edit roles, immutable admin chip).
 * - NOT wired into App.tsx here — that is Plan 49-03.
 */

import { useState, useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock, faXmark } from "@fortawesome/free-solid-svg-icons";
import clsx from "clsx";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import { PERMISSIONS } from "../lib/permissions";
import {
  listUsers,
  listRoles,
  assignRole,
  revokeRole,
} from "../api/client";
import type { UserRow, RoleDto } from "../api/client";
import { humanizeRelativeTime } from "../lib/relativeTime";

export function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Popover: keyed by username; null = closed
  const [openPopoverUser, setOpenPopoverUser] = useState<string | null>(null);
  // Per-popover inline error: { [username_roleName]: errorMsg }
  const [popoverErrors, setPopoverErrors] = useState<Record<string, string>>({});

  // Bulk select
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRoleName, setBulkRoleName] = useState<string>("");

  const popoverRef = useRef<HTMLDivElement>(null);

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canAssign = hasPermission(PERMISSIONS.USERS_ASSIGN_ROLES);

  // Fetch users and roles on mount
  const fetchData = async (signal?: AbortSignal) => {
    try {
      const [fetchedUsers, fetchedRoles] = await Promise.all([
        listUsers(signal),
        listRoles(signal),
      ]);
      setUsers(fetchedUsers);
      setRoles(fetchedRoles);
      if (fetchedRoles.length > 0 && !bulkRoleName) {
        setBulkRoleName(fetchedRoles[0].name);
      }
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void fetchData(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refetch = () => {
    setLoading(true);
    void fetchData();
  };

  // Click-outside popover: mirrors DataFilterRenderer.tsx pattern
  useEffect(() => {
    if (!openPopoverUser) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenPopoverUser(null);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [openPopoverUser]);

  const handleRevoke = async (username: string, roleName: string) => {
    const result = await revokeRole(username, roleName);
    if (!result.ok) {
      useToastStore.getState().showToast(result.error!, "error");
    } else {
      refetch();
    }
  };

  const handleAssign = async (username: string, roleName: string) => {
    const result = await assignRole(username, roleName);
    if (!result.ok) {
      useToastStore.getState().showToast(result.error!, "error");
    } else {
      refetch();
    }
  };

  const handlePopoverToggle = async (user: UserRow, roleName: string, currentlyAssigned: boolean) => {
    const key = `${user.username}_${roleName}`;
    if (currentlyAssigned) {
      const result = await revokeRole(user.username, roleName);
      if (!result.ok) {
        // Surface verbatim error inline in popover AND keep checkbox checked
        setPopoverErrors((prev) => ({ ...prev, [key]: result.error! }));
        // Also toast
        useToastStore.getState().showToast(result.error!, "error");
      } else {
        setPopoverErrors((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        refetch();
      }
    } else {
      const result = await assignRole(user.username, roleName);
      if (!result.ok) {
        setPopoverErrors((prev) => ({ ...prev, [key]: result.error! }));
        useToastStore.getState().showToast(result.error!, "error");
      } else {
        setPopoverErrors((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        refetch();
      }
    }
  };

  const handleBulkAssign = async () => {
    if (!bulkRoleName || selected.size === 0) return;
    const usernames = Array.from(selected);
    const results = await Promise.allSettled(
      usernames.map((username) => assignRole(username, bulkRoleName)),
    );

    let successCount = 0;
    const failures: string[] = [];

    results.forEach((result, i) => {
      if (result.status === "fulfilled" && result.value.ok) {
        successCount++;
      } else {
        const errMsg =
          result.status === "fulfilled"
            ? result.value.error || "Unknown error"
            : result.reason instanceof Error
              ? result.reason.message
              : "Unknown error";
        failures.push(`${usernames[i]} — ${errMsg}`);
      }
    });

    const failurePart = failures.length > 0 ? `, ${failures.length} failed: ${failures.join("; ")}` : "";
    useToastStore
      .getState()
      .showToast(`${successCount} assigned${failurePart}`, failures.length > 0 ? "error" : "info");

    setSelected(new Set());
    refetch();
  };

  const toggleRowSelect = (username: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(username)) {
        next.delete(username);
      } else {
        next.add(username);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="users-page">
        <p className="users-loading">Loading users&hellip;</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="users-page">
        <p className="users-error error">{error}</p>
      </div>
    );
  }

  return (
    <div className="users-page">
      <div className="users-page-header">
        <h2 className="users-page-title">User Management</h2>
      </div>

      {/* Bulk bar — render only when canAssign and rows are selected */}
      {canAssign && selected.size > 0 && (
        <div className="users-bulk-bar">
          <span className="users-bulk-label">{selected.size} selected</span>
          <label className="users-bulk-role-label" htmlFor="bulk-role-select">
            Assign role:
          </label>
          <select
            id="bulk-role-select"
            className="users-bulk-role-select"
            value={bulkRoleName}
            onChange={(e) => setBulkRoleName(e.target.value)}
          >
            {roles.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
          <button className="btn-primary users-bulk-assign" onClick={() => void handleBulkAssign()}>
            Assign role to {selected.size} selected
          </button>
          <button
            className="ghost-sm"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      <div className="users-table-wrap">
        <table className="users-table">
          <thead>
            <tr>
              {canAssign && <th className="users-th users-th-check" />}
              <th className="users-th">Username</th>
              <th className="users-th">Roles</th>
              <th className="users-th">Last Seen</th>
              {canAssign && <th className="users-th users-th-actions">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isPopoverOpen = openPopoverUser === user.username;
              return (
                <tr key={user.username} className="users-tr">
                  {/* Checkbox — only for non-bootstrap rows when canAssign */}
                  {canAssign && (
                    <td className="users-td users-td-check">
                      {!user.is_bootstrap && (
                        <input
                          type="checkbox"
                          checked={selected.has(user.username)}
                          onChange={() => toggleRowSelect(user.username)}
                          aria-label={`Select ${user.username}`}
                        />
                      )}
                    </td>
                  )}

                  {/* Username */}
                  <td className="users-td users-td-username">
                    {user.is_bootstrap && (
                      <FontAwesomeIcon
                        icon={faLock}
                        className="users-lock-icon"
                        title="Bootstrap admin — always app admin"
                      />
                    )}
                    <span>{user.username}</span>
                  </td>

                  {/* Roles chips */}
                  <td className="users-td users-td-roles">
                    {user.is_bootstrap ? (
                      // Bootstrap: immutable admin chip, no ×
                      <span
                        className="role-chip"
                        title={`Bootstrap admin (${user.username}) — always app admin.`}
                      >
                        admin
                      </span>
                    ) : user.roles.length === 0 ? (
                      // Unassigned: muted default chip, no ×
                      <span
                        className="role-chip role-chip--default"
                        title="No roles assigned — analyst by default."
                      >
                        analyst (default)
                      </span>
                    ) : (
                      // Explicit roles: each as chip with × when canAssign
                      user.roles.map((roleName) => (
                        <span key={roleName} className="role-chip">
                          {roleName}
                          {canAssign && (
                            <button
                              className="role-chip__remove"
                              aria-label={`Revoke ${roleName} from ${user.username}`}
                              onClick={() => void handleRevoke(user.username, roleName)}
                              title={`Revoke ${roleName}`}
                            >
                              <FontAwesomeIcon icon={faXmark} />
                            </button>
                          )}
                        </span>
                      ))
                    )}
                  </td>

                  {/* Last seen */}
                  <td className="users-td users-td-last-seen">
                    {humanizeRelativeTime(user.last_seen)}
                  </td>

                  {/* Actions — Edit roles popover */}
                  {canAssign && (
                    <td className="users-td users-td-actions">
                      {!user.is_bootstrap && (
                        <div className="users-popover-wrap" ref={isPopoverOpen ? popoverRef : undefined}>
                          <button
                            className="ghost-sm"
                            onClick={() =>
                              setOpenPopoverUser(isPopoverOpen ? null : user.username)
                            }
                          >
                            Edit roles
                          </button>
                          {isPopoverOpen && (
                            <div className="users-popover">
                              <div className="users-popover-title">Edit roles for {user.username}</div>
                              {roles.map((role) => {
                                const assigned = user.roles.includes(role.name);
                                const errKey = `${user.username}_${role.name}`;
                                const inlineError = popoverErrors[errKey];
                                return (
                                  <label key={role.name} className="users-popover-row">
                                    <input
                                      type="checkbox"
                                      checked={assigned}
                                      onChange={() =>
                                        void handlePopoverToggle(user, role.name, assigned)
                                      }
                                    />
                                    <span className="users-popover-role-name">{role.name}</span>
                                    {inlineError && (
                                      <span className="popover-error">{inlineError}</span>
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
