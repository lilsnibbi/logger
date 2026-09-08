import { truncate } from "../core/truncate";
import { formatError } from "../core/formatError";
import { inlineErrors } from "../core/inlineErrors";
import { LogFile } from "./LogFile";
import { colorSupported, paint, stripAnsi } from "../core/paint";
import type { LogStyle, LogTheme, LogToken } from "../core/paint";
import type { LogFileOptions } from "./LogFile";

/** Severity levels emitted by `Logger`, ordered from least to most severe. */
export type LogLevel = "DEBUG" | "NOTIF" | "ALERT" | "ERROR";

/**
 * How the level is drawn at the head of a line.
 *
 * `"badge"` fills the level name with its colour, so it reads as a solid
 * block. `"bar"` replaces the block with a thin coloured bar and a glyph, for
 * output that looks more like a task list than a log. `"box"` spends three
 * lines per record instead of one, framing the message under a rule that
 * carries the timestamp, the level and the logger's name.
 */
export type LogLayout = "badge" | "bar" | "box";

/** Whether a formatted line is bound for the console or a log file. */
export type LogDestination = "console" | "file";

/** A single logged event, before any formatting has happened. */
export interface LogRecord {
	/** The severity the event was logged at. */
	level: LogLevel;
	/** The name of the logger, or child logger, that produced it. */
	name: string;
	/** When the event was logged. */
	date: Date;
	/** The value passed to the logging method, untouched. */
	value: unknown;
}

/**
 * A {@link LogRecord} plus everything needed to render it for one destination.
 *
 * Passed to the {@link LoggerOptions.serialize} and
 * {@link LoggerOptions.format} hooks so custom output can reuse the active
 * theme instead of hard-coding escape codes.
 */
export interface LogContext extends LogRecord {
	/** Where the line being built is going. */
	destination: LogDestination;
	/** Whether colour is enabled for this destination. */
	colors: boolean;
	/** Styles text with a theme token, honouring {@link LogContext.colors}. */
	paint: (token: LogToken, text: string) => string;
	/** Styles text with an ad-hoc style, honouring {@link LogContext.colors}. */
	style: (text: string, style: LogStyle) => string;
}

/** The rendered pieces of a log line, before they are joined together. */
export interface LogParts {
	/**
	 * `Day HH:mm:ss.SSS`, or `HH:mm:ss` under the `"box"` layout, whose lighter
	 * frame reads better without the weekday and milliseconds. `""` when
	 * timestamps are disabled. Unstyled, and without the surrounding brackets.
	 */
	timestamp: string;
	/** The logger's name. Unstyled. */
	name: string;
	/** The level the record was logged at. */
	level: LogLevel;
	/** The serialised message, including a rendered stack for errors. */
	message: string;
}

/**
 * Text pinned to one corner of the `"box"` layout's frame.
 *
 * A fixed string is the same on every record; a function is called with the
 * record being drawn, so a corner can carry something that changes per line —
 * a request id, a route, whoever is signed in. Returning `undefined` leaves
 * the corner empty.
 */
export type LogBoxSlot = string | ((record: LogRecord) => string | undefined);

/**
 * Options for the `"box"` layout, passed as {@link LoggerOptions.box}.
 *
 * The corners are text the frame carries rather than content of their own: each
 * is truncated to the columns its rule can spare, so the box always closes in
 * the column it says it will.
 */
export interface LogBoxOptions {
	/**
	 * Total character width of the rules. Defaults to the terminal width, or
	 * `80` where that is unknown — a redirected stream, or a line bound for a
	 * log file. Never drawn narrower than 32.
	 */
	width?: number;
	/**
	 * Text ending the header rule. Defaults to the logger's name; pass `""` to
	 * leave the header bare.
	 */
	topRight?: LogBoxSlot;
	/** Text opening the footer rule. Empty by default. */
	bottomLeft?: LogBoxSlot;
	/** Text ending the footer rule. Empty by default. */
	bottomRight?: LogBoxSlot;
	/**
	 * Open each box with a blank line on the console, so consecutive records
	 * are separated by one. Defaults to `true`. Log files are never padded.
	 */
	spacing?: boolean;
}

