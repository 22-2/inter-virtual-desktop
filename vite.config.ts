import macros from "unplugin-parcel-macros";
import optimizeLocales from "@react-aria/optimize-locales-plugin";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [
    macros.vite(),
    react(),
    optimizeLocales.vite({ locales: ["en", "ja"] }),
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: ["es2022"],
    cssMinify: "lightningcss",
  },
});
