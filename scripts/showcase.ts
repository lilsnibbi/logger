/**
 * Walks through every output style and feature of the logger.
 *
 *   bun run scripts/showcase.ts
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_THEME, Logger, colorSupported, paint } from "../src/index.ts";

const colors = colorSupported();
const dim = (text: string) => paint(text, { dim: true }, colors);
const head = (text: string) =>
	paint(text, { bold: true, underline: true }, colors);
const section = (title: string, note: string) =>
	process.stdout.write(`\n${head(title)}  ${dim(note)}\n\n`);

const log = new Logger({ name: "app" });

section("Levels", "badge layout, the default");
log.debug("verbose tracing");
log.notif("ordinary output");
log.alert("unexpected, not yet a failure");
log.error("a failure");

section("Bar layout", "a coloured bar and a glyph; symbols are overridable");
const bar = new Logger({ name: "app", layout: "bar" });
bar.debug("verbose tracing");
bar.notif("listening on :3000");
bar.alert("disk almost full");
bar.error("query timed out", { symbols: { ERROR: "!" } });

section("Box layout", "a frame per record; corners are text or functions");
const box = new Logger({
	name: "api",
	layout: "box",
	box: { width: 60, bottomRight: (record) => record.date.toISOString() },
});
box.notif("a single line inside a frame");
box.alert("a multi-line message\nstays inside one record", {
	box: { topRight: "worker 2", bottomLeft: "req 7f3a" },
});
box.error(new Error("stacks stay inside too"), { box: { spacing: false } });

section("Values", "anything but a string or an Error is inspected");
log.notif(42);
log.notif(null);
log.notif(new Date(0));
log.notif(() => "fn");
log.notif("multi-line\nstrings pass through");
log.notif({ id: 42, tags: ["admin", "ops"], nested: { active: true } });
log.notif(new Map([["users", 3]]));
log.notif(new Set(["read", "write"]));
class Session {
	public id = "s_9f2";
}
log.notif(new Session());
log.notif({ a: { b: { c: {} } } }, { inspectDepth: 1 });
log.alert({ job: "sync", failed: new Error("nested errors print inline") });

section("Errors", "stack tree, extra properties, cause chain, aggregates");
log.error(
	Object.assign(new Error("request failed", { cause: new Error("timeout") }), {
		status: 503,
	}),
);
log.error(new AggregateError([new Error("shard 1")], "1 of 3 shards failed"));

section("Extras", "divider, timers, child loggers");
log.divider("section");
log.time("load");
log.timeEnd("load", "NOTIF");
log.child("db").notif("child shares config, different name");

section("Filtering", "level, filter hook, silent");
const quiet = new Logger({ name: "app", level: "ALERT" });
quiet.notif("dropped by level");
quiet.alert("kept");
const filtered = new Logger({
	name: "app",
	filter: (record) => !String(record.value).includes("secret"),
});
filtered.notif("secret token dropped by filter");
filtered.notif("kept");
new Logger({ name: "app", silent: true }).error("silent drops everything");

section("Per-call overrides", "any option for one record, incl. timestamps");
log.notif("renamed", { name: "worker" });
log.notif("no timestamp", { includeTimestamps: false });
log.notif("de-DE locale", { timeformat: "de-DE" });
log.notif("colours off", { colors: false });
log.notif("returned, not printed", true);

section("Theme", "named, hex, rgb tuple, CSS and hsl colours per token");
const themed = new Logger({
	name: "app",
	theme: {
		DEBUG: { background: "#5a4fcf", color: "white", bold: true },
		NOTIF: { background: [64, 160, 43], color: "black", bold: true },
		ALERT: { ...DEFAULT_THEME.ALERT, background: "orange" },
		ERROR: { background: "hsl(340 80% 45%)", color: "white", bold: true },
		timestamp: { color: "cyan", dim: true },
		name: { color: "brightMagenta", italic: true },
	},
});
themed.debug("themed");
themed.notif("themed");
themed.alert("themed", { layout: "bar" });
themed.error("themed", { layout: "bar" });
themed.setTheme({ errorName: { color: "brightRed", underline: true } });
themed.error(new Error("setTheme restyles stack tokens"));
log.notif("bold italic underline strikethrough", {
	theme: {
		message: { bold: true, italic: true, underline: true, strikethrough: true },
	},
});

section("Hooks", "serialize, format, transport");
new Logger({
	name: "app",
	serialize: (value, ctx) =>
		value instanceof Date
			? ctx.style("custom date", { color: "cyan" })
			: undefined,
}).notif(new Date(0));
new Logger({
	name: "app",
	format: (parts, ctx) =>
		`${ctx.paint(parts.level, parts.level.toLowerCase())} ${parts.message}`,
}).notif("whole line rebuilt");
new Logger({
	name: "app",
	transport: (line) =>
		process.stdout.write(`transport got ${JSON.stringify(line)}\n`),
}).notif("forwarded");

section("Files", "text and JSON files, size rotation; console quiet here");
const dir = mkdtempSync(join(tmpdir(), "logger-showcase-"));
const filed = new Logger({
	name: "app",
	level: "ERROR",
	file: { directory: dir, level: "DEBUG", rotate: "never" },
});
filed.debug("file keeps DEBUG");
filed.notif({ user: 42 });
await filed.close();
const json = new Logger({
	name: "app",
	level: "ERROR",
	file: {
		directory: dir,
		level: "DEBUG",
		extension: "jsonl",
		json: true,
		rotate: "never",
	},
});
json.notif("hello");
await json.close();
const rotating = new Logger({
	name: "app",
	level: "ERROR",
	file: {
		directory: dir,
		level: "DEBUG",
		filename: "rot",
		rotate: "never",
		maxSize: 120,
		maxFiles: 3,
	},
});
for (let i = 0; i < 12; i++) rotating.notif(`line ${i}`);
await rotating.close();

process.stdout.write(readFileSync(filed.filePath ?? "", "utf8"));
process.stdout.write(readFileSync(json.filePath ?? "", "utf8"));
process.stdout.write(
	`${dim("12 lines, maxSize 120, maxFiles 3:")} ${[...new Bun.Glob("rot*").scanSync({ cwd: dir })].sort().join(", ")}\n\n`,
);
rmSync(dir, { recursive: true, force: true });
