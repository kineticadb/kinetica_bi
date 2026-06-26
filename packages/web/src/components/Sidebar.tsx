import clsx from "clsx";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTableColumns,
  faDatabase,
  faGear,
  faAnglesLeft,
  faAnglesRight,
  faUsers,
  faUserShield,
  faPalette,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { useAuthStore } from "../store/auth";
import { PERMISSIONS } from "../lib/permissions";
import { useBrandStore } from "../store/brandStore";
import { useThemeStore } from "../store/theme";
import DefaultLogo from "./DefaultLogo";

type NavItem = {
  label: string;
  key: string;
  icon: IconDefinition;
  permission?: string;
};

const nav: NavItem[] = [
  { label: "Dashboards", key: "dashboards", icon: faTableColumns },
  { label: "Datasets", key: "datasets", icon: faDatabase },
  { label: "User Management", key: "users", icon: faUsers, permission: PERMISSIONS.USERS_VIEW },
  { label: "Roles", key: "roles", icon: faUserShield, permission: PERMISSIONS.ROLES_VIEW },
  { label: "Branding", key: "branding", icon: faPalette, permission: PERMISSIONS.BRANDING_MANAGE },
  { label: "Settings", key: "settings", icon: faGear },
];

type Props = {
  activeKey: string;
  onSelect: (key: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

const Sidebar = ({ activeKey, onSelect, collapsed, onToggleCollapse }: Props) => {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const logoUrl = useBrandStore((s) => s.logoUrl);
  const logoDarkUrl = useBrandStore((s) => s.logoDarkUrl);
  const appName = useBrandStore((s) => s.appName);
  const theme = useThemeStore((s) => s.theme);
  // BRANDUI-06: show dark-mode logo override when in dark mode and one is configured;
  // else fall back to primary logo; else fall back to inline DefaultLogo.
  const effectiveLogoUrl = (theme === "dark" && logoDarkUrl) ? logoDarkUrl : logoUrl;
  const visibleNav = nav.filter((item) => !item.permission || hasPermission(item.permission));

  return (
    <aside className={clsx("sidebar", collapsed && "collapsed")}>
      <div className="sidebar-header">
        {!collapsed && (
          <div className="logo">
            {effectiveLogoUrl ? (
              <img src={effectiveLogoUrl} alt={appName ?? "Kinetica BI"} className="logo-img brand-logo" />
            ) : (
              <DefaultLogo className="logo-img brand-logo" title={appName ?? "Kinetica BI"} />
            )}
          </div>
        )}
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggleCollapse}
        >
          <FontAwesomeIcon icon={collapsed ? faAnglesRight : faAnglesLeft} />
        </button>
      </div>
      <nav>
        {visibleNav.map((item) => (
          <button
            key={item.key}
            className={clsx("nav-item", item.key === activeKey && "active")}
            type="button"
            onClick={() => onSelect(item.key)}
            aria-label={item.label}
            title={collapsed ? item.label : undefined}
          >
            <span aria-hidden className="nav-icon">
              <FontAwesomeIcon icon={item.icon} />
            </span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        {!collapsed && (
          <div>
            <div className="sidebar-label">GPU-DB</div>
            <div className="sidebar-sub">Connected</div>
          </div>
        )}
        <div
          className="status-dot"
          title={collapsed ? "GPU-DB connected" : undefined}
        />
      </div>
    </aside>
  );
};

export default Sidebar;
