import {
	afterEach,
	beforeEach,
	describe,
	expect,
	type Mock,
	spyOn,
	test,
} from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripAnsi } from "../../src/core/paint";
import {
	DEFAULT_THEME,
	LEVEL_PRIORITY,
	Logger,
} from "../../src/structures/Logger";
import type { LoggerOptions } from "../../src/structures/Logger";

type StreamSpy = Mock<typeof process.stdout.write>;

let logger: Logger;
let stdout: string[];
let stderr: string[];
let stdoutSpy: StreamSpy;
let stderrSpy: StreamSpy;
let directory: string;
let loggers: Logger[];

/** Tracks a logger so its file is closed before the directory is removed. */
function make(options: LoggerOptions): Logger {
	const created = new Logger({ colors: false, ...options });
	loggers.push(created);
	return created;
}

/** Everything a stream received, joined and with trailing newlines trimmed. */
function written(chunks: string[]): string {
	if (chunks.length === 0) throw new Error("nothing was written");
	return chunks.join("").trimEnd();
}

/** Redirects a standard stream into an array for the duration of a test. */
function capture(stream: NodeJS.WriteStream, sink: string[]): StreamSpy {
	return spyOn(stream, "write").mockImplementation(((chunk: unknown) => {
		sink.push(String(chunk));
		return true;
	}) as typeof process.stdout.write);
}

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "lilsnibbi-logger-"));
	loggers = [];
	logger = new Logger({ name: "tester", timeformat: "en-AU", colors: false });
	stdout = [];
	stderr = [];
	stdoutSpy = capture(process.stdout, stdout);
	stderrSpy = capture(process.stderr, stderr);
});

afterEach(async () => {
	stdoutSpy.mockRestore();
	stderrSpy.mockRestore();
	for (const created of loggers) await created.close();
	rmSync(directory, { recursive: true, force: true });
});

