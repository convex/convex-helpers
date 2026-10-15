# convex-helpers

A collection of useful code to complement the official packages.
This directory contains the example frontend, and [`../convex/`](../convex/)
contains its backend. The npm package lives in
[`../packages/convex-helpers/`](../packages/convex-helpers/).

The sections that follow are examples from which you can copy code.

## Throttling client-side requests by Single-Flighting

See the [Stack post on single-flighting](https://stack.convex.dev/throttling-requests-by-single-flighting) for info on a technique to limit client requests.

You'll need the [useSingleFlight.ts](./src/hooks/useSingleFlight.ts) file, or [useLatestValue.ts](./src/hooks/useLatestValue.ts) utilities.

## Stable query results via useStableQuery

If you're fine getting stale results from queries when parameters change, check out the [Stack post on useStableQuery](https://stack.convex.dev/help-my-app-is-overreacting).

You'll need the [useStableQuery.ts](./src/hooks/useStableQuery.ts) file.
