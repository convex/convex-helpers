import * as zCore from "zod/v4/core";
import { expect, test } from "vitest";
import { expectedZodAlias } from "../test/zodVersion";

const alias = expectedZodAlias();

test.skipIf(alias === undefined)("loads the Zod version of the project", () => {
  expect(`zod-${zCore.version.major}.${zCore.version.minor}`).toBe(alias);
});
