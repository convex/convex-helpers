import fs from "fs";
import { spawnSync } from "child_process";
import chalk from "chalk";
import type { ValidatorJSON } from "convex/values";
import path from "path";
import os from "os";

type Visibility = { kind: "public" } | { kind: "internal" };

type FunctionType = "Action" | "Mutation" | "Query" | "HttpAction";

export type FunctionSpec = {
  url: string;
  functions: AnalyzedFunction[];
};

export type AnalyzedFunction = {
  identifier: string;
  functionType: FunctionType;
  visibility: Visibility;
  args: ValidatorJSON | null;
  returns: ValidatorJSON | null;
};

export function getFunctionSpec(
  prod?: boolean,
  filePath?: string,
  timeoutSeconds: number = 120,
) {
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    console.error(
      chalk.red(
        `Invalid --timeout value: expected a positive number of seconds.`,
      ),
    );
    process.exit(1);
  }
  if (filePath && prod) {
    console.error(`To use the prod flag, you can't provide a file path`);
    process.exit(1);
  }
  let content: string;
  if (filePath && !fs.existsSync(filePath)) {
    console.error(chalk.red(`File ${filePath} not found`));
    process.exit(1);
  }
  if (filePath) {
    content = fs.readFileSync(filePath, "utf-8");
  } else {
    const tempFile = path.join(os.tmpdir(), `function-spec-${Date.now()}.json`);

    try {
      const outputFd = fs.openSync(tempFile, "w");
      const flags = prod ? ["--prod"] : [];
      const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
      const extraOpts = process.platform === "win32" ? { shell: true } : {};
      const result = spawnSync(npxCmd, ["convex", "function-spec", ...flags], {
        stdio: ["inherit", outputFd, "pipe"],
        encoding: "utf-8",
        timeout: timeoutSeconds * 1000,
        ...extraOpts,
      });

      fs.closeSync(outputFd);

      if (
        result.error &&
        (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT"
      ) {
        throw new Error(
          `Timed out after ${timeoutSeconds}s waiting for \`npx convex function-spec\`. ` +
            "Check that your deployment is reachable (e.g. `npx convex dev` is running, " +
            "or pass --prod for your production deployment), or increase --timeout.",
        );
      }
      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        throw new Error(result.stderr || "Failed without error message");
      }

      content = fs.readFileSync(tempFile, "utf-8");
    } catch (e) {
      if (e instanceof Error) {
        console.error(e.message);
      }
      console.error(
        chalk.red(
          "\nError retrieving function spec from your Convex deployment. " +
            "Confirm that you \nare running this command from within a Convex project.\n",
        ),
      );
      throw e;
    } finally {
      try {
        fs.unlinkSync(tempFile);
      } catch (error) {
        console.warn(
          chalk.yellow(
            `Warning: Failed to delete temporary file ${tempFile}:`,
            error instanceof Error ? error.message : "Unknown error",
          ),
        );
      }
    }
  }

  return content;
}
