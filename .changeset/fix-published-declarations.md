---
"convex-helpers": patch
---

Fix the published TypeScript declarations for `server/crud` and `server/stream`
so they typecheck without `skipLibCheck`. Preserve schema, document, index, and
function visibility types without generating references to undeclared type names.
