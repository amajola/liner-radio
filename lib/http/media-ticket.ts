const encoder = new TextEncoder();

export const MEDIA_TICKET_TTL_MS = 6 * 60 * 60 * 1_000;

export type MediaTicket = {
  readonly version: 1;
  readonly trackId: string;
  readonly objectKey: string;
  readonly bytes: number;
  readonly mimeType: string;
  readonly expiresAt: number;
};

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`liner-radio-media-ticket-v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function isTicket(value: unknown, expectedTrackId: string, now: number): value is MediaTicket {
  if (!value || typeof value !== "object") return false;
  const ticket = value as Partial<MediaTicket>;
  return (
    ticket.version === 1 &&
    ticket.trackId === expectedTrackId &&
    /^[a-f0-9]{32}$/.test(ticket.trackId) &&
    typeof ticket.objectKey === "string" &&
    ticket.objectKey.startsWith("tracks/") &&
    ticket.objectKey.endsWith(`/${ticket.trackId}`) &&
    !ticket.objectKey.includes("..") &&
    ticket.objectKey.length <= 320 &&
    typeof ticket.bytes === "number" &&
    Number.isSafeInteger(ticket.bytes) &&
    ticket.bytes > 0 &&
    ticket.bytes <= 30 * 1024 * 1024 &&
    typeof ticket.mimeType === "string" &&
    ticket.mimeType.startsWith("audio/") &&
    typeof ticket.expiresAt === "number" &&
    Number.isSafeInteger(ticket.expiresAt) &&
    ticket.expiresAt > now &&
    ticket.expiresAt <= now + MEDIA_TICKET_TTL_MS + 60_000
  );
}

export async function createMediaTicket(
  ticket: MediaTicket,
  secret: string,
): Promise<string> {
  const payload = encodeBase64Url(encoder.encode(JSON.stringify(ticket)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    encoder.encode(payload),
  );
  return `${payload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyMediaTicket(
  token: string,
  expectedTrackId: string,
  secret: string,
  now = Date.now(),
): Promise<MediaTicket | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(secret),
      decodeBase64Url(parts[1]),
      encoder.encode(parts[0]),
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]))) as unknown;
    return isTicket(payload, expectedTrackId, now) ? payload : null;
  } catch {
    return null;
  }
}
