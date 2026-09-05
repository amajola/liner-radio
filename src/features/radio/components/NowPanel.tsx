import { motion } from "motion/react";
import { Pause, Play, Radio, SkipForward } from "lucide-react";
import { useEffect, useState } from "react";
import type { Room } from "../../../../lib/radio/model";
import { formatDuration } from "../../music/audio-duration";
import type { PlayerStatus } from "../../music/use-synchronized-player";
import { AudioConnection } from "./AudioConnection";

type Props = {
  room: Room;
  serverNow: () => number;
  connectionStatus: PlayerStatus;
  connectionError: string | null;
  busy: boolean;
  isHost: boolean;
  tuneIn: () => Promise<void>;
  openMixer: () => void;
  act: (type: string, extra?: Record<string, unknown>) => void;
};

export function NowPanel(props: Props) {
  const { room } = props;
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => setTick((value) => value + 1), 500);
    return () => window.clearInterval(interval);
  }, []);

  const duration = room.current?.duration ?? 0;
  const position = room.current
    ? Math.min(
        duration,
        Math.max(
          0,
          room.offset +
            (room.playing && room.startedAt ? (props.serverNow() - room.startedAt) / 1_000 : 0),
        ),
      )
    : 0;
  const progress = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <section className="room-column now-column">
      <div className="column-heading">
        <span className={`live-dot ${room.playing ? "is-live" : ""}`} />
        <strong>{room.playing ? "ON AIR" : "OFF AIR"}</strong>
        <span>{room.members.length} listening</span>
      </div>

      <div className="now-content">
        <div className="cover-space">
          <div className="cover-art">
            {room.current?.art ? (
              <motion.img
                key={room.current.key}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                src={room.current.art}
                alt={`${room.current.title} artwork`}
              />
            ) : (
              <Radio size={72} strokeWidth={1} />
            )}
          </div>
        </div>

        <div className="current-track">
          <h1 title={room.current?.title}>{room.current?.title || "Nothing playing yet"}</h1>
          <p title={room.current?.artist}>{room.current?.artist || "Queue a song to start the programme."}</p>
        </div>

        <div className="track-progress">
          <div className="progress-rail">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="progress-times">
            <span>{formatDuration(position)}</span>
            <span>{duration ? formatDuration(duration) : "--:--"}</span>
          </div>
        </div>

        {props.isHost && (
          <div className="transport">
            <button
              className="transport-primary"
              type="button"
              disabled={props.busy || !room.current}
              onClick={() => props.act(room.playing ? "pause" : "resume")}
            >
              {room.playing ? <Pause size={20} /> : <Play size={20} />}
              {room.playing ? "Pause" : "Play"}
            </button>
            <button
              className="transport-secondary"
              type="button"
              disabled={props.busy || !room.queue.length}
              onClick={() => props.act("next")}
              aria-label="Skip to the next song"
            >
              <SkipForward size={19} /> Next
            </button>
          </div>
        )}

        <AudioConnection
          status={props.connectionStatus}
          error={props.connectionError}
          hasTrack={Boolean(room.current)}
          onConnect={props.tuneIn}
          onOpenMixer={props.openMixer}
        />
      </div>
    </section>
  );
}
