import { useToastStore } from "../store/toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

const Toast = () => {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map((t) => {
        const action = t.action;
        return (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span className="toast-message">{t.message}</span>
            {action && (
              <button
                type="button"
                className="ghost-sm"
                onClick={() => {
                  action.onClick();
                  dismiss(t.id);
                }}
              >
                {action.label}
              </button>
            )}
            <button
              className="toast-dismiss"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default Toast;
