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

From a clean checkout that includes the latest `origin/main`, run:

```sh
npm run release                 # patch; edit the changelog in your Git editor
npm run release -- minor        # or major / alpha
npm run release -- --watch      # follow CI and open npm's approval page afterward
```

Stop development watchers first. The command checks the package, updates the root
version and lockfile with `npm version --git-tag-version=false`, opens
`CHANGELOG.md` in your Git editor, commits, and pushes `HEAD` to `main`. It can run
from any branch containing the current main; the push must be a fast-forward and
permitted by branch protection. A release PR is optional. If branch protection
requires a PR, run `npm run release:prepare -- patch`, commit the generated files,
and open a PR instead.

After pushing, the command prints links to that commit's CI checks and your npm
Staged Packages page. Finding the personal npm link uses `npm whoami`; signing in
locally is required to discover that link, but is not used for CI publishing.
`--watch` requires the GitHub CLI (`gh`) to be installed and authenticated. It follows only the pushed
commit's Release workflow and opens the approval page after success if `npm whoami`
succeeded. Otherwise, it still watches CI and prints instructions to sign in on
npmjs.com and open Settings → Staged Packages manually. The default command
returns after pushing and printing links.

[The release workflow](./.github/workflows/release.yml) finds the version-bump
commit in each push to main, including a release followed by ordinary commits in
the same push. Push one release at a time; multiple version bumps in one push
are rejected. The release is validated, built, tested, and staged from its
exact commit with npm trusted publishing and provenance. Prerelease identifiers
choose the npm dist-tag (`alpha`, `beta`, etc.); identifiers that npm treats as
version ranges (such as numeric identifiers) use `next`. Stable versions use
`latest`.

After staging succeeds, a separate tag job creates `npm/<version>` at the release
commit. It accepts an existing matching tag and refuses to move a conflicting
tag. **A Git tag means staging succeeded, not that the version is publicly
available.** Open
`https://www.npmjs.com/settings/<your-npm-username>/staged-packages`, review the
version, and approve with npm 2FA. Alternatively, the staging log prints the ID
for `npm stage approve <stage-id>`. Approval is the last step: no local Git
operation or finalization workflow follows it. If several versions await
approval, approve in version order so an older release does not replace `latest`.

### One-time setup

Configure the npm trusted publisher for package `convex-helpers`, GitHub
repository `convex/convex-helpers`, workflow `release.yml`, with **only staged
publishing allowed**. Disable direct publishing for the trust relationship and
remove CI tokens that can bypass human approval. The npm-side restriction keeps
a rogue workflow change from turning a push into a public release without 2FA.
The workflow uses the npm bundled with the Node version in `.nvmrc`: Node
24.18.0 includes npm 11.16.0, meeting the npm 11.15.0 minimum for staged
publishing. GitHub Actions also needs permission to create `npm/*` tags under
the repository's rulesets.

### Failures and retries

- If the local push fails, the release commit is retained. Reconcile with main,
  then push that commit; do not rerun the version bump. If preparation fails,
  inspect and finish or discard its uncommitted changes before trying again.
- If checks or staging fail, inspect the log. Re-run the failed jobs for a
  transient failure. The manual Release workflow also accepts the full SHA of a
  version-bump commit already on main. It cannot stage arbitrary branch commits.
- If only tagging fails, **re-run failed jobs**, which reuses the successful
  staging job. Do not rerun the entire workflow: npm rejects an already-staged or
  published version. Registry/authentication errors are failures, not silently
  treated as duplicate uploads.
- If npm accepted the upload but the runner lost its response, inspect the npm
  staging page before retrying. Do not delete tags or blindly upload again.
  Recover the tag at the original commit after verifying the staged artifact.
- Rejected candidates keep their Git tags. Ship corrections as a new version;
  never move a tag to represent different source.

Direct publishing could later replace `npm stage publish` with `npm publish`
(and change the npm trust permissions). Tagging would still follow a successful
upload; the human npm approval step would disappear.
