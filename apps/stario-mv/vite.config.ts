import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// すたりおMV（γ）の開発サーバ。⚠️ **α（1420）と別のポート**＝両方を同時に起動できるようにする（ADR-0075 決定1）。
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    headers: { "Cache-Control": "no-store" },
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    environment: "node",
    testTimeout: 30_000,
  },
});
