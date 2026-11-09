---
"convex-helpers": patch
---

`ConvexQueryCacheProvider` closes its cached subscriptions, idle ones included, when it unmounts or its client or options change, instead of leaving them open until `expiration`.
