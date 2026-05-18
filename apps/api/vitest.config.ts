import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@medspa/shared": resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
