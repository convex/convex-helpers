---
"convex-helpers": patch
---

`convexToZod(v.commitTs())` now returns `zCommitTs()`, the Zod equivalent of `v.commitTs()`. A commitTs field now roundtrips properly when using `zodToConvex` and `convexToZod`. On Zod 3, this means `convexToZod(v.commitTs())` now returns a `ZCommitTs` schema instead of a `z.union()`.