describe("Logger", () => {
	describe("notif", () => {
		test("writes to stdout with a NOTIF label", () => {
			logger.notif("hello");
			expect(stdout).toHaveLength(1);
			expect(written(stdout)).toContain("NOTIF");
			expect(written(stdout)).toContain("hello");
		});

		test("raw flag returns the string without writing it", () => {
			const result = logger.notif("raw test", true);
			expect(stdout).toBeEmpty();
			expect(typeof result).toBe("string");
			expect(result).toContain("raw test");
			expect(result).toContain("NOTIF");
		});
	});

	describe("alert", () => {
		test("writes to stderr with an ALERT label", () => {
			logger.alert("heads up");
			expect(stderr).toHaveLength(1);
			expect(written(stderr)).toContain("ALERT");
			expect(written(stderr)).toContain("heads up");
		});

		test("raw flag returns the string without writing it", () => {
			const result = logger.alert("raw alert", true);
			expect(stderr).toBeEmpty();
			expect(result).toContain("ALERT");
		});
	});

	describe("error", () => {
		test("writes to stderr with an ERROR label", () => {
			logger.error("something broke");
			expect(stderr).toHaveLength(1);
			expect(written(stderr)).toContain("ERROR");
			expect(written(stderr)).toContain("something broke");
		});

		test("renders an Error with its name, message and stack", () => {
			logger.error(new Error("db failed"));
			const output = written(stderr);
			expect(output).toContain("ERROR");
			expect(output).toContain("Error: db failed");
			expect(output).toContain("└─");
		});

		test("leaves the Error object untouched", () => {
			const error = new Error("db failed");
			const stack = error.stack;

			logger.error(error);

			expect(error.message).toBe("db failed");
			expect(error.stack).toBe(stack);
		});

		test("renders the cause chain", () => {
			const error = new Error("outer", { cause: new Error("inner") });
			logger.error(error);
			expect(written(stderr)).toContain("caused by");
			expect(written(stderr)).toContain("Error: inner");
		});

		test("raw flag returns the rendered stack", () => {
			const result = logger.error(new Error("db failed"), true);
			expect(stderr).toBeEmpty();
			expect(result).toContain("db failed");
			expect(result).toContain("└─");
		});

		test("raw flag returns the string without writing it", () => {
			const result = logger.error("raw error", true);
			expect(stderr).toBeEmpty();
			expect(result).toContain("ERROR");
		});
	});

	describe("debug", () => {
		test("writes to stdout with a DEBUG label", () => {
			logger.debug("trace info");
			expect(stdout).toHaveLength(1);
			expect(written(stdout)).toContain("DEBUG");
			expect(written(stdout)).toContain("trace info");
		});

		test("raw flag returns the string without writing it", () => {
			const result = logger.debug("raw debug", true);
			expect(stdout).toBeEmpty();
			expect(result).toContain("DEBUG");
		});
	});

	describe("log", () => {
		test("sends DEBUG and NOTIF to stdout, ALERT and ERROR to stderr", () => {
			logger.log("DEBUG", "d");
			logger.log("NOTIF", "n");
			logger.log("ALERT", "a");
			logger.log("ERROR", "e");

			expect(stdout).toHaveLength(2);
			expect(written(stdout)).toContain("DEBUG");
			expect(written(stdout)).toContain("NOTIF");

			expect(stderr).toHaveLength(2);
			expect(written(stderr)).toContain("ALERT");
			expect(written(stderr)).toContain("ERROR");
		});

		test("writes one chunk per record, ending in a single newline", () => {
			logger.notif("one");
			logger.notif("two");

			expect(stdout).toHaveLength(2);
			for (const chunk of stdout) {
				expect(chunk).toEndWith("\n");
				expect(chunk).not.toEndWith("\n\n");
			}
		});
	});

	describe("level filtering", () => {
		test("drops messages below the configured level", () => {
			logger.setLevel("ALERT");
			logger.debug("dropped");
			logger.notif("dropped");
			logger.alert("kept");
			logger.error("kept");
			expect(stdout).toBeEmpty();
			expect(stderr).toHaveLength(2);
		});

		test("returns undefined for a filtered raw call", () => {
			logger.setLevel("ERROR");
			expect(logger.notif("dropped", true)).toBeUndefined();
		});

		test("setLevel returns the logger for chaining", () => {
			expect(logger.setLevel("NOTIF")).toBe(logger);
			expect(logger.level).toBe("NOTIF");
		});

		test("LEVEL_PRIORITY orders the levels", () => {
			expect(LEVEL_PRIORITY.DEBUG).toBeLessThan(LEVEL_PRIORITY.NOTIF);
			expect(LEVEL_PRIORITY.NOTIF).toBeLessThan(LEVEL_PRIORITY.ALERT);
			expect(LEVEL_PRIORITY.ALERT).toBeLessThan(LEVEL_PRIORITY.ERROR);
		});
	});

	describe("silent", () => {
		test("drops everything", () => {
			const quiet = make({ name: "quiet", silent: true });
			quiet.notif("nope");
			quiet.divider("nope");
			expect(stdout).toBeEmpty();
		});

		test("returns undefined for a raw call", () => {
			const quiet = make({ name: "quiet", silent: true });
			expect(quiet.notif("nope", true)).toBeUndefined();
		});
	});

	describe("timestamps", () => {
		test("matches the [Day HH:mm:ss.ms] pattern", () => {
			const output = logger.notif("ts check", true);
			expect(output).toMatch(/\[.*?\d{2}:\d{2}:\d{2}\.\d{3}]/);
		});

		test("milliseconds are zero-padded to 3 digits", () => {
			const output = logger.notif("pad check", true);
			const match = output?.match(/\.(\d{3})]/);
			expect(match).not.toBeNull();
			expect(match?.[1]?.length).toBe(3);
		});

		test("are omitted when includeTimestamps is false", () => {
			const quiet = make({ name: "quiet", includeTimestamps: false });
			expect(quiet.notif("no ts", true)).not.toMatch(/\d{2}:\d{2}:\d{2}/);
		});
	});

	describe("divider", () => {
		test("writes text surrounded by dash lines", () => {
			logger.divider("SECTION");
			expect(stdout).toHaveLength(1);
			expect(written(stdout)).toContain("SECTION");
			expect(written(stdout)).toContain("─");
		});

		test("trims whitespace from text", () => {
			logger.divider("  PADDED  ");
			expect(written(stdout)).toContain("PADDED");
		});

		test("handles empty string", () => {
			logger.divider("");
			expect(stdout).toHaveLength(1);
			expect(written(stdout)).toContain("─");
		});
	});

	describe("non-string messages", () => {
		test("numbers are stringified", () => {
			expect(logger.notif(42, true)).toContain("42");
		});

		test("objects are formatted using inspect", () => {
			const output = logger.notif({ key: "val" }, true);
			expect(output).toContain("key");
			expect(output).toContain("val");
			expect(output).not.toContain("[object Object]");
		});

		test("null and undefined are stringified", () => {
			expect(logger.notif(null, true)).toContain("null");
			expect(logger.notif(undefined, true)).toContain("undefined");
		});

		test("inspectDepth limits how deep objects are rendered", () => {
			const shallow = make({ name: "shallow", inspectDepth: 0 });
			const output = shallow.notif({ a: { b: { c: 1 } } }, true);
			expect(output).toContain("[Object ...]");
		});
	});

	describe("colours", () => {
		test("are absent when colors is false", () => {
			const output = logger.notif("plain", true) ?? "";
			expect(stripAnsi(output)).toBe(output);
		});

		test("are present when colors is true", () => {
			const bright = make({ name: "bright", colors: true });
			const output = bright.notif("styled", true) ?? "";
			expect(stripAnsi(output)).not.toBe(output);
		});

		test("a theme override changes the level style", () => {
			const themed = make({
				name: "themed",
				colors: true,
				theme: { NOTIF: { color: "#ff0055" } },
			});

			expect(themed.notif("styled", true)).toContain("38;2;255;0;85");
		});

		test("setTheme applies overrides afterwards", () => {
			const themed = make({ name: "themed", colors: true });
			expect(themed.setTheme({ NOTIF: { color: "#00ff00" } })).toBe(themed);
			expect(themed.notif("styled", true)).toContain("38;2;0;255;0");
		});

		test("DEFAULT_THEME covers every token used by the layout", () => {
			expect(DEFAULT_THEME.ERROR).toEqual({
				background: "red",
				color: "white",
				bold: true,
			});
			expect(DEFAULT_THEME.timestamp).toEqual({ color: "gray" });
		});
	});

	describe("layout", () => {
		test("badge wraps the level in its own block", () => {
			expect(logger.notif("hi", true)).toContain(" NOTIF  tester › hi");
		});

		test("badge fills the block with the level's background", () => {
			const badged = make({ name: "badged", colors: true });
			expect(badged.error("nope", true)).toContain("\x1b[1;37;41m ERROR ");
		});

		test("bar draws a bar and a glyph in place of the badge", () => {
			const barred = make({ name: "barred", layout: "bar" });
			const output = barred.notif("hi", true) ?? "";

			expect(output).toContain("▌ ✓ barred › hi");
			expect(output).not.toContain("NOTIF");
		});

		test("bar paints the badge's background as its own colour", () => {
			const barred = make({ name: "barred", layout: "bar", colors: true });
			expect(barred.error("nope", true)).toContain("\x1b[1;31m▌ ×");
		});

		test("symbols override the glyphs the bar uses", () => {
			const barred = make({
				name: "barred",
				layout: "bar",
				symbols: { NOTIF: "→" },
			});

			expect(barred.notif("hi", true)).toContain("▌ → barred");
		});

		test("box frames the message between two rules", () => {
			const boxed = make({ name: "boxed", layout: "box", box: { width: 40 } });
			const lines = (boxed.notif("hi", true) ?? "").split("\n");

			expect(lines).toHaveLength(3);
			expect(lines[0]).toStartWith("┌ ");
			expect(lines[0]).toContain("NOTIF");
			expect(lines[0]).toEndWith(" boxed ┐");
			expect(lines[1]).toBe("│ hi");
			expect(lines[2]).toBe(`└${"─".repeat(38)}┘`);
		});

		test("box drops the weekday and milliseconds from the timestamp", () => {
			const boxed = make({ name: "boxed", layout: "box", box: { width: 40 } });
			expect(boxed.notif("hi", true)).toMatch(/^┌ \d{2}:\d{2}:\d{2} NOTIF/);
		});

		test("box rules span the configured width", () => {
			for (const includeTimestamps of [true, false]) {
				const boxed = make({
					name: "boxed",
					layout: "box",
					box: { width: 40 },
					includeTimestamps,
				});

				const lines = (boxed.notif("hi", true) ?? "").split("\n");

				expect(lines.at(0)).toHaveLength(40);
				expect(lines.at(-1)).toHaveLength(40);
			}
		});

		test("box truncates a corner rather than overflowing its rule", () => {
			const boxed = make({
				name: "a".repeat(60),
				layout: "box",
				box: { width: 40, bottomRight: "b".repeat(60) },
			});

			const lines = (boxed.notif("hi", true) ?? "").split("\n");

			expect(lines.at(0)).toHaveLength(40);
			expect(lines.at(-1)).toHaveLength(40);
			expect(lines.at(0)).toEndWith("... ┐");
			expect(lines.at(-1)).toEndWith("... ┘");
		});

		test("box fills its corners from the box options", () => {
			const boxed = make({
				name: "boxed",
				layout: "box",
				box: {
					width: 60,
					topRight: "src/api.ts:19",
					bottomLeft: "GET /",
					bottomRight: (record) => `level: ${record.level}`,
				},
			});

			const lines = (boxed.notif("hi", true) ?? "").split("\n");

			expect(lines.at(0)).toEndWith(" src/api.ts:19 ┐");
			expect(lines.at(0)).not.toContain("boxed");
			expect(lines.at(-1)).toStartWith("└─ GET / ");
			expect(lines.at(-1)).toEndWith(" level: NOTIF ┘");
			expect(lines.at(-1)).toHaveLength(60);
		});

		test("box leaves an empty corner out of the rule", () => {
			const boxed = make({
				name: "boxed",
				layout: "box",
				box: { width: 40, topRight: "", bottomRight: () => undefined },
			});

			const lines = (boxed.notif("hi", true) ?? "").split("\n");

			expect(lines.at(0)).toEndWith("──┐");
			expect(lines.at(-1)).toBe(`└${"─".repeat(38)}┘`);
		});

		test("box opens with a blank line, so two boxes are separated by one", () => {
			const boxed = make({ name: "boxed", layout: "box", box: { width: 40 } });
			boxed.notif("first");
			boxed.notif("second");

			expect(stdout.join("")).toStartWith("\n┌ ");
			expect(stdout.join("")).toContain("┘\n\n┌ ");
			expect(stdout.join("")).toEndWith("┘\n");
		});

		test("box spacing can be turned off", () => {
			const boxed = make({
				name: "boxed",
				layout: "box",
				box: { width: 40, spacing: false },
			});

			boxed.notif("hi");

			expect(stdout.join("")).toStartWith("┌ ");
			expect(stdout.join("")).toEndWith("┘\n");
		});

		test("box gives every line of a message its own edge", () => {
			const boxed = make({ name: "boxed", layout: "box", box: { width: 40 } });
			expect(boxed.notif("first\nsecond", true)).toContain("│ first\n│ second");
		});

		test("box paints the level in the badge's colour", () => {
			const boxed = make({
				name: "boxed",
				layout: "box",
				box: { width: 40 },
				colors: true,
			});

			expect(boxed.error("nope", true)).toContain("\x1b[1;31mERROR");
		});

		test("a child keeps the parent's layout", () => {
			const barred = make({ name: "barred", layout: "bar" });
			expect(barred.child("worker").notif("hi", true)).toContain("▌ ✓ worker");
		});
	});

	describe("hooks", () => {
		test("strips input ANSI from transports and colourless files", () => {
			const captured: string[] = [];
			const hooked = make({
				name: "plain",
				colors: false,
				file: { directory, rotate: "never" },
				transport: (line) => captured.push(line),
			});
			hooked.notif("\x1b[31mred\x1b[0m");
			expect(captured[0]).toBe(stripAnsi(captured[0] ?? ""));
			const contents = readFileSync(hooked.filePath as string, "utf8");
			expect(contents).toContain("red");
			expect(contents).toBe(stripAnsi(contents));
		});

		test("serialize replaces how a value is rendered", () => {
			const hooked = make({
				name: "hooked",
				serialize: (value) =>
					typeof value === "number" ? `#${value}` : undefined,
			});

			expect(hooked.notif(7, true)).toContain("#7");
			expect(hooked.notif("plain", true)).toContain("plain");
		});

		test("format replaces the whole layout", () => {
			const hooked = make({
				name: "hooked",
				format: (parts) => `${parts.level}::${parts.message}`,
			});

			expect(hooked.notif("hi", true)).toBe("NOTIF::hi");
		});

		test("format receives the record and theme helpers", () => {
			const hooked = make({
				name: "hooked",
				format: (parts, context) =>
					`${context.name}/${context.destination}/${context.colors}/${parts.message}`,
			});

			expect(hooked.notif("hi", true)).toBe("hooked/console/false/hi");
		});

		test("filter drops records before they are formatted", () => {
			const hooked = make({
				name: "hooked",
				filter: (record) => record.value !== "secret",
			});

			hooked.notif("secret");
			hooked.notif("public");

			expect(stdout).toHaveLength(1);
			expect(written(stdout)).toContain("public");
		});

		test("transport receives the colour-free line", () => {
			const captured: string[] = [];
			const hooked = make({
				name: "hooked",
				colors: true,
				transport: (line) => captured.push(line),
			});

			hooked.notif("shipped");

			const line = captured[0] ?? "";
			expect(captured).toHaveLength(1);
			expect(line).toContain("shipped");
			expect(stripAnsi(line)).toBe(line);
		});

		test("transport is skipped for a raw call", () => {
			const captured: string[] = [];
			const hooked = make({
				name: "hooked",
				transport: (line) => captured.push(line),
			});

			hooked.notif("not shipped", true);

			expect(captured).toBeEmpty();
		});
	});

	describe("child", () => {
		test("inherits the parent's current level, silence, and theme", () => {
			logger.setLevel("ERROR").setTheme({ ERROR: { color: "cyan" } });
			logger.silent = true;
			const child = logger.child("worker", { colors: true });
			expect(child.level).toBe("ERROR");
			expect(child.silent).toBe(true);
			child.silent = false;
			expect(child.error("failure", true)).toContain("\x1b[36m");
			expect(child.notif("filtered", true)).toBeUndefined();
			expect(logger.silent).toBe(true);
		});

		test("uses the new name and keeps the configuration", () => {
			const parent = make({ name: "parent", includeTimestamps: false });
			const child = parent.child("worker");

			expect(child.notif("hi", true)).toContain("worker");
			expect(child.notif("hi", true)).not.toMatch(/\d{2}:\d{2}:\d{2}/);
		});

		test("accepts overrides", () => {
			const parent = make({ name: "parent" });
			const child = parent.child("worker", { level: "ALERT" });

			expect(child.level).toBe("ALERT");
			expect(parent.level).toBe("DEBUG");
		});

		test("shares the parent's log file", () => {
			const parent = make({ name: "parent", file: { directory } });
			const child = parent.child("worker");

			parent.notif("from parent");
			child.notif("from child");

			const [name] = readdirSync(directory);
			const contents = readFileSync(join(directory, name ?? ""), "utf8");
			expect(contents).toContain("from parent");
			expect(contents).toContain("from child");
		});

		test("closing a child leaves the shared file open", async () => {
			const parent = make({ name: "parent", file: { directory } });
			const child = parent.child("worker");

			parent.notif("first");
			await child.close();
			parent.notif("second");

			const [name] = readdirSync(directory);
			expect(readFileSync(join(directory, name ?? ""), "utf8")).toContain(
				"second",
			);
		});
	});

	describe("file output", () => {
		test("writes the formatted line", () => {
			const filed = make({ name: "filed", file: { directory } });
			filed.notif("to disk");

			const [name] = readdirSync(directory);
			expect(readFileSync(join(directory, name ?? ""), "utf8")).toContain(
				" NOTIF  filed › to disk",
			);
		});

		test("exposes the active path", () => {
			const filed = make({ name: "filed", file: { directory } });
			filed.notif("to disk");
			expect(filed.filePath ?? "").toStartWith(directory);
		});

		test("filePath is undefined without a file", () => {
			expect(logger.filePath).toBeUndefined();
		});

		test("has no colour by default", () => {
			const filed = make({
				name: "filed",
				colors: true,
				file: { directory },
			});
			filed.notif("to disk");

			const [name] = readdirSync(directory);
			const contents = readFileSync(join(directory, name ?? ""), "utf8");
			expect(stripAnsi(contents)).toBe(contents);
		});

		test("can keep more detail than the console", () => {
			const filed = make({
				name: "filed",
				level: "ALERT",
				file: { directory, level: "DEBUG" },
			});

			filed.debug("quiet on screen");

			expect(stdout).toBeEmpty();
			const [name] = readdirSync(directory);
			expect(readFileSync(join(directory, name ?? ""), "utf8")).toContain(
				"quiet on screen",
			);
		});

		test("json mode writes one object per line", () => {
			const filed = make({
				name: "filed",
				file: { directory, json: true, rotate: "never" },
			});

			filed.notif("structured");

			const line = readFileSync(join(directory, "app.log"), "utf8").trim();
			expect(JSON.parse(line)).toMatchObject({
				level: "NOTIF",
				name: "filed",
				message: "structured",
			});
		});

		test("json mode carries the raw error alongside the message", () => {
			const filed = make({
				name: "filed",
				file: { directory, json: true, rotate: "never" },
			});

			filed.error(new Error("boom"));

			const line = readFileSync(join(directory, "app.log"), "utf8").trim();
			const parsed = JSON.parse(line) as { error: { message: string } };
			expect(parsed.error.message).toBe("boom");
		});

		test("a raw call writes nothing", () => {
			const filed = make({
				name: "filed",
				file: { directory, rotate: "never" },
			});

			filed.notif("not written", true);

			expect(readdirSync(directory)).toBeEmpty();
		});

		test("flush resolves without a file", async () => {
			await expect(logger.flush()).resolves.toBeUndefined();
		});
	});

	describe("timers", () => {
		test("timeEnd logs and returns the elapsed milliseconds", () => {
			logger.time("work");
			const elapsed = logger.timeEnd("work");

			expect(typeof elapsed).toBe("number");
			expect(stdout).toHaveLength(1);
			expect(written(stdout)).toContain("DEBUG");
			expect(written(stdout)).toContain("work took");
		});

		test("timeEnd accepts a level", () => {
			logger.time("work");
			logger.timeEnd("work", "NOTIF");
			expect(written(stdout)).toContain("NOTIF");
		});

		test("timeEnd returns undefined for an unknown label", () => {
			expect(logger.timeEnd("missing")).toBeUndefined();
			expect(stdout).toBeEmpty();
		});

		test("a label can only be ended once", () => {
			logger.time("work");
			logger.timeEnd("work");
			expect(logger.timeEnd("work")).toBeUndefined();
		});
	});
});
