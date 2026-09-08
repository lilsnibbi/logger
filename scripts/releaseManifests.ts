/**
 * Shared release metadata helpers.
 *
 * Every manifest that must carry the release version is listed here exactly
 * once, so `syncVersions.ts`, `verifyRelease.ts`, and `release.ts` can never
 * disagree about what the release surface is. This package is a single
 * manifest, but the list keeps the scripts identical across the
 * `@lilsnibbi/*` repositories.
 */

export const RELEASE_MANIFESTS = ["package.json"] as const;

export type ReleaseManifestPath = (typeof RELEASE_MANIFESTS)[number];

export const RELEASE_LICENSE = "MIT";

// SemVer 2.0: numeric identifiers cannot have leading zeroes.
const NUMERIC = "(?:0|[1-9]\\d*)";
const PRERELEASE = `(?:${NUMERIC}|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;
const VERSION = `${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}(?:-${PRERELEASE}(?:\\.${PRERELEASE})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?`;

export const SEMVER_PATTERN = new RegExp(`^${VERSION}$`);
export const RELEASE_TAG_PATTERN = new RegExp(`^v${VERSION}$`);

export type BumpDirective = "major" | "minor" | "patch";

export interface PackageManifest {
	version?: string;
	license?: string;
}

export function assertSemver(version: string, source: string): string {
	if (!SEMVER_PATTERN.test(version)) {
		throw new Error(`${source} is not valid SemVer: ${version}`);
	}
	return version;
}

/**
 * Resolves a release directive to a concrete version.
 *
 * `patch` / `minor` / `major` increment `current`; anything else is treated as
 * an explicit version (a leading `v` is tolerated).
 */
export function resolveVersion(current: string, directive: string): string {
	const requested = directive.trim();
	const normalized = requested.toLowerCase();

	if (
		normalized === "major" ||
		normalized === "minor" ||
		normalized === "patch"
	) {
		const [major, minor, patch] = assertSemver(current, "The current version")
			.replace(/[-+].*$/, "")
			.split(".")
			.map(Number) as [number, number, number];

		if (normalized === "major") {
			return `${major + 1}.0.0`;
		}
		if (normalized === "minor") {
			return `${major}.${minor + 1}.0`;
		}
		return `${major}.${minor}.${patch + 1}`;
	}

	return assertSemver(
		/^v/i.test(requested) ? requested.slice(1) : requested,
		"The requested version",
	);
}

/**
 * Extracts a release directive from a commit message or pull request title.
 *
 * Recognises `release: patch`, `[release: minor]`, `release: v1.2.3`, and the
 * `release/major` spelling. Returns `undefined` when the message asks for no
 * release, which is the common case for ordinary commits.
 */
export function parseReleaseDirective(message: string): string | undefined {
	const match = /(?:^|[\s[(])release[:/]\s*([^\s\])]+)/i.exec(message);
	const directive = match?.[1];
	if (!directive) return undefined;
	if (/^(major|minor|patch)$/i.test(directive)) return directive.toLowerCase();
	return SEMVER_PATTERN.test(directive.replace(/^v/i, ""))
		? directive
		: undefined;
}

export async function readManifest(path: string): Promise<PackageManifest> {
	const value: unknown = await Bun.file(path).json();
	if (!value || typeof value !== "object") {
		throw new Error(`${path} does not contain a package manifest.`);
	}
	return value as PackageManifest;
}

export async function readReleaseVersion(): Promise<string> {
	const manifest = await readManifest(RELEASE_MANIFESTS[0]);
	if (!manifest.version) {
		throw new Error(`${RELEASE_MANIFESTS[0]} does not declare a version.`);
	}
	return assertSemver(manifest.version, RELEASE_MANIFESTS[0]);
}

/**
 * Rewrites the top-level `version` field in place.
 *
 * The manifest text is patched rather than re-serialised so Biome's tab
 * indentation and key ordering survive untouched.
 */
export async function writeManifestVersion(
	path: string,
	version: string,
): Promise<boolean> {
	const original = await Bun.file(path).text();
	let replaced = false;

	const updated = original.replace(
		/^(\s*"version"\s*:\s*")([^"]*)(")/m,
		(match, prefix: string, current: string, suffix: string) => {
			replaced = true;
			if (current === version) {
				return match;
			}
			return `${prefix}${version}${suffix}`;
		},
	);

	if (!replaced) {
		throw new Error(`${path} has no top-level "version" field to update.`);
	}
	if (updated === original) {
		return false;
	}

	await Bun.write(path, updated);
	return true;
}
