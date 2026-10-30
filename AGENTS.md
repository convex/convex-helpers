When doing a task that involves modifying complex TypeScript types, run `npm run typecheck` in the root of the repository to ensure that the types are correct.
Do not install node modules in packages/convex-helpers. Install all packages in the root directory.
The convex/ directory is example usage exercising the package as in a real app.
The root package.json is the package we publish, with compiled entrypoints in dist/.
Package sources remain in packages/convex-helpers/.

Run `npm run format` to format the code before committing.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.

<!-- convex-ai-end -->
