import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import process from "node:process";

if (process.argv.length > 2) {
  throw new Error(
    "Changesets chooses the version. Run npm run changeset to select a bump; use npm run alpha to enter prerelease mode.",
  );
}
const current = JSON.parse(readFileSync("package.json")).version;
const pending = readdirSync(".changeset").filter(
  (file) =>
    file.endsWith(".md") &&
    !/^(README|AGENTS|CLAUDE|GEMINI)\.md$/i.test(file) &&
    !file.startsWith("."),
);
const pre = existsSync(".changeset/pre.json")
  ? JSON.parse(readFileSync(".changeset/pre.json"))
  : undefined;
if (pending.length === 0 && pre?.mode !== "exit") {
  if (!process.stdin.isTTY)
    throw new Error(
      "No pending release notes. Run npm run changeset before releasing noninteractively.",
    );
  console.log(
    "No pending release notes. Describe this release and choose its version bump:",
  );
  execFileSync("npm", ["run", "changeset"], { stdio: "inherit" });
}
execFileSync("npm", ["run", "version-packages"], { stdio: "inherit" });
if (JSON.parse(readFileSync("package.json")).version === current) {
  throw new Error(
    "No version bump was produced. Add a changeset for convex-helpers before releasing.",
  );
}
