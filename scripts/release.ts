import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { writeManifestVersion } from "./releaseManifests";

/** Only an entire stable version message requests an automated release. */
export function releaseTag(message: string): string | undefined {
	const text = message.replace(/\r?\n$/, "");
	return /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(text)
		? text
		: undefined;
}

interface ReleaseOptions {
	cwd: string;
	branch: string;
	source: string;
	/** Tests supply a local verifier; the workflow always uses the real gate. */
	verify?: (cwd: string) => Promise<void>;
}

async function command(
	cwd: string,
	args: string[],
	trim = true,
): Promise<string> {
	const child = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0)
		throw new Error(`${args[0]} ${args[1]} failed: ${stderr || stdout}`);
	return trim ? stdout.trimEnd() : stdout;
}

async function verifyPackage(cwd: string): Promise<void> {
	const install = existsSync(join(cwd, "bun.lock"))
		? ["bun", "install", "--frozen-lockfile", "--ignore-scripts"]
		: ["bun", "install", "--ignore-scripts"];
	for (const args of [
		install,
		["bun", "run", "audit"],
		["bun", "run", "check"],
		["bun", "pm", "pack", "--dry-run"],
	]) {
		console.log(await command(cwd, args));
	}
}

/**
 * Prepares and atomically pushes a checked version commit and its annotated tag.
 * Existing tags can only resume the original source commit's release.
 */
export async function prepareRelease({
	cwd,
	branch,
	source,
	verify = verifyPackage,
}: ReleaseOptions): Promise<string | undefined> {
	if (!/^[0-9a-f]{40}$/.test(source))
		throw new Error("Invalid release source SHA.");
	await command(cwd, ["git", "check-ref-format", `refs/heads/${branch}`]);
	const message = await command(
		cwd,
		["git", "show", "-s", "--format=format:%B", source],
		false,
	);
	const tag = releaseTag(message);
	if (!tag) return undefined;
	const version = tag.slice(1);
	if (await command(cwd, ["git", "status", "--porcelain"]))
		throw new Error("Release checkout must be clean.");

	const tagRef = `refs/tags/${tag}`;
	const existing = await command(cwd, [
		"git",
		"ls-remote",
		"--tags",
		"origin",
		tagRef,
	]);
	if (existing) {
		await command(cwd, ["git", "fetch", "origin", tagRef]);
		const commit = await command(cwd, [
			"git",
			"rev-parse",
			"FETCH_HEAD^{commit}",
		]);
		const parents = (
			await command(cwd, ["git", "show", "-s", "--format=%P", commit])
		).split(" ");
		const title = await command(cwd, [
			"git",
			"show",
			"-s",
			"--format=%s",
			commit,
		]);
		if (
			commit !== source &&
			!(
				parents.length === 1 &&
				parents[0] === source &&
				title === `chore(release): ${tag}`
			)
		) {
			throw new Error(
				`${tag} belongs to another source commit; choose a new version.`,
			);
		}
		await command(cwd, ["git", "checkout", "--detach", commit]);
		const manifest = await Bun.file(join(cwd, "package.json")).json();
		if (manifest.version !== version)
			throw new Error("Existing tag declares a different package version.");
		await verify(cwd);
		if (await command(cwd, ["git", "status", "--porcelain"]))
			throw new Error("Verification modified an existing release.");
		return tag;
	}

	const remote = await command(cwd, [
		"git",
		"ls-remote",
		"--heads",
		"origin",
		`refs/heads/${branch}`,
	]);
	if (remote.split(/\s/)[0] !== source) {
		throw new Error(
			"The default branch advanced. Push a new version commit on its current tip.",
		);
	}
	await command(cwd, ["git", "checkout", "--detach", source]);
	const manifestPath = join(cwd, "package.json");
	const manifest = await Bun.file(manifestPath).json();
	// Compare stable versions exactly, even beyond JavaScript's safe integer range.
	if (/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version)) {
		const current = manifest.version.split(".").map(BigInt) as bigint[];
		const requested = version.split(".").map(BigInt);
		const firstDifference = requested.findIndex(
			(part, index) => part !== current[index],
		);
		const requestedPart = requested[firstDifference];
		const currentPart = current[firstDifference];
		if (
			requestedPart !== undefined &&
			currentPart !== undefined &&
			requestedPart < currentPart
		) {
			throw new Error(
				"The requested release version is older than package.json.",
			);
		}
	}
	await writeManifestVersion(manifestPath, version);
	await verify(cwd);
	const changes = (await command(cwd, ["git", "status", "--porcelain"]))
		.split("\n")
		.filter(Boolean);
	if (
		changes.some(
			(line) => !["package.json", "bun.lock"].includes(line.slice(3)),
		)
	) {
		throw new Error(
			"Verification changed files outside package.json and bun.lock.",
		);
	}
	if (changes.length) {
		await command(cwd, [
			"git",
			"add",
			"--",
			"package.json",
			...(existsSync(join(cwd, "bun.lock")) ? ["bun.lock"] : []),
		]);
		await command(cwd, ["git", "commit", "-m", `chore(release): ${tag}`]);
	}
	await command(cwd, ["git", "tag", "--annotate", tag, "--message", tag]);
	// A branch race or existing tag rejects the whole push; never force either ref.
	await command(cwd, [
		"git",
		"push",
		"--atomic",
		"origin",
		`HEAD:refs/heads/${branch}`,
		tagRef,
	]);
	return tag;
}

if (import.meta.main) {
	const {
		GITHUB_EVENT_PATH: eventPath,
		GITHUB_EVENT_NAME: eventName,
		GITHUB_OUTPUT: output,
	} = Bun.env;
	if (!eventPath || eventName !== "push")
		throw new Error("Run this script through the Release push workflow.");
	const event = await Bun.file(eventPath).json();
	const branch = event.repository?.default_branch;
	if (
		typeof branch !== "string" ||
		event.deleted ||
		event.ref !== `refs/heads/${branch}`
	) {
		console.log("Not a push to the default branch; skipping.");
	} else {
		const tag = await prepareRelease({
			cwd: process.cwd(),
			branch,
			source: event.after,
		});
		if (tag && output) appendFileSync(output, `tag=${tag}\n`);
		console.log(
			tag
				? `Prepared ${tag}`
				: "Commit message is not exactly vX.Y.Z; skipping.",
		);
	}
}
