# Contributing to convex-helpers

## Installing dependencies for development

Run the following command in the _root_ of the repository (not `packages/convex-helpers`):

```sh
npm install
```

> [!NOTE]
> There are two `package.json` files in the repository, one in the root and one in `packages/convex-helpers`. The dependencies in the root are a superset of all dependencies, including dependencies used during development only.

> [!IMPORTANT]
> Do not run `npm install` in `packages/convex-helpers`: this might cause some dependencies to be installed twice, causing type errors.

The frontend and its Vite config live in `example-ui/`. Run `npm run dev:frontend`
from the repository root; Vite reads the root `.env.local` for `VITE_CONVEX_URL`.
To build the frontend, run `npm run build` followed by
`npx vite build --config example-ui/vite.config.mts`. Frontend hosting should serve
`example-ui/dist/`.

## Adding a helper

Adding helpers usually involves:

1. Adding code (and corresponding .test.ts file) to:
   - ./server/ if it helps write server-side code (imported in convex/)
   - ./react/ for client-side code. In the future beyond react/ there can be other framework-specific client-side helpers.
   - ./ if it's truly generic - can be imported client or server-side

2. Adding the file to [the root package.json](./package.json)
   or
   in the following places:
   1. exports in [the npm library package.json](./packages/convex-helpers/package.json)
      using `node generate-exports.mjs`.
   2. scripts: Update the `dev:helpers` script if it isn't being included by the existing
      globs, and the `build` command if it's not included in the `cp` command.

3. [package README.md](./packages/convex-helpers/README.md) blurb on how to use it, and a link in the TOC.
4. [root README.md](./README.md) link in the TOC.
5. Adding an example of usage in the root of this repo.
   1. convex/fooExample.ts for server-side code
   1. example-ui/src/components/FooExample.tsx for client-side code, added in App.tsx

6. A [Stack](https://stack.convex.dev) post on it - what problem it solves,
   a blurb on how to use it. Update this README with the link when it's live.

## Recommendations

1. Include a block comment at the top of the file about how to use it.
2. Include jsdoc comments on exported functions etc. about how to use them.
3. Include motivation for **why** someone would use this helper, for browsing.
4. Avoid introducing too many files. Things are more discoverable within a file.

## Releasing

Run commands from this folder (root of repo).

**NOTE**: make sure you aren't running `npm run dev` anywhere when you're
publishing to avoid races with re-generating files while publishing.

In general you can run `./publish.sh` to go through the publish workflow, or
`npm run release` to do a release.
It will prompt you for a new version. If you've already adjusted the version,
you can just hit enter.

When it shows the publish preview, ensure the files all look like they're there.
After you confirm to publish, it will publish to npm, make a git commit,
tag the commit with the version, and push the current branch & that tag.

### Alpha releases

For alpha releases, you can run `./publish.sh alpha` or `npm run alpha`.

Or run this beforehand to bump the version:
`npm version prerelease --preid alpha && git add package*`.
Only use alpha, otherwise npm won't tag it correctly and it might suggest it as
`convex-helpers@latest` instead of just as `convex-helpers@alpha`.
