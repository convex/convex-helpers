# convex-helpers

**[NPM](https://www.npmjs.com/package/convex-helpers)**&nbsp;&nbsp;•&nbsp;&nbsp;**[Changelog](./CHANGELOG.md)**

A collection of useful code to complement the official packages.

Table of contents:

- [Custom Functions](#custom-functions)
- [Relationship helpers](#relationship-helpers)
- [Action retries](#action-retries)
- [Stateful migrations](#stateful-migrations)
- [Rate limiting](#rate-limiting)
- [Session tracking via client-side sessionID storage](#session-tracking-via-client-side-sessionid-storage)
- [Richer useQuery](#richer-usequery)
- [Row-level security](#row-level-security)
- [Zod Validation](#zod-validation)
- [Hono for advanced HTTP endpoint definitions](#hono-for-advanced-http-endpoint-definitions)
- [CRUD utilities](#crud-utilities)
- [Validator utilities](#validator-utilities)
- [Filter](#filter)
- [Manual Pagination](#manual-pagination)
  - [Examples](#examples)
  - [`paginator`: manual pagination with familiar syntax](#paginator-manual-pagination-with-familiar-syntax)
- [Composable QueryStreams](#composable-querystreams)
  - [Example 1: Paginate all messages by a fixed set of authors](#example-1-paginate-all-messages-by-a-fixed-set-of-authors)
  - [Example 2: Paginate all messages whose authors match a complex predicate.](#example-2-paginate-all-messages-whose-authors-match-a-complex-predicate)
  - [Example 3: Order by a suffix of an index.](#example-3-order-by-a-suffix-of-an-index)
  - [Example 4: Join tables.](#example-4-join-tables)
- [Query Caching](#query-caching)
- [TypeScript API Generation](#typescript-api-generation)
- [Open API Spec Generation](#open-api-spec-generation)
- [Triggers](#triggers)
  - [What can you do with triggers?](#what-can-you-do-with-triggers)
  - [Trigger semantics](#trigger-semantics)
- [CORS support for HttpRouter](#cors-support-for-httprouter)
- [Standard Schema](#standard-schema)

## Custom Functions

Build your own customized versions of `query`, `mutation`, and `action` that
define custom behavior, allowing you to:

- Run authentication logic before the request starts.
- Look up commonly used data and add it to the ctx argument.
- Replace a ctx or argument field with a different value, such as a version
  of `db` that runs custom functions on data access.
- Consume arguments from the client that are not passed to the action, such
  as taking in an authentication parameter like an API key or session ID.
  These arguments must be sent up by the client along with each request.
- Execute finalization logic after function execution using the `onSuccess`
  callback, which has access to the function's result.

See the associated [Stack Post](https://stack.convex.dev/custom-functions)

For example:

```ts
import { customQuery } from "convex-helpers/server/customFunctions";

const myQueryBuilder = customQuery(query, {
  args: { apiToken: v.id("api_tokens") },
  input: async (ctx, args) => {
    const apiUser = await getApiUser(args.apiToken);
    const db = wrapDatabaseReader({ apiUser }, ctx.db, rlsRules);
    return {
      ctx: { db, apiUser },
      args: {},
      onSuccess: ({ args, result }) => {
        // Optional callback that runs after the function executes
        // Has access to resources created during input processing
        console.log(apiUser.name, args, result);
      },
    };
  },
});

// Use the custom builder everywhere you would have used `query`
export const getSomeData = myQueryBuilder({
  args: { someArg: v.string() },
  handler: async (ctx, args) => {
    const { db, apiUser, scheduler } = ctx;
    const { someArg } = args;
    // ...
  },
});
```

### Taking in extra arguments

You can take in extra arguments to a custom function by specifying the type of a third `input` arg.

```ts
const myQueryBuilder = customQuery(query, {
  args: {},
  input: async (ctx, args, { role }: { role: "admin" | "user" }) => {
    const user = await getUser(ctx);
    if (role === "admin" && user.role !== "admin") {
      throw new Error("You are not an admin");
    }
    if (role === "user" && !user) {
      throw new Error("You must be logged in to access this query");
    }
    return { ctx: { user }, args: {} };
  },
});

const myAdminQuery = myQueryBuilder({
  role: "admin",
  args: {},
  handler: async (ctx, args) => {
    // ...
  },
});
```

### Composing Custom Functions

You can compose custom functions to build middleware layers. This is useful when
you want to add validation or enrich the context without duplicating code.

#### composeCtx

Compose a base middleware with a context transformation:

```ts
import { customCtxAndArgs, composeCtx } from "convex-helpers/server/customFunctions";

// Base middleware with optional staff
const withDevice = customCtxAndArgs({
  args: { token: v.string() },
  input: async (ctx, { token }) => ({
    ctx: { device, staff: staff || null },
    args: {},
  }),
});

// Composed middleware - requires staff
const withDeviceAuth = composeCtx(withDevice, (ctx) => {
  if (!ctx.staff) {
    throw new ConvexError({ code: "STAFF_LOGIN_REQUIRED" });
  }
  return { ...ctx, staff: ctx.staff };
});
```

#### composeCtxAndArgs

Compose a base middleware with additional arguments and a context transformation:

```ts
import { customCtx, composeCtxAndArgs } from "convex-helpers/server/customFunctions";

// Base middleware with user
const withAuth = customCtx(async (ctx) => {
  const user = await getAuthUserOrThrow(ctx);
  return { user };
});

// Extended middleware with user + branch
const withBranch = composeCtxAndArgs(withAuth, {
  args: { orgId: v.id("organizations"), branchId: v.id("branches") },
  transform: async (ctx, { orgId, branchId }) => {
    const branch = await getBranchOrThrow(ctx, branchId);
    return { ...ctx, branch, branchId };
  },
});
```

## Relationship helpers

Traverse database relationships without all the query boilerplate.

See the [Stack post on relationship helpers](https://stack.convex.dev/functional-relationships-helpers)
and the [relationship schema structures post](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas).

Example:

```js
import {
  getOneFromOrThrow,
  getManyFrom,
  getManyViaOrThrow,
} from "convex-helpers/server/relationships.js";
import { asyncMap } from "convex-helpers";

const author = await getOneFromOrThrow(db, "authors", "userId", user._id);
const posts = await asyncMap(
  // one-to-many
  await getManyFrom(db, "posts", "authorId", author._id),
  async (post) => {
    // one-to-many
    const comments = await getManyFrom(db, "comments", "postId", post._id);
    // many-to-many via join table
    const categories = await getManyViaOrThrow(
      db,
      "postCategories",
      "categoryId",
      "postId",
      post._id,
    );
    return { ...post, comments, categories };
  },
);
```

## Action retries

Use helper functions to retry a Convex action until it succeeds.
An action should only be retried if it is safe to do so, i.e., if it's
idempotent or doesn't have any unsafe side effects.

**Note**: this is now an [`action-retrier` component](https://www.convex.dev/components/retrier).
I recommend using that (`npm i @convex-dev/action-retrier`).

See the [Stack post on retrying actions](https://stack.convex.dev/retry-actions)

Example:

```ts
 // in convex/utils.ts
 import { makeActionRetrier } from "convex-helpers/server/retries";

 export const { runWithRetries, retry } = makeActionRetrier("utils:retry");

 // in a mutation or action
 export const myMutation = mutation({
   args: {...},
   handler: async (ctx, args) => {
     //...
     await runWithRetries(ctx, internal.myModule.myAction, { arg1: 123 });
   }
 });
```

## Stateful migrations

A helper to define and run migrations. You can persist the migration state to a
table so you can query the status, or use it without persistence.

Note: there is now a [migration component](https://www.convex.dev/components/migrations)
for you to use instead of this approach. The component has the benefit of not
needing to add any tables to your schema. (`npm i @convex-dev/migrations`)

See the [Stack post on migrations](https://stack.convex.dev/migrating-data-with-mutations)
and the [migration primer Stack post](https://stack.convex.dev/intro-to-migrations).

To see the library code and usage, see the [migrations.ts file](./server/migrations.ts).

Example migration:

```ts
export const myMigration = migration({
  table: "users",
  migrateOne: async (ctx, doc) => {
    await ctx.db.patch(doc._id, { newField: "value" });
  },
});
```

## Rate limiting

Configure and use rate limits to avoid product abuse.

**Note**: this is now a [`rate-limiter` component](https://www.convex.dev/components/rate-limiter) I recommend you use instead.

See the associated Stack post for details:

https://stack.convex.dev/rate-limiting

For usage details, see the [rateLimit.ts file](./server/rateLimit.ts).

## Session tracking via client-side sessionID storage

Store a session ID on the client and pass it up with requests to keep track of
a user, even if they aren't logged in.

Use the client-side helpers in [react/sessions](./react/sessions.ts) and
server-side helpers in [server/sessions](./server/sessions.ts).

See the associated [Stack post](https://stack.convex.dev/track-sessions-without-cookies) for more information.

Example for a query (action & mutation are similar):

In your React's root, add the `SessionProvider`:

```js
import { SessionProvider } from "convex-helpers/react/sessions";
//...
<ConvexProvider client={convex}>
  <SessionProvider>
    <App />
  </SessionProvider>
</ConvexProvider>;
```

Pass the session ID from the client automatically to a server query:

```js
import { useSessionQuery } from "convex-helpers/react/sessions";

const results = useSessionQuery(api.myModule.mySessionQuery, { arg1: 1 });
```

Define a server query function in `convex/myModule.ts`:

```js
export const mySessionQuery = queryWithSession({
  args: { arg1: v.number() },
  handler: async (ctx, args) => {
    // ctx.anonymousUser
  },
});
```

Using `customQuery` to make `queryWithSession`:

```js
import { customQuery } from "convex-helpers/server/customFunctions";
import { SessionIdArg } from "convex-helpers/server/sessions";

export const queryWithSession = customQuery(query, {
  args: SessionIdArg,
  input: async (ctx, { sessionId }) => {
    const anonymousUser = await getAnonUser(ctx, sessionId);
    return { ctx: { ...ctx, anonymousUser }, args: {} };
  },
});
```

**Note:** `getAnonUser` is some function you write to look up a user by session.

## Richer useQuery

Use in place of `useQuery` from "convex/react" to fetch data from a query, with
a richer return value.

By default, `useQuery` will throw an error when the server throws. It also
returns `undefined` to indicate a "loading" state. This helper returns:

```ts
import { makeUseQueryWithStatus } from "convex-helpers/react";
import { useQueries } from "convex/react";
// Do this once somewhere, name it whatever you want.
export const useQueryWithStatus = makeUseQueryWithStatus(useQueries);

const { status, data, error, isSuccess, isPending, isError } =
  useQueryWithStatus(api.foo.bar, { myArg: 123 });
```

The types of the return is:

```ts
type ret =
  | {
      status: "success";
      data: FunctionReturnType<Query>;
      error: undefined;
      isSuccess: true;
      isPending: false;
      isError: false;
    }
  | {
      status: "pending";
      data: undefined;
      error: undefined;
      isSuccess: false;
      isPending: true;
      isError: false;
    }
  | {
      status: "error";
      data: undefined;
      error: Error;
      isSuccess: false;
      isPending: false;
      isError: true;
    };
```

## Row-level security

See the [Stack post on row-level security](https://stack.convex.dev/row-level-security)

Use the [RowLevelSecurity](./server/rowLevelSecurity.ts) helper to define
database wrappers to add row-level checks for a server-side function.
Any access to `db` inside functions wrapped with these
will check your access rules on read/insert/modify per-document.

```ts
import {
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import {
  Rules,
  RLSConfig,
  wrapDatabaseReader,
  wrapDatabaseWriter,
} from "convex-helpers/server/rowLevelSecurity";
import { DataModel } from "./_generated/dataModel";
import { mutation, query, QueryCtx } from "./_generated/server";

async function rlsRules(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  return {
    users: {
      read: async (_, user) => {
        // Unauthenticated users can only read users over 18
        if (!identity && user.age < 18) return false;
        return true;
      },
      insert: async (_, user) => {
        return true;
      },
      modify: async (_, user) => {
        if (!identity)
          throw new Error("Must be authenticated to modify a user");
        // Users can only modify their own user
        return user.tokenIdentifier === identity.tokenIdentifier;
      },
    },
  } satisfies Rules<QueryCtx, DataModel>;
}

// By default, tables with no rule have `defaultPolicy` set to "allow".
const config: RLSConfig = { defaultPolicy: "deny" };

const queryWithRLS = customQuery(
  query,
  customCtx(async (ctx) => ({
    db: wrapDatabaseReader(ctx, ctx.db, await rlsRules(ctx), config),
  })),
);

const mutationWithRLS = customMutation(
  mutation,
  customCtx(async (ctx) => ({
    db: wrapDatabaseWriter(ctx, ctx.db, await rlsRules(ctx), config),
  })),
);
```

## Zod Validation

Convex has argument validation, but if you prefer the [Zod](https://zod.dev)
features for validating arguments, this is for you!

See the [Stack post on Zod validation](https://stack.convex.dev/typescript-zod-function-validation) to see how to validate your Convex functions using the [zod](https://www.npmjs.com/package/zod) library.

Example:

```js
import * as z from "zod";
import { zCustomQuery, zid } from "convex-helpers/server/zod4";
import { NoOp } from "convex-helpers/server/customFunctions";

// Define this once - and customize like you would customQuery
const zodQuery = zCustomQuery(query, NoOp);

export const myComplexQuery = zodQuery({
  args: {
    userId: zid("users"),
    email: z.email(),
    num: z.number().min(0),
    nullableBigint: z.nullable(z.bigint()),
    boolWithDefault: z.boolean().default(true),
    null: z.null(),
    array: z.array(z.string()),
    optionalObject: z.object({ a: z.string(), b: z.number() }).optional(),
    union: z.union([z.string(), z.number()]),
    discriminatedUnion: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("a"), a: z.string() }),
      z.object({ kind: z.literal("b"), b: z.number() }),
    ]),
    literal: z.literal("hi"),
    enum: z.enum(["a", "b"]),
    readonly: z.object({ a: z.string(), b: z.number() }).readonly(),
    pipeline: z.number().pipe(z.coerce.string()),
  },
  handler: async (ctx, args) => {
    //... args at this point has been validated and has the types of what
    // zod parses the values into.
    // e.g. boolWithDefault is `bool` but has an input type `bool | undefined`.
  },
});
```

## Hono for advanced HTTP endpoint definitions

[Hono](https://hono.dev/) is an optimized web framework you can use to define
HTTP api endpoints easily
([`httpAction` in Convex](https://docs.convex.dev/functions/http-actions)).

See the [guide on Stack](https://stack.convex.dev/hono-with-convex) for tips on using Hono for HTTP endpoints.

To use it, put this in your `convex/http.ts` file:

```ts
import { Hono } from "hono";
import { HonoWithConvex, HttpRouterWithHono } from "convex-helpers/server/hono";
import { ActionCtx } from "./_generated/server";

const app: HonoWithConvex<ActionCtx> = new Hono();

// See the [guide on Stack](https://stack.convex.dev/hono-with-convex)
// for tips on using Hono for HTTP endpoints.
app.get("/", async (c) => {
  return c.json("Hello world!");
});

export default new HttpRouterWithHono(app);
```

## CRUD utilities

To generate a basic CRUD api for your tables, you can use this helper to define
these functions for a given table:

- `create`
- `read`
- `update`
- `delete`
- `paginate`

See the associated [Stack post](https://stack.convex.dev/crud-and-rest).
**Note: I recommend only doing this for prototyping or [internal functions](https://docs.convex.dev/functions/internal-functions) unless you add Row Level Security**

Example:

```ts
// in convex/users.ts
import { crud } from "convex-helpers/server/crud";
import schema from "./schema.js";

export const { create, read, update, destroy } = crud(schema, "users");

// in some file, in an action:
const user = await ctx.runQuery(internal.users.read, { id: userId });

await ctx.runMutation(internal.users.update, {
  id: userId,
  patch: {
    status: "inactive",
  },
});
```

## Validator utilities

When using validators for defining database schema or function arguments,
these validators help:

1. Add shorthand for a union of `literals`, a `nullable` field, a `deprecated`
   field, a `partial` object, and `brandedString`.
   To learn more about branded strings see
   [this article](https://stack.convex.dev/using-branded-types-in-validators).
2. A `validate(validator, data)` function validates a value against a validator.
   Warning: this does not validate that the value of v.id is an ID for the given table.
3. Add utilties for `partial`, `pick` and `omit` to match the TypeScript type
   utilities.
4. Add a `doc(schema, "tableName")` helper to validate a document with system
   fields included.
5. Add a `typedV(schema)` helper that is a `v` replacement that also has:
   - `doc("tableName")` that works like `doc` above.
   - `id("tableName")` that is typed to tables in your schema.
6. Add a `Table` utility that defines a table and keeps references to the fields
   to avoid re-defining validators. To learn more about sharing validators, read
   [this article](https://stack.convex.dev/argument-validation-without-repetition),
   an extension of [this article](https://stack.convex.dev/types-cookbook).

Example:

```ts
// convex/schema.ts
import { literals, deprecated, brandedString } from "convex-helpers/validators";
import { Infer } from "convex/values";

// Define a validator that requires an Email string type.
export const emailValidator = brandedString("email");
// Define the Email type based on the branded string.
export type Email = Infer<typeof emailValidator>;

export default defineSchema({
  accounts: defineTable({
    balance: nullable(v.bigint()),
    status: literals("active", "inactive"),
    email: emailValidator,
    oldField: deprecated,
  }).index("status", ["status"]),
  //...
});

// some module
import { doc, typedV, partial } from "convex-helpers/validators";
import { omit, pick } from "convex-helpers";
import schema from "./schema";

// You could export this from your schema file, or define it where you need it.
const vv = typedV(schema);

export const replaceUser = internalMutation({
  args: {
    id: vv.id("accounts"),
    replace: vv.object({
      // You can provide the document with or without system fields.
      ...schema.tables.accounts.validator.fields,
      ...partial(systemFields("accounts")),
    }),
  },
  returns: doc(schema, "accounts"), // See below for vv.doc
  handler: async (ctx, args) => {
    await ctx.db.replace(args.id, args.replace);
    return await ctx.db.get(args.id);
  },
});

// A validator just for balance & email: { balance: v.union(...), email: ..}
const balanceAndEmail = pick(vv.doc("accounts").fields, ["balance", "email"]);

// A validator for all the fields except balance.
const accountWithoutBalance = omit(vv.doc("accounts").fields, ["balance"]);

// Validate against a validator. Can optionally throw on error.
const value = { balance: 123n, email: "test@example.com" };
validate(balanceAndEmail, value);

// This will throw a ValidationError if the value is not valid.
validate(balanceAndEmail, value, { throw: true });

// Warning: this only validates that `accountId` is a string.
validate(vv.id("accounts"), accountId);
// Whereas this validates that `accountId` is an id for the accounts table.
validate(vv.id("accounts"), accountId, { db: ctx.db });
```

## Filter

See the [guide on Stack](https://stack.convex.dev/complex-filters-in-convex)
for an analysis of complex filters on Convex.

The `filter` helper composes with `ctx.db.query` to apply arbitrary TypeScript
or JavaScript filters to a database query.

Examples:

```js
import { filter } from "convex-helpers/server/filter";

export const evens = query({
  args: {},
  handler: async (ctx) => {
    return await filter(
      ctx.db.query("counter_table"),
      (c) => c.counter % 2 === 0,
    ).collect();
  },
});

export const lastCountLongerThanName = query({
  args: {},
  handler: async (ctx) => {
    return await filter(
      ctx.db.query("counter_table"),
      (c) => c.counter > c.name.length,
    )
      .order("desc")
      .first();
  },
});
```

## Manual Pagination

Note Convex provides built-in pagination through `.paginate()` and
`usePaginatedQuery()`.

The `getPage` helper gives you more control of the pagination. You can specify
the index ranges or do multiple paginations in the same query.
An index range is all of the documents between two index keys: (start, end].
An index key is an array of values for the fields in the specified index.
For example, for an index defined like `defineTable({ a: v.number(), b: v.string() }).index("my_index", ["a", "b"])`
an index key might be `[ 3 ]` or `[ 3, "abc" ]`. By default the index is the built-in "by_creation_time" index.
The returned index keys are unique, including the two fields at the end of every index: `_creationTime` and `_id`.

However, you have to handle edge cases yourself, as described in
https://stack.convex.dev/fully-reactive-pagination.

More details and patterns will appear in upcoming articles.

### Examples

Fetch the first page, by creation time:

```js
const { page, indexKeys, hasMore } = await getPage(ctx, {
  table: "messages",
});
```

Fetch the next page:

```js
const {
  page: page2,
  indexKeys: indexKeys2,
  hasMore: hasMore2,
} = await getPage(ctx, {
  table: "messages",
  startIndexKey: indexKeys[indexKeys.length - 1],
});
```

You can change the page size and order by any index:

```js
import schema from "./schema";
const { page, indexKeys, hasMore } = await getPage(ctx, {
  table: "users",
  index: "by_name",
  schema,
  targetMaxRows: 1000,
});
```

Fetch of a page between two fixed places in the index, allowing you to display
continuous pages even as documents change.

```js
const { page } = await getPage(ctx, {
  table: "messages",
  startIndexKey,
  endIndexKey,
});
```

Fetch starting at a given index key.
For example, here are yesterday's messages, with recent at the top:

```js
const { page, indexKeys, hasMore } = await getPage(ctx, {
  table: "messages",
  startIndexKey: [Date.now() - 24 * 60 * 60 * 1000],
  startInclusive: true,
  order: "desc",
});
```

### `paginator`: manual pagination with familiar syntax

In addition to `getPage`, convex-helpers provides a function
`paginator` as an alternative to the built-in `db.query.paginate`.

- The built-in `.paginate` is currently limited to one call per query, which allows
  it to track the page's "end cursor" for contiguous reactive pagination client-side.
- `paginator` can be called multiple times from a query,
  but does not subscribe the query to the end cursor automatically.

The syntax and interface for `paginator` is so similar to `.paginate` that it is
nearly a drop-in replacement and can even be used with `usePaginatedQuery`[^1].
This makes it more suitable for non-reactive pagination usecases,
such as iterating data in a mutation. Note: it supports `withIndex` but not `filter`.

[^1]:
    Note: if you want gapless pagination, use the `usePaginatedQuery` hook in
    `"convex-helpers/react"`, or if you're also using the cached query helpers, pass
    `customPagination: true` for that version.

For more information on reactive pagination and end cursors, see
https://stack.convex.dev/fully-reactive-pagination
and
https://stack.convex.dev/pagination

As a basic example, consider replacing this query with `paginator`.
It has the same behavior, except that the pages might not stay contiguous as
items are added and removed from the list and the query updates reactively.

```ts
import { paginator } from "convex-helpers/server/pagination";
import schema from "./schema";

export const list = query({
  args: { opts: paginationOptsValidator },
  handler: async (ctx, { opts }) => {
    // BEFORE:
    return await ctx.db.query("messages").paginate(opts);
    // AFTER:
    return await paginator(ctx.db, schema).query("messages").paginate(opts);
  },
});
```

You can order by an index, restrict the pagination to a range of the index,
and change the order to "desc", same as you would with a regular query.

```ts
import { paginator } from "convex-helpers/server/pagination";
import schema from "./schema";

export const list = query({
  args: { opts: paginationOptsValidator, author: v.id("users") },
  handler: async (ctx, { opts, author }) => {
    return await paginator(ctx.db, schema)
      .query("messages")
      .withIndex("by_author", (q) => q.eq("author", author))
      .order("desc")
      .paginate(opts);
  },
});
```

## Composable QueryStreams

In Convex queries, you can read data from many tables in many ways, and combine
the data before returning to to the client. However, some patterns aren't so
easy without these helpers. In particular, these helpers will allow you to take
a union of multiple queries, filter out some of them, join with other tables,
and paginate the result.

- A `QueryStream` is an
  [async iterable](https://javascript.info/async-iterators-generators)
  of documents, ordered by indexed fields.

The cool thing about QueryStreams is you can make more QueryStreams from them,
with operations equivalent to SQL's `UNION ALL`, `WHERE`, and `JOIN`.
These operations preserve order, so the result is still a valid QueryStream.
You can combine streams as much as you want, and finally treat it like a
Convex query to get documents with `.first()`, `.collect()`, or `.paginate()`.
See [this Stack post](https://stack.convex.dev/translate-sql-into-convex-queries)
for examples of translating SQL queries into Convex queries.

For example, if you have a stream of "messages created by user1" and a stream
of "messages created by user2", you can get a stream of
"messages created by user1 or user2" where the messages are interleaved
by creation time (or whatever the order is of the index you're using). You can
then filter the merged stream to get a stream of "messages created by user1 or user2 that are unread". Then you
can paginate the result.

See [this Stack post](https://stack.convex.dev/merging-streams-of-convex-data)
for more information.

Concrete functions you can use:

- `stream` constructs a stream using the same syntax as `DatabaseReader`.
  - e.g. `stream(ctx.db, schema).query("messages").withIndex("by_author", (q) => q.eq("author", "user1"))`
- `mergedStream(streams, fields)` combines multiple streams into a new stream, ordered by the same index fields.
- `.flatMap` expands each document into its own stream, and they all get chained together.
- `.map` modifies each stream item, preserving order.
- `.filterWith` filters out documents from a stream based on a TypeScript predicate.
- Once your stream is set up, you can get documents from it with the normal
  Convex query methods: `.first()`, `.collect()`, `.paginate()`, etc.

Note: if using `.paginate()` with streams in reactive queries, use the
`usePaginatedQuery` hook from `"convex-helpers/react"`, or if you're also using
the cached query helpers, pass `customPagination: true` for that version.
It has the same behavior as [`paginator` and `getPage`](#manual-pagination) in
that you need to pass in `endCursor` to prevent holes or overlaps between pages.

### Example 1: Paginate all messages by a fixed set of authors

```ts
import { stream, mergedStream } from "convex-helpers/server/stream";
import schema from "./schema";
// schema has messages: defineTable(...).withIndex("by_author", ["author"])

export const listForAuthors = query({
  args: {
    authors: v.array(v.id("users")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { authors, paginationOpts }) => {
    // This is an array of streams, where each stream consists of messages by a
    // single author.
    const authorStreams = authors.map((author) =>
      stream(ctx.db, schema)
        .query("messages")
        .withIndex("by_author", (q) => q.eq("author", author)),
    );
    // Create a new stream of all messages authored by users in `args.authors`,
    // ordered by the "by_author" index (i.e. ["author", "_creationTime"]).
    const allAuthorsStream = mergedStream(authorStreams, [
      "author",
      "_creationTime",
    ]);
    // Paginate the result.
    return await allAuthorsStream.paginate(paginationOpts);
  },
});
```

### Example 2: Paginate all messages whose authors match a complex predicate.

There are actually two ways to do this. One uses "post-filter" pagination,
where the filter is applied after fetching a fixed number of documents. To do that, you can
use the `filter` helper described [above](#filter). The advantage is that the
queries read bounded data, but the disadvantage is that the returned pages might
be small or empty.

The other does "pre-filter" pagination, where the filter is applied before
picking the page size. Doing this with a filter that excludes most documents may
result in slow queries or errors because it's reading too much data, but if the
predicate often returns true, it's perfectly fine. To avoid edge cases where you
accidentally read too much data, you can pass `maximumRowsRead` in pagination
options to limit the number of rows read. Let's see how to do
pre-filtering with streams.

```ts
import { stream } from "convex-helpers/server/stream";
import schema from "./schema";

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const allMessagesStream = stream(ctx.db, schema)
      .query("messages")
      .order("desc")
      .filterWith(async (message) => {
        const author = await ctx.db.get(message.author);
        return author !== null && author.verified;
      });
    // The pagination happens after the filtering, so the page should have size
    // `paginationOpts.numItems`.
    // To avoid reading too much data unexpectedly, you can optionally set maximumRowsRead.
    return await allMessagesStream.paginate({
      ...paginationOpts,
      maximumRowsRead: 100,
    });
  },
});
```

As with any usage of [`paginator`](#paginator-manual-pagination-with-familiar-syntax), remember to use `endCursor` in reactive queries to keep pages contiguous.

### Example 3: Order by a suffix of an index.

Suppose you have an index on `["author", "unread"]` and you want to get the
most recent 10 messages for an author, ignoring whether a messages is unread.

Normally this would require a separate index on `["author"]`, or doing two
requests and manually picking the 10 most recent. But with streams, it's cleaner:

```ts
import { stream, MergedStream } from "convex-helpers/server/stream";
import schema from "./schema";
// schema has messages: defineTable(...).index("by_author", ["author", "unread"])

export const latestMessages = query({
  args: { author: v.id("users") },
  handler: async (ctx, { author }) => {
    // These are two streams of messages, each ordered by _creationTime descending.
    // The first has read messages, the second has unread messages.
    const readMessages = stream(ctx.db, schema)
      .query("messages")
      .withIndex("by_author", (q) => q.eq("author", author).eq("unread", false))
      .order("desc");
    const unreadMessages = stream(ctx.db, schema)
      .query("messages")
      .withIndex("by_author", (q) => q.eq("author", author).eq("unread", true))
      .order("desc");
    // Since each stream is ordered by ["_creationTime"], we can merge them and
    // maintain that ordering.

    // Aside: We could instead choose to merge the streams ordered by ["unread", "_creationTime"]
    // or ordered by ["author", "unread", "_creationTime"].

    // `allMessagesByCreationTime` is a single stream of all messages authored by
    // `args.author`, ordered by _creationTime descending.
    const allMessagesByCreationTime = new MergedStream(
      [readMessages, unreadMessages],
      ["_creationTime"],
    );
    return await allMessagesByCreationTime.take(10);
  },
});
```

### Example 4: Join tables.

Suppose you have a table of channels, and another table of messages.
You want to paginate all messages in a user's channels, grouped by channel.
You could do this from the client with a `usePaginatedQuery` for each channel,
or you can do it with streams, like so:

```ts
import { stream } from "convex-helpers/server/stream";
import schema from "./schema";
// schema has:
//   channelMemberships: defineTable(...).index("userId", ["userId", "channelId"])
//   channels: defineTable(...)
//   messages: defineTable(...).index("channelId", ["channelId"])

// Return a paginated stream of { ...channel, ...message }
// ordered by
// [channelMembership.channelId, channelMembership._creationTime, message.channelId, message._creationTime],
// i.e. ordered by [channel._id, message._creationTime]
// if we assume the channelMemberships.userId index is unique
export const latestMessages = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    // Get the channels the user is a member of
    const userId = await getAuthedUserId(ctx);
    const channelMemberships = stream(ctx.db, schema)
      .query("channelMemberships")
      .withIndex("userId", (q) => q.eq("userId", userId));
    // Map membership to the channel info (including channel name, etc.)
    const channels = channelMemberships.map(async (membership) => {
      return (await ctx.db.get(membership.channelId))!;
    });
    // For each channel, expand it into the messages in that channel,
    // with the channel's fields also included.
    const messages = channels.flatMap(
      async (channel) =>
        stream(ctx.db, schema)
          .query("messages")
          .withIndex("channelId", (q) => q.eq("channelId", channel._id))
          .map(async (message) => ({ ...channel, ...message })),
      ["channelId", "_creationTime"],
    );
    return await messages.paginate(paginationOpts);
  },
});
```

## Query Caching

Utilize a query cache implementation which persists subscriptions to the
server for some expiration period even after app `useQuery` hooks have all
unmounted. This allows very fast reloading of unevicted values during
navigation changes, view changes, etc.

Note: unlike other forms of caching, subscription caching will mean strictly
more bandwidth usage, because it will keep the subscription open even after
the component unmounts. This is for optimizing the user experience, not database
bandwidth.

Related files:

- [cache.ts](./react/cache.ts) re-exports things so you can import from a single convenient location.
- [provider.tsx](./react/cache/provider.tsx) contains `ConvexQueryCacheProvider`,
  a configurable cache provider you put in your react app's root.
- [hooks.ts](./react/cache/hooks.ts) contains cache-enabled drop-in
  replacements for `useQuery`, `usePaginatedQuery`, and `useQueries`.

To use the cache, first make sure to put a `<ConvexQueryCacheProvider>`
inside `<ConvexProvider>` in your react component tree:

```tsx
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache";
// For Next.js, import from "convex-helpers/react/cache/provider"; instead

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ConvexClientProvider>
          <ConvexQueryCacheProvider>{children}</ConvexQueryCacheProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
```

This provider takes three optional props:

- **expiration** (number) -- Milliseconds to preserve unmounted subscriptions
  in the cache. After this, the subscriptions will be dropped, and the value
  will have to be re-fetched from the server. (Default: 300000, aka 5 minutes)
- **maxIdleEntries** (number) -- Maximum number of unused subscriptions
  kept in the cache. (Default: 250).
- **debug** (boolean) -- Dump console logs every 3s to debug the state of
  the cache (Default: false).

Finally, you can utilize `useQuery` (and `useQueries`) just the same as
their `convex/react` equivalents.

```tsx
import { useQuery } from "convex-helpers/react/cache";
// For Next.js, import from "convex-helpers/react/cache/hooks"; instead

// ...

const users = useQuery(api.todos.getAll);
```

## TypeScript API Generation

Install the CLI and its optional `prettier` peer dependency together in your project
so `npx` uses the local CLI, which can resolve that copy of Prettier:

```bash
npm install --save-dev convex-helpers prettier
```

Generate Convex API objects to use Convex with type-safety in separate repositories.
Once in the Convex folder whose functions you want to make an API for, you can run

```bash
npx convex-helpers ts-api-spec
```

By default, this connects to your Convex dev deployment, but you can pass in `--prod`
to read from your production deployment.

This command writes a `convexApi{msSinceEpoch}.ts` file that can be used in external repositories to
use your Convex functions with type-safety. It includes your internal functions, but you
can feel free to remove them.

## Open API Spec Generation

First, install the CLI and its optional `prettier` peer dependency locally:

```bash
npm install --save-dev convex-helpers prettier
```

Generate an Open API spec to create a client in a language that Convex doesn't currently
support or connect with tools like Retool. Once in the Convex folder whose functions you
want to generate a specification for, you can run

```bash
npx convex-helpers open-api-spec
```

By default, this connects to your Convex dev deployment, but you can pass in `--prod`
to read from your production deployment.

This command writes a `convex-spec-{msSinceEpoch}.yaml` file that can be used in external repositories to
use your Convex functions with type-safety. See `--help` for more details.

## Triggers

Register trigger functions to run whenever data in a table changes via
`ctx.db.insert`, `ctx.db.patch`, `ctx.db.replace`, or `ctx.db.delete`. The
functions run in the same transaction as the mutation, atomically with the data
change.

Triggers pair with [custom functions](#custom-functions) to hook into each
Convex mutation defined. Here's an example of using triggers to do four things:

1. Attach a computed `fullName` field to every user.
2. Keep a denormalized count of all users.
3. After the mutation, send the new user info to Clerk.
4. When a user is deleted, delete their messages (cascading deletes).

```ts
import { mutation as rawMutation } from "./_generated/server";
import { DataModel } from "./_generated/dataModel";
import { Triggers } from "convex-helpers/server/triggers";
import {
  customCtx,
  customMutation,
} from "convex-helpers/server/customFunctions";

const triggers = new Triggers<DataModel>();

// 1. Attach a computed `fullName` field to every user.
triggers.register("users", async (ctx, change) => {
  if (change.newDoc) {
    const fullName = `${change.newDoc.firstName} ${change.newDoc.lastName}`;
    // Abort the mutation if document is invalid.
    if (fullName === "The Balrog") {
      throw new Error("you shall not pass");
    }
    // Update denormalized field. Check first to avoid recursion
    if (change.newDoc.fullName !== fullName) {
      await ctx.db.patch(change.id, { fullName });
    }
  }
});

// 2. Keep a denormalized count of all users.
triggers.register("users", async (ctx, change) => {
  // Note writing the count to a single document increases write contention.
  // There are more scalable methods if you need high write throughput.
  const countDoc = (await ctx.db.query("userCount").unique())!;
  if (change.operation === "insert") {
    await ctx.db.patch(countDoc._id, { count: countDoc.count + 1 });
  } else if (change.operation === "delete") {
    await ctx.db.patch(countDoc._id, { count: countDoc.count - 1 });
  }
});

// 3. After an insert or update, send the new user info to Clerk.
// Even if a user is modified multiple times in a single mutation,
// `internal.users.updateClerkUser` runs once.
const scheduled: Record<Id<"users">, Id<"_scheduled_functions">> = {};
triggers.register("users", async (ctx, change) => {
  if (scheduled[change.id]) {
    await ctx.scheduler.cancel(scheduled[change.id]);
    delete scheduled[change.id];
  }
  // Cancel any pending update on deletion; Clerk deletions need a separate handler.
  if (change.operation === "delete") return;
  scheduled[change.id] = await ctx.scheduler.runAfter(
    0,
    internal.users.updateClerkUser,
    { user: change.newDoc },
  );
});

// 4. When a user is deleted, delete their messages (cascading deletes).
triggers.register("users", async (ctx, change) => {
  if (change.operation !== "delete") return;
  // Using relationships.ts helpers for succinctness.
  await asyncMap(
    await getManyFrom(ctx.db, "messages", "owner", change.id),
    (message) => ctx.db.delete(message._id),
  );
});

// Use `mutation` to define all mutations, and the triggers will get called.
export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
```

Now that you have redefined `mutation`, add an
[eslint rule](https://stack.convex.dev/eslint-setup#no-restricted-imports) to
forbid using the raw mutation wrappers which don't call your triggers.

### What can you do with triggers?

- Denormalize computed fields onto the same table or into a different table.
  - Such fields can be indexed for more efficient lookup.
- By default, triggers will trigger more triggers.
  - This can be useful to ensure denormalized fields stay consistent, no matter
    where they are modified.
  - Watch out for infinite loops of triggers.
  - Use `ctx.innerDb` to perform writes without triggering more triggers.
- Use global variables to coordinate across trigger invocations, e.g. to batch
  or debounce or single-flight async processing.
- Combine with other custom functions that can pre-fetch data, like fetching the
  authorized user at the start of the mutation.
- Throw errors, which can prevent the write by aborting the mutation.
  - Validate constraints and internal consistency.
  - Check row-level-security rules to validate the write is authorized.
- Components like
  [Aggregate](https://www.npmjs.com/package/@convex-dev/aggregate) can define
  triggers by exposing a method like `TableAggregate.trigger()` that returns a
  `Trigger<Ctx, DataModel, TableName>`. This "attaches" the component to a
  table.

### Trigger semantics

- The `change` argument tells you exactly how the document changed via a single
  `ctx.db.insert`, `ctx.db.patch`, `ctx.db.replace`, or `ctx.db.delete`.
  If these functions are called in parallel with `Promise.all`, they will be
  serialized as if they happened sequentially.
- A database write is executed atomically with all of its triggers, so you can
  update a denormalized field in a trigger without worrying about parallel
  writes getting in the way.
- If a write kicks off recursive triggers, they are executed with a queue,
  i.e. breadth-first-search order.
- If a trigger function throws an error, it will be thrown from the database
  write (e.g. `ctx.db.insert`) that caused the trigger.
  - If a trigger's error is caught, the database write can still be committed.
  - To maximize fairness and consistency, all triggers still run, even if an
    earlier trigger threw an error. The first trigger that throws an error will
    have its error rethrown; other errors are `console.error` logged.

> Warning: Triggers only run through `mutation`s and `internalMutation`s when
> wrapped with `customFunction`s.
>
> If you forget to use the wrapper, the triggers won't run (use
> [eslint rules](https://stack.convex.dev/eslint-setup#no-restricted-imports)).
>
> If you edit data in the Convex dashboard, the triggers won't run.
>
> If you upload data through `npx convex import`, the triggers won't run.

## CORS support for HttpRouter

Add CORS support to your Convex httpAction routes by registering a
handler for OPTIONS preflight requests and returning the appropriate headers.
Supports configuring allowed origins, allowed headers, exposed headers, allowing credentials, and browser cache max age, both for the entire router and per route overrides.

Here's a snippet from our `http.ts` file demonstrating how to use `corsRouter`:

```typescript
import { corsRouter } from "convex-helpers/server/cors";
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

// Your standard Convex http router:
const http = httpRouter();

// Your CORS router:
const cors = corsRouter(
  http,
  // Optional configuration, can be omitted entirely
  {
    // allowedOrigins can also be a function
    // allowedOrigins: (req: Request) => Promise<string[]>
    allowedOrigins: ["http://localhost:8080"], // Default: ["*"]
    // Allowed methods come from the routes registered below.
    allowedHeaders: ["Content-Type"], // Default: ["Content-Type"]
    exposedHeaders: ["Custom-Header"], // Default: ["Content-Range", "Accept-Ranges"]
    allowCredentials: true, // Default: false
    browserCacheMaxAge: 60, // Default: 86400 (1 day)
    // returns a 403 if the origin is not allowed
    enforceAllowOrigins: true, // Default: false
    debug: true, // Default: false
  },
);

cors.route({
  path: "/foo",
  method: "GET",
  handler: httpAction(async () => {
    return new Response("ok");
  }),
});

cors.route({
  path: "/foo",
  // You can register multiple methods for the same path
  method: "POST",
  handler: httpAction(async () => {
    return new Response("ok");
  }),
  // You can provide configuration per route
  allowedOrigins: ["http://localhost:8080"],
});

// Non-CORS routes still work, provided they're on different paths.
http.route({
  path: "/notcors",
  method: "GET",
  handler: httpAction(async () => {
    return new Response("ok");
  }),
});
// Export http (or cors.http)
export default http;
```

## Standard Schema

[Standard Schema](https://github.com/standard-schema/standard-schema)
is a specification for validating data.
To convert a Convex validator to a Standard Schema, use `toStandardSchema`:

```typescript
import { toStandardSchema } from "convex-helpers/standardSchema";

const standardValidator = toStandardSchema(
  v.object({
    name: v.string(),
    age: v.number(),
  }),
);

standardValidator["~standard"].validate({
  name: "John",
  age: 30,
});
```
