import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const run = (command, args, capture = false) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  })?.trim();
const git = (...args) => run("git", args, true);
const pkg = () =>
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));

function approvalUrl() {
  const result = spawnSync(
    "npm",
    [
      "whoami",
      "--registry=https://registry.npmjs.org",
      "--fetch-retries=0",
      "--fetch-timeout=3000",
    ],
    {
      cwd,
      encoding: "utf8",
      timeout: 5000,
    },
  );
  const username = result.status === 0 ? result.stdout.trim() : "";
  return username
    ? `https://www.npmjs.com/settings/${encodeURIComponent(username)}/staged-packages`
    : undefined;
}

async function watch(sha, approval) {
  // GitHub may take a few seconds to register the push workflow.
  let workflow;
  for (let attempt = 0; attempt < 12; attempt++) {
    const runs = JSON.parse(
      run(
        "gh",
        [
          "run",
          "list",
          "--repo",
          "convex/convex-helpers",
          "--workflow",
          "release.yml",
          "--commit",
          sha,
          "--event",
          "push",
          "--json",
          "databaseId,url",
        ],
        true,
      ),
    );
    workflow = runs[0];
    if (workflow) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (!workflow)
    throw new Error(
      "CI has not appeared yet. Use the printed commit link; do not create another release.",
    );
  console.log(`CI: ${workflow.url}`);
  run("gh", [
    "run",
    "watch",
    String(workflow.databaseId),
    "--repo",
    "convex/convex-helpers",
    "--exit-status",
  ]);
  if (approval) {
    console.log(`Staged. Approve with npm 2FA: ${approval}`);
    const opener =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "explorer.exe"
          : "xdg-open";
    // Opening a browser is a convenience; the printed link remains usable.
    spawnSync(opener, [approval], { stdio: "ignore" });
  }
}

try {
  const args = process.argv.slice(2);
  const watching = args.includes("--watch");
  const prepareArgs = args.filter((arg) => arg !== "--watch");
  if (watching) run("gh", ["auth", "status"]);
  if (git("status", "--porcelain"))
    throw new Error(
      "Git working directory not clean. Commit or stash your changes first.",
    );
  git("symbolic-ref", "--short", "HEAD");
  run("git", ["fetch", "origin", "main"]);
  git("merge-base", "--is-ancestor", "origin/main", "HEAD");
  const previous = pkg().version;
  run("npm", ["run", "release:check"]);
  run("npm", ["run", "release:prepare", "--", ...prepareArgs]);
  const version = pkg().version;
  if (previous === version)
    throw new Error("Release preparation did not change the package version.");
  run("npm", ["run", "release:validate"]);
  run("git", [
    "add",
    "--",
    "package.json",
    "package-lock.json",
    "CHANGELOG.md",
  ]);
  run("git", ["commit", "-m", `npm ${version}`]);
  const sha = git("rev-parse", "HEAD");
  console.log(
    `Release commit: ${sha}. If pushing fails, reconcile main and push this commit; do not bump again.`,
  );
  run("git", ["push", "origin", "HEAD:refs/heads/main"]);
  const approval = approvalUrl();
  console.log(`\nRelease commit pushed: ${pkg().name}@${version}`);
  console.log(
    `CI: https://github.com/convex/convex-helpers/commit/${sha}/checks`,
  );
  if (approval) console.log(`Approve: ${approval}`);
  else
    console.log(
      "Approve: sign in at https://www.npmjs.com and open Settings → Staged Packages. CI also prints the stage ID for npm stage approve <stage-id>.",
    );
  console.log(
    "CI stages this commit, then creates its Git tag. Approve the version on npm after staging completes.",
  );
  if (watching) await watch(sha, approval);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
