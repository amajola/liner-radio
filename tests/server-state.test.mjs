import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const radioQueries = await readFile(
  new URL("../src/features/radio/queries.ts", import.meta.url),
  "utf8",
);
const radioMutations = await readFile(
  new URL("../src/features/radio/use-room-mutations.ts", import.meta.url),
  "utf8",
);
const musicQueries = await readFile(
  new URL("../src/features/music/queries.ts", import.meta.url),
  "utf8",
);
const musicMutations = await readFile(
  new URL("../src/features/music/use-upload-track.ts", import.meta.url),
  "utf8",
);
const uiStore = await readFile(new URL("../src/stores/ui-store.ts", import.meta.url), "utf8");

test("server state uses domain-shaped colocated query options", () => {
  assert.match(radioQueries, /\["radio", "rooms"\]/);
  assert.match(radioQueries, /\["radio", "room", roomId\]/);
  assert.match(radioQueries, /queryOptions\(\{[\s\S]*queryFn:/);
  assert.match(musicQueries, /\["music", "uploaded-library", ownerId\]/);
});

test("playback grants and next-track preloading stay in the music server-state layer", () => {
  assert.match(musicQueries, /playback: \(trackId: string\)/);
  assert.match(musicQueries, /trackPlaybackQueryOptions/);
  assert.match(musicQueries, /playback-grant/);
});

test("uploaded-library writes invalidate only the owner's library", () => {
  assert.match(musicMutations, /musicKeys\.library\(variables\.ownerId\)/);
  assert.match(musicMutations, /exact: true/);
});

test("room writes optimistically reconcile only their room query", () => {
  assert.match(radioMutations, /cancelQueries\(\{ queryKey, exact: true \}\)/);
  assert.match(radioMutations, /const previous = queryClient\.getQueryData/);
  assert.match(radioMutations, /setQueryData<RoomSnapshot>/);
  assert.match(radioMutations, /context\?\.previous/);
  assert.match(radioMutations, /radioKeys\.room\(variables\.roomId\)/);
  assert.match(radioMutations, /exact: true/);
});

test("Zustand contains client UI state, not server entities", () => {
  assert.doesNotMatch(uiStore, /\bRoom\b|\bTrack\b|rooms:|session:/);
  assert.match(uiStore, /mobileView:/);
  assert.match(uiStore, /toast:/);
});
