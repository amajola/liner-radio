import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { radioRooms } from "../db/schema";
import { apply, nextAdvanceAt, normalizeRoom, type Room } from "../lib/radio/model";
import {
  eventForRoomChange,
  parseClientEvent,
  type RoomMutationEvent,
  type ServerToClientEvent,
} from "../lib/radio/realtime";
import type { Env } from "./env";
import { findUploadedTrack } from "./tracks";

export type Actor = { readonly id: string; readonly name: string; readonly image?: string | null };

export type ActionResult =
  | { readonly ok: true; readonly room: Room; readonly serverTime: number }
  | { readonly ok: false; readonly message: string; readonly status: number };

type SocketMeta = { readonly userId: string };
const disposableBackpressureBytes = 64 * 1024;
const maximumBackpressureBytes = 512 * 1024;

const failure = (message: string, status: number): ActionResult => ({
  ok: false,
  message,
  status,
});

/**
 * One instance per room code. The Durable Object is the only writer for a room,
 * so listeners never disagree about what is playing: every mutation is applied
 * here, persisted to D1, and pushed to every connected device on the same tick.
 * D1 stays the durable record so the lobby and a cold start still work.
 */
export class RoomChannel extends DurableObject<Env> {
  #room: Room | null = null;
  #code = "";

