import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const manifest = async () => JSON.parse(await readFile("package.json", "utf8"));
const before = await manifest();

try {
  execFileSync(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve("@changesets/cli/bin.js")),
      "version",
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" },
  );
} catch (error) {
  process.exit(error.status ?? 1);
}

const after = await manifest();
if (before.version !== after.version) {
  // Changesets generates the section headings outside the changelog hooks.
  // Only change the newly generated release; preserve older release notes.
  const changelog = await readFile("CHANGELOG.md", "utf8");
  const heading = `## ${after.version}\n`;
  const start = changelog.indexOf(heading);
  if (start === -1) {
    throw new Error(`Missing changelog entry for ${after.version}`);
  }
  const next = changelog.indexOf("\n## ", start + heading.length);
  const end = next === -1 ? changelog.length : next;
  const entry = changelog
    .slice(start, end)
    .replace(/^### Patch Changes\n\n/m, "");
  await writeFile(
    "CHANGELOG.md",
    changelog.slice(0, start) + entry + changelog.slice(end),
  );
}