/** Options accepted by the `Logger` constructor. */
export interface LoggerOptions {
	/** Label printed between the timestamp and the level, e.g. the service name. */
	name: string;
	/**
	 * Minimum level to emit; anything below it is dropped. Ordered
	 * `DEBUG` < `NOTIF` < `ALERT` < `ERROR`. Defaults to `"DEBUG"`.
	 */
	level?: LogLevel;
	/** Locale used to render timestamps. Defaults to `"en-US"`. */
	timeformat?: Intl.LocalesArgument;
	/** Whether to prefix each line with a timestamp. Defaults to `true`. */
	includeTimestamps?: boolean;
	/** Total character width of `Logger.divider` output. Defaults to `50`. */
	dividerWidth?: number;
	/**
	 * How the level marker at the head of each line is drawn — a filled badge
	 * or a coloured bar and glyph. Defaults to `"badge"`.
	 */
	layout?: LogLayout;
	/**
	 * Glyphs the `"bar"` layout draws beside the bar, merged over the defaults
	 * (`•`, `✓`, `⚑`, `×`). Ignored by the other layouts.
	 */
	symbols?: Partial<Record<LogLevel, string>>;
	/** Sizes the `"box"` layout and fills in its corners. */
	box?: LogBoxOptions;
	/**
	 * Colour output. `"auto"` honours `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb`
	 * and whether stdout is a TTY. Defaults to `"auto"`.
	 */
	colors?: boolean | "auto";
	/**
	 * Style overrides merged over the default theme, one entry per
	 * {@link LogToken}. An entry replaces the default outright rather than
	 * merging into it, so `{ ERROR: { color: "#ff0055" } }` drops the default
	 * bold.
	 */
	theme?: Partial<LogTheme>;
	/** Drop every record without formatting it. Defaults to `false`. */
	silent?: boolean;
	/**
	 * Assigned to `Error.stackTraceLimit` when set. This is a global V8
	 * setting; `Number.POSITIVE_INFINITY` captures complete stacks at the cost
	 * of some overhead on every thrown error.
	 */
	stackTraceLimit?: number;
	/** `depth` passed to `util.inspect`. Defaults to `null` (unlimited). */
	inspectDepth?: number | null;
	/**
	 * Rewrite absolute stack paths that sit inside `process.cwd()` as relative
	 * ones. Defaults to `true`.
	 */
	relativePaths?: boolean;
	/** Write output to disk in addition to the console. */
	file?: LogFileOptions;
	/**
	 * Turns a logged value into text. Return `undefined` to fall back to the
	 * built-in handling: errors get a rendered stack, objects get
	 * `util.inspect`, everything else is stringified.
	 */
	serialize?: (value: unknown, context: LogContext) => string | undefined;
	/**
	 * Assembles a whole line from its pieces, replacing the default
	 * `[timestamp] | name | LEVEL | message` layout.
	 */
	format?: (parts: LogParts, context: LogContext) => string;
	/** Return `false` to drop a record before it is formatted. */
	filter?: (record: LogRecord) => boolean;
	/**
	 * Called for every emitted record with the plain, colour-free line. Use it
	 * to forward logs to a service without reimplementing the formatting.
	 */
	transport?: (line: string, record: LogRecord) => void;
}

/**
 * Configuration a single logging call may override.
 *
 * Every method that emits a record — `log`, the four level shorthands,
 * `divider` and `timeEnd` — takes this in place of the `raw` flag, so a line
 * can carry settings of its own without a second `Logger`:
 *
 * ```ts
 * logger.notif("cache miss", {
 *   box: { topRight: "GET /users/42", bottomRight: "312ms" },
 * });
 * ```
 *
 * Overrides are resolved for that call alone and thrown away, so nothing
 * shared is mutated and two concurrent requests cannot overwrite each other's
 * corners. `theme`, `symbols` and `box` merge into the logger's own; every
 * other field replaces it outright.
 *
 * {@link LoggerOptions.file} and {@link LoggerOptions.stackTraceLimit} are the
 * two settings that cannot be overridden: one owns a file descriptor for the
 * life of the logger, the other is a process-wide V8 setting read when an
 * error is thrown rather than when it is logged.
 */
export interface LogCallOptions
	extends Partial<Omit<LoggerOptions, "file" | "stackTraceLimit">> {
	/**
	 * Return the formatted string instead of emitting it. Nothing is written
	 * to the console or the log file, and `transport` is not called.
	 */
	raw?: boolean;
}

/** Relative severity of each level, used to decide what gets dropped. */
export const LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
	DEBUG: 0,
	NOTIF: 1,
	ALERT: 2,
	ERROR: 3,
};

/**
 * The styles applied when no `theme` is given.
 *
 * The four level entries style the level badge, so their `background` is what
 * fills it and their `color` is chosen to stay legible against it. The
 * `"bar"` layout has no block to fill, so it draws that background colour as
 * the bar and glyph instead.
 *
 * Spread an entry to build a variation on the defaults rather than a whole new
 * palette: `theme: { ERROR: { ...DEFAULT_THEME.ERROR, background: "#400" } }`.
 */
