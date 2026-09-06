import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowUp, ListMusic, X } from "lucide-react";
import type { Room } from "../../../../lib/radio/model";
import { EmptyState } from "../../../shared/components/AsyncState";

export function QueuePanel({
  room,
  isHost,
  busy,
  act,
}: {
  room: Room;
  isHost: boolean;
  busy: boolean;
  act: (type: string, extra?: Record<string, unknown>) => void;
}) {
  return (
    <section className="room-column queue-column">
      <div className="column-heading">
        <ListMusic size={17} />
        <strong>UP NEXT</strong>
        <span>{room.queue.length}</span>
      </div>
      <div className="scroll-region column-scroll list-scroll">
        {!room.queue.length && (
          <EmptyState>
            {isHost
              ? "Approve a request to build the programme."
              : "The host is putting the programme together."}
          </EmptyState>
        )}
        <AnimatePresence initial={false}>
          {room.queue.map((track, index) => (
            <motion.article
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              // An optimistic row carries a client key that the server replaces,
              // so the old row briefly overlaps the real one. A short, explicit
              // exit keeps that from reading as a double add.
              transition={{ duration: 0.18 }}
              className="track-row"
              key={track.key}
            >
              <span className="track-number">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{track.title}</strong>
                <p>{track.artist}</p>
                <small>Requested by {track.requestedName}</small>
              </div>
              {isHost && (
                <div className="row-actions">
                  <button
                    className="btn btn--quiet btn--xs btn--icon"
                    type="button"
                    disabled={busy || index === 0}
                    onClick={() => act("move", { key: track.key, direction: -1 })}
                    aria-label={`Move ${track.title} up`}
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    className="btn btn--quiet btn--xs btn--icon"
                    type="button"
                    disabled={busy || index === room.queue.length - 1}
                    onClick={() => act("move", { key: track.key, direction: 1 })}
                    aria-label={`Move ${track.title} down`}
                  >
                    <ArrowDown size={16} />
                  </button>
                  <button
                    className="btn btn--quiet btn--xs btn--icon"
                    type="button"
                    disabled={busy}
                    onClick={() => act("remove", { key: track.key })}
                    aria-label={`Remove ${track.title}`}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
            </motion.article>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
