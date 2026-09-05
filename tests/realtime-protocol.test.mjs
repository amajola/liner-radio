import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRoomMutation,
  classifyRevision,
  eventForRoomChange,
  parseClientEvent,
  parseServerEvent,
} from "../lib/radio/realtime.ts";

const track = (id, key) => ({
  id,
  key,
  title: `Track ${key}`,
  artist: "Tester",
  url: `/api/tracks/${id}/audio`,
  duration: 180,
  source: "upload",
  requestedBy: "listener",
  requestedName: "Listener",
});

const room = () => ({
  id: "ROOM",
  name: "Test room",
  members: [
    { id: "host", name: "Host", role: "host", canRequest: true },
    { id: "listener", name: "Listener", role: "listener", canRequest: true },
  ],
  requests: [],
  queue: [],
  current: null,
  startedAt: null,
  offset: 0,
  playing: false,
  requestsOpen: true,
  volume: 0.8,
  ducked: false,
  crossfadeSeconds: 4,
  revision: 4,
});

test("the client protocol accepts only bounded ping and resync messages", () => {
  assert.deepEqual(parseClientEvent({ type: "sync:ping", clientTimestamp: 123 }), {
    type: "sync:ping",
    clientTimestamp: 123,
  });
  assert.deepEqual(parseClientEvent({ type: "room:resync", revision: 8 }), {
    type: "room:resync",
    revision: 8,
  });
  assert.equal(parseClientEvent({ type: "sync:ping", clientTimestamp: "123" }), null);
  assert.equal(parseClientEvent({ type: "room:resync", revision: -1 }), null);
  assert.equal(parseClientEvent({ type: "queue:add", track: {} }), null);
});

test("server event validation rejects malformed domain payloads", () => {
  const item = track("a".repeat(32), "request-1");
  assert.ok(
    parseServerEvent({
      type: "request:added",
      item,
      revision: 5,
      serverTime: 1_000,
    }),
  );
  assert.equal(
    parseServerEvent({
      type: "request:added",
      item: { ...item, duration: "long" },
      revision: 5,
      serverTime: 1_000,
    }),
    null,
  );
  assert.equal(parseServerEvent({ type: "request:removed", revision: 5 }), null);
});

test("revision classification ignores optimistic duplicates and detects missed events", () => {
  assert.equal(classifyRevision(41, 41), "duplicate");
  assert.equal(classifyRevision(41, 42), "next");
  assert.equal(classifyRevision(41, 43), "gap");
});

test("delta reducers reproduce request approval without a full room snapshot", () => {
  const requested = track("b".repeat(32), "request-2");
  const added = applyRoomMutation(room(), {
    type: "request:added",
    item: requested,
    revision: 5,
    serverTime: 1_000,
  });
  assert.deepEqual(added.requests, [requested]);
  assert.equal(added.revision, 5);

  const approved = applyRoomMutation(added, {
    type: "request:approved",
    item: requested,
    revision: 6,
    serverTime: 1_100,
  });
  assert.deepEqual(approved.requests, []);
  assert.deepEqual(approved.queue, [requested]);
  assert.equal(approved.revision, 6);
});

test("the server derives a compact queue event from canonical before and after state", () => {
  const queued = track("c".repeat(32), "queue-1");
  const previous = room();
  const next = { ...previous, queue: [queued], revision: 5 };
  assert.deepEqual(eventForRoomChange(previous, next, { type: "enqueue" }, 2_000), {
    type: "queue:added",
    item: queued,
    revision: 5,
    serverTime: 2_000,
  });
});
