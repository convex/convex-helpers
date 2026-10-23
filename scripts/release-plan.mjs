import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import semver from "semver";

const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const manifest = (sha) => JSON.parse(git("show", `${sha}:package.json`));

export function releaseAt(sha) {
  const current = manifest(sha);
  const previous = manifest(`${sha}^1`);
  if (!previous.version || previous.version === current.version)
    return undefined;
  const version = semver.parse(current.version);
  // npm's parser accepts a leading v and whitespace; package versions must be
  // canonical, including any build metadata.
  const canonical =
    version &&
    version.version +
      (version.build.length ? `+${version.build.join(".")}` : "");
  if (
    !version ||
    current.name !== "convex-helpers" ||
    current.version !== canonical
  ) {
    throw new Error(`Invalid release version or package at ${sha}`);
  }
  const prerelease = version.prerelease[0];
  // npm rejects dist-tags that are version ranges (e.g. 1, v1, or x).
  const distTag =
    prerelease === undefined
      ? "latest"
      : semver.validRange(String(prerelease))
        ? "next"
        : String(prerelease);
  const tag = `refs/tags/npm/${current.version}`;
  // Only a missing ref is ignored; never move a tag to another commit.
  const exists = execFileSync(
    "git",
    ["tag", "--list", `npm/${current.version}`],
    { encoding: "utf8" },
  ).trim();
  if (exists && git("rev-parse", `${tag}^{commit}`) !== sha)
    throw new Error(`${tag} already identifies a different commit`);
  return {
    sha,
    version: current.version,
    distTag,
  };
}

export function releasePlan(before, after) {
  if (!/^[a-f0-9]{40}$/.test(before) || !/^[a-f0-9]{40}$/.test(after))
    throw new Error("Expected full Git commit SHAs");
  git("merge-base", "--is-ancestor", before, after);
  // A push can contain a release commit followed by ordinary commits, or several releases.
  return git("rev-list", "--first-parent", "--reverse", `${before}..${after}`)
    .split("\n")
    .filter(Boolean)
    .map(releaseAt)
    .filter(Boolean);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const requested = process.env.RELEASE_COMMIT;
  let releases;
  if (requested) {
    if (!/^[a-f0-9]{40}$/.test(requested))
      throw new Error("Use the full SHA of a version-bump commit on main");
    git("merge-base", "--is-ancestor", requested, "origin/main");
    const release = releaseAt(requested);
    if (!release) throw new Error("This commit does not bump the version");
    releases = [release];
  } else {
    releases = releasePlan(process.env.BEFORE, process.env.GITHUB_SHA);
  }
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `releases=${JSON.stringify(releases)}\n`,
  );
}
