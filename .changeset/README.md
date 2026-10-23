# Release notes

Run `npm run changeset` for changes that should ship in the next npm release.
Select `convex-helpers`, choose the version bump, and describe the user-visible
change. Commit the generated Markdown file with the implementation.

Docs-only and development-tooling changes do not need a changeset.

Maintainers run `npm run release` to consume pending notes, generate the changelog,
update the version and lockfile, commit, and push to main. With no pending notes,
the command prompts to add one in an interactive terminal. A release PR is
optional: `npm run release:prepare` prepares the same files without committing or
pushing. CI stages the exact release commit and then tags it. A maintainer
approves the staged version on npm with 2FA; there is no later finalization step.

See [CONTRIBUTING.md](../CONTRIBUTING.md#releasing) for stable and alpha releases,
approval links, retries, and the optional `--watch` handoff.
