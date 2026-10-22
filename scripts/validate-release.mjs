import { existsSync, readFileSync, readdirSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json"));
const lock = JSON.parse(readFileSync("package-lock.json"));
const changelog = readFileSync("CHANGELOG.md", "utf8");
if (lock.version !== pkg.version || lock.packages[""].version !== pkg.version) {
  throw new Error("Package and lockfile versions must agree.");
}
const lines = changelog.split(/\r?\n/);
const heading = lines.indexOf(`## ${pkg.version}`);
const following = heading < 0 ? [] : lines.slice(heading + 1);
const end = following.findIndex((line) => /^#{1,2} /.test(line));
const releaseNotes = following
  .slice(0, end < 0 ? undefined : end)
  .join("\n")
  .trim();
if (!releaseNotes || releaseNotes.includes("- Describe this release.")) {
  throw new Error(
    `Add release notes under ## ${pkg.version} in CHANGELOG.md before releasing.`,
  );
}

// Changesets 3 moves consumed prerelease notes into .changeset/pre. Only those
// archived notes may remain during prerelease mode; fresh notes block staging.
const notes = (dir) =>
  existsSync(dir)
    ? readdirSync(dir).filter(
        (file) =>
          file.endsWith(".md") &&
          !/^(README|AGENTS|CLAUDE|GEMINI)\.md$/i.test(file) &&
          !file.startsWith("."),
      )
    : [];
const pending = notes(".changeset");
if (pending.length)
  throw new Error(
    `Release still has unconsumed changesets: ${pending.join(", ")}. Refresh the version and changelog before releasing.`,
  );
const pre = existsSync(".changeset/pre.json")
  ? JSON.parse(readFileSync(".changeset/pre.json"))
  : undefined;
if (pre && (pre.mode !== "pre" || !pkg.version.includes(`-${pre.tag}.`))) {
  throw new Error("Finish Changesets prerelease versioning before releasing.");
}
if (!pre && notes(".changeset/pre").length) {
  throw new Error(
    "Stable releases must consume archived prerelease notes too.",
  );
}
