// `apply` runs both on the Worker (always a secure context) and in the
// browser for optimistic updates (`use-room-mutations.ts`). `crypto.randomUUID`
// is only defined in secure contexts (HTTPS or localhost), so a plain-HTTP
// LAN/tunnel origin makes it disappear entirely. This id is just a client-side
// list key, discarded once the server's real response lands, so it doesn't
// need cryptographic randomness — fall back instead of throwing.
function randomKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export type Track = {
  id: string;
  title: string;
  artist: string;
  url: string;
  art?: string;
  duration: number;
  source: "upload";
};

export type Entry = Track & {
  key: string;
  requestedBy: string;
  requestedName: string;
};

export type Member = {
  id: string;
  name: string;
  role: "host" | "listener";
  canRequest: boolean;
};

export type Room = {
  id: string;
  name: string;
  members: Member[];
  requests: Entry[];
  queue: Entry[];
  current: Entry | null;
  startedAt: number | null;
  offset: number;
  playing: boolean;
  requestsOpen: boolean;
  volume: number;
  ducked: boolean;
  crossfadeSeconds: number;
  revision: number;
};

export function normalizeRoom(room: Room): Room {
  const playable = (track: Entry) =>
    track.source === "upload" &&
    /^[a-f0-9]{32}$/.test(track.id) &&
    track.url === `/api/tracks/${track.id}/audio`;
  const current = room.current && playable(room.current) ? room.current : null;

  return {
    ...room,
    requests: (room.requests || []).filter(playable),
    queue: (room.queue || []).filter(playable),
    current,
    startedAt: current ? room.startedAt : null,
    offset: current ? room.offset : 0,
    playing: current ? room.playing : false,
    volume:
      typeof room.volume === "number" && Number.isFinite(room.volume)
        ? Math.min(1, Math.max(0, room.volume))
        : 0.8,
    ducked: room.ducked === true,
    crossfadeSeconds:
      typeof room.crossfadeSeconds === "number" && Number.isFinite(room.crossfadeSeconds)
        ? Math.min(12, Math.max(0, room.crossfadeSeconds))
        : 4,
  };
}

/**
 * When the programme should roll to the next entry. The switch happens one
 * crossfade before the track actually ends so the fade lands on the boundary
 * instead of after a gap of silence. Null means nothing is scheduled.
 */
export function nextAdvanceAt(room: Room): number | null {
  if (!room.current || !room.playing || !room.startedAt) return null;
  const remaining = room.current.duration - room.offset - room.crossfadeSeconds;
  return room.startedAt + Math.max(0, remaining) * 1_000;
}

function uploadedTrack(value: unknown): Track {
  const track = value as Partial<Track> | null;
  if (
    !track ||
    typeof track.id !== "string" ||
    !/^[a-f0-9]{32}$/.test(track.id) ||
    typeof track.title !== "string" ||
    !track.title.trim() ||
    track.title.length > 180 ||
    typeof track.artist !== "string" ||
    !track.artist.trim() ||
    track.artist.length > 180 ||
    track.source !== "upload" ||
    track.url !== `/api/tracks/${track.id}/audio` ||
    typeof track.duration !== "number" ||
    !Number.isFinite(track.duration) ||
    track.duration <= 0 ||
    track.duration > 14_400
  ) {
    throw new Error("Choose a valid uploaded track.");
  }
  return track as Track;
}

export function apply(
  room: Room,
  actor: string,
  action: Record<string, unknown>,
  now = Date.now(),
): Room {
  const next = structuredClone(normalizeRoom(room));
  const member = next.members.find((item) => item.id === actor);
  if (!member) throw new Error("Join the room first.");

  if (action.type === "request") {
    if (!next.requestsOpen || !member.canRequest) {
      throw new Error("Song requests are closed for you.");
    }
    if (next.requests.length >= 100) throw new Error("The request inbox is full.");
    const track = uploadedTrack(action.track);
    if (next.requests.some((item) => item.id === track.id && item.requestedBy === actor)) {
      throw new Error("You already requested this song.");
    }
    next.requests.push({
      ...track,
      key: randomKey(),
      requestedBy: actor,
      requestedName: member.name,
    });
    return next;
  }

  if (member.role !== "host") throw new Error("Only the host can change the programme.");

  if (action.type === "enqueue") {
    if (next.queue.length >= 100) throw new Error("The programme is full.");
    const track = uploadedTrack(action.track);
    next.queue.push({
      ...track,
      key: randomKey(),
      requestedBy: actor,
      requestedName: member.name,
    });
  } else if (action.type === "rename") {
    const name = String(action.name ?? "").trim();
    if (!name || name.length > 70) {
      throw new Error("Choose a room name between 1 and 70 characters.");
    }
    next.name = name;
  } else if (action.type === "requestsOpen") next.requestsOpen = Boolean(action.value);
  else if (action.type === "permission") {
    const target = next.members.find((item) => item.id === action.member);
    if (!target || target.role === "host") throw new Error("Choose a listener.");
    target.canRequest = Boolean(action.value);
  } else if (action.type === "approve") {
    const entry = next.requests.find((item) => item.key === action.key);
    if (!entry) throw new Error("Request no longer available.");
    if (next.queue.length >= 100) throw new Error("The programme is full.");
    next.requests = next.requests.filter((item) => item.key !== entry.key);
    next.queue.push(entry);
  } else if (action.type === "reject") {
    next.requests = next.requests.filter((item) => item.key !== action.key);
  } else if (action.type === "remove") {
    next.queue = next.queue.filter((item) => item.key !== action.key);
  } else if (action.type === "move") {
    const from = next.queue.findIndex((item) => item.key === action.key);
    const to = from + (action.direction === -1 ? -1 : 1);
    if (from >= 0 && to >= 0 && to < next.queue.length) {
      [next.queue[from], next.queue[to]] = [next.queue[to], next.queue[from]];
    }
  } else if (action.type === "next") {
    next.current = next.queue.shift() || null;
    next.offset = 0;
    next.startedAt = next.current ? now : null;
    next.playing = Boolean(next.current);
  } else if (action.type === "pause") {
    if (next.playing && next.startedAt) next.offset += (now - next.startedAt) / 1_000;
    next.playing = false;
    next.startedAt = null;
  } else if (action.type === "resume") {
    if (!next.current) throw new Error("Choose the next song first.");
    next.playing = true;
    next.startedAt = now;
  } else if (action.type === "volume") {
    const value = Number(action.value);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error("Choose a volume between 0 and 100%.");
    }
    next.volume = value;
  } else if (action.type === "duck") {
    next.ducked = Boolean(action.value);
  } else if (action.type === "crossfade") {
    const seconds = Number(action.seconds);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 12) {
      throw new Error("Choose a crossfade between 0 and 12 seconds.");
    }
    next.crossfadeSeconds = seconds;
  } else throw new Error("Unknown room action.");

  return next;
}
