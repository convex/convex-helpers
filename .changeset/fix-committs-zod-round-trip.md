---
"convex-helpers": patch
---

Add `zCommitTs()`, the Zod equivalent of `v.commitTs()`, which `zodToConvex` and `zodOutputToConvex` convert back to `v.commitTs()`. `convexToZod(v.commitTs())` now returns it, so a commitTs field no longer becomes a union that accepts any value after a round trip.
