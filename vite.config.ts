import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
  },
  // Alchemy injects its Cloudflare Vite plugin for dev and deployment.
  plugins: [react()],
});
