# Releases

A push whose **tip commit's entire message** is exactly `vX.Y.Z` on the repository's default branch starts `.github/workflows/release.yml`.

```bash
git commit --allow-empty -m "v1.2.3"
git push
```

Use a new stable version. Prefixes, suffixes, a commit body, prerelease versions, and build metadata do not match. Ordinary commits, tag pushes, and other branches never release. With squash merges, the final squash commit message must be exactly the version. When pushing several commits, the tip must be the release commit.

## Automated steps

1. Validate the exact message and npm credentials.
2. Set `package.json` to the requested version.
3. Install locked dependencies (generate `bun.lock` only when missing), audit, run `bun run check`, and dry-run packaging.
4. If metadata changed, create `chore(release): vX.Y.Z` above the triggering commit.
5. Atomically push the version commit to the default branch and its annotated tag. If the manifest already matches, tag the triggering commit directly.
6. Publish to npm under `latest`, then create a GitHub Release with generated release notes.

Verification failures do not push release metadata. No force-pushes or tag moves are performed. If another push advances the default branch before tagging, the release fails safely; put a new version commit on the current tip.

## Setup

- Configure repository secret `NPM_TOKEN` with publish access and permission to publish non-interactively.
- The automatic `GITHUB_TOKEN` uses `contents: write`. Actions must be allowed to push the version commit and create tags.
- If branch/tag rules prohibit that token, configure `RELEASE_TOKEN` with Contents read/write and explicitly allow its actor to bypass the applicable rules. Adding a token alone does not bypass branch protection.
- Everything runs in one workflow, so a personal token is not needed solely to chain workflows.

Publish `@lilsnibbi/logger@1.1.0` before the first `discord-kit` release that depends on it. The missing Discord lockfile is then generated automatically from npm; local Bun links are not used in CI.

## Retry

Use **Actions → Release → the failed run → Re-run failed jobs**. Reuse the original run to preserve its source SHA.

An existing tag must belong to the original source; its files are checked again. An already-published npm version is tolerated, and an existing GitHub Release is preserved. Reusing the version in a different commit is rejected.

Changing a manifest alone does not release. The old Promote/Tag workflows are retired. Release scripts are workflow internals; request releases through commit messages.
