import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { apply } from "../lib/radio/model.ts";
import {
  applyRoomMutation,
  eventForRoomChange,
  parseServerEvent,
} from "../lib/radio/realtime.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const channel = await read("../worker/room-channel.ts");
const api = await read("../worker/api.ts");
const roomChannelHook = await read("../src/features/radio/use-room-channel.ts");
const roomView = await read("../src/features/radio/components/RoomView.tsx");
const settingsModal = await read("../src/features/radio/components/RoomSettingsModal.tsx");
const closedModal = await read("../src/features/radio/components/RoomClosedModal.tsx");
const lobby = await read("../src/features/radio/components/Lobby.tsx");
const mutations = await read("../src/features/radio/use-room-mutations.ts");
const css = await read("../src/styles.css");

const room = () => ({
  id: "ROOM",
  name: "Original",
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
  revision: 3,
});

test("only the host can rename a room, within a sane length", () => {
  const renamed = apply(room(), "host", { type: "rename", name: "  After hours  " });
  assert.equal(renamed.name, "After hours", "the name is trimmed");

  assert.throws(() => apply(room(), "guest", { type: "rename", name: "Hijacked" }), /Only the host/);
  assert.throws(() => apply(room(), "host", { type: "rename", name: "   " }), /between 1 and 70/);
  assert.throws(() => apply(room(), "host", { type: "rename", name: "x".repeat(71) }), /between 1 and 70/);
});

test("a rename travels as a delta and applies on the listener's copy", () => {
  const previous = room();
  const next = { ...apply(previous, "host", { type: "rename", name: "Late Night" }), revision: 4 };
  const event = eventForRoomChange(previous, next, { type: "rename" }, 1_000);
  assert.deepEqual(event, {
    type: "room:renamed",
    name: "Late Night",
    revision: 4,
    serverTime: 1_000,
  });
  assert.equal(applyRoomMutation(previous, event).name, "Late Night");
  assert.equal(applyRoomMutation(previous, event).revision, 4);
});

test("room:closed is accepted without a revision because nothing follows it", () => {
  const closed = parseServerEvent({ type: "room:closed", reason: "The host closed this room." });
  assert.deepEqual(closed, { type: "room:closed", reason: "The host closed this room." });
  assert.equal(parseServerEvent({ type: "room:closed" }), null, "a reason is required");
  assert.equal(parseServerEvent({ type: "room:closed", reason: "" }), null);
  assert.equal(parseServerEvent({ type: "room:closed", reason: "x".repeat(201) }), null);
});

test("closing a room deletes it, tells every device, and stops the programme", () => {
  assert.match(channel, /async close\(/);
  assert.match(channel, /Only the host can close this room/);
  assert.match(channel, /delete\(radioRooms\)/);
  assert.match(channel, /type: "room:closed"/);
  assert.match(channel, /socket\.close\(1000, "room-closed"\)/);
  // A deleted room must not keep waking up to advance a queue.
  assert.match(channel, /deleteAlarm\(\)/);
  assert.match(channel, /deleteAll\(\)/);
  // Closing is terminal, so it deliberately skips the revision conflict check.
  assert.match(api, /if \(action\.type === "close"\)/);
});

test("a closed room stops reconnecting and hands the listener a way out", () => {
  assert.match(roomChannelHook, /payload\.type === "room:closed"/);
  assert.match(roomChannelHook, /closed\.current = true/);
  assert.match(roomChannelHook, /if \(closed\.current\)/);
  assert.match(roomChannelHook, /closedReason/);
  assert.match(closedModal, /This room has closed/);
  assert.match(roomView, /<RoomClosedModal/);
  assert.match(roomView, /channel\.closedReason/);
});

test("the host leaving ends the room rather than stranding listeners", () => {
  assert.match(roomView, /if \(isHost\) \{[\s\S]*closeRoom\.mutate\([\s\S]*reason: "left"/);
  assert.match(mutations, /type: "close"/);
  // The room is gone, so its cached snapshot goes with it.
  assert.match(mutations, /removeQueries\(\{ queryKey: radioKeys\.room\(variables\.roomId\), exact: true \}\)/);
});

test("room management lives in a modal, and deleting asks twice", () => {
  assert.match(settingsModal, /<Modal/);
  assert.match(settingsModal, /Room settings/);
  assert.match(settingsModal, /onRename/);
  assert.match(settingsModal, /confirming/);
  assert.match(settingsModal, /Delete room/);
  assert.match(settingsModal, /Yes, delete/);
  assert.match(roomView, /<RoomSettingsModal/);
  assert.match(lobby, /<RoomSettingsModal/);
  assert.match(lobby, /owned-manage/);
});

test("the lobby stays fixed: entry forms move into a modal before it can overflow", () => {
  assert.match(lobby, /useMediaQuery\("\(max-width: 780px\)"\)/);
  assert.match(lobby, /compact \?/);
  assert.match(lobby, /entry-actions/);
  assert.match(css, /\.lobby\s*{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.lobby-panel-scroll[^{]*{[^}]*overflow:\s*auto/s);
});

test("invite and settings are labelled buttons, not hidden icons", () => {
  // They used to be transparent 12px text collapsed to bare icons on mobile.
  assert.match(roomView, /className="room-action room-action-primary"/);
  assert.match(roomView, /<UserPlus size=\{17\} \/> Invite/);
  assert.match(roomView, /<Settings size=\{17\} \/> Settings/);
  assert.doesNotMatch(roomView, /className="icon-text"[\s\S]{0,200}Invite/);
  // The label must survive the small-screen rule that blanks .icon-text.
  assert.doesNotMatch(css, /\.room-action[^{]*{[^}]*font-size:\s*0/s);
  assert.match(css, /\.room-action\s*{[^}]*min-height:\s*38px/s);
  assert.match(css, /\.room-action-primary\s*{[^}]*background:\s*var\(--accent\)/s);
});

test("the breakpoint hook re-reads on resize, not only on the media query event", async () => {
  const hook = await readFile(new URL("../src/shared/use-media-query.ts", import.meta.url), "utf8");
  assert.match(hook, /addEventListener\("change", onChange\)/);
  assert.match(hook, /addEventListener\("resize", onChange\)/);
  assert.match(hook, /removeEventListener\("resize", onChange\)/);
});
