# @lilsnibbi/logger

A structured console logger for the [Bun](https://bun.sh/) runtime. Colours
are written as ANSI escapes directly, so there is no styling dependency — no
dependencies at all.

The package ships raw TypeScript — there is no build step and no compiled
output. Consumers need Bun, or a bundler that resolves `.ts` imports.

```bash
bun add @lilsnibbi/logger
```

## Usage

```ts
import { Logger } from "@lilsnibbi/logger";

const logger = new Logger({ name: "api", level: "NOTIF" });

logger.notif("listening on :3000");
logger.alert("disk almost full");
logger.error(new Error("query timed out")); // prints the full stack
logger.divider("STARTUP");
```

A line leads with its timestamp and a level marker — a filled badge by
default, or a coloured bar and glyph with `layout: "bar"`:

```text
[Tue 19:38:23.644]  NOTIF  api › listening on :3000
[Tue 19:38:23.644] ▌ ✓ api › listening on :3000
```

`symbols` replaces the glyphs the bar draws, which default to `•`, `✓`, `⚑`
and `×`:

```ts
new Logger({ name: "api", layout: "bar", symbols: { NOTIF: "→" } });
```

`layout: "box"` frames the record instead. The timestamp and level sit on the
header rule, every line of the value gets its own edge, and each rule carries
text in its corners:

```text
┌ 19:38:23 NOTIF ────────────────────────────────────── src/api.ts:19 ┐
│ listening on :3000
└─ GET /checkout ──────────────────────────────────────── Auth ID: 41 ┘
```

```ts
const logger = new Logger({
  name: "api",
  layout: "box",
  box: {
    width: 72,                                   // default: the terminal's
    topRight: "src/api.ts:19",                   // default: the logger's name
    bottomLeft: "GET /checkout",
    bottomRight: (record) => `Auth ID: ${session(record)}`,
    spacing: true,
  },
});
```

Each corner takes a string, or a function of the {@link LogRecord} being drawn
for something that changes per line — a route, a request id, whoever is signed
in. Pass `""` to leave a corner empty. Corners take their columns out of the
rule rather than hanging off the end of it, and are truncated to what the rule
can spare, so the frame always closes in the column it says it will.

The box carries a lighter timestamp than the other layouts — `19:38:23`, no
weekday, no milliseconds, no brackets — since the header rule is already
carrying the level and a corner. `spacing` opens each box with a blank line, so
consecutive records are separated by one; log files are never padded. Width
falls back to 80 columns where the stream has none, and is never drawn narrower
than 32.

Levels are ordered `DEBUG` < `NOTIF` < `ALERT` < `ERROR`; anything below
`level` is dropped. Every method takes a trailing `raw` flag that returns the
formatted string instead of emitting it:

```ts
const line = logger.alert("disk almost full", true);
```

The return type is `string | undefined` — a message filtered out by the current
level returns nothing. A `raw` call is side-effect free: nothing reaches the
terminal, the log file or `transport`.

Lines are written straight to `process.stdout` and `process.stderr` rather than
through `console`. `DEBUG` and `NOTIF` go to stdout, `ALERT` and `ERROR` to
stderr, so `2>/dev/null` still leaves you with the routine output.

### Colour

Colours are written as ANSI escapes directly; there is no styling dependency.
`colors` defaults to `"auto"`, which honours `NO_COLOR`, `FORCE_COLOR`,
`TERM=dumb` and whether stdout is a TTY. Pass `true` or `false` to decide it
yourself.

Every part of a line is a themeable token — the four level names, plus
`timestamp`, `name`, `separator`, `boxNote`, `message`, `divider`,
`dividerText`,
`errorName`, `errorMessage`, `causeLabel`, `stackBranch`, `stackFunction`,
`stackFile`, `stackLocation` and `stackNote`:

```ts
const logger = new Logger({
  name: "api",
  theme: {
    NOTIF: { color: "#7aa2f7", bold: true },
    timestamp: { color: [88, 91, 112] },
    ERROR: { color: "white", background: "darkred", bold: true },
  },
});

logger.setTheme({ ALERT: { color: "orange", underline: true } });
```

The four level tokens style the badge, so their `background` is what fills it
and their `color` only has to stay legible against it. The `"bar"` layout has
no block to fill and draws that background colour as the bar and glyph instead.

A style takes `color`, `background` and the `bold`, `dim`, `italic`,
`underline`, `inverse` and `strikethrough` attributes. The sixteen ANSI colour
names (`red`, `gray`, `brightCyan`, …) map onto the terminal's own palette;
anything else — hex, `rgb()`, `hsl()`, a CSS colour name, an `[r, g, b]` tuple
— is parsed by `Bun.color` and emitted as truecolor. An entry replaces the
default for that token outright, so spread `DEFAULT_THEME.ERROR` if you only
want to change part of it.

`paint`, `stripAnsi` and `colorSupported` are exported if you need the same
styling elsewhere.

### Stack traces

An `Error` is rendered as an indented tree with its name, message, extra own
properties, `cause` chain and `AggregateError.errors`. Nothing is filtered:
native, anonymous, `node:internal` and `eval` frames all survive, and a frame
that cannot be parsed is printed verbatim. Paths lose their `file://` prefix,
get forward slashes, and are made relative to `process.cwd()` unless
`relativePaths: false`.

```
[Tue 19:38:23.644]  ERROR  api › Error: request failed
  └─ outer src/api.ts (L25 C13)
  ▼ caused by TypeError: x is not a function
    ├─ inner src/db.ts (L17 C12)
    └─ outer src/api.ts (L23 C3)
```

V8 keeps only the first ten frames by default. Set `stackTraceLimit` to capture
everything — it assigns the global `Error.stackTraceLimit`, so it is opt-in:

```ts
new Logger({ name: "api", stackTraceLimit: Number.POSITIVE_INFINITY });
```

### Log files

`file` mirrors output to disk, with rotation and retention handled for you.
Writes are synchronous, so entries and rotations never race each other.

```ts
const logger = new Logger({
  name: "api",
  level: "NOTIF",
  file: {
    directory: "logs",
    filename: "api",
    level: "DEBUG",   // keep more detail on disk than on screen
    rotate: "daily",  // "never" | "hourly" | "daily"
    maxSize: 5 * 1024 * 1024,
    maxFiles: 7,
    maxAge: 30,       // days; 0 disables
    json: false,
    colors: false,
  },
});

await logger.flush();
await logger.close();
```

Daily rotation writes `api-2026-08-25.log`; a file that passes `maxSize` is
renamed to `api-2026-08-25.1.log` and a fresh one takes its place, with the
index counting up so a higher number is always newer. `maxFiles` counts the
active file. `json: true` writes one object per line — `time`, `level`, `name`,
`message`, and an `error` object when the value was an `Error`. Filesystem
failures go to `onError` instead of being thrown.

### Hooks

```ts
const logger = new Logger({
  name: "api",
  serialize: (value) => (value instanceof Date ? value.toISOString() : undefined),
  format: (parts, ctx) => `${ctx.paint(parts.level, parts.level)} ${parts.message}`,
  filter: (record) => record.value !== "spam",
  transport: (line, record) => ship(record.level, line),
});
```

- `serialize` renders one value; return `undefined` to fall back to the
  built-in handling.
- `format` builds the whole line from `parts` (`timestamp`, `name`, `level`,
  `message`) and a context carrying the record, the destination
  (`"console"` or `"file"`), whether colour is on, and `paint`/`style` helpers
  bound to the active theme. It runs once per destination.
- `filter` drops a record before it is formatted.
- `transport` receives every emitted line with the colour stripped.

### Everything else

```ts
const worker = logger.child("worker", { level: "DEBUG" });

logger.time("query");
logger.timeEnd("query");        // logs "query took 12.40ms", returns 12.4

logger.silent = true;
```

A child keeps its parent's configuration, shares its log file rather than
opening a second handle on it, and closing a child leaves that shared file
open. Other options: `includeTimestamps`, `timeformat`, `dividerWidth`,
`inspectDepth`, `silent`.

## Development

```bash
bun test                          # run the suite
bun run check                     # typecheck, tests, release metadata, biome
bun run pretty                    # format
```

Releases are automated: push a commit whose entire message is exactly
`v1.2.3` (your desired version) to the repository's default branch.
CI updates the version, runs checks, pushes an annotated tag, publishes to npm,
and creates a GitHub Release with generated notes. Configure `NPM_TOKEN`
and allow Actions to push release metadata. See
[.github/RELEASE_POLICY.md](.github/RELEASE_POLICY.md).

## License

MIT
