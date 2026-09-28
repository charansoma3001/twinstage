import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["web/test/**/*.test.js", "server/test/**/*.test.js"] }
});
