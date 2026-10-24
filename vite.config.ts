import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],
  // src を `@/` で参照する (テストから `@/lib/...` のように使う)
  resolve: {
    alias: { "@": "/src" },
  },

  // エディタ (CodeMirror) とコードの色付け (highlight.js) で, 1 つのファイルが大きくなる (アプリの中から読むので, 分けない)
  build: { chunkSizeWarningLimit: 2000 },

  // 単体テスト (tests/ に, src/ と同じ構成で置く): ブラウザの DOM は, jsdom で代わりにする. カバレッジは src/lib の行と分岐が 100%
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
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
}));
