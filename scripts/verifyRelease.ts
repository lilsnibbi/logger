/**
 * Asserts that the package declares one valid MIT release version, and
 * optionally that it matches the tag being released.
 *
 *   bun run scripts/verifyRelease.ts
 *   bun run scripts/verifyRelease.ts v1.2.0
 */

import {
	RELEASE_LICENSE,
	RELEASE_MANIFESTS,
	SEMVER_PATTERN,
	readManifest,
} from "./releaseManifests.ts";

const packages = await Promise.all(RELEASE_MANIFESTS.map(readManifest));
const versions = packages.map((manifest) => manifest.version);
const version = versions[0];

if (!version || !SEMVER_PATTERN.test(version)) {
	throw new Error("The release version must be valid SemVer.");
}
if (versions.some((candidate) => candidate !== version)) {
	throw new Error(
		`Manifest versions must match: ${RELEASE_MANIFESTS.map((path, index) => `${path}=${versions[index] ?? "missing"}`).join(", ")}`,
	);
}
if (packages.some((manifest) => manifest.license !== RELEASE_LICENSE)) {
	throw new Error(`Every manifest must declare ${RELEASE_LICENSE}.`);
}

const { GITHUB_REF_TYPE, GITHUB_REF_NAME } = Bun.env;
const requestedTag =
	process.argv[2] ?? (GITHUB_REF_TYPE === "tag" ? GITHUB_REF_NAME : undefined);
if (requestedTag && requestedTag !== `v${version}`) {
	throw new Error(
		`Release tag ${requestedTag} does not match v${version}. ` +
			"Request releases with an exact vX.Y.Z commit on the default branch.",
	);
}

console.log(`Release metadata is aligned at v${version}.`);
