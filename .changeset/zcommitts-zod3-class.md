---
"convex-helpers": patch
---

On Zod 3, `convexToZod(v.commitTs())` and `zCommitTs()` now return a `ZCommitTs` schema, like `zid()` returns a `Zid`, instead of a `z.union()`.
