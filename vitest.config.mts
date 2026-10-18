import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // server-only throws outside a React Server Components build.
      "server-only": fileURLToPath(new URL("./test/empty-module.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup-env.ts"],
    // Tests share one database; run files one at a time.
    fileParallelism: false,
  },
});
