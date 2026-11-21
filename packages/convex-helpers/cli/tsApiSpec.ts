import fs from "fs";
import { Command, Option } from "commander";
import type { ValidatorJSON, RecordKeyValidatorJSON } from "convex/values";
import chalk from "chalk";
import type { FunctionSpec } from "./utils.js";
import { getFunctionSpec } from "./utils.js";
import prettier from "prettier";

export const tsApiSpec = new Command("ts-api-spec")
  .summary(
    "Generate a TypeScript API spec  similar to `convex/_generated/api.d.ts` from a Convex function definition.",
  )
  .addOption(
    new Option(
      "--input-file <fileName>",
      "The file name of the Convex function definition. If this argument is not provided, we will " +
        "\nretrieve the function spec from your configured Convex deployment.\n" +
        "The file name defaults to `convexApi{msSinceEpoch}`.",
    ),
  )
  .addOption(
    new Option(
      "--output-file <filename>",
      "Specify the output file name for your spec.",
    ).default(undefined),
  )
  .addOption(
    new Option(
      "--prod",
      "Get the function spec for your configured project's prod deployment.",
    ).default(undefined),
  )
  .addOption(
    new Option(
      "--include-internal",
      "Include internal functions from your Convex deployment.",
    ).default(false),
  )
  .addOption(
    new Option(
      "--timeout <seconds>",
      "Maximum time in seconds to wait when retrieving the function spec from your Convex deployment.",
    ).default(120),
  )
  .action(async (options) => {
    const content = getFunctionSpec(
      options.prod,
      options.inputFile,
      Number(options.timeout),
    );
    const baseOutputPath =
      options.outputFile ?? `convexApi${Date.now().valueOf()}`;
    const outputPath = baseOutputPath.endsWith(".ts")
      ? baseOutputPath
      : baseOutputPath + ".ts";

    try {
      const apiSpec = generateApiSpec(
        JSON.parse(content),
        options.includeInternal,
      );
      const formattedSpec = await prettier.format(apiSpec, {
        parser: "typescript",
      });
      fs.writeFileSync(outputPath, formattedSpec, "utf-8");
    } catch (e) {
      console.error("Failed to generate TypeScript API spec: ", e);
      process.exit(1);
    }

    console.log(chalk.green("Wrote JavaScript API spec to " + outputPath));
  });

function generateArgsType(argsJson: ValidatorJSON): string {
  switch (argsJson.type) {
    case "null":
      return "null";
    case "number":
      return "number";
    case "bigint":
    case "commitTs":
      return "bigint";
    case "boolean":
      return "boolean";
    case "string":
      return "string";
    case "bytes":
      return "ArrayBuffer";
    case "any":
      return "any";
    case "literal":
      if (typeof argsJson.value === "string") {
        return `"${argsJson.value}"` as string;
      } else {
        return argsJson.value!.toString();
      }
    case "id":
      return `Id<"${argsJson.tableName}">`;
    case "array":
      return `Array<${generateArgsType(argsJson.value)}>`;
    case "record": {
      const keyType = generateRecordKeyType(argsJson.keys);
      const valueType = generateArgsType(argsJson.values.fieldType);
      return `Record<${keyType}, ${valueType}>`;
    }
    case "object": {
      const members: string[] = Object.entries(argsJson.value).map(
        ([key, value]) => {
          return `${key}${value.optional ? "?" : ""}: ${generateArgsType(
            value.fieldType,
          )},`;
        },
      );
      if (members.length === 0) {
        // special case empty object
        return "Record<string, never>";
      }
      return `{ ${members.join("\n")} }`;
    }
    case "union": {
      const members: string[] = argsJson.value.map((v) => generateArgsType(v));
      return members.join(" | ");
    }
  }
}

/**
 * Generates a TypeScript-compatible key type for a record.
 */
function generateRecordKeyType(keys: RecordKeyValidatorJSON): string {
  switch (keys.type) {
    case "string":
      return "string";
    case "id":
      return `Id<"${keys.tableName}">`;
    case "union":
      return keys.value.map(generateRecordKeyType).join(" | ");
    default:
      return "any";
  }
}

function generateApiType(tree: Record<string, any>) {
  const isFunction = tree.functionType !== undefined;
  if (isFunction) {
    const output =
      tree.returns === null || tree.returns === undefined
        ? "any"
        : generateArgsType(tree.returns);
    return `FunctionReference<"${(tree.functionType as string).toLowerCase()}", "${
      tree.visibility.kind
    }", ${generateArgsType(tree.args)}, ${output}>`;
  }
  const members: string[] = Object.entries(tree).map(([key, value]) => {
    return `${key}: ${generateApiType(value)}`;
  });
  return `{ ${members.join("\n")} }`;
}

export function generateApiSpec(
  functionSpec: FunctionSpec,
  includeInternal: boolean,
) {
  if (functionSpec.functions === undefined || functionSpec.url === undefined) {
    console.error(
      chalk.red(
        "Incorrect function spec provided. Confirm that you have Convex 1.15.0 or greater installed.",
      ),
    );
    process.exit(1);
  }

  const publicFunctionTree: Record<string, any> = {};
  const internalFunctionTree: Record<string, any> = {};
  for (const fn of functionSpec.functions) {
    // Skip http actions because they go to a different url and we don't have argument/return types
    if (fn.functionType === "HttpAction") {
      continue;
    }
    const [modulePath, functionName] = fn.identifier.split(":");
    const withoutExtension = modulePath!.slice(0, modulePath!.length - 3);
    const pathParts = withoutExtension!.split("/");
    let treeNode =
      fn.visibility.kind === "internal"
        ? internalFunctionTree
        : publicFunctionTree;
    for (let i = 0; i < pathParts.length; i += 1) {
      const pathPart = pathParts[i]!;
      if (treeNode[pathPart] === undefined) {
        treeNode[pathPart] = {};
      }
      treeNode = treeNode[pathPart];
    }
    treeNode[functionName!] = fn;
  }
  const apiType = generateApiType(publicFunctionTree);
  const internalApiType = generateApiType(
    includeInternal ? internalFunctionTree : {},
  );
  return `
import { type FunctionReference, anyApi } from "convex/server"
import { type GenericId as Id } from "convex/values"

export const api: PublicApiType = anyApi as unknown as PublicApiType;
export const internal: InternalApiType = anyApi as unknown as InternalApiType;

export type PublicApiType = ${apiType}
export type InternalApiType = ${internalApiType}
`;
}
