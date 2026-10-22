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

test("watch follows this commit's CI run and opens npm after success", (t) => {
  const f = fixture(t);
  f.executable(
    path.join(f.bin, "gh"),
    '#!/bin/sh\nif [ "$2" = list ]; then echo \'[{"databaseId":123,"url":"https://github.com/convex/convex-helpers/actions/runs/123"}]\'; fi\n',
  );
  for (const opener of ["open", "xdg-open", "explorer.exe"])
    f.executable(
      path.join(f.bin, opener),
      `#!/bin/sh\nprintf '%s' "$1" > '${path.join(f.bin, "opened")}'\n`,
    );
  f.assertReleased("0.1.129", ["--watch"]);
  assert.equal(
    readFileSync(path.join(f.bin, "opened"), "utf8"),
    "https://www.npmjs.com/settings/release-tester/staged-packages",
  );
});

test("alpha releases keep their prerelease identifier", (t) => {
  const f = fixture(t);
  f.assertReleased("0.1.129-alpha.0", ["alpha"]);
});

test("CI discovers every bump in a multi-commit push and uses each exact SHA", (t) => {
  const f = fixture(t);
  const bump = (version) => {
    const pkg = JSON.parse(readFileSync(path.join(f.cwd, "package.json")));
    pkg.version = version;
    f.write("package.json", JSON.stringify(pkg));
    return f.commit();
  };
  const first = bump("0.1.129");
  f.write("feature.txt", "after release\n");
  f.commit();
  const second = bump("0.1.130-alpha.0");
  f.write("feature.txt", "later still\n");
  const tip = f.commit();
  const plan = () =>
    JSON.parse(
      f.run("node", [
        "--input-type=module",
        "-e",
        `import {releasePlan} from './scripts/release-plan.mjs'; console.log(JSON.stringify(releasePlan('${f.initial}', '${tip}')))`,
      ]),
    );
  assert.deepEqual(plan(), [
    { sha: first, version: "0.1.129", distTag: "latest" },
    { sha: second, version: "0.1.130-alpha.0", distTag: "alpha" },
  ]);
  f.git("tag", "npm/0.1.129", first);
  assert.equal(
    plan().length,
    2,
    "existing matching tag does not suppress a staging retry",
  );
  f.git("tag", "-f", "npm/0.1.129", tip);
  assert.throws(plan, /already identifies a different commit/);
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
    "[]",
  );
});