export const DEFAULT_THEME: Readonly<LogTheme> = {
	DEBUG: { background: "magenta", color: "white", bold: true },
	NOTIF: { background: "blue", color: "white", bold: true },
	ALERT: { background: "yellow", color: "black", bold: true },
	ERROR: { background: "red", color: "white", bold: true },
	timestamp: { color: "gray" },
	name: {},
	separator: { dim: true },
	boxNote: { dim: true },
	message: {},
	divider: { dim: true },
	dividerText: { bold: true },
	errorName: { color: "red", bold: true },
	errorMessage: {},
	causeLabel: { color: "yellow" },
	stackBranch: { dim: true },
	stackFunction: {},
	stackFile: { dim: true },
	stackLocation: { bold: true },
	stackNote: { dim: true, italic: true },
};

/**
 * Standard stream each level is written to.
 *
 * Matches where `console` would have put them — `log` and `debug` on stdout,
 * `warn` and `error` on stderr — so redirecting one stream still separates
 * routine output from problems.
 */
const LEVEL_STREAMS: Readonly<Record<LogLevel, "stdout" | "stderr">> = {
	DEBUG: "stdout",
	NOTIF: "stdout",
	ALERT: "stderr",
	ERROR: "stderr",
};

/**
 * The glyph each level is given by the `"bar"` layout.
 *
 * Spread it to change one glyph without restating the rest:
 * `symbols: { ...DEFAULT_SYMBOLS, NOTIF: "→" }`.
 */
export const DEFAULT_SYMBOLS: Readonly<Record<LogLevel, string>> = {
	DEBUG: "•",
	NOTIF: "✓",
	ALERT: "⚑",
	ERROR: "×",
};

/** Width the level name is padded to inside the badge, so columns line up. */
const LEVEL_WIDTH = 5;

/** The bar the `"bar"` layout draws in place of a badge. */
const BAR = "▌";

/** Drawn between the logger's name and the message. */
const SEPARATOR = "›";

/** Width the `"box"` layout falls back to when the terminal has no columns. */
const FALLBACK_WIDTH = 80;

/**
 * Narrowest box worth drawing, whatever the terminal reports.
 *
 * A timestamp and a level already account for 26 columns, so anything much
 * below this leaves no rule to draw and the header would outgrow the frame.
 */
const MINIMUM_WIDTH = 32;

/** The pieces of the frame the `"box"` layout draws. */
const BOX = {
	edge: "│",
	topLeft: "┌",
	topRight: "┐",
	bottomLeft: "└",
	bottomRight: "┘",
} as const;

/**
 * Every setting resolved to a concrete value.
 *
 * A logger holds one of these for its own configuration and builds a second
 * for any call that overrides something, so the rendering path never has to
 * ask whether a value came from the call, the logger or a default.
 */
interface LogConfig {
	name: string;
	level: LogLevel;
	silent: boolean;
	timeformat: Intl.LocalesArgument;
	includeTimestamps: boolean;
	dividerWidth: number;
	layout: NonNullable<LoggerOptions["layout"]>;
	symbols: Readonly<Record<LogLevel, string>>;
	box: NonNullable<LoggerOptions["box"]>;
	colors: NonNullable<LoggerOptions["colors"]>;
	theme: LogTheme;
	inspectDepth: number | null;
	relativePaths: boolean;
	serialize: LoggerOptions["serialize"];
	format: LoggerOptions["format"];
	filter: LoggerOptions["filter"];
	transport: LoggerOptions["transport"];
	formatter: Intl.DateTimeFormat;
}

/**
 * Timestamp formatters, keyed by locale and by whether the box layout asked.
 *
 * A per-call override can name a different locale or layout, and building an
 * `Intl.DateTimeFormat` is expensive enough that doing it once per record
 * would show. There are only ever as many entries as there are locales in use.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Returns the timestamp formatter for a locale, building it on first use.
 *
 * The box wears its timestamp on the header rule, where a weekday and
 * milliseconds crowd out the message; every other layout keeps them.
 *
 * @param locale - The locale to format in.
 * @param box - Whether the caller is the `"box"` layout.
 * @returns A shared, cached formatter.
 */
function formatterFor(
	locale: Intl.LocalesArgument,
	box: boolean,
): Intl.DateTimeFormat {
	const key = `${box} ${String(locale)}`;
	const cached = formatters.get(key);
	if (cached) return cached;

	const built = new Intl.DateTimeFormat(locale, {
		...(box ? {} : { weekday: "short" }),
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});

	formatters.set(key, built);
	return built;
}

