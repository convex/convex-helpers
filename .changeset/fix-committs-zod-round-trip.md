---
"convex-helpers": patch
---

Convert `v.commitTs()` back to `v.commitTs()` after a round trip through `convexToZod` and `zodToConvex` or `zodOutputToConvex`, instead of a union that accepts any value.
