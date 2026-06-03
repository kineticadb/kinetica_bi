import clsx from "clsx";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTableColumns,
  faDatabase,
  faGear,
  faAnglesLeft,
  faAnglesRight,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

type NavItem = {
  label: string;
  key: string;
  icon: IconDefinition;
};

const nav: NavItem[] = [
  { label: "Dashboards", key: "dashboards", icon: faTableColumns },
  { label: "Datasets", key: "datasets", icon: faDatabase },
  { label: "Settings", key: "settings", icon: faGear },
];

type Props = {
  activeKey: string;
  onSelect: (key: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

const Sidebar = ({ activeKey, onSelect, collapsed, onToggleCollapse }: Props) => {
  return (
    <aside className={clsx("sidebar", collapsed && "collapsed")}>
      <div className="sidebar-header">
        {!collapsed && <div className="logo">Kinetica BI</div>}
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
        {nav.map((item) => (
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
