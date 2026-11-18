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

`npm run typecheck` also checks the built declarations with `skipLibCheck: false`
under TypeScript 6 and 7. Its consumer fixtures in `type-tests/` import the
package's published entrypoints.

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
in the Markdown body. The GitHub changelog generator turns references such as
`#1234` into links and adds the implementation PR link automatically. For example:

```md
---
"convex-helpers": patch
---

Fix cursor handling when resuming pagination (#1234).
```

Write the summary in the body, without a leading bullet.
Optional contributor credits can be written as Markdown links in the summary.

Review and merge the release PR when ready. Click **Approve workflows to run**
on the PR if its checks are waiting for approval. To refresh it manually, run the
[Update release PR workflow](./.github/workflows/version.yml) on main.

When the release PR merges, CI tags the commit that set the new version as
`v<version>` and starts the [Release workflow](./.github/workflows/release.yml)
on that tag. To release a different commit, tag it yourself:

```sh
gh api repos/convex/convex-helpers/git/refs -f ref=refs/tags/v1.2.3 -f sha=<commit>
```

Or, from a local clone: `git tag v1.2.3 <commit> && git push origin v1.2.3`.

The tag must match `package.json`'s version. Stable releases must be on `main`;
the commit may be older than the current tip. GitHub runs the release workflow
from the tagged commit, so the commit must include it. The workflow builds and
checks that commit, then stages the tested package on npm.

Review the package under **Settings → Staged Packages** on
[npm](https://www.npmjs.com) and approve with 2FA, or use
`npm stage approve <stage-id>` with the ID from the workflow log. Approve versions
in order to avoid moving `latest` backward.

### Local preparation and alphas

To prepare a release locally instead of using the bot:

```sh
npm ci
npm run build
npm run check
GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token)}" npx changeset version
```

Review and commit the version, changelog, and consumed changesets. Land the commit
through a PR, or push to main where repository rules permit.

The GitHub generator needs `GITHUB_TOKEN` to look up PR metadata. The release bot
receives it from GitHub Actions; locally, the command above preserves an existing
`GITHUB_TOKEN` and otherwise uses your GitHub CLI login.

For an alpha, follow [Changesets' prerelease instructions](https://changesets.dev/guide/prereleases),
providing `GITHUB_TOKEN` for the version step as above. Commit and push the version
changes on your branch, then tag that commit, such as `v1.2.3-alpha.0`. The first
prerelease identifier selects the npm channel, such as `alpha`.

### Recovery

The tag records intent to release; npm is the source of truth for what was
staged. If the workflow fails, check npm's staged packages first:

- Tagged, but Release didn't start: start it on the tag with
  `gh workflow run release.yml -R convex/convex-helpers --ref v1.2.3`.
- Not staged: rerun the failed jobs
  (`gh run rerun <run-id> -R convex/convex-helpers --failed`), for example after
  pushing `main` if the tag went first. A rerun uses the run's original commit
  and works for 30 days.

  To release a different commit, fix the source and move the tag:

  ```sh
  gh api -X PATCH repos/convex/convex-helpers/git/refs/tags/v1.2.3 -f sha=<commit> -F force=true
  ```

- Staged, but rejected in review: `npm stage reject <stage-id>` frees the
  version, so you can move the tag to a corrected commit. A published version
  cannot be reused; prepare a new version instead.
