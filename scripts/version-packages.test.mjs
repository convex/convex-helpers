import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import changelog from "./changelog.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(import.meta.resolve("@changesets/cli/bin.js"));
const history = `# Changelog

## 1.0.0

### Patch Changes

- abc1234: An older entry.
`;
const summary = `Fix cursor handling ([#1234](https://github.com/convex/convex-helpers/issues/1234)).
Thanks to [@contributor](https://github.com/contributor)!

Details:
- Preserve the cursor.
- Handle empty pages.

\`\`\`md
### Patch Changes
\`\`\``;

test("dependency notes omit commit identifiers too", async () => {
  const line = await changelog.getDependencyReleaseLine(
    [{ summary: "Update a dependency", commit: "deadbeef1234567" }],
    [{ name: "example", newVersion: "2.0.0" }],
    null,
  );
  assert.match(line, /example@2\.0\.0/);
  assert.doesNotMatch(line, /deadbeef/);
});

for (const [type, version] of [
  ["patch", "1.0.1"],
  ["minor", "1.1.0"],
  ["major", "2.0.0"],
  ["alpha", "1.0.1-alpha.0"],
]) {
  test(`version ${type} releases with the configured changelog`, async (t) => {
    const cwd = await mkdtemp(path.join(tmpdir(), "convex-helpers-version-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(path.join(cwd, ".changeset"));
    await mkdir(path.join(cwd, "scripts"));
    for (const file of [
      ".changeset/config.json",
      "scripts/changelog.mjs",
      "scripts/version-packages.mjs",
    ]) {
      await copyFile(path.join(root, file), path.join(cwd, file));
    }
    // Reuse the installed dependencies without changing the real checkout.
    await symlink(
      path.join(root, "node_modules"),
      path.join(cwd, "node_modules"),
    );
    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({
        name: "convex-helpers",
        version: "1.0.0",
        type: "module",
      }),
    );
    await writeFile(path.join(cwd, "CHANGELOG.md"), history);
    await writeFile(
      path.join(cwd, ".changeset/fix.md"),
      `---\n"convex-helpers": patch\n---\n\n${summary}\n`,
    );
    if (type === "minor" || type === "major") {
      await writeFile(
        path.join(cwd, ".changeset/feature.md"),
        `---\n"convex-helpers": ${type}\n---\n\nA larger change.\n`,
      );
    }
    const git = (...args) =>
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
    git("init", "-b", "main");
    git("add", "package.json", "CHANGELOG.md", ".changeset", "scripts");
    git(
      "-c",
      "user.name=Release test",
      "-c",
      "user.email=release@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Add release notes",
    );
    const commit = git("rev-parse", "HEAD").trim();
    if (type === "alpha") {
      execFileSync(process.execPath, [cli, "pre", "enter", "alpha"], {
        cwd,
        stdio: "pipe",
      });
    }
    const versionPackages = () =>
      execFileSync(process.execPath, ["scripts/version-packages.mjs"], {
        cwd,
        stdio: "pipe",
      });
    versionPackages();

    const manifest = JSON.parse(
      await readFile(path.join(cwd, "package.json"), "utf8"),
    );
    assert.equal(manifest.version, version);
    const output = await readFile(path.join(cwd, "CHANGELOG.md"), "utf8");
    const entry = output.split("\n## 1.0.0\n")[0];
    assert.ok(entry.startsWith(`# Changelog\n\n## ${version}\n\n`));
    assert.doesNotMatch(entry, /^### Patch Changes$/m);
    assert.doesNotMatch(entry, new RegExp(commit.slice(0, 7)));
    assert.ok(entry.includes("- Fix cursor handling"));
    assert.ok(
      entry.includes(
        "[#1234](https://github.com/convex/convex-helpers/issues/1234)",
      ),
    );
    assert.ok(entry.includes("[@contributor](https://github.com/contributor)"));
    assert.match(entry, /  - Preserve the cursor\./);
    assert.match(entry, /  ```md\n  ### Patch Changes\n  ```/);
    if (type === "minor" || type === "major") {
      assert.ok(
        entry.includes(`### ${type === "minor" ? "Minor" : "Major"} Changes`),
      );
    }
    assert.ok(output.endsWith(history.slice("# Changelog\n\n".length)));

    if (type !== "alpha") {
      assert.deepEqual(await readdir(path.join(cwd, ".changeset")), [
        "config.json",
      ]);
      // Changesets exits 1 when no unreleased notes remain. Preserve that
      // behavior and leave the existing changelog untouched.
      assert.throws(versionPackages, (error) => error.status === 1);
      assert.equal(
        await readFile(path.join(cwd, "CHANGELOG.md"), "utf8"),
        output,
      );
    }
  });
}
