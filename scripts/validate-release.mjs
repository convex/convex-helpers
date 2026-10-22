import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json"));
const lock = JSON.parse(readFileSync("package-lock.json"));
const changelog = readFileSync("CHANGELOG.md", "utf8");
if (lock.version !== pkg.version || lock.packages[""].version !== pkg.version) {
  throw new Error("Package and lockfile versions must agree.");
}
if (
  !changelog.split("\n").includes(`## ${pkg.version}`) ||
  changelog.includes("- Describe this release.")
) {
  throw new Error(
    `Add release notes under ## ${pkg.version} in CHANGELOG.md before releasing.`,
  );
}
