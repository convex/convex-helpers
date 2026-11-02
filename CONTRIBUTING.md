# Contributing to convex-helpers

## Installing dependencies for development

Run the following command in the _root_ of the repository (not `packages/convex-helpers`):

```sh
npm install
```

Run `npm run build` before typechecking or running tests. Use `npm run dev`
for local development. See [package.json](./package.json) for available scripts
and [example-ui/README.md](./example-ui/README.md) for the frontend example.

## Adding a helper

Adding helpers usually involves:

1. Adding code (and a corresponding `.test.ts` file) under `packages/convex-helpers/`:
   - `server/` if it helps write server-side code (imported in `convex/`).
   - `react/` for React client-side code.
   - The package source root if it can be imported client or server-side.
2. Adding an entry to `exports` in [package.json](./package.json), following the
   existing entries.
3. Adding usage documentation to the [package README](./README.md).
4. Adding an example in `convex/fooExample.ts` or `example-ui/src/components/FooExample.tsx`.
5. Writing a [Stack](https://stack.convex.dev) post explaining the problem and
   how the helper solves it, then linking it from the README.

## Checking changes

```sh
npm run build
npm run check
```

For a frontend change, also run `npx vite build --config example-ui/vite.config.mts`.
Use `npm pack` to inspect the package tarball.

For Zod compatibility tests, run a single version with
`npx vitest run --project zod-4.2`, or typecheck all supported versions with
`npm run typecheck:zod`. See [scripts/zodVersions.mjs](./scripts/zodVersions.mjs)
for adding a version or marking known failures.

## Recommendations

1. Include a block comment at the top of the file about how to use it.
2. Include jsdoc comments on exported functions etc. about how to use them.
3. Include motivation for **why** someone would use this helper, for browsing.
4. Avoid introducing too many files. Things are more discoverable within a file.

## Releasing

Add a release note with `npx changeset`: choose the version bump, describe the
user-visible change, and commit the generated file with your implementation.
Docs-only and development-tooling changes do not need a changeset.

Review and merge the release PR when ready. Click **Approve workflows to run**
on the PR if its checks are waiting for approval. To refresh it manually, run the
[Test and lint workflow](./.github/workflows/test.yml) on main.

After staging, review the package under **Settings → Staged Packages** on
[npm](https://www.npmjs.com) and approve with 2FA, or use
`npm stage approve <stage-id>` with the ID from the workflow log. Approve versions
in order to avoid moving `latest` backward.

See [test.yml](./.github/workflows/test.yml) for PR automation and
[release.yml](./.github/workflows/release.yml) for release selection, checks,
staging, and tagging.

### Local preparation and alphas

To prepare a release locally instead of using the bot:

```sh
npm ci
npm run build
npm run check
npx changeset version
```

Review and commit the version, changelog, and consumed changesets. Land the commit
through a PR, or push to main where repository rules permit.

For an alpha, follow [Changesets' prerelease instructions](https://changesets.dev/guide/prereleases),
commit and push the version changes, then run:

```sh
gh workflow run release.yml --ref my-alpha-branch
```

To retry an earlier version-bump commit on the selected ref, add
`-f commit=<full-sha>`.

### Setup and recovery

In repository **Settings → Actions → General**, enable **Allow GitHub Actions to
create and approve pull requests**. See [GitHub's workflow-trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
for approving checks on bot-created PRs.

Retry **failed jobs** rather than the entire workflow when staging has already
succeeded. If an upload's outcome is uncertain, inspect npm before retrying. If
fixing a release requires code changes, prepare a new version.
