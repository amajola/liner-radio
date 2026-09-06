import { UserRound, Users } from "lucide-react";
import type { Room } from "../../../../lib/radio/model";
import { Modal } from "../../../shared/components/Modal";
import { Toggle } from "./Toggle";

type Shared = {
  room: Room;
  isHost: boolean;
  busy: boolean;
  act: (type: string, extra?: Record<string, unknown>) => void;
};

const QUICK_LIMIT = 4;

export function PeopleQuickView({ room, onOpen }: { room: Room; onOpen: () => void }) {
  const shown = room.members.slice(0, QUICK_LIMIT);
  const overflow = room.members.length - shown.length;

  return (
    <section className="quick-panel">
      <div className="quick-heading">
        <h2>
          <Users size={15} /> People
        </h2>
        <span>{room.members.length}</span>
      </div>
      <div className="people-strip">
        {shown.map((person) => (
          <span
            className={`person-chip ${person.role === "host" ? "is-host" : ""}`}
            key={person.id}
            title={person.role === "host" ? `${person.name} · Host` : person.name}
          >
            {person.image ? <img className="person-avatar" src={person.image} alt="" /> : <UserRound size={14} />}
            {person.name}
          </span>
        ))}
        {overflow > 0 && <span className="person-chip is-more">+{overflow}</span>}
      </div>
      <div className="quick-actions">
        <button className="ghost-button" type="button" onClick={onOpen}>
          See everyone
        </button>
      </div>
    </section>
  );
}

export function PeopleModal({
  open,
  onClose,
  room,
  isHost,
  busy,
  act,
}: Shared & { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="tall"
      title="People"
      subtitle={
        isHost
          ? "Choose who may send you song requests."
          : `${room.members.length} in the room`
      }
    >
      <div className="member-list">
        {room.members.map((person) => (
          <div className="member-row" key={person.id}>
            {person.image ? <img className="person-avatar" src={person.image} alt="" /> : <UserRound size={17} />}
            <span>
              <strong>{person.name}</strong>
              <small>{person.role === "host" ? "Host" : "Listener"}</small>
            </span>
            {isHost && person.role === "listener" && (
              <Toggle
                checked={person.canRequest}
                onChange={(value) => act("permission", { member: person.id, value })}
                label={`Allow requests from ${person.name}`}
                disabled={busy}
              />
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
