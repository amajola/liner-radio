import { Library, ListMusic, Radio } from "lucide-react";
import { useUiStore } from "../../../stores/ui-store";

export function MobileNavigation() {
  const mobileView = useUiStore((state) => state.mobileView);
  const setMobileView = useUiStore((state) => state.setMobileView);

  return (
    <nav className="mobile-nav" aria-label="Room sections">
      {(
        [
          ["now", Radio, "Now"],
          ["queue", ListMusic, "Queue"],
          ["requests", Library, "Library"],
        ] as const
      ).map(([view, Icon, label]) => (
        <button
          type="button"
          key={view}
          className={mobileView === view ? "active" : ""}
          onClick={() => setMobileView(view)}
        >
          <Icon size={19} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
