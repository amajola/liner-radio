import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIO_EXTENSION_PATTERN,
  looksLikeAudio,
  resolveAudioType,
} from "../lib/http/audio-types.ts";

test("vendor spellings resolve to one canonical type per container", () => {
  // macOS Chrome reports .m4a this way, which the strict allowlist rejected
  // even though the file picker had already accepted the file.
  assert.equal(resolveAudioType("audio/x-m4a", "set.m4a"), "audio/mp4");
  assert.equal(resolveAudioType("video/mp4", "set.m4a"), "audio/mp4");
  assert.equal(resolveAudioType("audio/x-wav", "take.wav"), "audio/wav");
  assert.equal(resolveAudioType("audio/vnd.wave", "take.wav"), "audio/wav");
  assert.equal(resolveAudioType("audio/x-flac", "master.flac"), "audio/flac");
  assert.equal(resolveAudioType("audio/mp3", "tune.mp3"), "audio/mpeg");
  assert.equal(resolveAudioType("application/ogg", "live.ogg"), "audio/ogg");
});

test("a file the operating system could not type is accepted on its extension", () => {
  assert.equal(resolveAudioType("", "boiler-room-set.flac"), "audio/flac");
  assert.equal(resolveAudioType("", "tiny-desk.m4a"), "audio/mp4");
  assert.equal(resolveAudioType("", "SHOUTING.WAV"), "audio/wav");
});

test("a recognised type still resolves when the name carries no extension", () => {
  assert.equal(resolveAudioType("audio/mpeg", "recording"), "audio/mpeg");
  assert.equal(resolveAudioType("audio/flac", ""), "audio/flac");
});

test("the extension decides when the two signals disagree", () => {
  // The container is what playback has to honour, and the extension names it
  // directly where File.type is only the operating system's guess.
  assert.equal(resolveAudioType("audio/mpeg", "actually-a-flac.flac"), "audio/flac");
});

test("non-audio is refused from both signals", () => {
  assert.equal(resolveAudioType("application/pdf", "sleeve-notes.pdf"), null);
  assert.equal(resolveAudioType("", "artwork.png"), null);
  assert.equal(resolveAudioType("", ""), null);
  assert.equal(resolveAudioType("video/quicktime", "clip.mov"), null);
});

test("every resolved type is one the media ticket will carry", () => {
  // isTicket() requires an audio/* mime type, so a container that resolved to
  // anything else would upload cleanly and then fail playback.
  for (const name of ["a.mp3", "a.m4a", "a.wav", "a.flac", "a.ogg", "a.opus", "a.webm"]) {
    const resolved = resolveAudioType("", name);
    assert.ok(resolved?.startsWith("audio/"), `${name} resolved to ${resolved}`);
  }
});

test("the picker filter and the server agree on what is admissible", () => {
  assert.equal(looksLikeAudio({ type: "audio/x-m4a", name: "set.m4a" }), true);
  assert.equal(looksLikeAudio({ type: "", name: "set.flac" }), true);
  assert.equal(looksLikeAudio({ type: "image/png", name: "cover.png" }), false);
});

test("the extension pattern only matches at the end of the name", () => {
  assert.ok(AUDIO_EXTENSION_PATTERN.test("my.mp3"));
  assert.ok(!AUDIO_EXTENSION_PATTERN.test("mp3-rip.txt"));
});
