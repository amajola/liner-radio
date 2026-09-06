import { X } from "lucide-react";
import { useUiStore } from "../../../stores/ui-store";

export function Toast() {
  const toast = useUiStore((state) => state.toast);
  const clearToast = useUiStore((state) => state.clearToast);
  if (!toast) return null;

  return (
    <div
      className={`toast ${toast.kind === "error" ? "toast-error" : ""}`}
      role={toast.kind === "error" ? "alert" : "status"}
    >
      <span>{toast.message}</span>
      <button className="btn btn--bare" type="button" onClick={clearToast} aria-label="Dismiss message">
        <X size={17} />
      </button>
    </div>
  );
}
