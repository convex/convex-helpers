import fs from "fs";
import { expect, test } from "vitest";
import { generateOpenApiSpec } from "./openApiSpec.js";
import { execSync } from "child_process";
import { FUNCTIONS_JSON, OPEN_API_SPEC } from "./functions.test.js";

// If this test fails, it means you changed the generated OpenAPI spec. Confirm that these changes are
// intentional by looking at the diff and update the string we compare against.
test("openApiSpecMatches", () => {
  const apiSpec = generateOpenApiSpec(JSON.parse(FUNCTIONS_JSON), true);

  expect(
    apiSpec,
    "The generated spec has changed. Confirm that these changes are intentional\
         by looking at the diff and update the comparison string if necessary.",
  ).toEqual(OPEN_API_SPEC);
});

// If this test fails, it means the generated OpenAPI spec is no longer valid.
test("generateValidSpec", async () => {
  const apiSpec = generateOpenApiSpec(JSON.parse(FUNCTIONS_JSON), true);

  const testFileName = "openApiSpec.test.yaml";
  fs.writeFileSync(testFileName, apiSpec, "utf-8");

  const output = execSync(`npx redocly lint ${testFileName} --format='json'`);

  fs.unlinkSync(testFileName);

  expect(JSON.parse(output.toString())["totals"]).toHaveProperty("errors", 0);
}, 10000);

// Regression test: nullable fields with "any" type (empty schema {}) should produce valid YAML.
test("nullable any field generates valid spec", async () => {
  const functionsJson = JSON.stringify({
    url: "https://test-convex-url.convex.cloud",
    functions: [
      {
        args: {
          type: "object",
          value: {
            claimedAt: {
              fieldType: {
                type: "union",
                value: [{ type: "any" }, { type: "null" }],
              },
              optional: false,
            },
          },
        },
        functionType: "Query",
        identifier: "example.js:get",
        returns: { type: "any" },
        visibility: { kind: "public" },
      },
    ],
  });

  const apiSpec = generateOpenApiSpec(JSON.parse(functionsJson), true);

  const testFileName = "openApiSpec.nullable-any.test.yaml";
  fs.writeFileSync(testFileName, apiSpec, "utf-8");

  const output = execSync(`npx redocly lint ${testFileName} --format='json'`);

  fs.unlinkSync(testFileName);

  expect(JSON.parse(output.toString())["totals"]).toHaveProperty("errors", 0);
  // nullable any should produce {} (any schema already permits null)
  expect(apiSpec).toMatch(/claimedAt:\s*\n\s*\{\}/);
}, 10000);

// Bytes go in as `{ "$bytes": "<base64>" }` and come back from the `json`
// output format as a bare base64 string, so the two sides get different
// schemas, and neither aborts spec generation.
test("bytes fields generate the wire shape for each side", async () => {
  const functionsJson = JSON.stringify({
    url: "https://test-convex-url.convex.cloud",
    functions: [
      {
        args: {
          type: "object",
          value: {
            payload: { fieldType: { type: "bytes" }, optional: false },
          },
        },
        functionType: "Mutation",
        identifier: "example.js:store",
        returns: { type: "bytes" },
        visibility: { kind: "public" },
      },
    ],
  });

  const apiSpec = generateOpenApiSpec(JSON.parse(functionsJson), true);

  const testFileName = "openApiSpec.bytes.test.yaml";
  fs.writeFileSync(testFileName, apiSpec, "utf-8");
  try {
    const output = execSync(`npx redocly lint ${testFileName} --format='json'`);
    expect(JSON.parse(output.toString())["totals"]).toHaveProperty("errors", 0);
  } finally {
    fs.unlinkSync(testFileName);
  }
  expect(apiSpec).toMatch(
    /payload:\n\s+type: object\n\s+required:\n\s+- \$bytes\n\s+properties:\n\s+\$bytes:\n\s+type: string\n\s+format: byte/,
  );
  expect(apiSpec).toMatch(/value:\n\s+type: string\n\s+format: byte\n/);
  expect(apiSpec.match(/\$bytes/g)).toHaveLength(2);
});
