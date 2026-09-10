import { resolve } from "node:path";

/** Validate the version recorded by Release Please before publishing. */
export function verifyRelease(
	manifest: { version?: string; license?: string },
	versions: Record<string, string>,
	tag?: string,
): void {
	const version = manifest.version;
	if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
		throw new Error("The release version must be stable SemVer.");
	}
	if (manifest.license !== "MIT")
		throw new Error("The package must declare MIT.");
	if (versions["."] !== version) {
		throw new Error("Release Please and package.json versions must match.");
	}
	if (tag !== undefined && tag !== `v${version}`) {
		throw new Error(`Release tag ${tag} does not match v${version}.`);
	}
}

if (import.meta.main) {
	const root = resolve(import.meta.dir, "..");
	verifyRelease(
		await Bun.file(resolve(root, "package.json")).json(),
		await Bun.file(resolve(root, ".release-please-manifest.json")).json(),
		process.argv[2],
	);
	console.log("Release metadata verified.");
}
