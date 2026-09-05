import assert from "node:assert/strict";
import test, { after } from "node:test";
import { makeHttpHandler } from "../worker/http.ts";

const effectServer = makeHttpHandler({}, async (request) =>
  Response.json({ path: new URL(request.url).pathname }),
);

after(async () => effectServer.dispose());

test("Effect HttpServer adapts Fetch requests and responses", async () => {
  const response = await effectServer.handler(new Request("http://localhost/api/health"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { path: "/api/health" });
});

test("Effect HttpServer returns a real 404 outside its API router", async () => {
  const response = await effectServer.handler(new Request("http://localhost/not-an-api"));
  assert.equal(response.status, 404);
});
