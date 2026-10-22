import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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
  if (
    current.name !== "convex-helpers" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([a-zA-Z][a-zA-Z0-9-]*)(?:\.[a-zA-Z0-9-]+)*)?$/.test(
      current.version,
    )
  ) {
    throw new Error(`Invalid release version or package at ${sha}`);
  }
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
    distTag: current.version.includes("-")
      ? current.version.split("-").slice(1).join("-").split(".")[0]
      : "latest",
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
