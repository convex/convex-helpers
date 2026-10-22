/**
## Testing with a local backend

[`convex/example.test.ts`](./convex/example.test.ts) demonstrates testing Convex functions by running them against a local backend.

See [this Stack article](https://stack.convex.dev/testing-with-local-oss-backend) for more information.

To set these up for yourself:

- Either [download a pre-built binary(recommended)](https://github.com/convex/convex-backend/releases),
  or [build it from source](https://stack.convex.dev/building-the-oss-backend).
  `just run-local-backend` will attempt to download the binary automatically.
- Create a `clearAll` function to reset data between tests (see [`convex/testingFunctions.ts`](./convex/testingFunctions.ts) for an example)
- Start writing tests using [`ConvexTestingHelper.ts`](./packages/convex-helpers/testing.ts)
- Make sure to call `clearAll` between tests and configure your testing framework to run one test at
  a time to ensure test isolation

To run tests, run this from the root of the repo:
```sh
node backendHarness.js 'just convex deploy && just convex env set IS_TEST true && vitest --config convex/vitest.config.mts --run convex/example.test.ts'
```
This command does the following:
- Sets up a fresh local backend (see [backendHarness.js](./backendHarness.js))
- Sets the `IS_TEST` environment variable to enable calling test only functions
- Deploys code to the backend
- Runs the tests
- Tears down the backend
*/
import http from "node:http";
import { spawn, exec, execSync } from "node:child_process";

// Run a command against a fresh local backend, handling setting up and tearing down the backend.

// Checks for a local backend running on port 3210.
const parsedUrl = new URL("http://127.0.0.1:3210");

async function isBackendRunning(backendUrl) {
  return new Promise((resolve) => {
    http
      .request(
        {
          hostname: backendUrl.hostname,
          port: backendUrl.port,
          path: "/version",
          method: "GET",
        },
        (res) => {
          resolve(res.statusCode === 200);
        },
      )
      .on("error", () => {
        resolve(false);
      })
      .end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const waitForLocalBackendRunning = async (backendUrl) => {
  let isRunning = await isBackendRunning(backendUrl);
  let i = 0;
  while (!isRunning) {
    if (i % 10 === 0) {
      // Progress messages every ~5 seconds
      console.log("Waiting for backend to be running...");
    }
    await sleep(500);
    isRunning = await isBackendRunning(backendUrl);
    i += 1;
  }
  return;
};

let backendProcess = null;

function cleanup() {
  if (backendProcess !== null) {
    console.log("Cleaning up running backend");
    backendProcess.kill("SIGTERM");
    execSync("just reset-local-backend");
  }
}

async function runWithLocalBackend(command, backendUrl) {
  const isRunning = await isBackendRunning(backendUrl);
  if (isRunning) {
    console.error(
      "Looks like local backend is already running. Cancel it and restart this command.",
    );
    process.exit(1);
  }
  execSync("just reset-local-backend");
  backendProcess = exec("CONVEX_TRACE_FILE=1 just run-local-backend");
  await waitForLocalBackendRunning(backendUrl);
  console.log("Backend running! Logs can be found in convex-local-backend.log");
  const innerCommand = new Promise((resolve) => {
    const c = spawn(command, {
      shell: true,
      stdio: "pipe",
      env: { ...process.env, FORCE_COLOR: true },
    });
    c.stdout.on("data", (data) => {
      process.stdout.write(data);
    });

    c.stderr.on("data", (data) => {
      process.stderr.write(data);
    });

    c.on("exit", (code) => {
      console.log("inner command exited with code " + code.toString());
      resolve(code);
    });
  });
  return innerCommand;
}

runWithLocalBackend(process.argv[2], parsedUrl)
  .then((code) => {
    cleanup();
    process.exit(code);
  })
  .catch(() => {
    cleanup();
    process.exit(1);
  });
