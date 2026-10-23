import { readFileSync } from "node:fs";

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