/**
 * Fills every option in with its default.
 *
 * @param options - The options a logger was constructed with.
 * @returns That logger's own configuration.
 */
function build(options: LoggerOptions): LogConfig {
	const layout = options.layout ?? "badge";
	const timeformat = options.timeformat ?? "en-US";

	return {
		name: options.name,
		level: options.level ?? "DEBUG",
		silent: options.silent ?? false,
		timeformat,
		includeTimestamps: options.includeTimestamps ?? true,
		dividerWidth: options.dividerWidth ?? 50,
		layout,
		symbols: { ...DEFAULT_SYMBOLS, ...options.symbols },
		box: options.box ?? {},
		colors: options.colors ?? "auto",
		theme: { ...DEFAULT_THEME, ...options.theme },
		inspectDepth: options.inspectDepth ?? null,
		relativePaths: options.relativePaths ?? true,
		serialize: options.serialize,
		format: options.format,
		filter: options.filter,
		transport: options.transport,
		formatter: formatterFor(timeformat, layout === "box"),
	};
}

/**
 * Layers one call's overrides over a logger's configuration.
 *
 * `theme`, `symbols` and `box` are merged, so overriding a single box corner
 * or a single token leaves the rest of that bag alone; everything else
 * replaces its counterpart. The result is never stored on the logger, so an
 * override cannot leak into the next record.
 *
 * @param base - The logger's own configuration.
 * @param options - What this call wants changed.
 * @returns The configuration to render one record with.
 */
function overlay(base: LogConfig, options: LogCallOptions): LogConfig {
	const layout = options.layout ?? base.layout;
	const timeformat = options.timeformat ?? base.timeformat;

	return {
		name: options.name ?? base.name,
		level: options.level ?? base.level,
		silent: options.silent ?? base.silent,
		timeformat,
		includeTimestamps: options.includeTimestamps ?? base.includeTimestamps,
		dividerWidth: options.dividerWidth ?? base.dividerWidth,
		layout,
		symbols: options.symbols
			? { ...base.symbols, ...options.symbols }
			: base.symbols,
		box: options.box ? { ...base.box, ...options.box } : base.box,
		colors: options.colors ?? base.colors,
		theme: options.theme ? { ...base.theme, ...options.theme } : base.theme,
		inspectDepth:
			options.inspectDepth === undefined
				? base.inspectDepth
				: options.inspectDepth,
		relativePaths: options.relativePaths ?? base.relativePaths,
		serialize: options.serialize ?? base.serialize,
		format: options.format ?? base.format,
		filter: options.filter ?? base.filter,
		transport: options.transport ?? base.transport,
		formatter:
			timeformat === base.timeformat && layout === base.layout
				? base.formatter
				: formatterFor(timeformat, layout === "box"),
	};
}

/** Whether colour should be emitted to the console under a configuration. */
function useColors(config: LogConfig): boolean {
	return config.colors === "auto" ? colorSupported() : config.colors;
}

/** Renders a moment as `Day HH:mm:ss.SSS`, or `HH:mm:ss` for the box. */
function timestamp(date: Date, config: LogConfig): string {
	if (config.layout === "box") return config.formatter.format(date);

	const ms = date.getMilliseconds().toString().padStart(3, "0");
	return `${config.formatter.format(date)}.${ms}`;
}

/**
 * Opens a record with the blank line the `"box"` layout is spaced by.
 *
 * One blank line per box, drawn above it, is what separates two boxes —
 * padding both sides would leave a two-line gap between consecutive records.
 * Console only: a log file is read with a pager or a grep, where the padding
 * is noise rather than air.
 */
function spaced(line: string, config: LogConfig): string {
	return config.layout === "box" && config.box.spacing !== false
		? `\n${line}`
		: line;
}

/**
 * Turns a badge style into the equivalent foreground-only one.
 *
 * The level tokens are written for the badge, where the colour lives in the
 * background. The `"bar"` layout draws that same colour as text, so the
 * background is promoted to the foreground and the badge's own foreground —
 * picked for contrast against it, not to be read on its own — is dropped.
 *
 * @param style - The level's badge style.
 * @returns A style that paints text in the badge's colour.
 */
function accent(style: LogStyle): LogStyle {
	const { color, background, ...attributes } = style;
	return { ...attributes, color: background ?? color };
}

