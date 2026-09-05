import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const modal = await read("../src/shared/components/Modal.tsx");
const sidePanel = await read("../src/features/radio/components/SidePanel.tsx");
const nowPanel = await read("../src/features/radio/components/NowPanel.tsx");
const mixerModal = await read("../src/features/radio/components/MixerModal.tsx");
const audioConnection = await read("../src/features/radio/components/AudioConnection.tsx");
const uploadModal = await read("../src/features/music/components/UploadTrackModal.tsx");
const quickView = await read("../src/features/music/components/LibraryQuickView.tsx");
const peoplePanel = await read("../src/features/radio/components/PeoplePanel.tsx");

test("the host adds music directly and is never offered a request flow", () => {
  assert.match(sidePanel, /isHost \? "enqueue" : "request"/);
  assert.match(sidePanel, /isHost \? "Add to queue" : "Request"/);
  assert.doesNotMatch(sidePanel, /Make a request/i);
  assert.doesNotMatch(nowPanel, /Make a request/i);
});

test("uploading happens in a modal, never inline in a column", () => {
  assert.match(uploadModal, /<Modal/);
  assert.match(sidePanel, /<UploadTrackModal/);
  assert.match(quickView, /onUpload/);
  // The quick view offers a shallow list plus a way into the full catalogue.
  assert.match(quickView, /QUICK_LIMIT/);
  assert.match(quickView, /onBrowse/);
});

test("a dropped audio file opens the upload dialog with the file already chosen", () => {
  assert.match(quickView, /onDrop=/);
  assert.match(quickView, /dataTransfer\.files/);
  assert.match(uploadModal, /onDrop=/);
  assert.match(uploadModal, /item\.type\.startsWith\("audio\/"\)/);
  assert.match(uploadModal, /initialFile/);
  // A dropped file lives in state, so a required file input would wedge the form.
  assert.doesNotMatch(uploadModal, /accept=\{ACCEPTED_AUDIO\}[\s\S]{0,120}required/);
});

test("people are a quick strip with the full roster behind a modal", () => {
  assert.match(peoplePanel, /export function PeopleQuickView/);
  assert.match(peoplePanel, /export function PeopleModal/);
  assert.match(peoplePanel, /person-chip/);
  assert.match(sidePanel, /<PeopleQuickView/);
  assert.match(sidePanel, /<PeopleModal/);
});

test("now playing carries transport only, with fine control behind the mixer", () => {
  assert.match(nowPanel, /openMixer/);
  assert.match(nowPanel, /progress-rail/);
  assert.doesNotMatch(nowPanel, /HostMixer/);
  assert.doesNotMatch(nowPanel, /crossfade/i);
  assert.doesNotMatch(nowPanel, /station-volume/);
  // Volume, crossfade, ducking and per-device playback all live in the modal.
  for (const control of ["station-volume", "crossfade-duration", "duck-button", "local-controls"]) {
    assert.match(mixerModal, new RegExp(control));
  }
});

test("audio connection has explicit, non-repeatable progress and recovery states", () => {
  assert.match(audioConnection, /aria-live="polite"/);
  assert.match(audioConnection, /disabled=\{connecting\}/);
  for (const label of ["Connecting audio", "You’re tuned in", "One tap to hear the room", "Audio didn’t connect", "Try again"]) {
    assert.match(audioConnection, new RegExp(label));
  }
});

test("the dialog is reachable and dismissible without a mouse", () => {
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-labelledby=\{titleId\}/);
  assert.match(modal, /event\.key === "Escape"/);
  assert.match(modal, /event\.key !== "Tab"/);
  assert.match(modal, /restoreFocus\.current\?\.focus/);
});

test("a closed dialog unmounts instead of waiting on an exit animation", () => {
  assert.match(modal, /if \(!open\) return null;/);
  assert.doesNotMatch(modal, /import \{[^}]*AnimatePresence[^}]*\} from "motion\/react"/);
  assert.doesNotMatch(modal, /<AnimatePresence/);
});
