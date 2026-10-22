# Contributing to convex-helpers

## Installing dependencies for development

Run the following command in the _root_ of the repository (not `packages/convex-helpers`):

```sh
npm install
```

The root `package.json` is the publishable package and contains all development
dependencies. Package sources stay in `packages/convex-helpers/`; `npm run build`
compiles them directly into root `dist/` and bundles the CLI as `dist/bin.cjs`.
The examples import `convex-helpers` through the root package's exports, so run
`npm run build` before typechecking or running tests. `npm run dev` builds first
and watches the package sources for changes. The frontend and its Vite config live
in `example-ui/`; Vite loads the repository root's `.env.local` for `VITE_CONVEX_URL`.

## Adding a helper

Adding helpers usually involves:

1. Adding code (and a corresponding `.test.ts` file) under `packages/convex-helpers/`:
   - `server/` if it helps write server-side code (imported in `convex/`).
   - `react/` for React client-side code.
   - The package source root if it can be imported client or server-side.
2. Adding an explicit entry to `exports` in [the root package.json](./package.json),
   pointing `types` at `./dist/<path>.d.ts` and `default` at `./dist/<path>.js`.
   Entrypoints are maintained manually. The build and watcher already include
   TypeScript files under the package source directory.
3. Adding usage documentation to the [package README](./README.md).
4. Adding an example in `convex/fooExample.ts` or `example-ui/src/components/FooExample.tsx`.
5. Writing a [Stack](https://stack.convex.dev) post explaining the problem and
   how the helper solves it, then linking it from the README.

## Checking the package and examples

- `npm run build`: compile the library and CLI into `dist/`.
- `npm run build && npx vite build --config example-ui/vite.config.mts`: build
  the library and frontend. Frontend hosting should use this command and serve
  `example-ui/dist/`.
- `npm run typecheck` and `npm test`: check the package and example usage.
- `npm pack` (or `npm run pack`): clean, build, and create the publishable tarball
  from the repository root. The `files` allowlist includes compiled output and
  package sources for declaration maps; tests and configuration are excluded.

## Testing the Zod helpers against several Zod versions

The Zod tests run, and are typechecked, against several Zod 4 versions: one per
`zod-4.<minor>` alias in [the root package.json](./package.json). Run a single
version with `npx vitest run --project zod-4.2` and typecheck every version with
`npm run typecheck:zod`. See [`scripts/zodVersions.mjs`](./scripts/zodVersions.mjs)
for how to add a version or mark known failures.

## Recommendations

1. Include a block comment at the top of the file about how to use it.
2. Include jsdoc comments on exported functions etc. about how to use them.
3. Include motivation for **why** someone would use this helper, for browsing.
4. Avoid introducing too many files. Things are more discoverable within a file.

## Releasing

Run `npm run release` for a patch or `npm run alpha` for an alpha release from
this folder. Stop any running development watcher before releasing.

The existing `publish.sh` checks and publishes the root package, then commits
its version and lockfile, tags `npm/<version>`, and pushes. Update the root
`CHANGELOG.md` before releasing. CI publishing is introduced in a separate PR.
