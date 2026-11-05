import defaultChangelog from "@changesets/cli/changelog";

// Keep Changesets' Markdown formatting, without adding Git commit identifiers.
export default {
  getReleaseLine(changeset, ...args) {
    return defaultChangelog.getReleaseLine(
      { ...changeset, commit: undefined },
      ...args,
    );
  },
  getDependencyReleaseLine(changesets, ...args) {
    return defaultChangelog.getDependencyReleaseLine(
      changesets.map((changeset) => ({ ...changeset, commit: undefined })),
      ...args,
    );
  },
};
