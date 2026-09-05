import type { Entry, Member, Room } from "./model";

type Revisioned = {
  readonly revision: number;
  readonly serverTime: number;
};

export type ClientToServerEvent =
  | { readonly type: "sync:ping"; readonly clientTimestamp: number }
  | { readonly type: "room:resync"; readonly revision: number };

export type RoomMutationEvent =
  | (Revisioned & { readonly type: "room:member-joined"; readonly member: Member })
  | (Revisioned & { readonly type: "room:renamed"; readonly name: string })
  | (Revisioned & { readonly type: "room:requests-changed"; readonly open: boolean })
  | (Revisioned & {
      readonly type: "room:member-permission-changed";
      readonly memberId: string;
      readonly canRequest: boolean;
    })
  | (Revisioned & { readonly type: "request:added"; readonly item: Entry })
  | (Revisioned & { readonly type: "request:removed"; readonly itemKey: string })
  | (Revisioned & { readonly type: "request:approved"; readonly item: Entry })
  | (Revisioned & { readonly type: "queue:added"; readonly item: Entry })
  | (Revisioned & { readonly type: "queue:removed"; readonly itemKey: string })
  | (Revisioned & {
      readonly type: "queue:moved";
      readonly itemKey: string;
      readonly index: number;
    })
  | (Revisioned & {
      readonly type: "playback:changed";
      readonly current: Entry | null;
      readonly removedQueueItemKey: string | null;
      readonly startedAt: number | null;
      readonly offset: number;
      readonly playing: boolean;
    })
  | (Revisioned & {
      readonly type: "mixer:changed";
      readonly volume: number;
      readonly ducked: boolean;
      readonly crossfadeSeconds: number;
    });

export type ServerToClientEvent =
  | { readonly type: "room:snapshot"; readonly room: Room; readonly serverTime: number }
  | RoomMutationEvent
  | {
      readonly type: "sync:pong";
      readonly clientTimestamp: number;
      readonly serverTimestamp: number;
    }
  | { readonly type: "protocol:error"; readonly message: string }
  // Terminal and deliberately unrevisioned: the room no longer exists, so there
  // is nothing left for a client to reconcile against.
  | { readonly type: "room:closed"; readonly reason: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const isNullableNumber = (value: unknown): value is number | null =>
  value === null || isFiniteNumber(value);

function isMember(value: unknown): value is Member {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 128 &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= 80 &&
    (value.role === "host" || value.role === "listener") &&
    typeof value.canRequest === "boolean"
  );
}

function isEntry(value: unknown): value is Entry {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    /^[a-f0-9]{32}$/.test(value.id) &&
    typeof value.key === "string" &&
    value.key.length > 0 &&
    value.key.length <= 128 &&
    typeof value.title === "string" &&
    value.title.length > 0 &&
    value.title.length <= 180 &&
    typeof value.artist === "string" &&
    value.artist.length > 0 &&
    value.artist.length <= 180 &&
    value.source === "upload" &&
    value.url === `/api/tracks/${value.id}/audio` &&
    isFiniteNumber(value.duration) &&
    value.duration > 0 &&
    value.duration <= 14_400 &&
    typeof value.requestedBy === "string" &&
    value.requestedBy.length > 0 &&
    value.requestedBy.length <= 128 &&
    typeof value.requestedName === "string" &&
    value.requestedName.length > 0 &&
    value.requestedName.length <= 80
  );
}

function isRoom(value: unknown): value is Room {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 32 &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= 70 &&
    Array.isArray(value.members) &&
    value.members.length <= 100 &&
    value.members.every(isMember) &&
    Array.isArray(value.requests) &&
    value.requests.length <= 100 &&
    value.requests.every(isEntry) &&
    Array.isArray(value.queue) &&
    value.queue.length <= 100 &&
    value.queue.every(isEntry) &&
    (value.current === null || isEntry(value.current)) &&
    isNullableNumber(value.startedAt) &&
    isFiniteNumber(value.offset) &&
    value.offset >= 0 &&
    typeof value.playing === "boolean" &&
    typeof value.requestsOpen === "boolean" &&
    isFiniteNumber(value.volume) &&
    value.volume >= 0 &&
    value.volume <= 1 &&
    typeof value.ducked === "boolean" &&
    isFiniteNumber(value.crossfadeSeconds) &&
    value.crossfadeSeconds >= 0 &&
    value.crossfadeSeconds <= 12 &&
    isNonNegativeInteger(value.revision)
  );
}

