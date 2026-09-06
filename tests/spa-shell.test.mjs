import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const infrastructure = await readFile(
  new URL("../alchemy.run.ts", import.meta.url),
  "utf8",
);
const deployWorkflow = await readFile(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
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

test("routes requests through the Worker before the SPA asset fallback", () => {
  assert.match(infrastructure, /notFoundHandling:\s*"single-page-application"/);
  assert.match(infrastructure, /runWorkerFirst:\s*true/);
});

test("the deploy config binds the resources the Worker actually reads", () => {
  assert.match(infrastructure, /Cloudflare\.D1\.Database\("Database"/);
  assert.match(infrastructure, /migrations:\s*"\.\/drizzle"/);
  assert.match(infrastructure, /Cloudflare\.R2\.Bucket\("Tracks"/);
  assert.match(infrastructure, /DB:\s*database/);
  assert.match(infrastructure, /TRACKS:\s*tracks/);
  assert.match(infrastructure, /BETTER_AUTH_SECRET:\s*authSecret\.text/);
  assert.match(infrastructure, /BETTER_AUTH_URL:\s*Cloudflare\.Workers\.URL/);
});

test("production data is retained while non-production stages are disposable", () => {
  assert.match(infrastructure, /RemovalPolicy\.retain\(production\)/g);
  assert.match(infrastructure, /forceDestroy:\s*!production/);
  assert.match(infrastructure, /name:\s*production \? "liner-radio" : undefined/);
});

test("CI deploys prod and disposable pull-request stages", () => {
  assert.match(deployWorkflow, /branches:\s*\[main\]/);
  assert.doesNotMatch(deployWorkflow, /refs\/heads\/develop|development|'dev'/);
  assert.match(deployWorkflow, /format\('pr-\{0\}', github\.event\.number\)/);
  assert.match(deployWorkflow, /\|\| 'prod'/);
  assert.match(deployWorkflow, /alchemy deploy --stage/);
  assert.match(deployWorkflow, /alchemy destroy --stage/);
  assert.match(deployWorkflow, /--adopt/);
});
