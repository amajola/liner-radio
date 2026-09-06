import { createAuth } from "./auth";
import type { Env } from "./env";
import { RequestFailure } from "./http";

const maximumImageBytes = 3 * 1024 * 1024;
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function fail(message: string, status = 400): never {
  throw new RequestFailure({ message, status });
}

function objectKey(userId: string) {
  return `profiles/${encodeURIComponent(userId)}`;
}

function hasValidSignature(type: string, bytes: Uint8Array) {
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") {
    return bytes.slice(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index]);
  }
  return (
    type === "image/webp" &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  );
}

async function uploadProfileImage(request: Request, env: Env) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    fail("Request origin rejected.", 403);
  }
  if (Number(request.headers.get("content-length") || 0) > maximumImageBytes + 50_000) {
    fail("Profile pictures can be up to 3 MB.", 413);
  }

  const session = await createAuth(request, env).api.getSession({ headers: request.headers });
  if (!session) fail("Sign in to edit your profile.", 401);
  const form = await request.formData();
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) fail("Choose a profile picture.");
  if (file.size > maximumImageBytes) fail("Profile pictures can be up to 3 MB.", 413);
  if (!imageTypes.has(file.type)) fail("Choose a JPEG, PNG, or WebP image.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasValidSignature(file.type, bytes)) fail("That file is not a valid image.");

  const key = objectKey(session.user.id);
  await env.TRACKS.put(key, bytes, {
    httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000" },
  });
  const image = `/api/profile-images/${encodeURIComponent(session.user.id)}?v=${Date.now()}`;
  await createAuth(request, env).api.updateUser({
    body: { image },
    headers: request.headers,
  });
  return Response.json({ image }, { headers: { "Cache-Control": "no-store" } });
}

async function removeProfileImage(request: Request, env: Env) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    fail("Request origin rejected.", 403);
  }
  const session = await createAuth(request, env).api.getSession({ headers: request.headers });
  if (!session) fail("Sign in to edit your profile.", 401);
  await env.TRACKS.delete(objectKey(session.user.id));
  await createAuth(request, env).api.updateUser({
    body: { image: null },
    headers: request.headers,
  });
  return Response.json({ image: null }, { headers: { "Cache-Control": "no-store" } });
}

async function readProfileImage(request: Request, env: Env, encodedUserId: string) {
  let userId: string;
  try {
    userId = decodeURIComponent(encodedUserId);
  } catch {
    fail("Invalid profile image.");
  }
  if (!userId || userId.length > 180 || userId.includes("/")) fail("Invalid profile image.");
  const object = await env.TRACKS.get(objectKey(userId));
  if (!object) fail("Profile image not found.", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  if (request.headers.get("if-none-match") === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { headers });
}

export async function handleProfileRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/profile/image" && request.method === "POST") {
    return uploadProfileImage(request, env);
  }
  if (url.pathname === "/api/profile/image" && request.method === "DELETE") {
    return removeProfileImage(request, env);
  }
  const match = url.pathname.match(/^\/api\/profile-images\/([^/]+)$/);
  if (match && request.method === "GET") return readProfileImage(request, env, match[1]);
  return null;
}
