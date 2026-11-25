---
"convex-helpers": patch
---

Support the `v.function()` validator introduced in Convex 1.49 in `convexToZod`
(Zod 3 and 4), `validate`/`parse`, and `vRequired`. Generate function-handle schemas
and types in the OpenAPI and TypeScript API generators. Preserve function-handle
types and signature metadata when removing optionality. This fixes typechecking
with Convex 1.49 and later and raises the minimum Convex peer dependency to 1.49.
Convex 1.49 requires Node.js 22 or later, so this also raises the supported Node.js
minimum through the Convex dependency.

Local function-handle validation checks the `function://` prefix, as the Convex
SDK does. Convex validates the embedded ID; function signatures are checked only
by TypeScript.

Add `zFunction()`, the Zod equivalent of `v.function()`, which `convexToZod`
returns for function handles. `zodToConvex` and `zodOutputToConvex` turn it back
into the original `v.function()` validator, signature included.
