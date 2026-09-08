import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareRelease, releaseTag } from "../scripts/release";

const temporary: string[] = [];
afterEach(() => {
	for (const directory of temporary.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
	const result = Bun.spawnSync(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString().trim();
}

function fixture(message = "v1.2.3", version = "1.0.0") {
	const root = mkdtempSync(join(tmpdir(), "release-test-"));
	temporary.push(root);
	const remote = join(root, "remote.git");
	const cwd = join(root, "checkout");
	git(root, "init", "--bare", remote);
	git(root, "init", "-b", "trunk", cwd);
	git(cwd, "config", "user.name", "Release Test");
	git(cwd, "config", "user.email", "release@example.invalid");
	git(cwd, "config", "commit.gpgsign", "false");
	git(cwd, "config", "tag.gpgsign", "false");
	git(cwd, "config", "core.autocrlf", "false");
	writeFileSync(
		join(cwd, "package.json"),
		`${JSON.stringify({ name: "fixture", version }, null, "\t")}\n`,
	);
	git(cwd, "add", "package.json");
	git(cwd, "commit", "-m", message);
	git(cwd, "remote", "add", "origin", remote);
	git(cwd, "push", "origin", "trunk");
	return {
		cwd,
		remote,
		branch: "trunk",
		source: git(cwd, "rev-parse", "HEAD"),
		verify: async () => {},
	};
}

describe("exact release commits", () => {
	test("the workflow entrypoint ignores non-default branch pushes", () => {
		const root = mkdtempSync(join(tmpdir(), "release-event-test-"));
		temporary.push(root);
		const eventPath = join(root, "event.json");
		writeFileSync(
			eventPath,
			JSON.stringify({
				repository: { default_branch: "trunk" },
				ref: "refs/heads/feature",
				after: "invalid",
				head_commit: { message: "v1.2.3" },
			}),
		);
		const result = Bun.spawnSync(
			[process.execPath, join(import.meta.dir, "../scripts/release.ts")],
			{
				cwd: root,
				env: {
					...process.env,
					GITHUB_EVENT_NAME: "push",
					GITHUB_EVENT_PATH: eventPath,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain("skipping");
	});

	test("accepts only the entire stable version message", () => {
		expect(releaseTag("v1.2.3")).toBe("v1.2.3");
		expect(releaseTag("v1.2.3\n")).toBe("v1.2.3");
		for (const message of [
			"release: v1.2.3",
			"v1.2.3 extra",
			" v1.2.3",
			"v1.2.3 ",
			"v1.2.3\n\nbody",
			"v01.2.3",
			"v1.2.3-beta.1",
			"v1.2.3+build",
			"V1.2.3",
			"v1.2.3\n\n",
		]) {
			expect(releaseTag(message)).toBeUndefined();
		}
	});

	test("versions and tags the triggering source on a non-main default branch", async () => {
		const options = fixture();
		let verified = false;
		const tag = await prepareRelease({
			...options,
			verify: async (cwd) => {
				verified = true;
				expect((await Bun.file(join(cwd, "package.json")).json()).version).toBe(
					"1.2.3",
				);
			},
		});
		expect(verified).toBe(true);
		expect(tag).toBe("v1.2.3");
		const released = git(
			options.remote,
			"rev-parse",
			"refs/tags/v1.2.3^{commit}",
		);
		expect(git(options.remote, "rev-parse", "trunk")).toBe(released);
		expect(git(options.remote, "rev-parse", `${released}^`)).toBe(
			options.source,
		);
		expect(git(options.remote, "cat-file", "-t", "refs/tags/v1.2.3")).toBe(
			"tag",
		);
	});

	test("reuses an existing release when retrying after the branch advances", async () => {
		const options = fixture();
		await prepareRelease(options);
		const released = git(options.cwd, "rev-parse", "HEAD");
		git(options.cwd, "commit", "--allow-empty", "-m", "ordinary later work");
		git(options.cwd, "push", "origin", "HEAD:trunk");
		const latest = git(options.remote, "rev-parse", "trunk");
		expect(await prepareRelease(options)).toBe("v1.2.3");
		expect(git(options.cwd, "rev-parse", "HEAD")).toBe(released);
		expect(git(options.remote, "rev-parse", "trunk")).toBe(latest);
	});

	test("tags the source directly when its manifest already matches", async () => {
		const options = fixture("v1.2.3", "1.2.3");
		await prepareRelease(options);
		expect(git(options.remote, "rev-parse", "refs/tags/v1.2.3^{commit}")).toBe(
			options.source,
		);
	});

	test("does not push a tag or version commit when verification fails", async () => {
		const options = fixture();
		await expect(
			prepareRelease({
				...options,
				verify: async () => {
					throw new Error("check failed");
				},
			}),
		).rejects.toThrow("check failed");
		expect(git(options.remote, "tag", "--list")).toBe("");
		expect(git(options.remote, "rev-parse", "trunk")).toBe(options.source);
	});

	test("rejects another source's tag", async () => {
		const options = fixture();
		await prepareRelease(options);
		git(options.cwd, "commit", "--allow-empty", "-m", "v1.2.3");
		git(options.cwd, "push", "origin", "HEAD:trunk");
		await expect(
			prepareRelease({
				...options,
				source: git(options.cwd, "rev-parse", "HEAD"),
			}),
		).rejects.toThrow("another source");
	});

	test("rejects a branch race without moving either remote ref", async () => {
		const options = fixture();
		await expect(
			prepareRelease({
				...options,
				verify: async () => {
					// Simulate a concurrent push using an existing commit object.
					const tree = git(options.cwd, "rev-parse", "HEAD^{tree}");
					const next = git(
						options.cwd,
						"commit-tree",
						tree,
						"-p",
						options.source,
						"-m",
						"concurrent work",
					);
					git(options.cwd, "push", "origin", `${next}:trunk`);
				},
			}),
		).rejects.toThrow();
		expect(git(options.remote, "tag", "--list")).toBe("");
		expect(git(options.remote, "log", "-1", "--format=%s", "trunk")).toBe(
			"concurrent work",
		);
	});

	test("ignores ordinary commits without verification or remote writes", async () => {
		const options = fixture("fix: ordinary change");
		expect(
			await prepareRelease({
				...options,
				verify: async () => {
					throw new Error("must not run");
				},
			}),
		).toBeUndefined();
		expect(git(options.remote, "tag", "--list")).toBe("");
	});

	test("rejects a downgrade", async () => {
		const options = fixture("v1.2.3", "2.0.0");
		await expect(prepareRelease(options)).rejects.toThrow("older");
		expect(git(options.remote, "tag", "--list")).toBe("");
	});
});
