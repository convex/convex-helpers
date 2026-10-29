// Typechecks the root project once for each tested Zod version (see
// scripts/zodVersions.mjs), with all `zod` imports resolving to that version.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  zodExcludedTestFiles,
  zodKnownTypecheckFailures,
  zodVersionAliases,
} from "./zodVersions.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const configDir = path.join(root, "node_modules/.cache/zod-typecheck");
const tsc = path.join(root, "node_modules/.bin/tsc");
mkdirSync(configDir, { recursive: true });

// If an alias isn't installed, the `paths` mapping silently falls back to the
// root `zod`, so the version would pass without being tested.
const missingAliases = zodVersionAliases.filter(
  (alias) =>
    !existsSync(path.join(root, "node_modules", alias, "package.json")),
);
if (missingAliases.length > 0) {
  console.error(
    `Missing Zod versions in node_modules: ${missingAliases.join(", ")}. Run \`npm install\`.`,
  );
  process.exit(1);
}

const results = [];
for (const alias of zodVersionAliases) {
  const zodDir = path.join(root, "node_modules", alias);
  const configPath = path.join(configDir, `tsconfig.${alias}.json`);
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        extends: path.join(root, "tsconfig.json"),
        compilerOptions: {
          paths: { zod: [zodDir], "zod/*": [path.join(zodDir, "*")] },
        },
        // Only the helpers' tests (and the helpers they import). The examples
        // in convex/ and example-ui/ are typechecked with the default `zod`.
        include: [path.join(root, "packages/convex-helpers/**/*.test.ts")],
        exclude: [
          path.join(root, "**/dist/**"),
          ...zodExcludedTestFiles(alias).map((file) =>
            path.join(root, "packages/convex-helpers", file),
          ),
        ],
      },
      null,
      2,
    ),
  );

  console.log(`\nTypechecking with ${alias}…`);
  const { status } = spawnSync(tsc, ["--noEmit", "-p", configPath], {
    stdio: "inherit",
  });
  results.push({ alias, ok: status === 0 });
}

console.log();
let failed = false;
for (const { alias, ok } of results) {
  const knownFailure = zodKnownTypecheckFailures[alias];
  if (knownFailure === undefined) {
    console.log(`${ok ? "✅" : "❌"} ${alias}`);
    failed ||= !ok;
  } else if (!ok) {
    console.log(`⚠️  ${alias} (known failure: ${knownFailure})`);
  } else {
    console.log(
      `❌ ${alias} passes: remove it from zodKnownTypecheckFailures in scripts/zodVersions.mjs`,
    );
    failed = true;
  }
}
if (failed) {
  process.exit(1);
}
