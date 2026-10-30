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

Add release notes alongside package changes with `npx changeset`. Choose the
version bump and describe the user-visible change, then commit the generated
`.changeset/*.md` file with your implementation. Docs-only and development-tooling
changes do not need a changeset.

To prepare a release from an up-to-date checkout:

```sh
npm ci
npm run build
npm run check
npx changeset version
```

Review the version and changelog, then commit the root `package.json`,
`CHANGELOG.md`, and consumed `.changeset/` files. Land that commit through a PR,
or push it directly to main where repository rules permit. Changesets does not
commit, push, or tag for you. There is no release wrapper or automatic release-PR
bot. Package-lock version metadata does not need to match the package version;
update the lockfile normally when dependencies change.

[The release workflow](./.github/workflows/release.yml) finds the version-bump
commit in each push to main, including a release followed by ordinary commits in
the same push. Push one release at a time. CI validates the release notes, builds,
checks, and packs that exact commit, then stages the tarball using npm trusted
publishing and provenance. Installation and package scripts run without OIDC
permission; a separate staging job uploads the tarball with scripts disabled.
Caching is disabled throughout the release workflow.

Release PR checks reject unconsumed changesets on the proposed merge, and the
release workflow repeats this check on the exact release commit. If newer notes
land before your release, rerun `npx changeset version` to include them. Notes
landing after the release commit belong to the next release. No merge queue is
required, but without one a race may only be caught after landing, blocking staging.

After staging succeeds, CI creates `v<version>` at the release commit without
moving an existing tag. **The tag records successful staging, not public
availability.** Open Settings → Staged Packages on [npm](https://www.npmjs.com),
review the package, and approve with 2FA. The direct page is
`https://www.npmjs.com/settings/<your-npm-username>/staged-packages`; alternatively,
the staging log supplies the ID for `npm stage approve <stage-id>`. Approval is
the final step. Approve pending versions in order so an older release does not
replace `latest`.

### Alphas and manual runs

Only pushes to `main` automatically start releases. Opening or updating a PR,
including a Changesets release PR, does not. For a branch alpha, use Changesets'
standard `npx changeset pre enter alpha` and `npx changeset version`, commit and
push the generated files, then explicitly run:

```sh
gh workflow run release.yml --ref my-alpha-branch
```

The selected tip must change the version. To stage an earlier version-bump commit
on that ref, add `-f commit=<full-sha>`. The workflow must already exist on the
default branch for dispatch to be available. Stable versions use `latest`;
prereleases use their identifier (`alpha`, `beta`, etc.), or `next` if that
identifier is an npm version range. For subsequent alphas, add changesets and run
`npx changeset version` again. Use `npx changeset pre exit` followed by
`npx changeset version` when preparing a stable release on main.

### One-time setup and forks

Configure npm's trusted publisher for `convex/convex-helpers`, workflow
`release.yml`, with **staged publishing only**. Disable direct publishing for the
trust relationship and remove CI credentials that bypass approval. No GitHub
environment is required, so explicit branch dispatch remains available. GitHub
Actions needs permission to create `v*` tags. The workflow uses the npm bundled
with Node from `.nvmrc`, which supports staged publishing.

<<<<<<< HEAD
Configure the npm trusted publisher for package `convex-helpers`, GitHub
repository `convex/convex-helpers`, workflow `release.yml`, with **only staged
publishing allowed**. Disable direct publishing for the trust relationship and
remove CI tokens that can bypass human approval. The npm-side restriction keeps
a rogue workflow change from turning a push into a public release without 2FA.
The workflow uses the npm bundled with the Node version in `.nvmrc`: Node
24.18.0 includes npm 11.16.0, meeting the npm 11.15.0 minimum for staged
publishing. GitHub Actions also needs permission to create `npm/*` tags under
the repository's rulesets.
=======
The repository guard skips releases on forks, avoiding missing-trust failures.
Forks that want their own releases can change the guard and configure npm trust
for their repository/package. All workflow logic is in the linked YAML; no shared
release package or remotely maintained reusable workflow is involved.
>>>>>>> 1ca4d2b (Use vanilla Changesets commands and inline release workflow checks)

### Failures and retries

- For transient check or staging failures, rerun failed jobs. Manual dispatch can
  also retry a specific version-bump commit on the selected ref.
- If tagging alone fails, rerun **failed jobs**, preserving the successful staging
  job. Rerunning everything attempts to upload the already-reserved version again.
- If npm accepted the upload but the runner lost the response, inspect npm before
  retrying, and recover the tag at the original commit after verifying the artifact.
- If a release needs code changes, land a new version. Rejected staged candidates
  keep their tags; never move a tag to represent different source.

Direct publishing could later replace `npm stage publish` with `npm publish`
and change npm trust permissions. Tagging would still follow a successful upload.
