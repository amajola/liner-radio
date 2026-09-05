import { AlertCircle, Check, Headphones, LoaderCircle, RotateCw, SlidersHorizontal } from "lucide-react";
import type { PlayerStatus } from "../../music/use-synchronized-player";

const copy: Record<PlayerStatus, { title: string; detail: string }> = {
  idle: {
    title: "Audio is off on this device",
    detail: "Connect once and this player will follow the host.",
  },
  connecting: {
    title: "Connecting audio…",
    detail: "Loading the track and finding the live position.",
  },
  live: {
    title: "You’re tuned in",
    detail: "Audio is live and synchronized with the host.",
  },
  blocked: {
    title: "One tap to hear the room",
    detail: "Your browser needs permission to start audio.",
  },
  error: {
    title: "Audio didn’t connect",
    detail: "Check your connection, then try again.",
  },
};

export function AudioConnection({
  status,
  error,
  hasTrack,
  onConnect,
  onOpenMixer,
}: {
  status: PlayerStatus;
  error: string | null;
  hasTrack: boolean;
  onConnect: () => Promise<void>;
  onOpenMixer: () => void;
}) {
  const state = hasTrack ? status : "idle";
  const waiting = !hasTrack;
  const connecting = state === "connecting";
  const connected = state === "live";
  const failed = state === "error";

  return (
    <div className={`audio-connection is-${waiting ? "waiting" : state}`} aria-live="polite">
      <span className="audio-connection-mark" aria-hidden="true">
        {connecting ? (
          <LoaderCircle className="spin" size={18} />
        ) : connected ? (
          <Check size={18} />
        ) : failed ? (
          <AlertCircle size={18} />
        ) : (
          <Headphones size={18} />
        )}
      </span>
      <span className="audio-connection-copy">
        <strong>{waiting ? "Waiting for the first song" : copy[state].title}</strong>
        <small>{waiting ? "The host hasn’t started the programme yet." : error || copy[state].detail}</small>
      </span>
      <span className="audio-connection-actions">
        {!waiting && !connected && (
          <button
            className="connection-action"
            type="button"
            disabled={connecting}
            onClick={() => void onConnect()}
          >
            {connecting ? (
              <><LoaderCircle className="spin" size={15} /> Connecting</>
            ) : failed ? (
              <><RotateCw size={15} /> Try again</>
            ) : (
              <><Headphones size={15} /> Connect</>
            )}
          </button>
        )}
        {connected && <span className="connection-badge"><Check size={14} /> Connected</span>}
        <button
          className="connection-mixer"
          type="button"
          onClick={onOpenMixer}
          aria-label="Sound controls"
          title="Sound controls"
        >
          <SlidersHorizontal size={17} />
        </button>
      </span>
    </div>
  );
}
