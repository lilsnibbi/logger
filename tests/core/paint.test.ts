// biome-ignore-all lint/complexity/useLiteralKeys: TypeScript requires bracket access for environment index signatures.
import { afterEach, describe, expect, test } from "bun:test";
import { colorSupported, paint, stripAnsi } from "../../src/core/paint";

const ESC = "\x1b";
const RESET = `${ESC}[0m`;

const originalEnv = { ...process.env };

afterEach(() => {
	for (const key of Object.keys(process.env)) delete process.env[key];
	Object.assign(process.env, originalEnv);
});

describe("paint", () => {
	test("does not treat inherited object keys as palette colours", () => {
		for (const color of ["toString", "constructor", "__proto__"]) {
			expect(paint("hi", { color })).toBe("hi");
		}
	});

	test("returns the text untouched when disabled", () => {
		expect(paint("hello", { color: "red" }, false)).toBe("hello");
	});

	test("returns the text untouched for an empty style", () => {
		expect(paint("hello", {})).toBe("hello");
	});

	test("returns the text untouched when there is no style", () => {
		expect(paint("hello", undefined)).toBe("hello");
	});

	test("leaves an empty string alone", () => {
		expect(paint("", { color: "red" })).toBe("");
	});

	test("uses the palette code for a named colour", () => {
		expect(paint("hi", { color: "red" })).toBe(`${ESC}[31mhi${RESET}`);
	});

	test("maps gray onto the bright black code", () => {
		expect(paint("hi", { color: "gray" })).toBe(`${ESC}[90mhi${RESET}`);
	});

	test("shifts named colours by ten for backgrounds", () => {
		expect(paint("hi", { background: "red" })).toBe(`${ESC}[41mhi${RESET}`);
	});

	test("emits truecolor for a hex colour", () => {
		expect(paint("hi", { color: "#ff0055" })).toBe(
			`${ESC}[38;2;255;0;85mhi${RESET}`,
		);
	});

	test("emits truecolor for an rgb tuple", () => {
		expect(paint("hi", { color: [1, 2, 3] })).toBe(
			`${ESC}[38;2;1;2;3mhi${RESET}`,
		);
	});

	test("emits truecolor for a css colour name", () => {
		expect(paint("hi", { background: "rebeccapurple" })).toBe(
			`${ESC}[48;2;102;51;153mhi${RESET}`,
		);
	});

	test("ignores a colour it cannot parse", () => {
		expect(paint("hi", { color: "not-a-colour" })).toBe("hi");
	});

	test("combines attributes with a colour", () => {
		expect(paint("hi", { bold: true, underline: true, color: "cyan" })).toBe(
			`${ESC}[1;4;36mhi${RESET}`,
		);
	});

	test("supports every attribute", () => {
		const style = {
			bold: true,
			dim: true,
			italic: true,
			underline: true,
			inverse: true,
			strikethrough: true,
		};
		expect(paint("hi", style)).toBe(`${ESC}[1;2;3;4;7;9mhi${RESET}`);
	});

	test("reopens the outer style after a nested one closes", () => {
		const inner = paint("b", { color: "red" });
		const outer = paint(`a${inner}c`, { bold: true });

		expect(outer).toBe(`${ESC}[1ma${ESC}[31mb${RESET}${ESC}[1mc${RESET}`);
	});
});

describe("stripAnsi", () => {
	test("removes escape sequences", () => {
		expect(stripAnsi(paint("hi", { color: "red", bold: true }))).toBe("hi");
	});

	test("leaves plain text alone", () => {
		expect(stripAnsi("hi")).toBe("hi");
	});
});

describe("colorSupported", () => {
	test("is false when NO_COLOR is set", () => {
		process.env["NO_COLOR"] = "1";
		expect(colorSupported()).toBe(false);
	});

	test("ignores an empty NO_COLOR", () => {
		process.env["NO_COLOR"] = "";
		process.env["FORCE_COLOR"] = "1";
		expect(colorSupported()).toBe(true);
	});

	test("is true when FORCE_COLOR is set", () => {
		delete process.env["NO_COLOR"];
		process.env["FORCE_COLOR"] = "1";
		expect(colorSupported()).toBe(true);
	});

	test("is false when FORCE_COLOR is 0", () => {
		delete process.env["NO_COLOR"];
		process.env["FORCE_COLOR"] = "0";
		expect(colorSupported()).toBe(false);
	});

	test("NO_COLOR wins over FORCE_COLOR", () => {
		process.env["NO_COLOR"] = "1";
		process.env["FORCE_COLOR"] = "1";
		expect(colorSupported()).toBe(false);
	});

	test("is false for a dumb terminal", () => {
		delete process.env["NO_COLOR"];
		delete process.env["FORCE_COLOR"];
		process.env["TERM"] = "dumb";
		expect(colorSupported()).toBe(false);
	});
});
