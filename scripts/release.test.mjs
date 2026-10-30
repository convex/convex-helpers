import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const rootPkg = JSON.parse(readFileSync(path.join(root, "package.json")));

function fixture(t) {
  const temp = mkdtempSync(path.join(tmpdir(), "helpers-release-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const cwd = path.join(temp, "repo");
  const remote = path.join(temp, "remote.git");
  const bin = path.join(temp, "bin");
  mkdirSync(cwd);
  mkdirSync(bin);
  cpSync(path.join(root, "scripts"), path.join(cwd, "scripts"), {
    recursive: true,
  });
  symlinkSync(
    path.join(root, "node_modules"),
    path.join(cwd, "node_modules"),
    "dir",
  );
  const write = (file, content) => writeFileSync(path.join(cwd, file), content);
  const executable = (file, content) => {
    writeFileSync(file, content);
    chmodSync(file, 0o755);
  };
  const npmCli = process.env.npm_execpath;
  assert(npmCli, "Run these tests with npm run test:release");
  executable(
    path.join(bin, "npm"),
    `#!/bin/sh\nif [ "$1" = whoami ]; then echo release-tester; else exec "${process.execPath}" "${npmCli}" "$@"; fi\n`,
  );
  executable(
    path.join(bin, "editor"),
    `#!${process.execPath}\nconst fs = require('node:fs'); const p = process.argv[2]; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('- Describe this release.', '- Release note.'));\n`,
  );
  const pkg = {
    name: "convex-helpers",
    version: "0.1.128",
    type: "module",
    scripts: { ...rootPkg.scripts, "release:check": 'node -e ""' },
  };
  write("package.json", JSON.stringify(pkg, null, 2) + "\n");
  write(
    "package-lock.json",
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        lockfileVersion: 3,
        packages: { "": { name: pkg.name, version: pkg.version } },
      },
      null,
      2,
    ) + "\n",
  );
  write("CHANGELOG.md", "# Changelog\n\n## 0.1.128\n\n- Existing history.\n");
  write(".gitignore", "node_modules\n");
  const options = {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      GIT_EDITOR: "editor",
      npm_config_offline: "true",
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
  };
  const run = (cmd, args) => execFileSync(cmd, args, options).trim();
  const git = (...args) => run("git", args);
  git("init", "--quiet", "--initial-branch=release-test");
  git("config", "user.name", "Release test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  git("init", "--quiet", "--bare", remote);
  git("remote", "add", "origin", remote);
  const commit = () => {
    git("add", ".");
    git("commit", "--quiet", "-m", "fixture");
    return git("rev-parse", "HEAD");
  };
  const initial = commit();
  git("branch", "main");
  git("push", "--quiet", "origin", "HEAD:main");
  const release = (args = []) =>
    spawnSync("npm", ["run", "release", "--", ...args], options);
  const version = () =>
    JSON.parse(readFileSync(path.join(cwd, "package.json"))).version;
  const assertReleased = (expected, args) => {
    const result = release(args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(version(), expected);
    const lock = JSON.parse(readFileSync(path.join(cwd, "package-lock.json")));
    assert.equal(lock.version, expected);
    assert.equal(lock.packages[""].version, expected);
    const changelog = readFileSync(path.join(cwd, "CHANGELOG.md"), "utf8");
    assert(changelog.includes(`## ${expected}`));
    assert(changelog.includes("Existing history."));
    assert.equal(git("status", "--porcelain"), "");
    assert.equal(
      git("tag"),
      "",
      "CI owns tagging, never the local release command",
    );
    assert.equal(git("--git-dir", remote, "tag"), "");
    assert.equal(
      git("--git-dir", remote, "rev-parse", "refs/heads/main"),
      git("rev-parse", "HEAD"),
    );
    assert.match(result.stdout, /settings\/release-tester\/staged-packages/);
    assert(
      result.stdout.includes(`/commit/${git("rev-parse", "HEAD")}/checks`),
    );
  };
  return {
    cwd,
    bin,
    remote,
    write,
    run,
    git,
    commit,
    initial,
    release,
    version,
    assertReleased,
    executable,
  };
}

test("local release writes changelog/version/lockfile and pushes main without a tag", (t) => {
  const f = fixture(t);
  f.assertReleased("0.2.0", ["minor"]);
});

test("dirty trees are rejected before versioning", (t) => {
  const f = fixture(t);
  f.write("CHANGELOG.md", "unfinished");
  const result = f.release();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Git working directory not clean/);
  assert.equal(f.version(), "0.1.128");
  assert.equal(f.git("tag"), "");
});

test("failed checks do not bump or commit a version", (t) => {
  const f = fixture(t);
  const pkg = JSON.parse(readFileSync(path.join(f.cwd, "package.json")));
  pkg.scripts["release:check"] = "node -e 'process.exit(1)'";
  f.write("package.json", JSON.stringify(pkg));
  const head = f.commit();
  assert.notEqual(f.release().status, 0);
  assert.equal(f.version(), "0.1.128");
  assert.equal(f.git("rev-parse", "HEAD"), head);
  assert.equal(f.git("status", "--porcelain"), "");
});

test("rejected pushes preserve the release commit for recovery and create no tags", (t) => {
  const f = fixture(t);
  f.executable(path.join(f.remote, "hooks/pre-receive"), "#!/bin/sh\nexit 1\n");
  const result = f.release();
  assert.notEqual(result.status, 0);
  assert.equal(f.version(), "0.1.129");
  assert.notEqual(f.git("rev-parse", "HEAD"), f.initial);
  assert.equal(f.git("--git-dir", f.remote, "rev-parse", "main"), f.initial);
  assert.equal(f.git("tag"), "");
  assert.match(result.stdout, /do not bump again/);
});

function watchFixture(t, { fails = false, signedIn = true } = {}) {
  const f = fixture(t);
  const events = path.join(f.bin, "events");
  f.executable(
    path.join(f.bin, "gh"),
    `#!${process.execPath}
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === 'auth') {
  assert.deepEqual(args, ['auth', 'status']);
} else if (args[1] === 'list') {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  assert.deepEqual(args, ['run', 'list', '--repo', 'convex/convex-helpers', '--workflow', 'release.yml', '--commit', sha, '--event', 'push', '--json', 'databaseId,url']);
  console.log(JSON.stringify([{databaseId: 123, url: 'https://github.com/convex/convex-helpers/actions/runs/123'}]));
} else {
  assert.deepEqual(args, ['run', 'watch', '123', '--repo', 'convex/convex-helpers', '--exit-status']);
  fs.appendFileSync(${JSON.stringify(events)}, 'watch 123\\n');
  process.exit(${fails ? 1 : 0});
}
`,
  );
  for (const opener of ["open", "xdg-open", "explorer.exe"])
    f.executable(
      path.join(f.bin, opener),
      `#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(events)}, 'open ' + process.argv[2] + '\\n');
`,
    );
  if (!signedIn) {
    f.executable(
      path.join(f.bin, "npm"),
      `#!/bin/sh\nif [ "$1" = whoami ]; then exit 1; else exec "${process.execPath}" "${process.env.npm_execpath}" "$@"; fi\n`,
    );
  }
  return { ...f, events: () => readFileSync(events, "utf8") };
}

test("watch follows this commit's CI run and opens npm after success", (t) => {
  const f = watchFixture(t);
  f.assertReleased("0.1.129", ["--watch"]);
  assert.equal(
    f.events(),
    "watch 123\nopen https://www.npmjs.com/settings/release-tester/staged-packages\n",
  );
});

test("failed CI never opens the npm approval page", (t) => {
  const f = watchFixture(t, { fails: true });
  const result = f.release(["--watch"]);
  assert.notEqual(result.status, 0);
  assert.equal(f.events(), "watch 123\n");
});

test("watch without local npm authentication prints manual approval instructions", (t) => {
  const f = watchFixture(t, { signedIn: false });
  const result = f.release(["--watch"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.events(), "watch 123\n");
  assert.match(
    result.stdout,
    /sign in at https:\/\/www.npmjs.com and open Settings → Staged Packages/,
  );
});

test("alpha releases keep their prerelease identifier", (t) => {
  const f = fixture(t);
  f.assertReleased("0.1.129-alpha.0", ["alpha"]);
});

test("CI uses the release commit even when ordinary commits follow it", (t) => {
  const f = fixture(t);
  const bump = (version) => {
    const pkg = JSON.parse(readFileSync(path.join(f.cwd, "package.json")));
    pkg.version = version;
    f.write("package.json", JSON.stringify(pkg));
    return f.commit();
  };
  const first = bump("0.1.129");
  f.write("feature.txt", "after release\n");
  const tip = f.commit();
  const plan = () =>
    JSON.parse(
      f.run("node", [
        "--input-type=module",
        "-e",
        `import {releasePlan} from './scripts/release-plan.mjs'; console.log(JSON.stringify(releasePlan('${f.initial}', '${tip}')))`,
      ]),
    );
  assert.deepEqual(plan(), {
    sha: first,
    version: "0.1.129",
    distTag: "latest",
  });
  f.git("tag", "npm/0.1.129", first);
  assert.equal(
    plan().sha,
    first,
    "existing matching tag does not suppress a staging retry",
  );
  f.git("tag", "-f", "npm/0.1.129", tip);
  assert.throws(plan, /already identifies a different commit/);
});

test("CI rejects multiple version bumps in one push", (t) => {
  const f = fixture(t);
  for (const version of ["0.1.129", "0.1.130"]) {
    const pkg = JSON.parse(readFileSync(path.join(f.cwd, "package.json")));
    pkg.version = version;
    f.write("package.json", JSON.stringify(pkg));
    f.commit();
  }
  const tip = f.git("rev-parse", "HEAD");
  assert.throws(
    () =>
      f.run("node", [
        "--input-type=module",
        "-e",
        `import {releasePlan} from './scripts/release-plan.mjs'; releasePlan('${f.initial}', '${tip}')`,
      ]),
    /Push one release at a time/,
  );
});

test("CI does not release an ordinary push", (t) => {
  const f = fixture(t);
  f.write("feature.txt", "ordinary change\n");
  const tip = f.commit();
  assert.equal(
    f.run("node", [
      "--input-type=module",
      "-e",
      `import {releasePlan} from './scripts/release-plan.mjs'; console.log(JSON.stringify(releasePlan('${f.initial}', '${tip}')))`,
    ]),
    "null",
  );
});

test("release validation requires notes in the current version section", (t) => {
  const f = fixture(t);
  // Isolate changelog validation from the pending-changeset guard.
  rmSync(path.join(f.cwd, ".changeset"), { recursive: true, force: true });
  const validate = () => f.run("node", ["scripts/validate-release.mjs"]);
  for (const body of ["", "  \n\t", "- Describe this release."]) {
    f.write(
      "CHANGELOG.md",
      `# Changelog\n\n## 0.1.128\n${body}\n## 0.1.127\n\n- Older notes.\n`,
    );
    assert.throws(validate, /Add release notes under ## 0.1.128/);
  }
  f.write("CHANGELOG.md", "# Changelog\n\n## 0.1.127\n\n- Older notes.\n");
  assert.throws(validate, /Add release notes/);
  f.write(
    "CHANGELOG.md",
    "# Changelog\r\n\r\n## 0.1.128\r\n\r\n- Real notes.\r\n\r\n## 0.1.127\r\n\r\n- Describe this release.\r\n",
  );
  assert.doesNotThrow(validate);
});

test("CI validates complete SemVer and chooses npm-compatible dist-tags", (t) => {
  const f = fixture(t);
  const plan = (version) => {
    const pkg = JSON.parse(readFileSync(path.join(f.cwd, "package.json")));
    pkg.version = version;
    f.write("package.json", JSON.stringify(pkg));
    const sha = f.commit();
    return JSON.parse(
      f.run("node", [
        "--input-type=module",
        "-e",
        `import {releaseAt} from './scripts/release-plan.mjs'; console.log(JSON.stringify(releaseAt('${sha}')))`,
      ]),
    );
  };
  for (const version of [
    "1.2.3-alpha.01",
    "1.2.3-01",
    "01.2.3",
    "1.2.3-alpha..1",
    "1.2.3+",
    "v1.2.3",
    " 1.2.3",
    "1.2.3\n",
    null,
  ]) {
    assert.throws(() => plan(version), /Invalid release version/);
    // Ensure the following case still compares against a truthy old version.
    const pkg = JSON.parse(readFileSync(path.join(f.cwd, "package.json")));
    pkg.version = "0.1.128";
    f.write("package.json", JSON.stringify(pkg));
    f.commit();
  }
  for (const [version, distTag] of [
    ["1.2.3-alpha.0", "alpha"],
    ["1.2.3-beta-test.1+build.9", "beta-test"],
    ["1.2.3-0.1", "next"],
    ["1.2.3-v1", "next"],
    ["1.2.3-x", "next"],
    ["1.2.3+build-alpha.001", "latest"],
  ]) {
    const result = plan(version);
    assert.equal(result.version, version);
    assert.equal(result.distTag, distTag);
  }
});

test("manual dispatch stages the selected branch tip or an earlier release commit", (t) => {
  const f = fixture(t);
  const pkg = JSON.parse(readFileSync(path.join(f.cwd, "package.json")));
  pkg.version = "0.1.129-alpha.0";
  f.write("package.json", JSON.stringify(pkg));
  const releaseSha = f.commit();
  const dispatch = (tip, requested = "") => {
    const output = path.join(f.bin, "output");
    writeFileSync(output, "");
    const result = spawnSync(process.execPath, ["scripts/release-plan.mjs"], {
      cwd: f.cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_SHA: tip,
        RELEASE_COMMIT: requested,
        GITHUB_OUTPUT: output,
      },
    });
    return { ...result, output: readFileSync(output, "utf8") };
  };
  let result = dispatch(releaseSha);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.output.slice("release=".length)), {
    sha: releaseSha,
    version: "0.1.129-alpha.0",
    distTag: "alpha",
  });
  assert.notEqual(releaseSha, f.git("rev-parse", "origin/main"));
  f.write("feature.txt", "after release");
  const tip = f.commit();
  assert.equal(dispatch(tip, releaseSha).status, 0);
  result = dispatch(tip);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not bump the version/);
  assert.notEqual(
    dispatch(f.initial, releaseSha).status,
    0,
    "reject commits outside the selected ref",
  );
  assert.notEqual(dispatch(tip, "--all").status, 0, "require a full SHA");
});
