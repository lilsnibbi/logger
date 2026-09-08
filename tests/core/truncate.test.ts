import { describe, expect, test } from "bun:test";
import { truncate } from "../../src/core/truncate";

describe("truncate", () => {
	test("truncates a string and appends an ellipsis when it exceeds max length", () => {
		expect(truncate("Hello World", 8)).toBe("Hello...");
		expect(truncate("TypeScript is amazing", 13)).toBe("TypeScript...");
	});

	test("returns the original string if it is strictly less than max length", () => {
		expect(truncate("Hello", 10)).toBe("Hello");
		expect(truncate("", 5)).toBe("");
	});

	test("returns the original string if it is exactly max length", () => {
		expect(truncate("Hello", 5)).toBe("Hello");
		expect(truncate("Exact", 5)).toBe("Exact");
	});

	test("throws an error if maxLength is negative", () => {
		expect(() => truncate("Hello", -1)).toThrow("maxLength cannot be negative");
		expect(() => truncate("Hello", -10)).toThrow(
			"maxLength cannot be negative",
		);
	});

	test("handles extremely short max lengths properly (<= 3)", () => {
		// Previously a bug: truncate("Hello", 2) would return "Hell..."
		expect(truncate("Hello", 3)).toBe("Hel");
		expect(truncate("Hello", 2)).toBe("He");
		expect(truncate("Hello", 1)).toBe("H");
		expect(truncate("Hello", 0)).toBe("");
	});

	test("handles whitespace strings correctly", () => {
		expect(truncate("A B C D E", 6)).toBe("A B...");
		expect(truncate("       ", 5)).toBe("  ...");
	});

	test("handles emoji characters (length is determined by UTF-16 code units)", () => {
		// A rocket emoji "🚀" consists of 2 UTF-16 code units
		// slice(0, 5 - 3) = slice(0, 2) which gets exactly one rocket emoji
		expect(truncate("🚀🚀🚀🚀", 5)).toBe("🚀...");
		// Family emoji is 11 code units: 👨(2) + ZWJ(1) + 👩(2) + ZWJ(1) + 👧(2) + ZWJ(1) + 👦(2)
		// slice(0, 2) gives just 👨
		expect(truncate("👨‍👩‍👧‍👦", 5)).toBe("👨...");
	});

	test("truncates exactly on boundaries without duplicating the final character", () => {
		// String length 10, max length 9.
		// slice(0, 6) = "012345", plus "..." = "012345..." -> length 9
		expect(truncate("0123456789", 9)).toBe("012345...");
	});
});
