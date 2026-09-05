import { betterAuth } from "better-auth";

// Schema-generation configuration. Runtime configuration lives in worker/auth.ts
// because Cloudflare bindings are supplied to the Worker at request time.
export const auth = betterAuth({
  emailAndPassword: {
    enabled: true,
  },
  account: {
    identityStrategy: "provider-id",
  },
});
