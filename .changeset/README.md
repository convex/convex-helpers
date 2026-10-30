# Release notes

Run `npx changeset` for changes that should ship in the next npm release. Select
`convex-helpers`, choose the version bump, and describe the user-visible change.
Commit the generated Markdown file with the implementation. Docs-only and
development-tooling changes do not need a changeset.

Maintainers run `npx changeset version` to consume notes and update the root
version and changelog, then review, commit, and land those changes on main. CI
stages that exact commit and tags it after staging succeeds. A maintainer approves
the package on npm with 2FA; no later finalization step is required.

See [CONTRIBUTING.md](../CONTRIBUTING.md#releasing) for checks, branch alphas,
approval, and retries. There is no local release wrapper or release-PR bot.
