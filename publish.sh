#! /bin/bash

set -e

npm whoami || npm login

npm run clean
npm ci
npm run build
npm run lint
npm run test
git diff --exit-code || {
  echo "Uncommitted changes found. Commit or stash them before publishing."
  exit 1
}
function cleanup() {
  git checkout -- package.json package-lock.json
}
trap cleanup EXIT

if [ "$1" == "alpha" ]; then
  npm version prerelease --preid alpha --git-tag-version=false
else
  npm version patch --git-tag-version=false
fi
current=$(npm pkg get version | tr -d '"')

cat <<EOF
Test it:
  - Add some example usage to the outer convex-helpers repo.
  - Run \`npm pack\` at the repository root and install it elsewhere from the .tgz file.
EOF
echo "Latest versions:"
npm view convex-helpers@latest version
npm view convex-helpers@alpha version

read -r -p "Enter the new version number (hit enter for $current): " version

if [ -n "$version" ]; then
  npm version "$version" --git-tag-version=false --allow-same-version
else
  version=$current
fi

if (echo "$version" | grep alpha >/dev/null); then
  npm publish --tag alpha
else
  npm publish
fi
git add package.json package-lock.json
# If there's nothing to commit, continue
git commit -m "npm $version" || true
git tag "npm/$version"
git push origin "npm/$version"
git push