/**
 * Structured console logger with timestamped, colour-coded output.
 *
 * A line leads with its timestamp and a level marker: a filled badge by
 * default, or a coloured bar and glyph with `layout: "bar"`.
 *
 * ```text
 * [Tue 19:38:23.644]  NOTIF  api › listening on :3000
 * [Tue 19:38:23.644] ▌ ✓ api › listening on :3000
 * ```
 *
 * `layout: "box"` frames the message instead, which keeps a multi-line value
 * — a rendered stack, an inspected object — visibly part of one record:
 *
 * ```text
 * [Tue 19:38:23.644] NOTIF ───────────────────────────────── api ┐
 * │
 * │  listening on :3000
 * │
 * └───────────────────────────────────────────────────────────────┘
 * ```
 *
 *
 * Colours are emitted directly as ANSI escapes — there is no dependency on a
 * styling library. Every part of a line is themeable by token, the layout and
 * the rendering of individual values can be replaced with hooks, and output
 * can be mirrored to a rotating log file.
 *
 * Every emitting method takes a trailing {@link LogCallOptions} bag that
 * overrides the configuration for that one record — the corners of a box, the
 * layout, the theme, the name — so per-request detail costs a second argument
 * rather than a logger per request. Passing `true` in its place, or
 * `raw: true` inside it, returns the formatted string instead of printing it,
 * writing nothing to the file and calling no `transport`.
 *
 * @example
 * ```ts
 * const logger = new Logger({
 *   name: "api",
 *   level: "NOTIF",
 *   theme: { NOTIF: { color: "#7aa2f7" } },
 *   file: { directory: "logs", filename: "api", maxFiles: 7 },
 * });
 *
 * logger.notif("listening on :3000");
 * logger.error(new Error("query timed out"));
 *
 * logger.notif("cache miss", {
 *   box: { topRight: "GET /users/42", bottomRight: "312ms" },
 * });
 *
 * const line = logger.alert("disk almost full", true); // returned, not printed
 * ```
 */
export class Logger {
	private readonly options: LoggerOptions;
	private readonly timers = new Map<string, number>();

	private config: LogConfig;
	private file: LogFile | undefined;
	private ownsFile: boolean;

	constructor(options: LoggerOptions) {
		this.options = options;
		this.config = build(options);
		this.file = options.file ? new LogFile(options.file) : undefined;
		this.ownsFile = this.file !== undefined;

		if (options.stackTraceLimit !== undefined) {
			Error.stackTraceLimit = options.stackTraceLimit;
		}
	}

	/** Label printed between the timestamp and the level. */
	public get name(): string {
		return this.config.name;
	}

	public set name(name: string) {
		this.config.name = name;
	}

	/** Minimum level currently emitted. */
	public get level(): LogLevel {
		return this.config.level;
	}

	public set level(level: LogLevel) {
		this.config.level = level;
	}

	/** Whether every record is being dropped. */
	public get silent(): boolean {
		return this.config.silent;
	}

	public set silent(silent: boolean) {
		this.config.silent = silent;
	}

	/** Path of the log file currently being written to, if there is one. */
	public get filePath(): string | undefined {
		return this.file?.path;
	}

	/**
	 * Whether the log file still accepts writes, or `undefined` without a file.
	 *
	 * Turns `false` once the filesystem has refused to open the destination —
	 * a read-only directory, a path the process has no rights to. File output
	 * stops there; the console is unaffected.
	 */
	public get fileWritable(): boolean | undefined {
		return this.file?.writable;
	}

	/**
	 * Sets the minimum level to emit.
	 * @param level - The new minimum level.
	 * @returns This logger, for chaining.
	 */
	public setLevel(level: LogLevel): this {
		this.config.level = level;
		return this;
	}

	/**
	 * Merges style overrides into the active theme.
	 * @param theme - Styles to apply, one entry per token. Each entry replaces
	 * the current style for that token outright.
	 * @returns This logger, for chaining.
	 */
	public setTheme(theme: Partial<LogTheme>): this {
		this.config.theme = { ...this.config.theme, ...theme };
		return this;
	}

	/**
	 * Creates a logger with a different name but the same configuration.
	 *
	 * The child shares its parent's log file rather than opening a second
	 * handle on it, so a whole tree of loggers writes to one file. Closing a
	 * child leaves that shared file open.
	 *
	 * @param name - The child's name.
	 * @param overrides - Options to change for the child. Passing `file` opens
	 * a separate file instead of sharing the parent's.
	 * @returns The new logger.
	 */
	public child(
		name: string,
		overrides: Partial<Omit<LoggerOptions, "name">> = {},
	): Logger {
		const child = new Logger({
			...this.options,
			...this.config,
			...overrides,
			name,
			file: overrides.file,
		});

		if (!overrides.file) {
			child.file = this.file;
			child.ownsFile = false;
		}

		return child;
	}

