import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: import.meta.dirname,
  // Convex writes VITE_CONVEX_URL to .env.local at the repository root.
  envDir: fileURLToPath(new URL("..", import.meta.url)),
  plugins: [react()],
  test: {
    name: "example-ui",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    globals: true,
  },
});