function hasRevision(value: Record<string, unknown>): boolean {
  return isNonNegativeInteger(value.revision) && isFiniteNumber(value.serverTime);
}

export function parseClientEvent(value: unknown): ClientToServerEvent | null {
  if (!isObject(value)) return null;
  if (value.type === "sync:ping" && isFiniteNumber(value.clientTimestamp)) {
    return { type: "sync:ping", clientTimestamp: value.clientTimestamp };
  }
  if (value.type === "room:resync" && isNonNegativeInteger(value.revision)) {
    return { type: "room:resync", revision: value.revision };
  }
  return null;
}

export function parseServerEvent(value: unknown): ServerToClientEvent | null {
  if (!isObject(value)) return null;

  if (
    value.type === "room:snapshot" &&
    isRoom(value.room) &&
    isFiniteNumber(value.serverTime)
  ) {
    return value as ServerToClientEvent;
  }
  if (
    value.type === "sync:pong" &&
    isFiniteNumber(value.clientTimestamp) &&
    isFiniteNumber(value.serverTimestamp)
  ) {
    return value as ServerToClientEvent;
  }
  if (
    value.type === "protocol:error" &&
    typeof value.message === "string" &&
    value.message.length > 0 &&
    value.message.length <= 200
  ) {
    return value as ServerToClientEvent;
  }
  if (
    value.type === "room:closed" &&
    typeof value.reason === "string" &&
    value.reason.length > 0 &&
    value.reason.length <= 200
  ) {
    return value as ServerToClientEvent;
  }
  if (!hasRevision(value)) return null;

  switch (value.type) {
    case "room:member-joined":
      return isMember(value.member) ? (value as RoomMutationEvent) : null;
    case "room:renamed":
      return typeof value.name === "string" &&
        value.name.length > 0 &&
        value.name.length <= 70
        ? (value as RoomMutationEvent)
        : null;
    case "room:requests-changed":
      return typeof value.open === "boolean" ? (value as RoomMutationEvent) : null;
    case "room:member-permission-changed":
      return typeof value.memberId === "string" && typeof value.canRequest === "boolean"
        ? (value as RoomMutationEvent)
        : null;
    case "request:added":
    case "request:approved":
    case "queue:added":
      return isEntry(value.item) ? (value as RoomMutationEvent) : null;
    case "request:removed":
    case "queue:removed":
      return typeof value.itemKey === "string" ? (value as RoomMutationEvent) : null;
    case "queue:moved":
      return typeof value.itemKey === "string" && isNonNegativeInteger(value.index)
        ? (value as RoomMutationEvent)
        : null;
    case "playback:changed":
      return (value.current === null || isEntry(value.current)) &&
        (value.removedQueueItemKey === null || typeof value.removedQueueItemKey === "string") &&
        isNullableNumber(value.startedAt) &&
        isFiniteNumber(value.offset) &&
        value.offset >= 0 &&
        typeof value.playing === "boolean"
        ? (value as RoomMutationEvent)
        : null;
    case "mixer:changed":
      return isFiniteNumber(value.volume) &&
        value.volume >= 0 &&
        value.volume <= 1 &&
        typeof value.ducked === "boolean" &&
        isFiniteNumber(value.crossfadeSeconds) &&
        value.crossfadeSeconds >= 0 &&
        value.crossfadeSeconds <= 12
        ? (value as RoomMutationEvent)
        : null;
    default:
      return null;
  }
}

export function isRoomMutationEvent(event: ServerToClientEvent): event is RoomMutationEvent {
  return "revision" in event;
}

export type RevisionDisposition = "next" | "duplicate" | "gap";

export function classifyRevision(
  currentRevision: number,
  incomingRevision: number,
): RevisionDisposition {
  if (incomingRevision <= currentRevision) return "duplicate";
  return incomingRevision === currentRevision + 1 ? "next" : "gap";
}

