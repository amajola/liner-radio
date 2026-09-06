import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DIRECT_UPLOAD_BYTES,
  expectedPartBytes,
  MAXIMUM_TRACK_BYTES,
  partCountFor,
  UPLOAD_PART_BYTES,
} from "../lib/http/upload-limits.ts";
import { createMediaTicket, verifyMediaTicket } from "../lib/http/media-ticket.ts";

const trackId = "1234567890abcdef1234567890abcdef";
const secret = "a-local-test-secret-that-is-long-enough";
const now = 2_000_000_000_000;

test("a track at the maximum size still produces a usable media ticket", async () => {
  // The upload cap and the ticket's own bytes bound are separate checks. When
  // they disagree a large file uploads cleanly and then fails playback with a
  // misleading "link expired" error, so pin them together.
  const ticket = {
    version: 1,
    trackId,
    objectKey: `tracks/user_123/${trackId}`,
    bytes: MAXIMUM_TRACK_BYTES,
    mimeType: "audio/flac",
    expiresAt: now + 60_000,
  };
  const token = await createMediaTicket(ticket, secret);
  assert.deepEqual(await verifyMediaTicket(token, trackId, secret, now), ticket);
});

test("a track past the maximum size is refused by the ticket", async () => {
  const token = await createMediaTicket(
    {
      version: 1,
      trackId,
      objectKey: `tracks/user_123/${trackId}`,
      bytes: MAXIMUM_TRACK_BYTES + 1,
      mimeType: "audio/flac",
      expiresAt: now + 60_000,
    },
    secret,
  );
  assert.equal(await verifyMediaTicket(token, trackId, secret, now), null);
});

test("part counts cover the file exactly", () => {
  for (const size of [
    DIRECT_UPLOAD_BYTES + 1,
    UPLOAD_PART_BYTES * 4,
    UPLOAD_PART_BYTES * 4 + 1,
    MAXIMUM_TRACK_BYTES,
    123_456_789,
  ]) {
    const parts = partCountFor(size);
    let total = 0;
    for (let part = 1; part <= parts; part += 1) total += expectedPartBytes(size, part);
    assert.equal(total, size, `parts must sum to ${size}`);
  }
});

test("only the final part is allowed to be short", () => {
  const size = UPLOAD_PART_BYTES * 3 + 1_000;
  const parts = partCountFor(size);
  assert.equal(parts, 4);
  for (let part = 1; part < parts; part += 1) {
    assert.equal(expectedPartBytes(size, part), UPLOAD_PART_BYTES);
  }
  assert.equal(expectedPartBytes(size, parts), 1_000);
});

test("an exact multiple of the part size has no short trailing part", () => {
  const size = UPLOAD_PART_BYTES * 5;
  assert.equal(partCountFor(size), 5);
  assert.equal(expectedPartBytes(size, 5), UPLOAD_PART_BYTES);
});

test("part numbers outside the upload resolve to zero rather than a size", () => {
  const size = UPLOAD_PART_BYTES * 2;
  assert.equal(expectedPartBytes(size, 0), 0);
  assert.equal(expectedPartBytes(size, 3), 0);
  assert.equal(expectedPartBytes(size, -1), 0);
});

test("R2 rejects parts under 5 MiB, so the configured part size clears it", () => {
  assert.ok(UPLOAD_PART_BYTES >= 5 * 1024 * 1024);
  // 10,000 parts is R2's ceiling for one multipart upload.
  assert.ok(partCountFor(MAXIMUM_TRACK_BYTES) <= 10_000);
});

test("the direct-upload threshold stays under the multipart path", () => {
  assert.ok(DIRECT_UPLOAD_BYTES < MAXIMUM_TRACK_BYTES);
  // Anything routed through formData() is buffered whole in the Worker, which
  // has a 128 MB memory ceiling.
  assert.ok(DIRECT_UPLOAD_BYTES <= 100 * 1024 * 1024);
});

test("the worker rejects a part whose length is not the expected one", async () => {
  const source = await readFile(new URL("../worker/tracks.ts", import.meta.url), "utf8");
  assert.match(source, /body\.byteLength !== expected/);
  // The declared size gates the quota check, so the assembled object must match.
  assert.match(source, /object\.size !== pending\.bytes/);
});

test("the whole-object cache write is gated on size", async () => {
  const source = await readFile(new URL("../worker/tracks.ts", import.meta.url), "utf8");
  assert.match(source, /isWholeObject && context && ticket\.bytes <= maximumCacheableBytes/);
});

test("the sweep runs on a schedule rather than off the next upload", async () => {
  const tracks = await readFile(new URL("../worker/tracks.ts", import.meta.url), "utf8");
  const entry = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

  // Starting an upload must no longer pay for a scan, and a host who abandons
  // one and never returns must still be cleaned up.
  assert.doesNotMatch(tracks, /sweepExpiredUploads/);
  assert.match(entry, /async scheduled\(/);
  assert.match(entry, /sweepAbandonedUploads\(env\)/);

  // Rows are deleted whether or not the R2 abort succeeds, so an upload that
  // can never be aborted cannot wedge the sweep behind the same batch.
  assert.match(tracks, /\.abort\(\)\s*\n?\s*\.catch\(\(\) => undefined\)/);
});

test("expired reservations stop consuming a host's quota", async () => {
  const tracks = await readFile(new URL("../worker/tracks.ts", import.meta.url), "utf8");
  // Between sweeps a stale row must not lock a host out of their own library.
  assert.match(tracks, /gt\(trackUploads\.createdAt/);
});

test("the cron expression is shared with the deploy config", async () => {
  const config = await readFile(new URL("../alchemy.run.ts", import.meta.url), "utf8");
  assert.match(config, /crons: \[SWEEP_CRON\]/);
  // alchemy.run.ts runs under Node, so the constant must not come from the
  // Worker entry — that would pull in `cloudflare:workers` at deploy time.
  assert.match(config, /from "\.\/lib\/http\/upload-limits"/);
  assert.doesNotMatch(config, /^import \{[^}]*\} from "\.\/worker\//m);
});

test("the sweep fires often enough to stay ahead of the expiry window", async () => {
  const { SWEEP_CRON, UPLOAD_EXPIRY_MS } = await import("../lib/http/upload-limits.ts");
  assert.equal(SWEEP_CRON.split(/\s+/).length, 5, "must be a 5-field cron expression");
  assert.ok(UPLOAD_EXPIRY_MS >= 60 * 60 * 1_000, "hourly fires must not outpace the window");
});
