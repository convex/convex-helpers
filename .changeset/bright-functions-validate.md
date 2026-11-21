---
"convex-helpers": patch
---

Support the `v.function()` validator introduced in Convex 1.49 in `convexToZod`
(Zod 3 and 4), `validate`/`parse`, and `vRequired`. Generate function-handle schemas
and types in the OpenAPI and TypeScript API generators. Preserve function-handle
types and signature metadata when removing optionality. This fixes typechecking
with Convex 1.49 and later and raises the minimum Convex peer dependency to 1.49.

Local function-handle validation checks the `function://` prefix, as the Convex
SDK does. Convex validates the embedded ID; function signatures are checked only
by TypeScript.

Converting a function-handle validator to Zod and back with `zodToConvex` or
`zodOutputToConvex` yields `v.any()`, as with other custom Zod schemas. The Zod
schema still checks the prefix, but the original Convex validator and its
signature metadata are not preserved by that round trip.
