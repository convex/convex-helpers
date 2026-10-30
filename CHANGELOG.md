# Changelog

## 0.1.133

- Zod 4 support: when a `z.object()` schema is passed as `args` to
  `zCustomQuery`/`zCustomMutation`/`zCustomAction`, checks on the object
  itself (`.refine()`, `.superRefine()`, `.check()`) are now run. Previously
  they were silently skipped. (#1055)

## 0.1.132

- Enforces defaultPolicy: "deny" for RLS on bare db.get calls where
  table name is not provided and cannot be determined.

## 0.1.131

- Zod 4 support: fixed a regression in 0.1.130 when chaining multiple `.brand()`
  calls together.

## 0.1.130

- Zod 4 support: bug fixes when used across different Zod versions:
  - `zodToConvex` now makes the fields of `z.partialRecord` optional on Zod 4.5
    and later, with literal and enum keys. Thanks to @aymanemt1 for the fix!
    (#1025, #1047)
  - Fixed `TS2589: Type instantiation is excessively deep and possibly infinite`
    when calling `convexToZod` inline (e.g. in the `args` of `zCustomMutation`)
    on Zod 4.6.6 and later. Thanks to @jherth for the fix! (#1043)
  - Fixed the type of `v.commitTs()` in `convexToZod` on Zod 4.6. (#1050)
  - Fixed the type of branded `zod/mini` objects on Zod 4.0–4.2. (#1051)
- `validate` and `parse` now reject arrays and class instances (e.g. `Date`,
  `Map`) for `v.record(...)` validators, as Convex does. Thanks to
  @RishavTiwari25 for the fix! (#1040)

## 0.1.129

- (fix:streams) Retry later groups after nonempty pages (#1027)
- (fix:validators) Only match own keys of an object validator's fields. Thanks to
  @mikirejf for the fix! (#1035)

## 0.1.128

- Triggers: `patch`, `replace` and `delete` with an explicit table name now
  skip the trigger path when the table has no registered triggers, as `insert`
  already does. They no longer read the document before and after the write.
- Zod 4 support: fixed the TypeScript return type of `zodOutputToConvex` for
  schemas nested in objects, arrays, records, unions and tuples (and inside
  `.readonly()`, `z.lazy()`, `.catch()` and `.nonoptional()`). These nested
  schemas were typed from their input, like in `zodToConvex`, so a nested
  `z.codec`, `z.pipe` or `.default()` got the wrong type. The return type now
  matches the validator returned at runtime. Thanks to @vinnysaj for the fix!
- fix(stream): Ensure cursors advance past exhausted flatMap items on resume (#1018)

## 0.1.127

- (fix:streams) Preserve empty stream intersections and their index metadata (#1017)

## 0.1.126

- (fix:streams) Preserve flatMap rows when resuming from cursor (#1014)

## 0.1.125

- Support Convex 1.46's `FunctionReference_future` in query hooks and function
  wrappers, including composing cached `useQueries` with `makeUseQueryWithStatus`.
  Requires `convex` ^1.46.0.

## 0.1.124

- `validate` now normalizes system table ids (e.g. `v.id("_storage")`) with
  `db.system.normalizeId` instead of throwing when passed a real `db`.

## 0.1.123

- Deprecates some validator utilities now that convex@1.44 has schema.doc and schema.id

## 0.1.122

- Support TypeScript 7.

## 0.1.121

- Support the new `db.vars.commitTs` variable and `v.commitTs()` validator added in
  convex 1.43.0.
- `convex-helpers/server/compare` is deprecated and now re-exports
  `compareValues` from `convex/values`. There may be small differences in behavior in
  uncommon cases (NaNs, negative zero, etc.) compared with the previous implementation.

## 0.1.120

- Zod 4 support: fix a regression introduced in 0.1.119 in the return types of
  `zodToConvex`/`zodOutputToConvex` when using branded types (including `zid`)

## 0.1.119

- Zod 4 support: the return types of `zodToConvex` and `zodOutputToConvex`
  now return the expected type when enabling the
  `exactOptionalPropertyTypes` TypeScript setting.

## 0.1.118

- Fixes the helpers custom pagination page splitting logic when used
  with filters. Previously it would aggressively split pages whenever
  more items were _scanned_ than requested. Now it only splits when
  the page grows to be larger than the number of requested items or
  so many documents are being scanned that the limits are close to being
  hit.

## 0.1.117

- Zod 4 support: fixed an issue with the return type of `convexToZod`
  when the input type is a non-tuple array type.

## 0.1.116

- `HonoWithConvex` and `HttpRouterWithHono` now accept an optional `Variables`
  type parameter, so consumers using middleware-driven typed context state
  (`c.var` / `c.set` / `c.get`) no longer need to cast their `Hono` app.
- Support nullable empty schemas in open-api-spec

## 0.1.115

- Supports typescript ^6.0.0

## 0.1.114

- Adds support for maximumBytesRead option for PaginationOptions on the
  stream / paginator helpers.

## 0.1.113

- Zod 4 support: fix the input type of `zid` (thanks @danth3b0t!)

## 0.1.112

- Zod 4 support: fix an issue where `zodToConvex` would incorrectly
  identify some types as `v.id()` when using Zod schema inheritance.
- Relationships: fix the return type of `getManyVia`
  and `getManyViaOrThrow` when using system tables.

## 0.1.111

- Allow a hono http router register more routes using the standard
  Convex HttpRouter API

## 0.1.110

- Improve db wrapping in Triggers to support using an RLS-wrapped DB

## 0.1.109

- Triggers/row-level security: fix a type issue with the `ctx.db` APIs with
  table name arguments (see the changelog of
  [`convex@1.31.2`](https://github.com/convex/convex-js/blob/main/CHANGELOG.md#1312))
- Zod 4: fix handling of optional in the type of `zodOutputToConvex` (credit: ksinghal)
- Fixes validation of records with undefined values. `validate` will now skip entries
  with undefined values for record and object validators, and `parse` will drop
  entries from records that have undefined values.
- The openapi and ts generator commands will now avoid adding .yaml if the filename
  already includes it.

## 0.1.108

- `makeUseQueryWithStatus`: fix handling of some argument values
  (credit: RhysSullivan)
- Triggers: fix handling of `ctx.db` calls with a table name parameter

## 0.1.107

- Zod support: branded object types are now supported (credit: gary-ix)
- Fixes `skipConvexValidation` for zod custom functions to still do zod validation.

## 0.1.106

- Update typedV to match the type of the installed convex validators for v.nullable
- Improves handling of literals() helper to keep the ordering of its members
- Improved Zod 4 handling of circular types, empty returns, and empty function args
- Zod 4 transforms can now be asynchronous

## 0.1.105

- **convex-helpers now supports Zod 4!** (#840)
  - The new methods that support Zod 4 can be found in `convex-helpers/server/zod4`
  - Existing types and methods for Zod 3 support have been moved
    (`convex-helpers/server/zod` → `convex-helpers/server/zod3`)
  - Thanks to @ksinghal and @natedunn for their contributions to this improvement.
- Zod 3 support: fix the return types of `zodOutputToConvex` for objects and unions
  (credit: gari-ix)
- Zod 3 support: improve the type safety of `onSuccess` in custom function builders
- Sessions: If the only argument to a session function is the sessionId,
  allow omitting args in React.

## 0.1.104

- Allows RLS to deny access by default

## 0.1.103

- Parsing validators with optional fields and explicit { field: undefined } works

## 0.1.102

- You can use Zod4 alongside convex-helpers.
  Note: convex-helpers/zod supports zod3 only. Zod4 support is WIP

## 0.1.101

- Improved Zod union type (credit:Firephoenix25)
- Fixes zCustom\* function type inference regression
- Adds a helper function `addFieldsToValidator` which recursively adds fields
  to either a `{ key: v.string() }`, a `v.object(..)`, or `v.union(...` of objects/unions.
- Tightens the types when not using extra args, so it catches typos
- Removes the long-deprecated "output" argument (use `returns` instead)- Improved Zod union type (credit:Firephoenix25)
- Bumps the Convex peer dependency as we rely on compareValues (credit:nicolas)
- Exports types for QueryStream

## 0.1.100

- Custom Functions now can take dynamic parameters for each function
  they define (e.g. each custom query providing a "role" it expects)
- Custom Functions can provide an "onSuccess" callback to do final
  things after the inner function succeeds. Throwing fails it.
- Custom Functions exposes a customCtxAndArgs utility to help with types
- Trigger DB wrapper is now an object, not a class when using
  `.wrapDB()` or `writerWithTriggers` explicitly (credit: front-depiction)
- `convexToZod` now transforms to more specific zod types (credit: Firephoenix25)
- `crud` helper works for tables with top-level unions
- `paginator` works over indexes including `undefined` values.
- `Mod` type is deprecated - renamed to `Customization`

## 0.1.99

- Fixes LoadingMore for custom pagintation

## 0.1.98

- `partial` now supports unions too (including recursive unions).

## 0.1.97

- `partial` from `convex-helpers/validators` now supports either a
  v.object or POJO of validators.

## 0.1.96

- Fix the usePaginatedQuery helper to show LoadingMore when loading
  the last page

## 0.1.95

- Improved CORS support for server-to-server endpoints, along with more
  nuanced handling of Vary headers.
  If you want the server to continue throwing when origins don't match,
  pass `enforceAllowOrigins: true`. By default it will not throw and let
  the browser or other server decide what to do about a conflict.

## 0.1.94

- Fix: Pagination of distinct streams

## 0.1.93

- Changes `usePaginatedQuery` for caching to take a `customPagination`
  option instead of "fixed" vs. "grow" for now. Pass `true` when using
  the `paginator` or `stream` helpers.
- Adds a regular `usePaginatedQuery` to use with `stream` and `paginator`
  helpers that doesn't use the subscription cache helper.

## 0.1.92

- `usePaginatedQuery` has the default `latestPageSize` option of "fixed"
  which has the first (or latest once loadMore is called) page stay a
  fixed size. Today this only affects queries using `paginator` or
  `stream` helpers, and will soon also be able to fix the page size for
  built-in pagination too.
- Fix: update type annotations of imports for tsApiApec.ts.

## 0.1.91

- `usePaginatedQuery` is now available in the cached query helpers.
- With `usePaginatedQuery`, you can pass `endCursorBehavior: "setOnLoadMore"`,
  which allows seamless pagination when using `stream` and`paginator` helpers
  and will allow future deprecation of the too-magical QueryJournal.
- Split pages more eagerly in the custom pagination hooks to reduce bandwidth.
- Fix descending multi-column index pagination for `paginator` and `streams`
  helpers.

## 0.1.90

- Support unions with `parse` and `validate(... { throws: true })`

## 0.1.89

- `parse` validator utility

## 0.1.88

- Support for standard schema
- Allow debugging cors

... older: check git!
