---
"convex-helpers": patch
---

- `open-api-spec` renders unions as `anyOf`, so a value matching more than one
  member validates.
- `open-api-spec` supports `v.bytes()` instead of aborting with "bytes unsupported".
