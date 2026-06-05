import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSun, faMoon } from "@fortawesome/free-solid-svg-icons";
import { useAuthStore } from "../store/auth";
import { useThemeStore } from "../store/theme";

const Topbar = () => {
  const user = useAuthStore((s) => s.user);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  const initials = user ? user.username.slice(0, 2).toUpperCase() : "?";

  return (
    <header className="topbar">
      <div />
      <div className="top-actions">
        {user && (
          <div className="user-identity">
            <span className="username">{user.username}</span>
            <div className="role-chips">
              {user.roles.map((r) => (
                <span key={r} className="role-chip">{r.replace("_", " ")}</span>
              ))}
            </div>
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
        <div className="avatar" aria-label="User avatar">
          {initials}
        </div>
      </div>
    </header>
  );
};

export default Topbar;
