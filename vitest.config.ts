import { defineConfig } from "vitest/config";

export default defineConfig({
  ssr: {
    external: ["bun:sqlite"],
  },
  optimizeDeps: {
    exclude: ["bun:sqlite"],
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    pool: "forks",
    server: {
      deps: { external: [/^bun:/] },
    },
  },
});
