import { describe, expect, test } from "bun:test";
import { verifyRelease } from "../scripts/verifyRelease";

describe("release validation", () => {
	const manifest = { version: "1.2.3", license: "MIT" };
	test("accepts aligned metadata and the release tag", () => {
		expect(() =>
			verifyRelease(manifest, { ".": "1.2.3" }, "v1.2.3"),
		).not.toThrow();
	});
	test("rejects stale Release Please metadata", () => {
		expect(() => verifyRelease(manifest, { ".": "1.2.2" })).toThrow(
			"versions must match",
		);
	});
	test("rejects a different release tag", () => {
		expect(() => verifyRelease(manifest, { ".": "1.2.3" }, "v1.2.4")).toThrow(
			"does not match",
		);
	});
	test("rejects invalid, prerelease and missing versions", () => {
		for (const version of [
			undefined,
			"01.2.3",
			"1.2",
			"1.2.3-beta.1",
			"1.2.3+build",
		]) {
			expect(() => verifyRelease({ ...manifest, version }, {})).toThrow(
				"stable SemVer",
			);
		}
	});
	test("rejects missing metadata and incorrect licenses", () => {
		expect(() => verifyRelease(manifest, {})).toThrow("versions must match");
		expect(() =>
			verifyRelease({ ...manifest, license: "ISC" }, { ".": "1.2.3" }),
		).toThrow("MIT");
	});
});
