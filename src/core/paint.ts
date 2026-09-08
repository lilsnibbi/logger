import type { LogLevel } from "../structures/Logger";

/** The sixteen colour names every ANSI terminal understands. */
export type LogColorName =
	| "black"
	| "red"
	| "green"
	| "yellow"
	| "blue"
	| "magenta"
	| "cyan"
	| "white"
	| "gray"
	| "brightBlack"
	| "brightRed"
	| "brightGreen"
	| "brightYellow"
	| "brightBlue"
	| "brightMagenta"
	| "brightCyan"
	| "brightWhite";

/**
 * A colour accepted by {@link LogStyle}.
 *
 * A {@link LogColorName} maps onto the terminal's own palette, so it follows
 * whatever theme the user has configured. Anything else is parsed by
 * `Bun.color` and emitted as a 24-bit truecolor escape — CSS colour names,
 * `#rgb`, `#rrggbb`, `rgb()`, `hsl()`, or an `[r, g, b]` tuple.
 */
export type LogColor =
	| LogColorName
	| (string & Record<never, never>)
	| readonly [number, number, number];

/** A terminal style: an optional colour pair plus any number of attributes. */
export interface LogStyle {
	/** Foreground colour. */
	color?: LogColor;
	/** Background colour. */
	background?: LogColor;
	/** Increased intensity (SGR 1). */
	bold?: boolean;
	/** Reduced intensity (SGR 2). */
	dim?: boolean;
	/** Italic (SGR 3) — not honoured by every terminal. */
	italic?: boolean;
	/** Underline (SGR 4). */
	underline?: boolean;
	/** Swap foreground and background (SGR 7). */
	inverse?: boolean;
	/** Strikethrough (SGR 9). */
	strikethrough?: boolean;
}

/**
 * Every individually styleable piece of logger output.
 *
 * The four level names style their own badge, so `ERROR` in a theme colours
 * the `ERROR` label rather than the whole line.
 */
export type LogToken =
	| LogLevel
	| "timestamp"
	| "name"
	| "separator"
	| "boxNote"
	| "message"
	| "divider"
	| "dividerText"
	| "errorName"
	| "errorMessage"
	| "causeLabel"
	| "stackBranch"
	| "stackFunction"
	| "stackFile"
	| "stackLocation"
	| "stackNote";

/** A complete set of styles, one per {@link LogToken}. */
export type LogTheme = Record<LogToken, LogStyle>;

/** The SGR reset sequence, closing every attribute at once. */
const RESET = "\x1b[0m";

/** Foreground SGR codes for the sixteen standard colour names. */
const NAMED_FOREGROUND: Readonly<Record<LogColorName, number>> = {
	black: 30,
	red: 31,
	green: 32,
	yellow: 33,
	blue: 34,
	magenta: 35,
	cyan: 36,
	white: 37,
	gray: 90,
	brightBlack: 90,
	brightRed: 91,
	brightGreen: 92,
	brightYellow: 93,
	brightBlue: 94,
	brightMagenta: 95,
	brightCyan: 96,
	brightWhite: 97,
};

/** SGR codes for the boolean attributes of a {@link LogStyle}. */
const ATTRIBUTES: ReadonlyArray<readonly [keyof LogStyle, number]> = [
	["bold", 1],
	["dim", 2],
	["italic", 3],
	["underline", 4],
	["inverse", 7],
	["strikethrough", 9],
];

/** Memoises resolved colour parameters, keyed by layer and input. */
const COLOR_CACHE = new Map<string, string>();

/**
 * Whether the current process should emit ANSI escapes.
 *
 * Follows the `NO_COLOR` and `FORCE_COLOR` conventions, treats `TERM=dumb` as
 * unsupported, and otherwise requires stdout to be a TTY. Recomputed on every
 * call rather than cached, so flipping an environment variable in a test takes
 * effect immediately.
 *
 * @returns `true` when colour output is appropriate.
 */
export function colorSupported(): boolean {
	const { NO_COLOR: noColor, FORCE_COLOR: forceColor, TERM: term } = Bun.env;
	if (noColor !== undefined && noColor !== "") return false;

	if (forceColor !== undefined && forceColor !== "") {
		return forceColor !== "0" && forceColor !== "false";
	}

	if (term === "dumb") return false;

	return Boolean(process.stdout?.isTTY);
}

/**
 * Removes every ANSI escape sequence from a string.
 *
 * @param text - The text to strip.
 * @returns The same text with all escapes removed.
 */
export function stripAnsi(text: string): string {
	return Bun.stripANSI(text);
}

/**
 * Wraps text in the escape sequences described by a style.
 *
 * Nested calls compose: an inner style resets when it closes, so the outer
 * style is reopened afterwards to keep the remaining text styled.
 *
 * @param text - The text to style.
 * @param style - The style to apply. `undefined` and empty styles are no-ops.
 * @param enabled - Set to `false` to return `text` untouched.
 * @returns The styled text, or `text` when nothing needed to be applied.
 */
export function paint(
	text: string,
	style: LogStyle | undefined,
	enabled = true,
): string {
	if (!enabled || !style || text === "") return text;

	const attributes: number[] = [];
	for (const [key, code] of ATTRIBUTES) if (style[key]) attributes.push(code);

	const parameters = [
		attributes.join(";"),
		resolveColor(style.color, false),
		resolveColor(style.background, true),
	]
		.filter(Boolean)
		.join(";");

	if (parameters === "") return text;

	const open = `\x1b[${parameters}m`;
	const body = text.includes(RESET)
		? text.replaceAll(RESET, RESET + open)
		: text;

	return `${open}${body}${RESET}`;
}

/**
 * Resolves a colour into the SGR parameters that select it.
 *
 * Named colours become palette entries, so they follow the terminal's own
 * theme. Everything else is handed to `Bun.color`, which understands hex,
 * `rgb()`, `hsl()`, CSS colour names and `[r, g, b]` tuples, and is emitted as
 * 24-bit truecolor.
 *
 * @param color - The colour to resolve.
 * @param background - Whether to target the background instead of the text.
 * @returns The SGR parameters, or `""` when the colour is absent or unparseable.
 */
function resolveColor(
	color: LogColor | undefined,
	background: boolean,
): string {
	if (color === undefined) return "";

	const input = typeof color === "string" ? color : color.join(",");
	const key = `${background ? "bg" : "fg"}:${input}`;

	const cached = COLOR_CACHE.get(key);
	if (cached !== undefined) return cached;

	const resolved = computeColor(color, background);
	COLOR_CACHE.set(key, resolved);
	return resolved;
}

/** Uncached half of {@link resolveColor}. */
function computeColor(color: LogColor, background: boolean): string {
	if (typeof color === "string" && Object.hasOwn(NAMED_FOREGROUND, color)) {
		const code = NAMED_FOREGROUND[color as LogColorName];
		return String(background ? code + 10 : code);
	}

	const rgb = Bun.color(
		typeof color === "string" ? color : [...color],
		"[rgb]",
	);
	if (!rgb) return "";

	return `${background ? 48 : 38};2;${rgb[0]};${rgb[1]};${rgb[2]}`;
}
