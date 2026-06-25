import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // 開発時はブラウザにモジュール/HTML をキャッシュさせない（プレビューが古いバンドルを掴む stale を防ぐ）。
    // dev サーバー専用の設定で、本番ビルド（tauri build）には影響しない。
    headers: { "Cache-Control": "no-store" },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Vitest 設定（ADR-0014）。
  // 既定 environment は node のまま（純粋ロジックの既存テストは従来どおり高速・無依存）。
  // DOM が要るコンポーネント/対話テスト（*.test.tsx）は、各ファイル先頭の
  // `// @vitest-environment jsdom` で個別に jsdom へ切り替える（既存 node テストへ波及しない）。
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
  },
}));
