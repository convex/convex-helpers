import { defineConfig } from "vitest/config";
import {
  zodExcludedTestFiles,
  zodVersionAliases,
} from "./scripts/zodVersions.mjs";

// The test files that import Zod, relative to packages/convex-helpers.
const zodTestFiles = ["server/zod*.test.ts", "standardSchema.test.ts"];

export default defineConfig({
  test: {
    projects: [
      "example-ui",
      "packages/convex-helpers",
      // Runs the Zod tests again for each tested Zod version (see
      // scripts/zodVersions.mjs), with `zod` resolving to that version both in
      // the tests and in the helpers they import.
      ...zodVersionAliases.map((alias) => ({
        extends: "./packages/convex-helpers/vitest.config.mts",
        resolve: {
          alias: [{ find: /^zod(?=\/|$)/, replacement: alias }],
        },
        test: {
          name: alias,
          root: "./packages/convex-helpers",
          include: zodTestFiles,
          exclude: [
            "**/node_modules/**",
            "dist/**",
            ...zodExcludedTestFiles(alias),
          ],
          provide: { expectedZodAlias: alias },
          // Bundle zod-compare so that its own `zod` imports use the alias too.
          server: { deps: { inline: ["zod-compare"] } },
        },
      })),
    ],
  },
});
