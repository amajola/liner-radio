import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { apply, nextAdvanceAt } from "../lib/radio/model.ts";

const wrangler = JSON.parse(
  (await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8")).replace(
    /^\s*\/\/.*$/gm,
    "",
  ),
);
const workerEntry = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
const channel = await readFile(new URL("../worker/room-channel.ts", import.meta.url), "utf8");
const api = await readFile(new URL("../worker/api.ts", import.meta.url), "utf8");
const radioQueries = await readFile(new URL("../src/features/radio/queries.ts", import.meta.url), "utf8");
const roomChannelHook = await readFile(
  new URL("../src/features/radio/use-room-channel.ts", import.meta.url),
  "utf8",
);
const player = await readFile(
  new URL("../src/features/music/use-synchronized-player.ts", import.meta.url),
  "utf8",
);

const track = (id, duration) => ({
  id,
  title: `Track ${id}`,
  artist: "Tester",
  url: `/api/tracks/${id}/audio`,
  duration,
  source: "upload",
});

const baseRoom = () => ({
  id: "ROOM",
  name: "Room",
  members: [
    { id: "host", name: "Host", role: "host", canRequest: true },
    { id: "guest", name: "Guest", role: "listener", canRequest: true },
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
  revision: 0,
});

test("a room broadcasts over a durable object rather than per-tab polling", () => {
  assert.ok(
    wrangler.durable_objects.bindings.some((binding) => binding.class_name === "RoomChannel"),
  );
  assert.ok(
    wrangler.migrations.some((migration) =>
      migration.new_sqlite_classes?.includes("RoomChannel"),
    ),
  );
  assert.match(workerEntry, /export \{ RoomChannel \}/);
  assert.match(channel, /ctx\.acceptWebSocket/);
  assert.match(channel, /for \(const socket of this\.ctx\.getWebSockets\(\)\)/);
  assert.match(channel, /eventForRoomChange/);
  assert.doesNotMatch(channel, /#broadcast\(\): void/);
});

test("the socket upgrade is answered before the Effect router rebuilds responses", () => {
  const socketRoute = workerEntry.indexOf('"/api/radio/socket"');
  const effectDispatch = workerEntry.indexOf("effectHandler.handler(request)");
  assert.ok(socketRoute > 0 && effectDispatch > socketRoute);
});

test("socket handshakes are authenticated, membership-checked and origin-locked", () => {
  assert.match(api, /getSession/);
  assert.match(api, /origin !== url\.origin/);
  assert.match(channel, /members\.some\(\(member\) => member\.id === userId\)/);
});

test("every room write funnels through the durable object so devices cannot disagree", () => {
  assert.match(api, /roomChannel\(env, normalized\)\.snapshot/);
  assert.match(api, /roomChannel\(env, code\)\.act/);
  // Only room creation may still touch D1 directly.
  assert.doesNotMatch(api, /update\(radioRooms\)/);
});

test("polling stands down while the live socket is delivering pushes", () => {
  assert.match(radioQueries, /refetchInterval: live \? false : 2_000/);
  assert.match(roomChannelHook, /type: "sync:ping"/);
  assert.match(roomChannelHook, /serverTimestamp \+ rtt \/ 2 - Date\.now\(\)/);
  assert.match(roomChannelHook, /classifyRevision/);
  assert.match(roomChannelHook, /type: "room:resync"/);
  assert.match(roomChannelHook, /0\.8 \+ Math\.random\(\) \* 0\.4/);
  assert.match(roomChannelHook, /__LINER_RADIO_DIAGNOSTICS__/);
});

test("the programme advances one crossfade before the current track ends", () => {
  const room = baseRoom();
  assert.equal(nextAdvanceAt(room), null, "nothing scheduled while off air");

  const started = apply(
    { ...room, queue: [{ ...track("a".repeat(32), 180), key: "k1", requestedBy: "host", requestedName: "Host" }] },
    "host",
    { type: "next" },
    1_000_000,
  );
  // 180s track, 4s crossfade => switch at t+176s.
  assert.equal(nextAdvanceAt(started), 1_000_000 + 176_000);

  const paused = apply(started, "host", { type: "pause" }, 1_010_000);
  assert.equal(nextAdvanceAt(paused), null, "a paused room has no pending advance");

  const resumed = apply(paused, "host", { type: "resume" }, 1_020_000);
  // 10s already played, so 166s of runway remains.
  assert.equal(nextAdvanceAt(resumed), 1_020_000 + 166_000);
});

test("a crossfade longer than the track still schedules a non-negative advance", () => {
  const room = {
    ...baseRoom(),
    crossfadeSeconds: 12,
    queue: [{ ...track("b".repeat(32), 5), key: "k2", requestedBy: "host", requestedName: "Host" }],
  };
  const started = apply(room, "host", { type: "next" }, 500);
  assert.equal(nextAdvanceAt(started), 500);
});

test("listeners correct drift by trimming rate before resorting to a seek", () => {
  assert.match(player, /HARD_SEEK_SECONDS/);
  assert.match(player, /playbackRate = clampTo/);
  assert.match(player, /NotAllowedError/);
  assert.match(player, /setStatus\("blocked"\)/);
});

test("the next queued track is preloaded without ignoring data-saver mode", () => {
  assert.match(player, /const nextTrack = room\?\.queue\[0\]/);
  assert.match(player, /trackPlaybackQueryOptions\(nextTrack\.id\)/);
  assert.match(player, /audio\.preload = "auto"/);
  assert.match(player, /connection\?\.saveData/);
});

test("the first connect click starts playback before awaiting the network buffer", () => {
  const load = player.indexOf("const loading = loadTrack");
  const play = player.indexOf("to.audio.play()", load);
  const wait = player.indexOf("await loading", play);
  assert.ok(load > 0 && play > load && wait > play);
  assert.match(player, /if \(syncing\.current \|\| status === "connecting"\) return/);
  assert.match(player, /setStatus\("connecting"\);[\s\S]{0,100}await sync\(true\)/);
});

test("a remount cancels the stale audio attempt before trying again", () => {
  assert.match(player, /syncAbort\.current\?\.abort\(\)/);
  assert.match(player, /syncGeneration\.current \+= 1/);
  assert.match(player, /autoTried\.current = false/);
  assert.match(player, /decks\.current = null/);
});
