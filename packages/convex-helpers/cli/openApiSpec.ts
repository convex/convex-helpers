import fs from "fs";
import { Command, Option } from "commander";
import type { ValidatorJSON } from "convex/values";
import chalk from "chalk";
import type { AnalyzedFunction, FunctionSpec } from "./utils.js";
import { getFunctionSpec } from "./utils.js";
import prettier from "prettier";

export const openApiSpec = new Command("open-api-spec")
  .summary("Generate an OpenAPI spec from a Convex function definition.")
  .addOption(
    new Option(
      "--input-file <filename>",
      "The file name of the Convex function definition. If this argument is not provided, we will\n" +
        "retrieve the function spec from your configured Convex deployment.\n" +
        "The file name defaults to `convex-spec-{msSinceEpoch}`.",
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
      "--include-internal",
      "Include internal functions from your Convex deployment.",
    ).default(false),
  )
  .addOption(
    new Option(
      "--prod",
      "Get the function spec for your configured project's prod deployment.",
    ).default(undefined),
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
      options.outputFile ?? `convex-spec-${Date.now().valueOf()}`;
    const outputPath =
      baseOutputPath.endsWith(".yaml") || baseOutputPath.endsWith(".yml")
        ? baseOutputPath
        : baseOutputPath + ".yaml";

    try {
      const apiSpec = generateOpenApiSpec(
        JSON.parse(content),
        options.includeInternal,
      );
      const formattedSpec = await prettier.format(apiSpec, { parser: "yaml" });
      fs.writeFileSync(outputPath, formattedSpec, "utf-8");
    } catch (e) {
      console.error("Failed to generate TypeScript API spec: ", e);
      process.exit(1);
    }

    console.log(chalk.green("Wrote OpenAPI spec to " + outputPath));
  });

function generateSchemaFromValidator(validatorJson: ValidatorJSON): string {
  switch (validatorJson.type) {
    case "null":
      // Necessary because null only becomes explicitly supported in OpenAPI 3.1.0
      return "type: string\nnullable: true";
    case "number":
      return "type: number";
    case "bigint":
    case "commitTs":
      return "type: integer\nformat: int64";
    case "boolean":
      return "type: boolean";
    case "string":
      return "type: string";
    case "bytes":
      throw new Error("bytes unsupported");
    case "any":
      return "{}";
    case "literal":
      if (typeof validatorJson.value === "string") {
        return `type: string\nenum:\n  - "${validatorJson.value}"` as string;
      } else if (typeof validatorJson.value === "boolean") {
        return `type: boolean\nenum:\n  - ${validatorJson.value.toString()}`;
      } else {
        return `type: number\nenum:\n  - ${validatorJson.value!.toString()}`;
      }
    case "id":
      return `type: string\ndescription: ID from table "${validatorJson.tableName}"`;
    case "array":
      return `type: array\nitems:\n${reindent(
        generateSchemaFromValidator(validatorJson.value),
        1,
      )}`;
    case "record":
      return "type: object";
    case "object": {
      const requiredProperties: string[] = [];
      const members: string[] = Object.entries(validatorJson.value).map(
        ([key, value]) => {
          if (!value.optional) {
            requiredProperties.push(key);
          }
          return `${key}:\n${reindent(
            generateSchemaFromValidator(value.fieldType),
            1,
          )}`;
        },
      );
      const requiredPropertiesStr =
        requiredProperties.length === 0
          ? ""
          : `required:\n${reindent(
              requiredProperties.map((r) => `- ${r}`).join("\n"),
              1,
            )}\n`;
      const propertiesStr =
        members.length === 0
          ? ""
          : `properties:\n${reindent(members.join("\n"), 1)}`;
      return `type: object\n${requiredPropertiesStr}${propertiesStr}`;
    }
    case "union": {
      const nullMember = validatorJson.value.find((v) => v.type === "null");
      const nonNullMembers = validatorJson.value.filter(
        (v) => v.type !== "null",
      );
      if (nonNullMembers.length === 1 && nullMember !== undefined) {
        const innerSchema = generateSchemaFromValidator(nonNullMembers[0]!);
        if (innerSchema === "{}") {
          return "{}";
        }
        return `${innerSchema}\nnullable: true`;
      }
      const members: string[] = nonNullMembers.map((v) =>
        generateSchemaFromValidator(v),
      );
      return `${
        nullMember === undefined ? "" : "nullable: true\n"
      }oneOf:\n${members.map((m) => reindent(m, 1, true)).join("\n")}`;
    }
  }
}

