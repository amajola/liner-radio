import assert from "node:assert/strict";
import test from "node:test";
import {
  createMediaTicket,
  MEDIA_TICKET_TTL_MS,
  verifyMediaTicket,
} from "../lib/http/media-ticket.ts";

const now = 2_000_000_000_000;
const trackId = "1234567890abcdef1234567890abcdef";
const secret = "a-local-test-secret-that-is-long-enough";

function ticket(overrides = {}) {
  return {
    version: 1,
    trackId,
    objectKey: `tracks/user_123/${trackId}`,
    bytes: 1_048_576,
    mimeType: "audio/mpeg",
    expiresAt: now + MEDIA_TICKET_TTL_MS,
    ...overrides,
  };
}

test("a valid media ticket carries immutable R2 metadata without a database read", async () => {
  const token = await createMediaTicket(ticket(), secret);
  assert.deepEqual(await verifyMediaTicket(token, trackId, secret, now), ticket());
});

test("tampered and cross-track media tickets are rejected", async () => {
  const token = await createMediaTicket(ticket(), secret);
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assert.equal(await verifyMediaTicket(tampered, trackId, secret, now), null);
  assert.equal(
    await verifyMediaTicket(token, "abcdef1234567890abcdef1234567890", secret, now),
    null,
  );
});

test("expired media tickets are rejected", async () => {
  const token = await createMediaTicket(ticket({ expiresAt: now - 1 }), secret);
  assert.equal(await verifyMediaTicket(token, trackId, secret, now), null);
});
