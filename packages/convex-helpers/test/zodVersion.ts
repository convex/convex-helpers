// Helpers for tests that run against several Zod 4 versions
// (see scripts/zodVersions.mjs in the repository root).
import semver from "semver";
import { inject, test } from "vitest";
import * as zCore from "zod/v4/core";

declare module "vitest" {
  export interface ProvidedContext {
    /** The `zod-4.<minor>` alias the current Vitest project resolves `zod` to.
     * Undefined in the projects that use the default `zod` package. */
    expectedZodAlias?: string;
  }
}

/** The `zod-4.<minor>` alias of the current Vitest project, if any. */
export function expectedZodAlias(): string | undefined {
  return inject("expectedZodAlias");
}

const zodVersion = `${zCore.version.major}.${zCore.version.minor}.${zCore.version.patch}`;

/** Whether the Zod version running the tests is at least `version`.
 *
 * Use it to skip tests that rely on a newer Zod at runtime:
 * `describe.skipIf(!zodAtLeast("4.3"))(...)`. If the newer API is also missing
 * from the older versions' types, move the tests to their own file and add it
 * to `zodTestFileMinMinor` in scripts/zodVersions.mjs instead.
 */
export function zodAtLeast(version: string): boolean {
  return semver.satisfies(zodVersion, `>=${version}`);
}

/** `test`, or `test.fails` from Zod `version` on.
 *
 * Use it to mark a test that is known to fail on newer Zod versions, e.g.
 * `testFailingSinceZod("4.5")("…", () => { … })`. Like `test.fails`, the test
 * fails if it starts passing on these versions, so that the marker gets
 * removed.
 */
export function testFailingSinceZod(version: string): typeof test {
  return zodAtLeast(version) ? (test.fails as typeof test) : test;
}
