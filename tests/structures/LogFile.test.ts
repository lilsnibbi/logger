import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogFile } from "../../src/structures/LogFile";

let directory: string;
let files: LogFile[];

/** Tracks a file so it is closed before the directory is removed. */
function open(options: ConstructorParameters<typeof LogFile>[0]): LogFile {
	const file = new LogFile(options);
	files.push(file);
	return file;
}

/** Today's stamp, matching the one daily rotation puts in a filename. */
function today(): string {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${now.getFullYear()}-${month}-${day}`;
}

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "lilsnibbi-logfile-"));
	files = [];
});

afterEach(async () => {
	for (const file of files) await file.close();
	rmSync(directory, { recursive: true, force: true });
});

describe("LogFile", () => {
	describe("writing", () => {
		test("appends each line with a trailing newline", () => {
			const file = open({ directory, rotate: "never" });
			file.write("one");
			file.write("two");

			expect(readFileSync(join(directory, "app.log"), "utf8")).toBe(
				"one\ntwo\n",
			);
		});

		test("creates the directory when it is missing", () => {
			const nested = join(directory, "a", "b");
			const file = open({ directory: nested, rotate: "never" });
			file.write("one");

			expect(readdirSync(nested)).toEqual(["app.log"]);
		});

		test("appends to a file that already exists", () => {
			writeFileSync(join(directory, "app.log"), "existing\n");

			const file = open({ directory, rotate: "never" });
			file.write("new");

			expect(readFileSync(join(directory, "app.log"), "utf8")).toBe(
				"existing\nnew\n",
			);
		});

		test("exposes the active path", () => {
			const file = open({ directory, filename: "api", rotate: "never" });
			file.write("one");

			expect(file.path).toBe(join(directory, "api.log"));
		});

		test("ignores writes once closed", async () => {
			const file = open({ directory, rotate: "never" });
			file.write("one");
			await file.close();
			file.write("two");

			expect(readFileSync(join(directory, "app.log"), "utf8")).toBe("one\n");
		});
	});

	describe("naming", () => {
		test("omits the date when rotation is off", () => {
			const file = open({ directory, filename: "api", rotate: "never" });
			file.write("one");

			expect(readdirSync(directory)).toEqual(["api.log"]);
		});

		test("adds a date suffix for daily rotation", () => {
			const file = open({ directory, filename: "api", rotate: "daily" });
			file.write("one");

			expect(readdirSync(directory)).toEqual([`api-${today()}.log`]);
		});

		test("adds an hour suffix for hourly rotation", () => {
			const file = open({ directory, filename: "api", rotate: "hourly" });
			file.write("one");

			const hour = String(new Date().getHours()).padStart(2, "0");
			expect(readdirSync(directory)).toEqual([`api-${today()}-${hour}.log`]);
		});

		test("honours a custom extension", () => {
			const file = open({ directory, extension: "txt", rotate: "never" });
			file.write("one");

			expect(readdirSync(directory)).toEqual(["app.txt"]);
		});
	});

	describe("size rotation", () => {
		test("rotates an existing full file before the first write", () => {
			writeFileSync(join(directory, "app.log"), "existing\n");
			const file = open({ directory, rotate: "never", maxSize: 10 });
			file.write("new");
			expect(readFileSync(join(directory, "app.1.log"), "utf8")).toBe(
				"existing\n",
			);
			expect(readFileSync(join(directory, "app.log"), "utf8")).toBe("new\n");
		});

		test("archives the active file once it is full", () => {
			const file = open({
				directory,
				rotate: "never",
				maxSize: 20,
				maxFiles: 0,
			});

			// Each line is eleven bytes, so every write after the first rotates.
			for (let index = 0; index < 3; index += 1) file.write("0123456789");

			expect(readdirSync(directory).sort()).toEqual([
				"app.1.log",
				"app.2.log",
				"app.log",
			]);
		});

		test("keeps the newest content in the active file", () => {
			const file = open({
				directory,
				rotate: "never",
				maxSize: 20,
				maxFiles: 0,
			});

			file.write("aaaaaaaaa");
			file.write("bbbbbbbbb");
			file.write("ccccccccc");

			expect(readFileSync(join(directory, "app.log"), "utf8")).toBe(
				"ccccccccc\n",
			);
		});

		test("does nothing when maxSize is zero", () => {
			const file = open({ directory, rotate: "never", maxSize: 0 });
			for (let index = 0; index < 50; index += 1) file.write("0123456789");

			expect(readdirSync(directory)).toEqual(["app.log"]);
		});
	});

	describe("retention", () => {
		test("preserves files with a shared filename prefix", () => {
			const unrelated = [
				"app-worker.log",
				"app.backup.log",
				"app-2026-notes.log",
			];
			for (const name of unrelated)
				writeFileSync(join(directory, name), "keep\n");
			writeFileSync(join(directory, "app-2020-01-01.1.log"), "old\n");
			const file = open({ directory, maxFiles: 1 });
			file.write("new");
			for (const name of unrelated) {
				expect(readFileSync(join(directory, name), "utf8")).toBe("keep\n");
			}
			expect(readdirSync(directory)).not.toContain("app-2020-01-01.1.log");
		});

		test("keeps at most maxFiles files including the active one", () => {
			const file = open({
				directory,
				rotate: "never",
				maxSize: 20,
				maxFiles: 3,
			});

			for (let index = 0; index < 20; index += 1) file.write("0123456789");

			expect(readdirSync(directory)).toHaveLength(3);
		});

		test("deletes the oldest archives first", () => {
			const file = open({
				directory,
				rotate: "never",
				maxSize: 20,
				maxFiles: 2,
			});

			for (let index = 0; index < 8; index += 1) file.write("0123456789");

			const remaining = readdirSync(directory).sort();
			expect(remaining).toHaveLength(2);
			expect(remaining).toContain("app.log");
			expect(remaining).not.toContain("app.1.log");
		});

		test("leaves files belonging to another logger alone", () => {
			writeFileSync(join(directory, "other.log"), "keep me\n");

			const file = open({
				directory,
				filename: "app",
				rotate: "never",
				maxSize: 20,
				maxFiles: 1,
			});

			for (let index = 0; index < 8; index += 1) file.write("0123456789");

			expect(readdirSync(directory)).toContain("other.log");
		});

		test("keeps everything when maxFiles is zero", () => {
			const file = open({
				directory,
				rotate: "never",
				maxSize: 20,
				maxFiles: 0,
				maxAge: 0,
			});

			for (let index = 0; index < 8; index += 1) file.write("0123456789");

			expect(readdirSync(directory).length).toBeGreaterThan(3);
		});
	});

	describe("failures", () => {
		test("reports errors instead of throwing", () => {
			writeFileSync(join(directory, "blocked"), "not a directory");

			const reported: Error[] = [];
			const file = open({
				directory: join(directory, "blocked"),
				rotate: "never",
				onError: (error) => reported.push(error),
			});

			expect(() => file.write("one")).not.toThrow();
			expect(reported).not.toBeEmpty();
		});
	});

	describe("flags", () => {
		test("exposes colors and json", () => {
			const file = open({ directory, colors: true, json: true });
			expect(file.colors).toBe(true);
			expect(file.json).toBe(true);
		});

		test("defaults colors and json to false", () => {
			const file = open({ directory });
			expect(file.colors).toBe(false);
			expect(file.json).toBe(false);
		});

		test("flush resolves without a file open", async () => {
			const file = open({ directory });
			await expect(file.flush()).resolves.toBeUndefined();
		});
	});
});
