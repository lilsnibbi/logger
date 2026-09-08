import { describe, expect, test } from "bun:test";
import {
	assertSemver,
	parseReleaseDirective,
	RELEASE_TAG_PATTERN,
	resolveVersion,
} from "../scripts/releaseManifests";

describe("release metadata", () => {
	test("rejects invalid numeric identifiers and empty prerelease parts", () => {
		for (const version of [
			"01.2.3",
			"1.02.3",
			"1.2.03",
			"1.2.3-01",
			"1.2.3-beta.01",
			"1.2.3-beta..1",
		]) {
			expect(() => assertSemver(version, "test")).toThrow();
			expect(RELEASE_TAG_PATTERN.test(`v${version}`)).toBe(false);
		}
	});

	test("preserves case and build metadata in explicit versions", () => {
		const version = "1.2.3-RC.1+Build.01";
		expect(resolveVersion("1.0.0", `v${version}`)).toBe(version);
		expect(parseReleaseDirective(`[release: v${version}]`)).toBe(`v${version}`);
		expect(RELEASE_TAG_PATTERN.test(`v${version}`)).toBe(true);
	});

	test("does not extract a valid prefix of an invalid directive", () => {
		for (const message of [
			"prerelease: patch",
			"release: patch-notes",
			"release: v1.2.3.4",
			"release: v1.2.3-beta..1",
		]) {
			expect(parseReleaseDirective(message)).toBeUndefined();
		}
		expect(parseReleaseDirective("fix: handling [release: MINOR]")).toBe(
			"minor",
		);
		expect(resolveVersion("1.2.3", "PATCH")).toBe("1.2.4");
	});
});
