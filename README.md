# convex-helpers

A collection of useful code to complement the official packages.
This directory has a project with examples of using convex-helpers. You can
find the npm package in [./packages/convex-helpers](./packages/convex-helpers).

## Index

| In the [`convex-helpers`](./packages/convex-helpers/README.md) [npm package](https://www.npmjs.com/package/convex-helpers): |
| --------------------------------------------------------------------------------------------------------------------------- |
| [Custom Functions](./packages/convex-helpers/README.md#custom-functions)                                                    |
| [Relationship helpers](./packages/convex-helpers/README.md#relationship-helpers)                                            |
| [Stateful Migrations](./packages/convex-helpers/README.md#stateful-migrations)                                              |
| [Action retry wrapper](./packages/convex-helpers/README.md#action-retries)                                                  |
| [Rate limiting](./packages/convex-helpers/README.md#rate-limiting)                                                          |
| [Sessions: client-generated](./packages/convex-helpers/README.md#session-tracking-via-client-side-sessionid-storage)        |
| [Richer useQuery](./packages/convex-helpers/README.md#richer-usequery)                                                      |
| [Row-level security](./packages/convex-helpers/README.md#row-level-security)                                                |
| [Zod validation](./packages/convex-helpers/README.md#zod-validation)                                                        |
| [Hono for HTTP endpoints](./packages/convex-helpers/README.md#hono-for-advanced-http-endpoint-definitions)                  |
| [CRUD](./packages/convex-helpers/README.md#crud-utilities)                                                                  |
| [Validator utilities](./packages/convex-helpers/README.md#validator-utilities)                                              |
| [Filter db queries with JS](./packages/convex-helpers/README.md#filter)                                                     |
| [Manual pagination](./packages/convex-helpers/README.md#manual-pagination)                                                  |
| [Stream and combine data from multiple queries](./packages/convex-helpers/README.md#composable-querystreams)                |
| [Query caching with ConvexQueryCacheProvider](./packages/convex-helpers/README.md#query-caching)                            |
| [TypeScript API Generator](./packages/convex-helpers/README.md#typescript-api-generation)                                   |
| [OpenAPI Spec Generator](./packages/convex-helpers/README.md#open-api-spec-generation)                                      |
| [Triggers](./packages/convex-helpers/README.md#triggers)                                                                    |
| [CORS for HttpRouter](./packages/convex-helpers/README.md#cors-support-for-httprouter)                                      |
| [Standard Schema support](./packages/convex-helpers/README.md#standard-schema)                                              |

| In this directory for copy-pasting:                                                     |
| --------------------------------------------------------------------------------------- |
| [Sessions: via a server table](#server-persisted-session-data)                          |
| [Testing with a local backend](#testing-with-a-local-backend)                           |
| [Throttling via single-flighting](#throttling-client-side-requests-by-single-flighting) |
| [Stable query results via useStableQuery](#stable-query-results-via-usestablequery)     |

## 👉 `convex-helpers` [npm package](https://www.npmjs.com/package/convex-helpers) 👈

In the [packages/ directory](./packages/) there's the [convex-helpers](./packages/convex-helpers/)
directory. To use it in your own project:

```sh
 npm install convex-helpers@latest
```

See also: **[`convex-helpers` package README](./packages/convex-helpers/README.md)**&nbsp;&nbsp;•&nbsp;&nbsp;**[Changelog](./packages/convex-helpers/CHANGELOG.md)**

The sections that follow are examples from which you can copy code.

## Running the examples:

To run these locally, run: `npm i && npm run dev`.
This will symlink the packages/convex-helpers directory so you can edit the
convex helpers source while using it in this example project.
It will also run `chokidar` to re-compile convex-helpers on file changes.
See the [dev script](./packages/convex-helpers/package.json) for details.

## Server-Persisted Session Data

There are two approaches to sessions data:

1. Creating a session ID client-side and passing it up to the server on every
   request. This is the [recommended approach](https://stack.convex.dev/track-sessions-without-cookies)
   and is available by **importing from `"convex-helpers/server/sessions"`**.
   See more [in the convex-helpers README](./packages/convex-helpers/README.md).

2. Create a new session document in a `sessions` table for every new client,
   where you can store associated data.
   See [this article on Stack](https://stack.convex.dev/sessions-wrappers-as-middleware)
   for tips on how to set up and use Sessions. To use these sessions, copy the files:
   - [server/sessions.ts](./packages/convex-helpers/server/sessions.ts) on the server-side to give you action utilities like `ctx.runSessionQuery(...)`.
   - [react/session.ts](./packages/convex-helpers/react/sessions.ts) on the client-side to give you hooks like `useSessionMutation(...)`.
   - You'll need to define a table in your [`convex/schema.ts`](./convex/schema.ts) for whatever your session data looks like. Here we just use `{}`.

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
- `npm run testFunctions` can be used to run these tests. This command does the following:
  - Sets up a fresh local backend (see [backendHarness.js](./backendHarness.js))
  - Sets the `IS_TEST` environment variable to enable calling test only functions
  - Deploys code to the backend
  - Runs the tests
  - Tears down the backend

## Throttling client-side requests by Single-Flighting

See the [Stack post on single-flighting](https://stack.convex.dev/throttling-requests-by-single-flighting) for info on a technique to limit client requests.

You'll need the [useSingleFlight.ts](./example-ui/src/hooks/useSingleFlight.ts) file, or [useLatestValue.ts](./example-ui/src/hooks/useLatestValue.ts) utilities.

## Stable query results via useStableQuery

If you're fine getting stale results from queries when parameters change, check out the [Stack post on useStableQuery](https://stack.convex.dev/help-my-app-is-overreacting).

You'll need the [useStableQuery.ts](./example-ui/src/hooks/useStableQuery.ts) file.

## Presence

Note: you should use the new [Presence Component](https://convex.dev/components/presence).
k
See the [Stack post on implementing presence](https://stack.convex.dev/presence-with-convex) for an older approach on building it yourself. Some files in this repo are based on that post, but you should use the new component instead.

Related files:

- [presence.ts](./convex/presence.ts) for server-side presence functions. Intended to be modified for your application.
- [usePresence.ts](./example-ui/src/hooks/usePresence.ts) for client-side React hooks. Modify to match your server API.
- (optional)[useTypingIndicator.ts](./example-ui/src/hooks/useTypingIndicator.ts) for specifically doing typing indicator presence.
- (optional)[Facepile.tsx](./example-ui/src/components/Facepile.tsx) for showing a facepile based on presence data. Intended to be used as an example to extend.

# 🧑‍🏫 What is Convex?

[Convex](https://convex.dev) is a hosted backend platform with a
built-in database that lets you write your
[database schema](https://docs.convex.dev/database/schemas) and
[server functions](https://docs.convex.dev/functions) in
[TypeScript](https://docs.convex.dev/typescript). Server-side database
[queries](https://docs.convex.dev/functions/query-functions) automatically
[cache](https://docs.convex.dev/functions/query-functions#caching--reactivity) and
[subscribe](https://docs.convex.dev/client/react#reactivity) to data, powering a
[realtime `useQuery` hook](https://docs.convex.dev/client/react#fetching-data) in our
[React client](https://docs.convex.dev/client/react). There are also clients for
[Python](https://docs.convex.dev/client/python),
[Rust](https://docs.convex.dev/client/rust),
[ReactNative](https://docs.convex.dev/client/react-native), and
[Node](https://docs.convex.dev/client/javascript), as well as a straightforward
[HTTP API](https://docs.convex.dev/http-api/).

The database supports
[NoSQL-style documents](https://docs.convex.dev/database/document-storage) with
[opt-in schema validation](https://docs.convex.dev/database/schemas),
[relationships](https://docs.convex.dev/database/document-ids) and
[custom indexes](https://docs.convex.dev/database/indexes/)
(including on fields in nested objects).

The
[`query`](https://docs.convex.dev/functions/query-functions) and
[`mutation`](https://docs.convex.dev/functions/mutation-functions) server functions have transactional,
low latency access to the database and leverage our
[`v8` runtime](https://docs.convex.dev/functions/runtimes) with
[determinism guardrails](https://docs.convex.dev/functions/runtimes#using-randomness-and-time-in-queries-and-mutations)
to provide the strongest ACID guarantees on the market:
immediate consistency,
serializable isolation, and
automatic conflict resolution via
[optimistic multi-version concurrency control](https://docs.convex.dev/database/advanced/occ) (OCC / MVCC).

The [`action` server functions](https://docs.convex.dev/functions/actions) have
access to external APIs and enable other side-effects and non-determinism in
either our
[optimized `v8` runtime](https://docs.convex.dev/functions/runtimes) or a more
[flexible `node` runtime](https://docs.convex.dev/functions/runtimes#nodejs-runtime).

Functions can run in the background via
[scheduling](https://docs.convex.dev/scheduling/scheduled-functions) and
[cron jobs](https://docs.convex.dev/scheduling/cron-jobs).

Development is cloud-first, with
[hot reloads for server function](https://docs.convex.dev/cli#run-the-convex-dev-server) editing via the
[CLI](https://docs.convex.dev/cli),
[preview deployments](https://docs.convex.dev/production/hosting/preview-deployments),
[logging and exception reporting integrations](https://docs.convex.dev/production/integrations/),
There is a
[dashboard UI](https://docs.convex.dev/dashboard) to
[browse and edit data](https://docs.convex.dev/dashboard/deployments/data),
[edit environment variables](https://docs.convex.dev/production/environment-variables),
[view logs](https://docs.convex.dev/dashboard/deployments/logs),
[run server functions](https://docs.convex.dev/dashboard/deployments/functions), and more.

There are built-in features for
[reactive pagination](https://docs.convex.dev/database/pagination),
[file storage](https://docs.convex.dev/file-storage),
[reactive text search](https://docs.convex.dev/text-search),
[vector search](https://docs.convex.dev/vector-search),
[https endpoints](https://docs.convex.dev/functions/http-actions) (for webhooks),
[snapshot import/export](https://docs.convex.dev/database/import-export/),
[streaming import/export](https://docs.convex.dev/production/integrations/streaming-import-export), and
[runtime validation](https://docs.convex.dev/database/schemas#validators) for
[function arguments](https://docs.convex.dev/functions/args-validation) and
[database data](https://docs.convex.dev/database/schemas#schema-validation).

Everything scales automatically, and it’s [free to start](https://www.convex.dev/plans).
