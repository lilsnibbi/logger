import { describe, expect, test } from "bun:test";
import { formatError } from "../../src/core/formatError";
import type { LogToken } from "../../src/core/paint";

/** A `paint` that leaves the text alone, so assertions stay readable. */
const plain = (_token: LogToken, text: string): string => text;

/** Builds an error with a hand-written stack, so frames are predictable. */
function withStack(message: string, frames: string[], name = "Error"): Error {
	const error = new Error(message);
	error.name = name;
	error.stack = [`${name}: ${message}`, ...frames].join("\n");
	return error;
}

describe("formatError", () => {
	test("starts with the error name and message", () => {
		const error = withStack("boom", ["    at run (/a/b.ts:1:2)"]);
		expect(formatError(error, { paint: plain })).toStartWith("Error: boom");
	});

	test("keeps a custom error name", () => {
		const error = withStack("boom", [], "TypeError");
		expect(formatError(error, { paint: plain })).toStartWith("TypeError: boom");
	});

	test("prints the name alone when there is no message", () => {
		const error = withStack("", ["    at run (/a/b.ts:1:2)"]);
		expect(formatError(error, { paint: plain }).split("\n")[0]).toBe("Error");
	});

	test("closes the last frame with a corner and branches the rest", () => {
		const error = withStack("boom", [
			"    at one (/a/b.ts:1:2)",
			"    at two (/a/b.ts:3:4)",
			"    at three (/a/b.ts:5:6)",
		]);

		const lines = formatError(error, { paint: plain }).split("\n");
		expect(lines[1]).toContain("├─");
		expect(lines[2]).toContain("├─");
		expect(lines[3]).toContain("└─");
	});

	test("renders the position as line and column", () => {
		const error = withStack("boom", ["    at run (/a/b.ts:12:34)"]);
		expect(formatError(error, { paint: plain })).toContain("(L12 C34)");
	});

	test("keeps frames with no function name", () => {
		const error = withStack("boom", ["    at /a/b.ts:1:2"]);
		expect(formatError(error, { paint: plain })).toContain(
			"└─ /a/b.ts (L1 C2)",
		);
	});

	test("keeps native frames", () => {
		const error = withStack("boom", [
			"    at run (/a/b.ts:1:2)",
			"    at native",
		]);
		expect(formatError(error, { paint: plain })).toContain("└─ native");
	});

	test("keeps node internals", () => {
		const error = withStack("boom", [
			"    at Module._compile (node:internal/modules/cjs/loader:1105:14)",
		]);
		expect(formatError(error, { paint: plain })).toContain(
			"node:internal/modules/cjs/loader",
		);
	});

	test("marks awaited frames", () => {
		const error = withStack("boom", ["    at async run (/a/b.ts:1:2)"]);
		expect(formatError(error, { paint: plain })).toContain("async run");
	});

	test("splits an eval frame on its outer parenthesis", () => {
		const error = withStack("boom", [
			"    at eval (eval at run (/a/b.ts:1:2), <anonymous>:3:4)",
		]);
		expect(formatError(error, { paint: plain })).toContain("eval at run");
	});

	test("normalises windows separators", () => {
		const error = withStack("boom", ["    at run (C:\\a\\b.ts:1:2)"]);
		expect(formatError(error, { paint: plain })).toContain("C:/a/b.ts");
	});

	test("strips a file:// prefix", () => {
		const error = withStack("boom", ["    at run (file:///a/b.ts:1:2)"]);
		expect(formatError(error, { paint: plain })).toContain("└─ run /a/b.ts");
	});

	test("shortens paths inside the working directory", () => {
		const cwd = process.cwd().replaceAll("\\", "/");
		const error = withStack("boom", [`    at run (${cwd}/src/a.ts:1:2)`]);

		expect(formatError(error, { paint: plain })).toContain("run src/a.ts");
	});

	test("keeps absolute paths when relativePaths is off", () => {
		const cwd = process.cwd().replaceAll("\\", "/");
		const error = withStack("boom", [`    at run (${cwd}/src/a.ts:1:2)`]);

		expect(
			formatError(error, { paint: plain, relativePaths: false }),
		).toContain(`${cwd}/src/a.ts`);
	});

	test("handles a message that spans several lines", () => {
		const error = new Error("line one\nline two");
		error.stack = "Error: line one\nline two\n    at run (/a/b.ts:1:2)";

		const output = formatError(error, { paint: plain });
		expect(output).toContain("line one\nline two");
		expect(output).toContain("└─ run /a/b.ts (L1 C2)");
	});

	test("copes with an error that has no stack", () => {
		const error = new Error("boom");
		error.stack = undefined;
		expect(formatError(error, { paint: plain })).toBe("Error: boom");
	});

	test("renders the cause chain", () => {
		const cause = withStack("inner", ["    at inner (/a/b.ts:1:2)"]);
		const error = new Error("outer", { cause });
		error.stack = "Error: outer\n    at outer (/a/b.ts:3:4)";

		const output = formatError(error, { paint: plain });
		expect(output).toContain("▼ caused by");
		expect(output).toContain("Error: inner");
		expect(output).toContain("inner /a/b.ts (L1 C2)");
	});

	test("renders a non-error cause", () => {
		const error = new Error("outer", { cause: { code: 42 } });
		error.stack = "Error: outer\n    at outer (/a/b.ts:3:4)";

		expect(formatError(error, { paint: plain })).toContain("code: 42");
	});

	test("stops at a circular cause", () => {
		const error = new Error("outer");
		error.stack = "Error: outer\n    at outer (/a/b.ts:1:2)";
		(error as { cause?: unknown }).cause = error;

		expect(formatError(error, { paint: plain })).not.toContain("caused by");
	});

	test("renders aggregated errors", () => {
		const error = new AggregateError(
			[withStack("first", []), withStack("second", [])],
			"all failed",
		);

		const output = formatError(error, { paint: plain });
		expect(output).toContain("Error: first");
		expect(output).toContain("Error: second");
		expect(output.match(/▼ aggregated/g)).toHaveLength(2);
	});

	test("shows extra own properties", () => {
		const error = Object.assign(withStack("boom", []), { code: "ENOENT" });
		expect(formatError(error, { paint: plain })).toContain("ENOENT");
	});

	test("omits the extras line when there are none", () => {
		const error = withStack("boom", ["    at run (/a/b.ts:1:2)"]);
		expect(formatError(error, { paint: plain }).split("\n")).toHaveLength(2);
	});

	test("indents nested causes further than their parent", () => {
		const cause = withStack("inner", [
			"    at inner (/a/b.ts:1:2)",
			"    at deeper (/a/b.ts:5:6)",
		]);
		const error = new Error("outer", { cause });
		error.stack = "Error: outer\n    at outer (/a/b.ts:3:4)";

		const lines = formatError(error, { paint: plain }).split("\n");
		expect(lines.find((line) => line.includes("inner /a/b.ts"))).toStartWith(
			"    ├─",
		);
		expect(lines.find((line) => line.includes("deeper /a/b.ts"))).toStartWith(
			"    └─",
		);
	});

	test("honours a custom indent", () => {
		const error = withStack("boom", ["    at run (/a/b.ts:1:2)"]);
		const output = formatError(error, { paint: plain, indent: ">>" });
		expect(output).toContain(">>└─");
	});

	test("passes every fragment through paint", () => {
		const tokens: LogToken[] = [];
		const error = withStack("boom", ["    at run (/a/b.ts:1:2)"]);

		formatError(error, {
			paint: (token, text) => {
				tokens.push(token);
				return text;
			},
		});

		expect(tokens).toContain("errorName");
		expect(tokens).toContain("errorMessage");
		expect(tokens).toContain("stackBranch");
		expect(tokens).toContain("stackFunction");
		expect(tokens).toContain("stackFile");
		expect(tokens).toContain("stackLocation");
	});
});
