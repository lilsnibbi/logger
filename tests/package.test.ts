import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

test("published archive builds and exposes the public API", async () => {
	const root = resolve(import.meta.dir, "..");
	// Stay beneath node_modules so extracted imports resolve installed peers.
	const cache = join(root, "node_modules", ".cache");
	mkdirSync(cache, { recursive: true });
	const temporary = mkdtempSync(join(cache, "package-test-"));
	try {
		const archive = join(temporary, "package.tgz");
		const pack = Bun.spawnSync(
			[process.execPath, "pm", "pack", "--filename", archive],
			{ cwd: root },
		);
		expect(pack.exitCode, pack.stderr.toString()).toBe(0);
		const listing = Bun.spawnSync(["tar", "-tzf", archive]);
		expect(listing.exitCode, listing.stderr.toString()).toBe(0);
		const files = listing.stdout.toString().trim().split(/\r?\n/);
		expect(files).toContain("package/src/index.ts");
		expect(files).toContain("package/LICENSE");
		expect(files).toContain("package/README.md");
		for (const file of files) {
			expect(file).toMatch(
				/^package\/(src\/.*|package\.json|README\.md|LICENSE)$/,
			);
		}
		const unpack = Bun.spawnSync(["tar", "-xzf", archive, "-C", temporary]);
		expect(unpack.exitCode, unpack.stderr.toString()).toBe(0);
		const manifest = await Bun.file(
			join(temporary, "package", "package.json"),
		).json();
		const entry = resolve(temporary, "package", manifest.exports["."].import);
		const build = await Bun.build({
			entrypoints: [entry],
			target: "bun",
			packages: "external",
		});
		expect(build.success, String(build.logs)).toBe(true);
		const exports = await import(pathToFileURL(entry).href);
		const expected: Record<string, string[]> = {
			"@lilsnibbi/toolkit": [
				"chunk",
				"clamp",
				"formatBytes",
				"formatSeconds",
				"isLink",
				"randomInt",
				"randomItem",
				"shuffle",
				"toOrdinal",
				"truncate",
			],
			"@lilsnibbi/logger": ["Logger", "LogFile", "formatError"],
			"@lilsnibbi/discord-kit": [
				"DiscordClient",
				"DiscordCommand",
				"DiscordEvent",
				"DiscordPagination",
				"getClient",
			],
		};
		const names = expected[manifest.name];
		expect(names).toBeDefined();
		for (const name of names ?? [])
			expect(typeof exports[name]).toBe("function");
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}, 30_000);