  async #load(code?: string): Promise<Room | null> {
    const wanted = (code || this.#code || (await this.ctx.storage.get<string>("code")) || "")
      .toUpperCase();
    if (!wanted) return null;
    if (this.#room && this.#code === wanted) return this.#room;

    const [row] = await getDb(this.env.DB)
      .select({ state: radioRooms.state, revision: radioRooms.revision })
      .from(radioRooms)
      .where(eq(radioRooms.id, wanted))
      .limit(1);
    if (!row) return null;

    this.#code = wanted;
    this.#room = { ...normalizeRoom(JSON.parse(row.state) as Room), revision: row.revision };
    await this.ctx.storage.put("code", wanted);
    return this.#room;
  }

  async #commit(
    room: Room,
    event: (committed: Room, serverTime: number) => RoomMutationEvent,
  ): Promise<Room> {
    const next = { ...room, revision: room.revision + 1 };
    const serverTime = Date.now();
    const mutation = event(next, serverTime);
    this.#room = next;
    await getDb(this.env.DB)
      .update(radioRooms)
      .set({ state: JSON.stringify(next), revision: next.revision })
      .where(eq(radioRooms.id, this.#code));
    this.#broadcast(mutation);
    await this.#schedule();
    return next;
  }

  #send(socket: WebSocket, event: ServerToClientEvent, disposable = false): void {
    if (disposable && socket.bufferedAmount > disposableBackpressureBytes) return;
    if (!disposable && socket.bufferedAmount > maximumBackpressureBytes) {
      // Transactional deltas are never silently dropped. Closing forces this
      // slow client through reconnect, where it receives a canonical snapshot.
      socket.close(1013, "Realtime connection fell behind.");
      return;
    }
    socket.send(JSON.stringify(event));
  }

  #broadcast(event: RoomMutationEvent): void {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        this.#send(socket, event);
      } catch {
        // A dead socket is cleaned up by webSocketClose; never fail a write for it.
      }
    }
  }

  /**
   * Wake up just before the current track runs out so the queue advances on the
   * server. Every device then crossfades from the same broadcast instead of
   * waiting for the host's browser to be awake and foregrounded.
   */
  async #schedule(): Promise<void> {
    const room = this.#room;
    const firesAt = room ? nextAdvanceAt(room) : null;
    if (firesAt === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.max(firesAt, Date.now() + 250));
  }

  async alarm(): Promise<void> {
    const room = await this.#load();
    if (!room) return;

    const firesAt = nextAdvanceAt(room);
    if (firesAt === null) return;
    if (Date.now() < firesAt - 250) {
      await this.#schedule();
      return;
    }

    const host = room.members.find((member) => member.role === "host");
    if (!host) return;

    try {
      const action = { type: "next" };
      await this.#commit(apply(room, host.id, action), (committed, serverTime) =>
        eventForRoomChange(room, committed, action, serverTime),
      );
    } catch {
      await this.ctx.storage.deleteAlarm();
    }
  }

  async snapshot(code: string, userId: string): Promise<ActionResult> {
    const room = await this.#load(code);
    if (!room) return failure("Room not found. Check the invite code.", 404);
    if (!room.members.some((member) => member.id === userId)) {
      return failure("Join this room to see its programme.", 403);
    }
    return { ok: true, room, serverTime: Date.now() };
  }

  /**
   * Ends a room for good: the row is deleted, every connected device is told
   * why, and the alarm is cleared so a closed room cannot keep advancing a
   * programme nobody is listening to.
   */
  async close(code: string, userId: string, reason: string): Promise<ActionResult> {
    const room = await this.#load(code);
    if (!room) return failure("Room not found. Check the invite code.", 404);

    const host = room.members.find((member) => member.role === "host");
    if (!host || host.id !== userId) {
      return failure("Only the host can close this room.", 403);
    }

    await getDb(this.env.DB).delete(radioRooms).where(eq(radioRooms.id, room.id));

    const serverTime = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(JSON.stringify({ type: "room:closed", reason }));
        // 1000 is a normal closure: the listener was not disconnected by a
        // fault and should not try to reconnect to a room that is gone.
        socket.close(1000, "room-closed");
      } catch {
        // A socket that is already gone needs no farewell.
      }
    }

    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.#room = null;
    this.#code = "";

    return { ok: true, room, serverTime };
  }

  async act(
    code: string,
    actor: Actor,
    action: Record<string, unknown>,
  ): Promise<ActionResult> {
    const room = await this.#load(code);
    if (!room) return failure("Room not found. Check the invite code.", 404);

    if (action.type === "join") {
      if (room.members.some((member) => member.id === actor.id)) {
        return { ok: true, room, serverTime: Date.now() };
      }
      if (room.members.length >= 100) return failure("This room is full.", 400);
      const joined: Room = {
        ...room,
        members: [...room.members, { ...actor, role: "listener", canRequest: true }],
      };
      const member = joined.members[joined.members.length - 1];
      return {
        ok: true,
        room: await this.#commit(joined, (committed, serverTime) => ({
          type: "room:member-joined",
          member,
          revision: committed.revision,
          serverTime,
        })),
        serverTime: Date.now(),
      };
    }

    if (typeof action.revision === "number" && action.revision !== room.revision) {
      return failure("The room changed. Try your action again.", 409);
    }

    const resolved = { ...action };
    if (action.type === "request" || action.type === "enqueue") {
      const host = room.members.find((member) => member.role === "host");
      const requested = action.track as { id?: unknown } | undefined;
      if (!host || typeof requested?.id !== "string") {
        return failure("Choose an uploaded track.", 400);
      }
      try {
        resolved.track = await findUploadedTrack(this.env, requested.id, host.id);
      } catch (cause) {
        const message =
          cause && typeof cause === "object" && "message" in cause
            ? String((cause as { message: unknown }).message)
            : "That track is no longer in the host's library.";
        return failure(message, 404);
      }
    }

    try {
      const changed = apply(room, actor.id, resolved);
      return {
        ok: true,
        room: await this.#commit(changed, (committed, serverTime) =>
          eventForRoomChange(room, committed, resolved, serverTime),
        ),
        serverTime: Date.now(),
      };
    } catch (cause) {
      return failure(cause instanceof Error ? cause.message : "Unknown room action.", 400);
    }
  }

  // WebSocket upgrades cannot travel over RPC, so the Worker forwards the raw
  // request here with the already-authenticated identity attached.
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = (url.searchParams.get("room") || "").toUpperCase();
    const userId = url.searchParams.get("uid") || "";

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }

    const room = await this.#load(code);
    if (!room) return new Response("Room not found.", { status: 404 });
    if (!room.members.some((member) => member.id === userId)) {
      return new Response("Join this room first.", { status: 403 });
    }

    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId } satisfies SocketMeta);
    this.#send(server, { type: "room:snapshot", room, serverTime: Date.now() });

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;

    let raw: unknown;
    try {
      raw = JSON.parse(message) as unknown;
    } catch {
      this.#send(socket, { type: "protocol:error", message: "Message must be valid JSON." });
      return;
    }
    const payload = parseClientEvent(raw);
    if (!payload) {
      this.#send(socket, { type: "protocol:error", message: "Unsupported realtime message." });
      return;
    }

    // Round-trip probe: the client halves the measured latency to align its
    // clock with the server, which is what keeps decks on separate devices
    // within a few tens of milliseconds of each other.
    if (payload.type === "sync:ping") {
      this.#send(
        socket,
        {
          type: "sync:pong",
          clientTimestamp: payload.clientTimestamp,
          serverTimestamp: Date.now(),
        },
        true,
      );
      return;
    }

    if (payload.type === "room:resync") {
      const room = await this.#load();
      if (room) {
        this.#send(socket, { type: "room:snapshot", room, serverTime: Date.now() });
      }
    }
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  }
}
