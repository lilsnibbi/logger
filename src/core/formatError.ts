import type { LogToken } from "./paint";

/** A single parsed line of a stack trace. */
interface StackFrame {
	/** Function or method name, or `""` when the frame is anonymous. */
	fn: string;
	/** Normalised file path, or a pseudo-location such as `native`. */
	location: string;
	/** Line number, or `null` for frames without a source position. */
	line: number | null;
	/** Column number, or `null` for frames without a source position. */
	column: number | null;
	/** Whether the frame sits behind an `await`. */
	async: boolean;
}

/** Options for {@link formatError}. */
export interface FormatErrorOptions {
	/** Styles a fragment of output with a theme token. */
	paint: (token: LogToken, text: string) => string;
	/** Prefix applied to every line below the header. Defaults to `"  "`. */
	indent?: string;
	/**
	 * Rewrite absolute paths that sit inside `process.cwd()` as relative ones.
	 * Defaults to `true`.
	 */
	relativePaths?: boolean;
}

/** Matches a stack line, i.e. the point where the header ends. */
const FRAME_LINE = /^\s*at\s/;

/** Splits a frame's location into path, line and column. */
const POSITION = /^(.*?):(\d+):(\d+)$/;

/** Error keys that are rendered by hand rather than as extra properties. */
const RENDERED_KEYS = new Set(["name", "message", "stack", "cause", "errors"]);

/** How many `cause` links to follow before giving up. */
const MAX_CAUSE_DEPTH = 8;

/**
 * Renders an error, its stack, its `cause` chain and any aggregated errors as
 * an indented tree.
 *
 * Nothing is filtered: native, anonymous, `node:internal` and `eval` frames are
 * all kept, since the frame that explains a bug is often the one a
 * prettifier would have dropped. Frames that cannot be parsed are printed
 * verbatim rather than discarded.
 *
 * @param error - The error to render.
 * @param options - Styling and path options.
 * @returns The rendered error, without a trailing newline.
 */
export function formatError(error: Error, options: FormatErrorOptions): string {
	const seen = new Set<unknown>();
	return render(error, options, options.indent ?? "  ", 0, seen);
}

/** Renders one error in the chain, then recurses into its causes. */
function render(
	error: Error,
	options: FormatErrorOptions,
	indent: string,
	depth: number,
	seen: Set<unknown>,
): string {
	const { paint } = options;
	seen.add(error);

	const name = error.name || "Error";
	const lines: string[] = [
		error.message
			? `${paint("errorName", name)}: ${paint("errorMessage", error.message)}`
			: paint("errorName", name),
	];

	const extras = extraProperties(error);
	if (extras) lines.push(`${indent}${paint("stackNote", extras)}`);

	const frames = parseStack(error.stack ?? "", options.relativePaths ?? true);
	frames.forEach((frame, index) => {
		const last = index === frames.length - 1;
		lines.push(`${indent}${renderFrame(frame, last, paint)}`);
	});

	if (depth >= MAX_CAUSE_DEPTH) return lines.join("\n");

	const nested = `${indent}  `;

	for (const child of aggregated(error)) {
		if (seen.has(child)) continue;
		const body = render(child, options, nested, depth + 1, seen);
		lines.push(`${indent}${paint("causeLabel", "▼ aggregated")} ${body}`);
	}

	const cause = error.cause;
	if (cause !== undefined && !seen.has(cause)) {
		const body = isError(cause)
			? render(cause, options, nested, depth + 1, seen)
			: Bun.inspect(cause, { depth: 2, colors: false, compact: true });
		lines.push(`${indent}${paint("causeLabel", "▼ caused by")} ${body}`);
	}

	return lines.join("\n");
}

/** Renders a single frame as a branch of the tree. */
function renderFrame(
	frame: StackFrame,
	last: boolean,
	paint: FormatErrorOptions["paint"],
): string {
	const branch = paint("stackBranch", last ? "└─" : "├─");

	const label = frame.async
		? `${paint("stackNote", "async")} ${paint("stackFunction", frame.fn)}`
		: paint("stackFunction", frame.fn);

	const position =
		frame.line === null
			? paint("stackNote", frame.location)
			: `${paint("stackFile", frame.location)} ${paint("stackLocation", `(L${frame.line} C${frame.column})`)}`;

	return frame.fn ? `${branch} ${label} ${position}` : `${branch} ${position}`;
}

/**
 * Parses the frame lines of a stack trace.
 *
 * The header can span several lines when an error message contains newlines,
 * so parsing starts at the first line that looks like a frame rather than
 * assuming the header is exactly one line.
 */
function parseStack(stack: string, relativePaths: boolean): StackFrame[] {
	const lines = stack.split("\n");
	const start = lines.findIndex((line) => FRAME_LINE.test(line));
	if (start === -1) return [];

	return lines
		.slice(start)
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.map((line) => parseFrame(line, relativePaths));
}

/** Parses one `at ...` line into its parts. */
function parseFrame(raw: string, relativePaths: boolean): StackFrame {
	let rest = raw.replace(/^at\s+/, "");

	const async = rest.startsWith("async ");
	if (async) rest = rest.slice("async ".length);

	let fn = "";
	let location = rest;

	// `indexOf` rather than `lastIndexOf`, so that an eval frame such as
	// `eval (eval at fn (/a.ts:1:1), <anonymous>:1:1)` splits on its outer
	// parenthesis and keeps the inner one as part of the location.
	const open = rest.indexOf(" (");
	if (open !== -1 && rest.endsWith(")")) {
		fn = rest.slice(0, open);
		location = rest.slice(open + 2, -1);
	}

	const position = POSITION.exec(location);
	if (!position) {
		return {
			fn,
			location: normalisePath(location, relativePaths),
			line: null,
			column: null,
			async,
		};
	}

	return {
		fn,
		location: normalisePath(position[1] ?? "", relativePaths),
		line: Number(position[2]),
		column: Number(position[3]),
		async,
	};
}

/** Strips `file://` prefixes, unifies separators and shortens cwd paths. */
function normalisePath(path: string, relativePaths: boolean): string {
	// `file:///C:/a` is the Windows spelling of `C:/a`, so the slash in front
	// of a drive letter goes with the scheme; on POSIX it is part of the path.
	let result = path
		.replace(/^file:\/\//, "")
		.replace(/^\/([A-Za-z]:)/, "$1")
		.replaceAll("\\", "/");

	if (relativePaths) {
		const cwd = `${process.cwd().replaceAll("\\", "/").replace(/\/$/, "")}/`;
		if (result.startsWith(cwd)) result = result.slice(cwd.length);
	}

	return result;
}

/** Inspects the error's own enumerable properties, minus the rendered ones. */
function extraProperties(error: Error): string {
	const extras: Record<string, unknown> = {};
	let found = false;

	for (const [key, value] of Object.entries(error)) {
		if (RENDERED_KEYS.has(key)) continue;
		extras[key] = value;
		found = true;
	}

	if (!found) return "";

	return Bun.inspect(extras, { depth: 2, colors: false, compact: true });
}

/** The sub-errors of an `AggregateError`, or an empty array. */
function aggregated(error: Error): Error[] {
	const { errors } = error as { errors?: unknown };
	if (!Array.isArray(errors)) return [];
	return errors.filter(isError);
}

/** Whether a value is an `Error`, including ones from another realm. */
function isError(value: unknown): value is Error {
	return (
		value instanceof Error ||
		Object.prototype.toString.call(value) === "[object Error]"
	);
}
