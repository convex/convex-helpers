import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const args = process.argv.slice(2);
const bump = args[0] ?? "patch";
if (args.length > 1 || !["patch", "minor", "major", "alpha"].includes(bump)) {
  throw new Error(
    "Usage: npm run release -- [patch|minor|major|alpha] [--watch]",
  );
}
execFileSync(
  "npm",
  [
    "version",
    bump === "alpha" ? "prerelease" : bump,
    ...(bump === "alpha" ? ["--preid=alpha"] : []),
    "--git-tag-version=false",
  ],
  { stdio: "inherit" },
);
const { version } = JSON.parse(readFileSync("package.json"));
let changelog = readFileSync("CHANGELOG.md", "utf8");
changelog = /^## Unreleased$/m.test(changelog)
  ? changelog.replace(/^## Unreleased$/m, `## ${version}`)
  : changelog.replace(
      /^(# .*\n)/,
      `$1\n## ${version}\n\n- Describe this release.\n`,
    );
writeFileSync("CHANGELOG.md", changelog);
// GIT_EDITOR/VISUAL/EDITOR are intentionally shell commands, as with git commit.
const editor = execFileSync("git", ["var", "GIT_EDITOR"], {
  encoding: "utf8",
}).trim();
execFileSync("sh", ["-c", `${editor} CHANGELOG.md`], { stdio: "inherit" });
execFileSync(
  "npm",
  [
    "exec",
    "--",
    "prettier",
    "--write",
    "CHANGELOG.md",
    "package.json",
    "package-lock.json",
  ],
  { stdio: "inherit" },
);
