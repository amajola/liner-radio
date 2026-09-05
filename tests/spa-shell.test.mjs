import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const wrangler = JSON.parse(
  (await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8")).replace(
    /^\s*\/\/.*$/gm,
    "",
  ),
);

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
  assert.equal(wrangler.assets.not_found_handling, "single-page-application");
  assert.deepEqual(wrangler.assets.run_worker_first, ["/api/*"]);
  assert.ok(wrangler.d1_databases.some((database) => database.binding === "DB"));
});

test("the deploy config binds the resources the Worker actually reads", () => {
  // env.DB and env.TRACKS are what worker/env.ts declares; a duplicate binding
  // pointing at the same resource under a different name silently leaves the
  // real one on a placeholder.
  const d1 = wrangler.d1_databases.filter((database) => database.binding === "DB");
  const r2 = wrangler.r2_buckets.filter((bucket) => bucket.binding === "TRACKS");
  assert.equal(d1.length, 1, "expected exactly one D1 binding named DB");
  assert.equal(r2.length, 1, "expected exactly one R2 binding named TRACKS");

  assert.equal(d1[0].migrations_dir, "drizzle");
  assert.notEqual(
    d1[0].database_id,
    "00000000-0000-4000-8000-000000000000",
    "database_id is still the placeholder, so a deploy would bind to nothing",
  );
  assert.match(d1[0].database_id, /^[0-9a-f-]{36}$/);
});
