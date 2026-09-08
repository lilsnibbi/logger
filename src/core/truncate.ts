/**
 * Shortens a string to at most `maxLength` characters, ending in an ellipsis.
 *
 * The ellipsis counts toward the budget, so the result never exceeds
 * `maxLength`. When `maxLength` is 3 or less there is no room for it and the
 * string is hard-cut instead.
 *
 * @param value - The string to shorten.
 * @param maxLength - Maximum length of the result, ellipsis included.
 * @returns `value` unchanged if it already fits, otherwise the shortened string.
 * @throws {RangeError} If `maxLength` is negative.
 *
 * @example
 * ```ts
 * truncate("Hello, world!", 8); // "Hello..."
 * truncate("Hello", 10);        // "Hello"
 * ```
 */
export function truncate(value: string, maxLength: number): string {
	if (maxLength < 0) throw new RangeError("maxLength cannot be negative");
	if (value.length <= maxLength) return value;
	if (maxLength <= 3) return value.slice(0, maxLength);
	return `${value.slice(0, maxLength - 3)}...`;
}
