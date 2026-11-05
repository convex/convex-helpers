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

### Working on Zod helpers

When working on Zod compatibility, you can run tests for a single version with
`npx vitest run --project zod-4.2`, or run just the compatibility typechecks with
`npm run typecheck:zod`. These are optional commands for focused development.
See [scripts/zodVersions.mjs](./scripts/zodVersions.mjs) for adding a version or
marking known failures.

## Recommendations

1. Include a block comment at the top of the file about how to use it.
2. Include jsdoc comments on exported functions etc. about how to use them.
3. Include motivation for **why** someone would use this helper, for browsing.
4. Avoid introducing too many files. Things are more discoverable within a file.

## Releasing

Add a release note with `npx changeset`: choose the version bump, describe the
user-visible change, and commit the generated file with your implementation.
Docs-only and development-tooling changes do not need a changeset.

Edit the generated `.changeset/*.md` file to include relevant issue or PR links
and optional contributor credits in the Markdown body. Use full links so they
also work outside GitHub. For example:

```md
---
"convex-helpers": patch
---

Fix cursor handling when resuming pagination
([#1234](https://github.com/convex/convex-helpers/issues/1234)).
Thanks to [@contributor](https://github.com/contributor) for the fix!
```

Keep the package/version frontmatter as generated; put links and credits in the
body, without a leading bullet. Changesets preserves this Markdown in the
changelog. Include `Fixes #1234` in the implementation PR's description to close
the issue when that PR merges. Changelog links and credits are written by the
author or reviewer, rather than inferred from commit authors or GitHub metadata.

Release notes appear directly under the version heading, without a **Patch
Changes** heading or automatic commit hashes. Minor and major headings remain to
highlight larger changes. The release bot uses `npm run version-packages`, which
runs Changesets and removes the patch heading from the new entry. Use this command
for local versioning too; `npx changeset version` alone still adds that heading.

Review and merge the release PR when ready. Click **Approve workflows to run**
on the PR if its checks are waiting for approval. To refresh it manually, run the
[Update release PR workflow](./.github/workflows/version.yml) on main.

After staging, review the package under **Settings → Staged Packages** on
[npm](https://www.npmjs.com) and approve with 2FA, or use
`npm stage approve <stage-id>` with the ID from the workflow log. Approve versions
in order to avoid moving `latest` backward.

See [version.yml](./.github/workflows/version.yml) for PR automation and
[release.yml](./.github/workflows/release.yml) for release selection, checks,
staging, and tagging.

### Local preparation and alphas

To prepare a release locally instead of using the bot:

```sh
npm ci
npm run build
npm run check
npm run version-packages
```

Review and commit the version, changelog, and consumed changesets. Land the commit
through a PR, or push to main where repository rules permit.

For an alpha, follow [Changesets' prerelease instructions](https://changesets.dev/guide/prereleases),
using `npm run version-packages` for the version step. Commit and push the version
changes, then run:

```sh
gh workflow run release.yml --ref my-alpha-branch
```

To retry an earlier version-bump commit on the selected ref, add
`-f commit=<full-sha>`.

### Recovery

| Situation                                                                                      | Action                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transient failure before uploading to npm                                                      | Re-run **failed jobs** for the same release commit.                                                                                                                                                  |
| Staging succeeded, but tagging failed                                                          | Re-run **failed jobs** to retry tagging. Re-running all jobs would attempt to upload the same version again and may fail before reaching tagging.                                                    |
| The upload failed, but npm may have received it                                                | Check npm's staged packages and published versions. If absent, retry the failed jobs. If present, verify its source commit and create any missing Git tag on that commit instead of uploading again. |
| Fixing the failure requires changing the release commit, such as consuming leftover changesets | Merge the fix with a new version bump, even if the failed version was never published. Keep the original release commit intact; retrying it would repeat the same failure.                           |
