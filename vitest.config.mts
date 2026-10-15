import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["example-ui", "packages/convex-helpers"],
  },
});
