# convex-helpers examples

This directory contains the example frontend. Its backend lives in
[`../convex/`](../convex/), and package sources live in
[`../packages/convex-helpers/`](../packages/convex-helpers/).
See the [package documentation](../README.md) for the helpers themselves.

The sections that follow are examples from which you can copy code.

## Running the examples:

From the repository root, run `npm i && npm run dev`.
The root package builds into `dist/`, and the examples import it by name.
You can edit sources in `packages/convex-helpers/` while using this example app.
It will also run `chokidar` to re-compile convex-helpers on file changes.
See the [dev script](../package.json) for details.

## Server-Persisted Session Data

There are two approaches to sessions data:

1. Creating a session ID client-side and passing it up to the server on every
   request. This is the [recommended approach](https://stack.convex.dev/track-sessions-without-cookies)
   and is available by **importing from `"convex-helpers/server/sessions"`**.
   See more [in the convex-helpers README](../README.md).

2. Create a new session document in a `sessions` table for every new client,
   where you can store associated data.
   See [this article on Stack](https://stack.convex.dev/sessions-wrappers-as-middleware)
   for tips on how to set up and use Sessions. To use these sessions, copy the files:
   - [server/sessions.ts](../packages/convex-helpers/server/sessions.ts) on the server-side to give you action utilities like `ctx.runSessionQuery(...)`.
   - [react/session.ts](../packages/convex-helpers/react/sessions.ts) on the client-side to give you hooks like `useSessionMutation(...)`.
   - You'll need to define a table in your [`convex/schema.ts`](../convex/schema.ts) for whatever your session data looks like. Here we just use `{}`.

## Testing with a local backend

See [backendHarness.js](../backendHarness.js) for instructions on testing Convex
functions against a local backend, including setup and the command to run.

## Throttling client-side requests by Single-Flighting

See the [Stack post on single-flighting](https://stack.convex.dev/throttling-requests-by-single-flighting) for info on a technique to limit client requests.

You'll need the [useSingleFlight.ts](./src/hooks/useSingleFlight.ts) file, or [useLatestValue.ts](./src/hooks/useLatestValue.ts) utilities.

## Stable query results via useStableQuery

If you're fine getting stale results from queries when parameters change, check out the [Stack post on useStableQuery](https://stack.convex.dev/help-my-app-is-overreacting).

You'll need the [useStableQuery.ts](./src/hooks/useStableQuery.ts) file.

## Presence

Note: you should use the new [Presence Component](https://convex.dev/components/presence).
See the [Stack post on implementing presence](https://stack.convex.dev/presence-with-convex) for an older approach on building it yourself. Some files in this repo are based on that post, but you should use the new component instead.

Related files:

- [presence.ts](../convex/presence.ts) for server-side presence functions. Intended to be modified for your application.
- [usePresence.ts](./src/hooks/usePresence.ts) for client-side React hooks. Modify to match your server API.
- (optional)[useTypingIndicator.ts](./src/hooks/useTypingIndicator.ts) for specifically doing typing indicator presence.
- (optional)[Facepile.tsx](./src/components/Facepile.tsx) for showing a facepile based on presence data. Intended to be used as an example to extend.