function findAdded(previous: Entry[], next: Entry[]): Entry | undefined {
  return next.find((item) => !previous.some((candidate) => candidate.key === item.key));
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

export function eventForRoomChange(
  previous: Room,
  next: Room,
  action: Record<string, unknown>,
  serverTime: number,
): RoomMutationEvent {
  const revision = next.revision;
  switch (action.type) {
    case "request":
      return {
        type: "request:added",
        item: required(findAdded(previous.requests, next.requests), "Missing requested item."),
        revision,
        serverTime,
      };
    case "enqueue":
      return {
        type: "queue:added",
        item: required(findAdded(previous.queue, next.queue), "Missing queued item."),
        revision,
        serverTime,
      };
    case "rename":
      return { type: "room:renamed", name: next.name, revision, serverTime };
    case "requestsOpen":
      return { type: "room:requests-changed", open: next.requestsOpen, revision, serverTime };
    case "permission":
      return {
        type: "room:member-permission-changed",
        memberId: String(action.member),
        canRequest: Boolean(action.value),
        revision,
        serverTime,
      };
    case "approve":
      return {
        type: "request:approved",
        item: required(
          next.queue.find((item) => item.key === action.key),
          "Missing approved item.",
        ),
        revision,
        serverTime,
      };
    case "reject":
      return { type: "request:removed", itemKey: String(action.key), revision, serverTime };
    case "remove":
      return { type: "queue:removed", itemKey: String(action.key), revision, serverTime };
    case "move": {
      const itemKey = String(action.key);
      const index = next.queue.findIndex((item) => item.key === itemKey);
      if (index < 0) throw new Error("Missing moved item.");
      return { type: "queue:moved", itemKey, index, revision, serverTime };
    }
    case "next":
    case "pause":
    case "resume":
      return {
        type: "playback:changed",
        current: next.current,
        removedQueueItemKey: action.type === "next" ? previous.queue[0]?.key ?? null : null,
        startedAt: next.startedAt,
        offset: next.offset,
        playing: next.playing,
        revision,
        serverTime,
      };
    case "volume":
    case "duck":
    case "crossfade":
      return {
        type: "mixer:changed",
        volume: next.volume,
        ducked: next.ducked,
        crossfadeSeconds: next.crossfadeSeconds,
        revision,
        serverTime,
      };
    default:
      throw new Error("Unknown room action.");
  }
}

export function applyRoomMutation(room: Room, event: RoomMutationEvent): Room {
  const next = structuredClone(room);

  switch (event.type) {
    case "room:member-joined":
      if (!next.members.some((member) => member.id === event.member.id)) {
        next.members.push(event.member);
      }
      break;
    case "room:renamed":
      next.name = event.name;
      break;
    case "room:requests-changed":
      next.requestsOpen = event.open;
      break;
    case "room:member-permission-changed": {
      const member = next.members.find((candidate) => candidate.id === event.memberId);
      if (!member) throw new Error("Room member is missing.");
      member.canRequest = event.canRequest;
      break;
    }
    case "request:added":
      if (!next.requests.some((item) => item.key === event.item.key)) {
        next.requests.push(event.item);
      }
      break;
    case "request:removed":
      next.requests = next.requests.filter((item) => item.key !== event.itemKey);
      break;
    case "request:approved":
      next.requests = next.requests.filter((item) => item.key !== event.item.key);
      if (!next.queue.some((item) => item.key === event.item.key)) next.queue.push(event.item);
      break;
    case "queue:added":
      if (!next.queue.some((item) => item.key === event.item.key)) next.queue.push(event.item);
      break;
    case "queue:removed":
      next.queue = next.queue.filter((item) => item.key !== event.itemKey);
      break;
    case "queue:moved": {
      const from = next.queue.findIndex((item) => item.key === event.itemKey);
      if (from < 0 || event.index >= next.queue.length) throw new Error("Queue item is missing.");
      const [item] = next.queue.splice(from, 1);
      next.queue.splice(event.index, 0, item);
      break;
    }
    case "playback:changed":
      if (event.removedQueueItemKey) {
        next.queue = next.queue.filter((item) => item.key !== event.removedQueueItemKey);
      }
      next.current = event.current;
      next.startedAt = event.startedAt;
      next.offset = event.offset;
      next.playing = event.playing;
      break;
    case "mixer:changed":
      next.volume = event.volume;
      next.ducked = event.ducked;
      next.crossfadeSeconds = event.crossfadeSeconds;
      break;
  }

  next.revision = event.revision;
  return next;
}
