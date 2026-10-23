import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import process from "node:process";
import test from "node:test";
import { parse } from "yaml";

// Exercise the actual inline tag job without checking out or executing package
// code in that privileged CI job, and without making any GitHub writes in tests.
const workflow = parse(
  readFileSync(
    new URL("../.github/workflows/release-candidate.yml", import.meta.url),
    "utf8",
  ),
);
const code = workflow.jobs.tag.steps[0].run
  .split("<<'JS'\n")[1]
  .replace(/\nJS\s*$/, "");
const sha = "a".repeat(40);

async function tag(t, existing, creationStatus = 201) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, path: req.url, body });
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      res.statusCode = creationStatus;
      res.end("{}");
    } else {
      res.statusCode = existing ? 200 : 404;
      res.end(JSON.stringify({ object: existing }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    env: {
      ...process.env,
      GH_TOKEN: "fixture",
      GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
      GITHUB_REPOSITORY: "fixture/repo",
      VERSION: "0.1.129",
      RELEASE_SHA: sha,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let error = "";
  child.stderr.on("data", (chunk) => {
    error += chunk;
  });
  const status = await new Promise((resolve) => child.on("close", resolve));
  return { status, error, requests };
}

test("tag job creates the version tag at the staged SHA", async (t) => {
  const result = await tag(t);
  assert.equal(result.status, 0, result.error);
  const create = result.requests.find((r) => r.method === "POST");
  assert.deepEqual(JSON.parse(create.body), {
    ref: "refs/tags/npm/0.1.129",
    sha,
  });
  assert.equal(workflow.jobs.tag.needs.includes("stage"), true);
  assert.equal(
    workflow.jobs.tag.steps.some((step) => step.uses),
    false,
  );
});

test("tag retries accept the same commit without rewriting the ref", async (t) => {
  const result = await tag(t, { type: "commit", sha });
  assert.equal(result.status, 0, result.error);
  assert.equal(result.requests.length, 1);
});

test("tag job refuses an existing tag pointing elsewhere", async (t) => {
  const result = await tag(t, { type: "commit", sha: "b".repeat(40) });
  assert.notEqual(result.status, 0);
  assert.match(result.error, /refusing to move/);
  assert.equal(result.requests.length, 1);
});

test("tag permission failures remain failures", async (t) => {
  const result = await tag(t, undefined, 403);
  assert.notEqual(result.status, 0);
  assert.match(result.error, /Creating tag failed: 403/);
});

test("each release tags only after its own stage job, with separate credentials", () => {
  const caller = parse(
    readFileSync(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    ),
  );
  const release = caller.jobs.release;
  assert.equal(release.uses, "./.github/workflows/release-candidate.yml");
  assert.equal(release.strategy["fail-fast"], false);
  assert.equal(
    release.strategy.matrix.release,
    "${{ fromJSON(needs.plan.outputs.releases) }}",
  );
  assert.equal(release.with.sha, "${{ matrix.release.sha }}");
  assert.equal(release.with.version, "${{ matrix.release.version }}");
  assert.equal(release.with.distTag, "${{ matrix.release.distTag }}");
  assert.equal(workflow.jobs.tag.needs, "stage");
  assert.equal(
    workflow.jobs.tag.if,
    undefined,
    "tagging must retain the default success() condition",
  );
  assert.equal(
    workflow.jobs.stage.strategy,
    undefined,
    "staging is one candidate, not an aggregate matrix",
  );
  assert.equal(workflow.jobs.tag.strategy, undefined);
  assert.deepEqual(workflow.jobs.stage.permissions, {
    contents: "read",
    "id-token": "write",
  });
  assert.deepEqual(workflow.jobs.tag.permissions, { contents: "write" });
});
