# Releases

Release Please runs on pushes to main. Use Conventional Commits: fix: produces
a patch, feat: a minor, and feat!: or a BREAKING CHANGE: footer a major.
Squash-merge feature PRs with a conventional title.

Review and merge the generated release PR after CI passes. It updates package.json,
CHANGELOG.md, and .release-please-manifest.json. The next main push creates the
vX.Y.Z tag and GitHub release, then a separate job checks out that exact tag,
installs the frozen lockfile, runs checks and the dependency audit, and publishes
to npm. No manual version commits or version-sync scripts are needed.

## Setup

- RELEASE_TOKEN: a fine-grained GitHub PAT scoped to this repository with
  Contents, Issues, and Pull requests read/write. Its actor must be allowed to
  create release tags under repository rules. It is required so generated PRs
  trigger CI; the built-in GITHUB_TOKEN does not trigger those workflows.
- NPM_TOKEN: an npm token scoped to this package with non-interactive publish
  permission. It is exposed only to the publishing step. Existing Bun publishing
  is retained; npm trusted publishing can replace this when configured separately.
- Require both Verify package CI matrix checks before merging to main.
  CI runs on PRs, main pushes, and manual dispatch with read-only credentials.
- Keep action SHA pins updated through Renovate.
- The initial manifest records the existing package version; the next eligible
  change increments it. Existing versions are not republished during migration.
- Publish logger before introducing a discord-kit dependency on a new logger
  version, and commit the resulting registry-backed bun.lock.

These packages ship TypeScript source. Tests also pack, extract, build, and import
the actual package archive, checking public exports and excluding internal files.
The archive test needs tar, available on both configured GitHub runner platforms.

## Recovery

If publishing fails after the GitHub release exists, use Actions > Release >
the original run > Re-run failed jobs. This preserves the successful
Release Please job outputs and the exact tag. Do not rerun all jobs: Release
Please will not emit release_created again for a release it already created.
Bun tolerates an already-published version when retrying the publishing job.
A GitHub release alone does not prove npm publication succeeded.

## References

- [Release Please action](https://github.com/googleapis/release-please-action)
- [Manifest configuration](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md)
- [Bun publishing](https://bun.sh/docs/pm/cli/publish)
