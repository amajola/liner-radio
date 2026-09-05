import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseRangeHeader } from "../lib/http/range.ts";

const tracks = await readFile(new URL("../worker/tracks.ts", import.meta.url), "utf8");
const SIZE = 96_044;

test("an unranged request is served whole so Safari never sees an unasked-for 206", () => {
  assert.equal(parseRangeHeader(null, SIZE), null);
  assert.equal(parseRangeHeader("bytes=abc", SIZE), null, "unparseable ranges fall back to 200");
  assert.equal(parseRangeHeader("bytes=0-100,200-300", SIZE), null, "multi-range falls back to 200");
  assert.equal(parseRangeHeader("bytes=-", SIZE), null);
});

test("byte ranges resolve to the exact window the client asked for", () => {
  assert.deepEqual(parseRangeHeader("bytes=0-", SIZE), { start: 0, length: SIZE });
  assert.deepEqual(parseRangeHeader("bytes=0-1023", SIZE), { start: 0, length: 1024 });
  assert.deepEqual(parseRangeHeader("bytes=1000-", SIZE), { start: 1000, length: SIZE - 1000 });
  assert.deepEqual(parseRangeHeader("bytes=-500", SIZE), { start: SIZE - 500, length: 500 });
  assert.deepEqual(parseRangeHeader(" bytes=10-19 ", SIZE), { start: 10, length: 10 });
});

test("an end past the object is clamped rather than over-reported", () => {
  assert.deepEqual(parseRangeHeader(`bytes=0-${SIZE + 5000}`, SIZE), { start: 0, length: SIZE });
  assert.deepEqual(parseRangeHeader(`bytes=-${SIZE + 5000}`, SIZE), { start: 0, length: SIZE });
});

test("ranges that start past the end are refused with 416 instead of silently clamped", () => {
  assert.equal(parseRangeHeader(`bytes=${SIZE}-`, SIZE), "unsatisfiable");
  assert.equal(parseRangeHeader("bytes=999999-1000000", SIZE), "unsatisfiable");
  assert.equal(parseRangeHeader("bytes=500-100", SIZE), "unsatisfiable");
  assert.equal(parseRangeHeader("bytes=-0", SIZE), "unsatisfiable");
  assert.equal(parseRangeHeader("bytes=0-", 0), "unsatisfiable");
});

test("the audio route answers HEAD and returns 416 with the total size", () => {
  assert.match(tracks, /request\.method === "GET" \|\| request\.method === "HEAD"/);
  assert.match(tracks, /status: 416/);
  assert.match(tracks, /`bytes \*\/\$\{ticket\.bytes\}`/);
  assert.match(tracks, /status: 200/);
});

test("audio byte ranges use a signed grant instead of repeating session and D1 work", () => {
  const streamBody = tracks.slice(
    tracks.indexOf("async function streamTrack"),
    tracks.indexOf("export async function handleTrackRequest"),
  );
  assert.match(streamBody, /verifyMediaTicket/);
  assert.match(streamBody, /caches as CacheStorage/);
  assert.doesNotMatch(streamBody, /await identity/);
  assert.doesNotMatch(streamBody, /getDb\(/);
});

test("whole immutable objects seed the shared cache and preserve range responses", () => {
  assert.match(tracks, /isWholeObject/);
  assert.match(tracks, /cacheable\.clone\(\)/);
  assert.match(tracks, /status: 206/);
  assert.match(tracks, /X-Media-Cache/);
});