	/**
	 * Logs a message at an explicit level.
	 * @param level - The severity to log at.
	 * @param message - The value to log. An `Error` is rendered with its full
	 * stack and `cause` chain.
	 * @param options - Configuration for this record alone, or `true` as a
	 * shorthand for `{ raw: true }`.
	 * @returns The formatted string when `raw` is set, or `undefined` if the
	 * message was dropped by the level in force.
	 */
	public log(
		level: LogLevel,
		message: unknown,
		options: true | (LogCallOptions & { raw: true }),
	): string | undefined;
	public log(
		level: LogLevel,
		message: unknown,
		options?: false | (LogCallOptions & { raw?: false }),
	): void;
	public log(
		level: LogLevel,
		message: unknown,
		options?: boolean | LogCallOptions,
	): string | undefined;
	public log(
		level: LogLevel,
		message: unknown,
		options?: boolean | LogCallOptions,
	): string | undefined {
		const config =
			typeof options === "object" ? overlay(this.config, options) : this.config;
		const raw =
			typeof options === "boolean" ? options : (options?.raw ?? false);

		if (config.silent) return;

		const priority = LEVEL_PRIORITY[level];
		const toConsole = priority >= LEVEL_PRIORITY[config.level];
		const fileLevel = this.file?.level ?? config.level;
		const toFile =
			this.file !== undefined && priority >= LEVEL_PRIORITY[fileLevel];

		if (!toConsole && !toFile) return;

		const record: LogRecord = {
			level,
			name: config.name,
			date: new Date(),
			value: message,
		};

		if (config.filter && !config.filter(record)) return;

		if (raw) {
			return toConsole
				? this.render(record, "console", useColors(config), config)
				: undefined;
		}

		let line: string | undefined;

		if (toConsole) {
			const colors = useColors(config);
			line = this.render(record, "console", colors, config);
			process[LEVEL_STREAMS[level]].write(`${spaced(line, config)}\n`);
		}

		if (toFile && this.file) {
			this.file.write(
				this.file.json
					? this.renderJson(record, config)
					: this.render(record, "file", this.file.colors, config),
			);
		}

		if (config.transport) {
			config.transport(
				stripAnsi(line ?? this.render(record, "console", false, config)),
				record,
			);
		}
	}

	/**
	 * Logs at `DEBUG` — verbose tracing, usually filtered out in production.
	 * @param message - The value to log.
	 * @param options - Configuration for this record alone, or `true` as a
	 * shorthand for `{ raw: true }`.
	 * @returns The formatted string when `raw` is set, or `undefined` if the
	 * message was dropped by the level in force.
	 */
	public debug(
		message: unknown,
		options: true | (LogCallOptions & { raw: true }),
	): string | undefined;
	public debug(
		message: unknown,
		options?: false | (LogCallOptions & { raw?: false }),
	): void;
	public debug(
		message: unknown,
		options?: boolean | LogCallOptions,
	): string | undefined;
	public debug(
		message: unknown,
		options?: boolean | LogCallOptions,
	): string | undefined {
		return this.log("DEBUG", message, options);
	}

	/**
	 * Logs at `NOTIF` — ordinary informational output.
	 * @param message - The value to log.
	 * @param options - Configuration for this record alone, or `true` as a
	 * shorthand for `{ raw: true }`.
	 * @returns The formatted string when `raw` is set, or `undefined` if the
	 * message was dropped by the level in force.
	 */
	public notif(
		message: unknown,
		options: true | (LogCallOptions & { raw: true }),
	): string | undefined;
	public notif(
		message: unknown,
		options?: false | (LogCallOptions & { raw?: false }),
	): void;
	public notif(
		message: unknown,
		options?: boolean | LogCallOptions,
	): string | undefined;
	public notif(
		message: unknown,
		options?: boolean | LogCallOptions,
	): string | undefined {
		return this.log("NOTIF", message, options);
	}

	/**
	 * Logs at `ALERT` — something unexpected that is not yet a failure.
	 * @param message - The value to log.
	 * @param options - Configuration for this record alone, or `true` as a
	 * shorthand for `{ raw: true }`.
	 * @returns The formatted string when `raw` is set, or `undefined` if the
	 * message was dropped by the level in force.
	 */
	public alert(
		message: unknown,
		options: true | (LogCallOptions & { raw: true }),
	): string | undefined;
	public alert(
		message: unknown,
		options?: false | (LogCallOptions & { raw?: false }),
	): void;
	public alert(
		message: unknown,
		options?: boolean | LogCallOptions,
	): string | undefined;
	public alert(
		message: unknown,
		options?: boolean | LogCallOptions,
	): string | undefined {
		return this.log("ALERT", message, options);
	}

