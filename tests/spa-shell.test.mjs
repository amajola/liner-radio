import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const wrangler = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");

test("locks the document to the viewport and scrolls content regions", () => {
  assert.match(css, /html,\s*\nbody,\s*\n#root\s*{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.app-shell\s*{[^}]*height:\s*100dvh[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.column-scroll\s*{[^}]*overflow:\s*auto/s);
  // The lobby is fixed to the viewport; only the lists inside it scroll.
  assert.match(css, /\.lobby\s*{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.lobby-panel-scroll[^{]*{[^}]*overflow:\s*auto/s);
  assert.doesNotMatch(css, /\.lobby-scroll/);
});

test("routes only API requests through Worker compute", () => {
  assert.match(wrangler, /"not_found_handling":\s*"single-page-application"/);
  assert.match(wrangler, /"run_worker_first":\s*\["\/api\/\*"\]/);
  assert.match(wrangler, /"binding":\s*"DB"/);
});
