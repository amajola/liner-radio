import { LoaderCircle, RefreshCw } from "lucide-react";

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="query-state" role="status">
      <LoaderCircle className="spin" size={20} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div className="query-state query-error" role="alert">
      <span>{message}</span>
      <button type="button" onClick={retry}>
        <RefreshCw size={15} /> Retry
      </button>
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="empty-state">{children}</p>;
}

export function QueryFreshness({
  isFetching,
  isStale,
  hasError,
}: {
  isFetching: boolean;
  isStale: boolean;
  hasError?: boolean;
}) {
  if (isFetching) return <span className="query-freshness">Syncing…</span>;
  if (hasError) return <span className="query-freshness is-stale">Offline data</span>;
  // if (isStale) return <span className="query-freshness is-stale">May be stale</span>;
  return null;
}
