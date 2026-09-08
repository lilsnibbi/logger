import { expect, test } from "bun:test";
import { inlineErrors } from "../../src/core/inlineErrors";

test("preserves an own __proto__ field without changing the clone prototype", () => {
	const value = JSON.parse('{"__proto__":{"marker":true}}');
	value.error = new Error("nested");
	const rewritten = inlineErrors(value) as Record<string, unknown>;
	expect(Object.getPrototypeOf(rewritten)).toBe(Object.prototype);
	expect(Object.hasOwn(rewritten, "__proto__")).toBe(true);
	expect(
		Object.getOwnPropertyDescriptor(rewritten, "__proto__")?.value,
	).toEqual({ marker: true });
	expect(value.error).toBeInstanceOf(Error);
});
