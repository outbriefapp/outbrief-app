import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri dev on a phone reaches the dev server through TAURI_DEV_HOST.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    // Not Tauri's default 1420: other local Tauri apps (lumivo) use it, and their dev scripts kill
    // whatever holds it. Keep in sync with build.devUrl in src-tauri/tauri.conf.json.
    port: 1520,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1521 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
});
