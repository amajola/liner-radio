import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const modal = await read("../src/shared/components/Modal.tsx");
const addMusic = await read("../src/features/music/components/AddMusicModal.tsx");
const sidePanel = await read("../src/features/radio/components/SidePanel.tsx");

test("the focus trap does not re-run when a caller re-renders", () => {
  // Callers pass an inline arrow for onClose, so a new identity arrives on
  // every parent render. Depending on it tore the trap down mid-keystroke:
  // the cleanup moved focus out of the dialog and the re-run put it on the
  // close button, which destroyed the caret and any selection.
  assert.match(sidePanel, /onClose=\{\(\) =>/);
  assert.match(modal, /\}, \[focusables, open, requestClose\]\);/);
  assert.doesNotMatch(modal, /\[focusables, onClose, open\]/);
});

test("the latest onClose is read through a ref rather than a dependency", () => {
  assert.match(modal, /const onCloseRef = useRef\(onClose\);/);
  assert.match(modal, /onCloseRef\.current = onClose;/);
  assert.match(modal, /const requestClose = useCallback\([\s\S]*?\, \[\]\);/);
});

test("no key other than Escape and Tab is intercepted", () => {
  // Text navigation, selection and clipboard shortcuts have to reach the input
  // untouched, so the handler must bail before touching anything else.
  assert.match(modal, /if \(event\.key !== "Tab"\) return;/);
  const prevented = modal.match(/event\.preventDefault\(\)/g) ?? [];
  // Only the three Tab-cycling branches prevent a default.
  assert.equal(prevented.length, 3);
});

test("every close path is guarded, and submitting is not", () => {
  for (const path of [
    /onPointerDown=\{\(event\) => \{[\s\S]*?requestClose\(\)/, // backdrop
    /onClick=\{requestClose\}/, // header close button
  ]) {
    assert.match(modal, path);
  }
  // Escape asks the same question rather than closing outright.
  assert.match(modal, /if \(confirmPanel\.current\) setQuestion\(null\);\s*\n\s*else requestClose\(\);/);
  // A successful submit calls onClose directly and is never questioned.
  assert.match(addMusic, /confirmClose=\{\(\) =>/);
});

test("Escape dismisses the question instead of answering it", () => {
  // Pressing Escape twice must never discard work by accident.
  const escapeBranch = modal.slice(modal.indexOf('event.key === "Escape"'));
  const beforeTab = escapeBranch.slice(0, escapeBranch.indexOf('event.key !== "Tab"'));
  assert.match(beforeTab, /setQuestion\(null\)/);
  assert.doesNotMatch(beforeTab, /onCloseRef\.current\(\)/);
});

test("the confirmation only appears when there is work to lose", () => {
  assert.match(addMusic, /items\.length\s*\n?\s*\?\s*`Discard \$\{items\.length\}/);
  assert.match(addMusic, /:\s*null/);
});

test("the confirmation takes over the focus trap while it is up", () => {
  // Tab must cycle inside the question, not through the form behind it.
  assert.match(modal, /\(confirmPanel\.current \?\? surface\.current\)\?\.querySelectorAll/);
  assert.match(modal, /if \(question\) keepEditing\.current\?\.focus\(\);/);
});

test("a reopened dialog does not still hold the last question", () => {
  assert.match(modal, /if \(!open\) setQuestion\(null\);/);
});