function reindent(
  linesStr: string,
  indentation: number,
  firstLineList: boolean = false,
) {
  const lines = linesStr.split("\n");
  return lines
    .map((l, index) => {
      if (index === 0 && firstLineList) {
        return `- ${"  ".repeat(indentation - 1)}${l}`;
      }
      return `${"  ".repeat(indentation)}${l}`;
    })
    .join("\n");
}

function formatName(name: string) {
  const [modulePath, functionName] = name.split(":");
  const withoutExtension = modulePath?.slice(0, modulePath.length - 3);
  const pathParts = withoutExtension?.split("/");
  const shortName = `${pathParts?.join(".")}.${functionName}`;
  const urlPathName = `${pathParts?.join("/")}/${functionName}`;
  return {
    original: name,
    shortName,
    urlPathName,
  };
}

function generateEndpointDef(func: AnalyzedFunction) {
  const { urlPathName, shortName } = formatName(func.identifier);
  return `
    /api/run/${urlPathName}:
      post:
        summary: Calls a ${func.functionType.toLowerCase()} at the path ${func.identifier}
        tags:
          - ${func.functionType.toLowerCase()}
        requestBody:
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Request_${shortName}'
          required: true
        responses:
          '200':
            description: Convex executed your request and returned a result
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Response_${shortName}'
          '400':
            description: Failed operation
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/FailedResponse'
          '500':
            description: Convex Internal Error
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/FailedResponse'\n`;
}

function generateEndpointSchemas(func: AnalyzedFunction) {
  const { shortName } = formatName(func.identifier);
  return `
    Request_${shortName}:
      type: object
      required:
        - args
      properties:
        args:\n${reindent(
          generateSchemaFromValidator(func.args ?? { type: "any" }),
          5,
        )}\n
    Response_${shortName}:
      type: object
      required:
        - status
      properties:
        status:
          type: string
          enum:
            - "success"
            - "error"
        errorMessage:
          type: string
        errorData:
          type: object
        value:\n${reindent(
          generateSchemaFromValidator(func.returns ?? { type: "any" }),
          5,
        )}\n`;
}

export function generateOpenApiSpec(
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

  return `
openapi: 3.0.3
info:
    title: Convex App - OpenAPI 3.0
    version: 0.0.0
servers:
    - url: ${functionSpec.url}
security:
  - bearerAuth: []
tags:
    - name: query
      description: Functions that read data
    - name: mutation
      description: Functions that write/update/delete data
    - name: action
      description: Functions that can make calls to external APIs
paths:
${reindent(
  // Skip http actions because they go to a different url and we don't have argument/return types
  functionSpec.functions
    .filter((f) => f.functionType !== "HttpAction")
    .filter((f) => includeInternal || f.visibility.kind === "public")
    .map((f) => generateEndpointDef(f))
    .join("\n"),
  1,
)}
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: Token of the format "Bearer {token}" for normal authentication and "Convex {token}" for admin tokens.
  schemas:
${reindent(
  functionSpec.functions
    .filter((f) => f.functionType !== "HttpAction")
    .filter((f) => includeInternal || f.visibility.kind === "public")
    .map((f) => generateEndpointSchemas(f))
    .join("\n"),
  1,
)}
      FailedResponse:
        type: object
        properties: {}
`;
}
