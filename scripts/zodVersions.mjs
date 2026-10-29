// The Zod 4 versions the Zod helpers are tested against.
//
// Every `zod-4.<minor>` npm alias in the root package.json (e.g.
// `"zod-4.2": "npm:zod@~4.2.0"`) adds a Vitest project and a typecheck run
// where all `zod` imports resolve to that alias. To test a new version, add an
// alias and run `npm install`.
//
// For tests that depend on the Zod version (`zodAtLeast`, `testFailingSinceZod`),
// see packages/convex-helpers/test/zodVersion.ts.
import { readFileSync } from "node:fs";

const rootPackageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

/** The `zod-4.<minor>` aliases in the root package.json, oldest first. */
export const zodVersionAliases = Object.keys({
  ...rootPackageJson.dependencies,
  ...rootPackageJson.devDependencies,
})
  .filter((name) => /^zod-4\.\d+$/.test(name))
  .sort((a, b) => zodAliasMinor(a) - zodAliasMinor(b));

/** The test files that need a newer Zod than the oldest tested version.
 *
 * Maps a test file (relative to packages/convex-helpers) to the oldest Zod 4
 * minor it supports. Use this when a test relies on an API whose *types* don't
 * exist in older versions (runtime-only differences can use `zodAtLeast` from
 * `packages/convex-helpers/test/zodVersion.ts` instead). The file is excluded
 * from the Vitest projects and typecheck runs of older versions.
 *
 * @type {Record<string, number>}
 */
export const zodTestFileMinMinor = {
  "server/zod4.functions.zod41.test.ts": 1,
  "server/zod4.zodtoconvex.zod41.test.ts": 1,
  "server/zod4.zodtoconvex.mini.zod41.test.ts": 1,
};

/** The Zod versions that are known to fail `npm run typecheck:zod`, with why.
 *
 * Their failures are reported but don't fail the typecheck. Once a version
 * passes, the typecheck fails until it is removed from this list.
 *
 * @type {Record<string, string>}
 */
export const zodKnownTypecheckFailures = {
  "zod-4.0":
    "With zod/mini, branded objects get an extra `[$brand]` key in their inferred type",
  "zod-4.1":
    "With zod/mini, branded objects get an extra `[$brand]` key in their inferred type",
  "zod-4.2":
    "With zod/mini, branded objects get an extra `[$brand]` key in their inferred type",
  "zod-4.6":
    "`z.instanceof()` returns `ZodInstanceOf`, which doesn't match the commitTs type of `ZodValidatorFromConvex`",
};

/** @param {string} alias e.g. `zod-4.2` */
export function zodAliasMinor(alias) {
  return Number(alias.slice("zod-4.".length));
}

/** The test files to skip for a given alias. @param {string} alias */
export function zodExcludedTestFiles(alias) {
  return Object.entries(zodTestFileMinMinor)
    .filter(([, minMinor]) => zodAliasMinor(alias) < minMinor)
    .map(([file]) => file);
}
