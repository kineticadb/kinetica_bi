import { useState, useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSun, faMoon, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { useAuthStore } from "../store/auth";
import { useThemeStore } from "../store/theme";
import "./Topbar.css";

type TopbarProps = {
  onNavigateProfile: () => void;
};

const Topbar = ({ onNavigateProfile }: TopbarProps) => {
  const user = useAuthStore((s) => s.user);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const initials = user ? user.username.slice(0, 2).toUpperCase() : "?";

  // Click-outside dismiss — mirrors UsersPage mousedown pattern
  useEffect(() => {
    if (!menuOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [menuOpen]);

  const handleProfile = () => {
    onNavigateProfile();
    setMenuOpen(false);
  };

  const handleLogout = () => {
    useAuthStore.getState().logout();
    setMenuOpen(false);
  };

  return (
    <header className="topbar">
      <div />
      <div className="top-actions">
        {user && (
          <div className="user-menu-container" ref={menuRef}>
            <button
              type="button"
              className="user-menu-trigger"
              aria-label="Open user menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="avatar user-menu-avatar">{initials}</span>
              <span className="username">{user.username}</span>
              <FontAwesomeIcon icon={faChevronDown} className="user-menu-caret" />
            </button>

            {menuOpen && (
              <div className="user-menu">
                <button
                  type="button"
                  className="user-menu-item"
                  onClick={handleProfile}
                >
                  Profile
                </button>
                <button
                  type="button"
                  className="user-menu-item"
                  onClick={handleLogout}
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          <FontAwesomeIcon icon={theme === "dark" ? faSun : faMoon} />
        </button>
      </div>
    </header>
  );
};

export default Topbar;
