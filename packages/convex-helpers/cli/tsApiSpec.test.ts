import * as ts from "typescript";
import { expect, test } from "vitest";
import { FUNCTIONS_JSON, JS_API } from "./functions.test.js";
import { generateApiSpec } from "./tsApiSpec.js";

// If this test fails, it means the generated code changed. Confirm that these changes are
// intentional by looking at the diff and update the string we compare against.
test("generatedCodeMatches", () => {
  const tsCode = generateApiSpec(JSON.parse(FUNCTIONS_JSON), false);
  expect(
    tsCode,
    "The generated code has changed. Confirm that these changes are intentional\
         by looking at the diff and update the comparison string if necessary.",
  ).toEqual(JS_API);
});

// If this test fails, you made the generated code invalid typescript.
test("generatedCodeIsValid", () => {
  const tsCode = generateApiSpec(JSON.parse(FUNCTIONS_JSON), false);
  const result = ts.transpileModule(tsCode, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ESNext,
    },
  });

  const jsCode = result.outputText;

  // Asserts that the generated code is valid typescript. This will fail if
  // the generated code is invalid.
  eval(jsCode);
});

test("function handles retain signatures in generated types", () => {
  const spec = JSON.parse(
    JSON.stringify({
      url: "https://test-convex-url.convex.cloud",
      functions: [
        {
          functionType: "Mutation",
          identifier: "example.js:run",
          visibility: { kind: "public" },
          args: {
            type: "object",
            value: {
              callback: {
                optional: true,
                fieldType: {
                  type: "function",
                  fnType: "mutation",
                  args: {
                    type: "object",
                    value: {
                      count: { optional: false, fieldType: { type: "number" } },
                    },
                  },
                  returns: { type: "string" },
                },
              },
            },
          },
          returns: { type: "array", value: { type: "function" } },
        },
      ],
    }),
  );
  const code = generateApiSpec(spec, false);
  expect(code).toContain(
    'callback?: import("convex/server").FunctionHandle_future<"mutation", { count: number, }, string>',
  );
  expect(code).toContain(
    'Array<import("convex/server").FunctionHandle_future<any, any, any>>',
  );
});
