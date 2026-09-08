/**
 * Writes one version to the package manifest and confirms the lockfile.
 *
 *   bun run scripts/syncVersions.ts patch
 *   bun run scripts/syncVersions.ts 1.2.0
 *   bun run scripts/syncVersions.ts v1.2.0-rc.1 --no-install
 *
 * Prints the resolved version on the last stdout line, and appends
 * `version=<v>` to $GITHUB_OUTPUT when running inside GitHub Actions.
 */

import {
	RELEASE_MANIFESTS,
	readReleaseVersion,
	resolveVersion,
	writeManifestVersion,
} from "./releaseManifests.ts";

const args = Bun.argv.slice(2);
const directive = args.find((argument) => !argument.startsWith("--"));
const skipInstall = args.includes("--no-install");

if (!directive) {
	throw new Error(
		"Usage: bun run scripts/syncVersions.ts <major|minor|patch|X.Y.Z> [--no-install]",
	);
}

const current = await readReleaseVersion();
const version = resolveVersion(current, directive);

const changed: string[] = [];
for (const manifest of RELEASE_MANIFESTS) {
	if (await writeManifestVersion(manifest, version)) {
		changed.push(manifest);
	}
}

if (changed.length === 0) {
	console.log(`${RELEASE_MANIFESTS.join(", ")} already declares ${version}.`);
} else {
	for (const manifest of changed) {
		console.log(`Updated ${manifest} to ${version}.`);
	}
}

// The package's own version is not recorded in bun.lock, so a bump can never
// change the resolution graph. Confirm that rather than running an unpinned
// `bun install`, which could otherwise fold dependency upgrades into a release
// commit.
if (!skipInstall && changed.length > 0) {
	const install = await Bun.$`bun install --frozen-lockfile`.quiet().nothrow();
	if (install.exitCode !== 0) {
		throw new Error(
			"bun.lock no longer matches package.json after the version bump. " +
				"Run `bun install`, review the lockfile diff, and commit it separately.",
		);
	}
	console.log("bun.lock is still consistent.");
}

const { GITHUB_OUTPUT } = Bun.env;
if (GITHUB_OUTPUT) {
	await Bun.write(
		GITHUB_OUTPUT,
		`${await Bun.file(GITHUB_OUTPUT)
			.text()
			.catch(
				() => "",
			)}version=${version}\ntag=v${version}\nprevious=${current}\n`,
	);
}

console.log(version);