	/**
	 * Logs at `ERROR` — a failure. An `Error` is rendered with its full stack.
	 * @param message - The value to log.
	 * @param options - Configuration for this record alone, or `true` as a
	 * shorthand for `{ raw: true }`.
	 * @returns The formatted string when `raw` is set, or `undefined` if the
	 * message was dropped by the level in force.
	 */
	public error(
		message: unknown,
		options: true | (LogCallOptions & { raw: true }),
	): string | undefined;
	public error(
		message: unknown,
		options?: false | (LogCallOptions & { raw?: false }),
	): void;
	public error(
		message: unknown,
		options?: boolean | LogCallOptions,
	): string | undefined;
	public error(
		message: unknown,
		options?: boolean | LogCallOptions,
	): string | undefined {
		return this.log("ERROR", message, options);
	}

	/**
	 * Starts a named timer. Overwrites any timer already using the label.
	 * @param label - The name to measure against.
	 */
	public time(label: string): void {
		this.timers.set(label, performance.now());
	}

	/**
	 * Stops a named timer and logs how long it ran for.
	 * @param label - The name passed to {@link Logger.time}.
	 * @param level - The level to log at. Defaults to `"DEBUG"`.
	 * @param options - Configuration for the record it logs. `raw` is ignored;
	 * the elapsed time is the return value.
	 * @returns The elapsed milliseconds, or `undefined` if the label is unknown.
	 */
	public timeEnd(
		label: string,
		level: LogLevel = "DEBUG",
		options?: LogCallOptions,
	): number | undefined {
		const started = this.timers.get(label);
		if (started === undefined) return;

		this.timers.delete(label);
		const elapsed = performance.now() - started;
		this.log(level, `${label} took ${elapsed.toFixed(2)}ms`, {
			...options,
			raw: false,
		});

		return elapsed;
	}

	/**
	 * Prints a horizontal rule with the given text centred inside it.
	 * @param text - The text to centre. Surrounding whitespace is trimmed.
	 * @param options - Configuration for this rule alone. `dividerWidth`,
	 * `theme`, `colors` and `silent` are the ones it reads.
	 */
	public divider(text: string, options?: LogCallOptions): void {
		const config = options ? overlay(this.config, options) : this.config;
		if (config.silent) return;

		const trimmed = text.trim();
		const remaining = Math.max(0, config.dividerWidth - trimmed.length - 2);
		const left = "─".repeat(Math.ceil(remaining / 2));
		const right = "─".repeat(Math.floor(remaining / 2));

		const draw = (colors: boolean): string =>
			`${paint(left, config.theme.divider, colors)} ${paint(trimmed, config.theme.dividerText, colors)} ${paint(right, config.theme.divider, colors)}`;

		process.stdout.write(`\n${draw(useColors(config))}\n`);
		if (this.file && !this.file.json) this.file.write(draw(this.file.colors));
	}

	/**
	 * Waits for buffered file output to reach the operating system.
	 * @returns A promise that resolves once the buffer has drained.
	 */
	public flush(): Promise<void> {
		return this.file?.flush() ?? Promise.resolve();
	}

	/**
	 * Closes this logger's log file. A child sharing its parent's file leaves
	 * that file open.
	 * @returns A promise that resolves once the handle is closed.
	 */
	public close(): Promise<void> {
		if (!this.ownsFile) return Promise.resolve();
		return this.file?.close() ?? Promise.resolve();
	}

	/** Builds the full line for one destination. */
	private render(
		record: LogRecord,
		destination: LogDestination,
		colors: boolean,
		config: LogConfig,
	): string {
		const context = this.context(record, destination, colors, config);
		const parts: LogParts = {
			timestamp: config.includeTimestamps ? timestamp(record.date, config) : "",
			name: record.name,
			level: record.level,
			message: this.serialize(record.value, context, config),
		};

		if (config.format) return config.format(parts, context);
		if (config.layout === "box") {
			return this.box(parts, context, record, config);
		}

		const stamp = parts.timestamp
			? `${context.paint("timestamp", `[${parts.timestamp}]`)} `
			: "";
		const marker =
			config.layout === "bar"
				? context.style(
						`${BAR} ${config.symbols[parts.level]}`,
						accent(config.theme[parts.level]),
					)
				: context.paint(parts.level, ` ${parts.level.padEnd(LEVEL_WIDTH)} `);
		const name = parts.name
			? `${context.paint("name", parts.name)} ${context.paint("separator", SEPARATOR)} `
			: "";

		return `${stamp}${marker} ${name}${context.paint("message", parts.message)}`;
	}

