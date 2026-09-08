/** The key `Bun.inspect` looks up to let a value render itself. */
const CUSTOM_INSPECT = Symbol.for("nodejs.util.inspect.custom");

/** A one-line stand-in that inspects as `Name: message`. */
function standIn(error: Error): object {
	const line = `${error.name}: ${error.message}`;
	return { [CUSTOM_INSPECT]: () => line, toString: () => line };
}

/** Whether `value` holds an `Error` anywhere `inlineErrors` would rewrite one. */
function holdsError(value: unknown, seen: WeakSet<object>): boolean {
	if (value instanceof Error) return true;
	if (value === null || typeof value !== "object") return false;
	if (seen.has(value)) return false;
	seen.add(value);

	if (Array.isArray(value)) return value.some((item) => holdsError(item, seen));
	if (value instanceof Map) {
		for (const [key, item] of value) {
			if (holdsError(key, seen) || holdsError(item, seen)) return true;
		}
		return false;
	}
	if (value instanceof Set) {
		for (const item of value) if (holdsError(item, seen)) return true;
		return false;
	}
	if (!isPlain(value)) return false;
	return Object.values(value).some((item) => holdsError(item, seen));
}

/** Whether an object is a plain one, so rebuilding it loses nothing. */
function isPlain(value: object): value is Record<string, unknown> {
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function rewrite(value: unknown, seen: WeakMap<object, unknown>): unknown {
	if (value instanceof Error) return standIn(value);
	if (value === null || typeof value !== "object") return value;

	const done = seen.get(value);
	if (done !== undefined) return done;

	if (Array.isArray(value)) {
		const copy: unknown[] = [];
		seen.set(value, copy);
		for (const item of value) copy.push(rewrite(item, seen));
		return copy;
	}

	if (value instanceof Map) {
		const copy = new Map<unknown, unknown>();
		seen.set(value, copy);
		for (const [key, item] of value) {
			copy.set(rewrite(key, seen), rewrite(item, seen));
		}
		return copy;
	}

	if (value instanceof Set) {
		const copy = new Set<unknown>();
		seen.set(value, copy);
		for (const item of value) copy.add(rewrite(item, seen));
		return copy;
	}

	if (!isPlain(value)) return value;

	const copy: Record<string, unknown> = Object.create(
		Object.getPrototypeOf(value),
	);
	seen.set(value, copy);
	for (const [key, item] of Object.entries(value)) {
		Object.defineProperty(copy, key, {
			value: rewrite(item, seen),
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	return copy;
}

/**
 * Replaces every `Error` nested inside a value with a one-line stand-in.
 *
 * `Bun.inspect` renders an `Error` as a source excerpt with a caret and a
 * stack, which is several lines of noise in the middle of an object dump. A
 * top-level `Error` never reaches the inspector — it goes through
 * `formatError` — but one held in a field, an array, a `Map` or a `Set` does.
 * The stand-in carries a custom inspect key, so it prints as `Name: message`
 * wherever the original sat.
 *
 * Containers are rebuilt rather than edited, so the logged value is never
 * mutated, and cycles are preserved by reusing the copy already made. Only
 * arrays, plain objects, `Map`s and `Set`s are rebuilt: anything with a
 * prototype of its own is returned untouched, since a copy would not be the
 * same kind of thing. When there is no `Error` to replace, `value` is returned
 * as it is.
 *
 * @param value - The value about to be inspected.
 * @returns `value` itself, or a copy with its errors replaced.
 *
 * @example
 * ```ts
 * inlineErrors({ note: "failed", error: new Error("inner") });
 * // inspects as { note: "failed", error: Error: inner }
 * ```
 */
export function inlineErrors(value: unknown): unknown {
	if (!holdsError(value, new WeakSet())) return value;
	return rewrite(value, new WeakMap());
}
