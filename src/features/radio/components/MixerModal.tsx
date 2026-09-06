import { Mic2, Pause, Play, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Room } from "../../../../lib/radio/model";
import { Modal } from "../../../shared/components/Modal";
import { Toggle } from "./Toggle";

export function MixerModal({
  open,
  onClose,
  room,
  isHost,
  busy,
  act,
  localAction,
}: {
  open: boolean;
  onClose: () => void;
  room: Room;
  isHost: boolean;
  busy: boolean;
  act: (type: string, extra?: Record<string, unknown>) => void;
  localAction: (action: "play" | "pause") => void;
}) {
  const [volume, setVolume] = useState(room.volume);
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(room.crossfadeSeconds);

  useEffect(() => setVolume(room.volume), [room.volume]);
  useEffect(() => setCrossfadeSeconds(room.crossfadeSeconds), [room.crossfadeSeconds]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isHost ? "Sound controls" : "Playback on this device"}
      subtitle={isHost ? "These settings apply to everyone tuned in." : undefined}
    >
      {isHost && (
        <>
          <div className="mixer-control">
            <label htmlFor="station-volume">
              <span>Station volume</span>
              <strong>{Math.round(volume * 100)}%</strong>
            </label>
            <input
              id="station-volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              disabled={busy}
              onChange={(event) => setVolume(Number(event.target.value))}
              onPointerUp={() => act("volume", { value: volume })}
              onKeyUp={() => act("volume", { value: volume })}
            />
          </div>

          <div className="mixer-control">
            <label htmlFor="crossfade-duration">
              <span>Crossfade into the next song</span>
              <strong>{crossfadeSeconds}s</strong>
            </label>
            <input
              id="crossfade-duration"
              type="range"
              min="0"
              max="12"
              step="1"
              value={crossfadeSeconds}
              disabled={busy}
              onChange={(event) => setCrossfadeSeconds(Number(event.target.value))}
              onPointerUp={() => act("crossfade", { seconds: crossfadeSeconds })}
              onKeyUp={() => act("crossfade", { seconds: crossfadeSeconds })}
            />
          </div>

          <button
            className={`btn btn--secondary btn--block ${room.ducked ? "is-ducked" : ""}`}
            type="button"
            disabled={busy}
            onClick={() => act("duck", { value: !room.ducked })}
          >
            {room.ducked ? <Volume2 size={16} /> : <Mic2 size={16} />}
            {room.ducked ? "Raise music" : "Duck for voice"}
          </button>
          <p className="mixer-note">
            Ducking lowers the music in every tuned-in browser. Microphone audio is not
            broadcast yet.
          </p>

          <div className="modal-divider" />

          <label className="switch-label block">
            <span>
              <strong>Song requests</strong>
              <small>Let listeners send you tracks from your library.</small>
            </span>
            <Toggle
              checked={room.requestsOpen}
              onChange={(value) => act("requestsOpen", { value })}
              label="Open song requests"
              disabled={busy}
            />
          </label>

          <div className="modal-divider" />
        </>
      )}

      <div className="mixer-control">
        <label>
          <span>This device only</span>
        </label>
        <p className="mixer-note">
          Stop or resume audio here without changing what anyone else hears.
        </p>
        <div className="local-controls">
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => localAction("play")}>
            <Play size={17} /> Play here
          </button>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => localAction("pause")}>
            <Pause size={17} /> Pause here
          </button>
        </div>
      </div>
    </Modal>
  );
}
