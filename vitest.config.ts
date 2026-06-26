import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    // Only our unit tests — pure logic, no DB/network needed.
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