	/**
	 * Frames a record, for the `"box"` layout.
	 *
	 * The timestamp and level sit on the header rule itself, the message runs
	 * down a left edge one line per line, and each rule can carry text in its
	 * corners — the logger's name on the header unless `box.topRight` says
	 * otherwise, and whatever `box.bottomLeft` and `box.bottomRight` resolve to
	 * on the footer.
	 *
	 * Rules are measured against the plain text rather than the painted one,
	 * since escapes take up no columns, and every corner is truncated to the
	 * columns its rule can spare, so the frame closes where it says it will
	 * however long that text is. The message is left alone and wraps as the
	 * terminal sees fit.
	 */
	private box(
		parts: LogParts,
		context: LogContext,
		record: LogRecord,
		config: LogConfig,
	): string {
		const width = Math.max(
			MINIMUM_WIDTH,
			config.box.width ?? process.stdout.columns ?? FALLBACK_WIDTH,
		);
		const stamp = parts.timestamp ? `${parts.timestamp} ` : "";

		// The corner glyphs, the space after each of them, and the space before
		// the header rule — the columns the header spends before any text.
		const fixed = stamp.length + parts.level.length + 4;

		const top = this.fit(
			config.box.topRight === undefined
				? parts.name
				: this.slot(config.box.topRight, record),
			width - fixed - 3,
		);
		const topText = top ? ` ${top} ` : "";

		const header = [
			context.paint("separator", `${BOX.topLeft} `),
			stamp ? `${context.paint("timestamp", stamp.trimEnd())} ` : "",
			context.style(parts.level, accent(config.theme[parts.level])),
			" ",
			context.paint(
				"separator",
				"─".repeat(Math.max(1, width - fixed - topText.length)),
			),
			context.paint("name", topText),
			context.paint("separator", BOX.topRight),
		].join("");

		const left = this.fit(this.slot(config.box.bottomLeft, record), width - 6);
		const right = this.fit(
			this.slot(config.box.bottomRight, record),
			width - 6 - (left ? left.length + 3 : 0),
		);
		const spare =
			width - 2 - (left ? left.length + 3 : 0) - (right ? right.length + 2 : 0);

		const footer = [
			context.paint("separator", left ? `${BOX.bottomLeft}─ ` : BOX.bottomLeft),
			left ? `${context.paint("boxNote", left)} ` : "",
			context.paint("separator", "─".repeat(Math.max(1, spare))),
			right ? ` ${context.paint("boxNote", right)} ` : "",
			context.paint("separator", BOX.bottomRight),
		].join("");

		const edge = context.paint("separator", BOX.edge);
		const body = parts.message
			.split("\n")
			.map((line) => `${edge} ${context.paint("message", line)}`)
			.join("\n");

		return [header, body, footer].join("\n");
	}

	/** Resolves one of the box's corners against the record being drawn. */
	private slot(slot: LogBoxSlot | undefined, record: LogRecord): string {
		if (slot === undefined) return "";
		return (typeof slot === "function" ? slot(record) : slot) ?? "";
	}

	/** Cuts a corner's text down to the columns its rule can spare. */
	private fit(text: string, room: number): string {
		return text ? truncate(text, Math.max(0, room)) : "";
	}

	/** Builds one JSON object per record, for machine-readable log files. */
	private renderJson(record: LogRecord, config: LogConfig): string {
		const context = this.context(record, "file", false, config);
		const { value } = record;

		return JSON.stringify({
			time: record.date.toISOString(),
			level: record.level,
			name: record.name,
			message: this.serialize(value, context, config),
			...(value instanceof Error
				? {
						error: {
							name: value.name,
							message: value.message,
							stack: value.stack,
						},
					}
				: {}),
		});
	}

	/** Bundles a record with the theme helpers the hooks are given. */
	private context(
		record: LogRecord,
		destination: LogDestination,
		colors: boolean,
		config: LogConfig,
	): LogContext {
		return {
			...record,
			destination,
			colors,
			paint: (token, text) => paint(text, config.theme[token], colors),
			style: (text, style) => paint(text, style, colors),
		};
	}

	/** Turns a logged value into text, deferring to the `serialize` hook first. */
	private serialize(
		value: unknown,
		context: LogContext,
		config: LogConfig,
	): string {
		if (config.serialize) {
			const custom = config.serialize(value, context);
			if (custom !== undefined) return custom;
		}

		if (value instanceof Error) {
			return formatError(value, {
				paint: context.paint,
				relativePaths: config.relativePaths,
			});
		}

		if (typeof value === "string") return value;

		return Bun.inspect(inlineErrors(value), {
			colors: context.colors,
			depth: config.inspectDepth ?? Number.POSITIVE_INFINITY,
			compact: false,
		});
	}
}
