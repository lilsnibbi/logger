# @lilsnibbi/logger — AGENTS.md

Keep responses minimal: bare essentials, short paragraphs, no padding.
Never commit, push, tag, publish, or run release automation unless explicitly requested.
Preserve existing user changes and public APIs. Prefer focused fixes over broad rewrites.

## Project Overview

A structured console logger for the **Bun runtime**, published to npm as
`@lilsnibbi/logger`. Ships raw TypeScript source — no build step, no compiled
output, no runtime dependencies. It was split out of `@lilsnibbi/utils` v2,
along with the helpers, which became `@lilsnibbi/toolkit`, and the discord.js
structures, which became `@lilsnibbi/discord-kit` and depend on this package.
Sibling checkouts sit beside this one under `Projects/@lilsnibbi/`.

- **Package**: `@lilsnibbi/logger` (public, MIT)
- **Runtime**: Bun
- **Language**: TypeScript (strict, ESNext, bundler module resolution)
- **Linter/Formatter**: Biome
- **Package manager**: `bun`

## Branch Strategy

Use the repository's configured default branch for releases. Renovate currently targets `dev`.
An exact `vX.Y.Z` tip commit message requests a release; ordinary commits never release.

## Key Scripts

```bash
bun test              # run all tests
bun run check         # release gate: typecheck, test, release:verify, lint
bun run typecheck     # tsc --noEmit
bun run lint          # biome check
bun run pretty        # format with Biome
bun run audit         # bun audit --audit-level=high
```

`bun run check` must pass before committing. CI
(`.github/workflows/ci.yml`) runs `bun install --frozen-lockfile`,
`bun run audit`, `bun run check`, and `bun pm pack --dry-run` on every pull
request and on pushes to `main`.

## Project Structure

```
src/
  index.ts                # barrel — re-exports core/ and structures/
  core/
    paint.ts              # ANSI engine (replaces chalk) + colour/theme types
    formatError.ts        # error / stack tree renderer
    inlineErrors.ts       # rewrites nested errors before inspection
    truncate.ts           # vendored from @lilsnibbi/toolkit; used by the box layout
  structures/
    Logger.ts             # the class + LogLevel and the option types
    LogFile.ts            # rotating file sink + its option types
tests/                    # mirrors src/
  core/paint.test.ts
  core/formatError.test.ts
  core/truncate.test.ts
  structures/Logger.test.ts
  structures/LogFile.test.ts
```

The logger splits into `core/` (stateless functions) and `structures/`
(classes). Tests import the concrete module rather than the barrel.
`core/truncate.ts` is a copy of the helper in `@lilsnibbi/toolkit`, kept here so
the logger has no dependency on that package; it is not re-exported from the
barrel, and a behaviour change should be mirrored in both places.

Conventions:

- One export per file; the filename matches the thing it exports.
- Files exporting a class are `PascalCase`; files exporting a function are
  `camelCase`.
- Types live in the module that owns them, exported beside the implementation
  — there is no `types.ts`. `paint.ts` owns the colour and theme vocabulary
  (`LogColor`, `LogStyle`, `LogToken`, `LogTheme`), `LogFile.ts` owns
  `LogFileOptions` and `LogRotation`, `Logger.ts` owns `LogLevel` and the
  option/record types. `LogLevel` is the one type consumed from below —
  `paint.ts` and `LogFile.ts` import it from `Logger.ts` with `import type`,
  which `verbatimModuleSyntax` erases, so the cycle never exists at runtime.
- Do not use `.d.ts` files for these. The package ships raw TypeScript with no
  build step, so a declaration file has no runtime module for `export *` in
  the barrel to resolve.
- Every exported symbol carries JSDoc. Option bags are named, exported
  interfaces — never inline object types — so consumers can name them.
- Guard clauses throw `RangeError` for out-of-range arguments, not bare
  `Error`.

## `Logger`

Levels are ordered `DEBUG` < `NOTIF` < `ALERT` < `ERROR`; anything below the
configured `level` is dropped.

- `log(level, message, raw?)` plus `debug` / `notif` / `alert` / `error`
  shorthands.
- The `raw` flag returns the formatted string instead of emitting it, and is
  side-effect free — no console, no file, no `transport`. Its return type is
  `string | undefined`; a message dropped by the level filter returns nothing.
- `child(name, overrides?)` clones the configuration and **shares the parent's
  `LogFile`** (`ownsFile` is false, so `close()` on a child is a no-op).
- Writes go straight to `process.stdout` / `process.stderr`, not through
  `console`, so nothing reinterprets the string and the newline is ours.
  `DEBUG` and `NOTIF` go to stdout, `ALERT` and `ERROR` to stderr — the same
  split `console.log`/`warn` would have made.
- `divider(text)`, `time(label)` / `timeEnd(label, level?)`, `setLevel`,
  `setTheme`, `flush`, `close`, `filePath`, `silent`.
- Timestamp format: `[Day HH:mm:ss.SSS]`, 24h, locale configurable — except
  under `layout: "box"`, which drops the weekday, the milliseconds and the
  brackets for a bare `HH:mm:ss`.

**Layout** — `layout` is `"badge"` (default), `"bar"` or `"box"`. `"badge"`
renders the level as a filled block, `"bar"` as a coloured bar plus the glyph
from `symbols` (`•` `✓` `⚑` `×`, spread `DEFAULT_SYMBOLS` to change one). Both
put the name and a `›` separator between the marker and the message:
`[Tue 19:38:23.644]  NOTIF  api › listening`.

`"box"` is a frame — `┌ HH:mm:ss LEVEL ── topRight ┐`, the message behind a
`│` edge one line per line, then `└─ bottomLeft ── bottomRight ┘`. Its level is
painted like the bar's, foreground only, and it is configured through the
`box: LogBoxOptions` bag rather than top-level options:

- `width` — the terminal's columns by default, 80 where there are none (a
  redirected stream, a log file), never less than 32.
- `topRight` (defaults to the logger's name), `bottomLeft`, `bottomRight` —
  each a `LogBoxSlot`: a string, or a function of the `LogRecord` for a corner
  that changes per record. `""` or `undefined` leaves the corner out of the
  rule entirely.
- `spacing` — opens each box with a blank line so two boxes are separated by
  one; a leading blank rather than both sides, which would leave a two-line
  gap. Console only, never in a log file.

Rules are measured against the plain text, since escapes take up no columns,
and every corner is `truncate`d to what its rule can spare, so both rules close
in the same column however long the corner text is. The footer's corners use
the `boxNote` token, the header's the `name` token.

**Colour** — `colors` is `boolean | "auto"`; `"auto"` checks `NO_COLOR`,
`FORCE_COLOR`, `TERM=dumb` and `stdout.isTTY`. `theme` is a
`Partial<Record<LogToken, LogStyle>>` merged over `DEFAULT_THEME`; an entry
replaces the default for its token outright rather than merging into it. The
level tokens carry a `background` (the badge fill) and a `color` picked to read
against it; the `"bar"` layout promotes that background to the foreground. Named
colours use the terminal palette (SGR 30–37/90–97); anything else goes through
`Bun.color(..., "[rgb]")` and becomes truecolor. `paint` reopens the outer
style after a nested reset so styles nest correctly.

**Errors** — `formatError.ts` renders name, message, extra own properties,
frames, `cause` chain and `AggregateError.errors` as an indented tree. It
filters nothing: native, anonymous, `node:internal` and `eval` frames are all
kept, and unparseable lines are printed verbatim. The logged `Error` object is
never mutated. `stackTraceLimit` assigns the global `Error.stackTraceLimit`
when set; it is opt-in because that setting is process-wide.

**Files** — `file: LogFileOptions` mirrors output to a rotating file. Writes go
through `writeSync` on a held descriptor rather than a stream, because a
buffered write can outlive the rename that rotation performs. Rotation is by
period (`never` / `hourly` / `daily`) and by `maxSize`; archives are numbered
from the highest index on disk so the numbering stays monotonic across prunes.
`maxFiles` counts the active file. Filesystem errors go to `onError`, never
thrown.

**Hooks** — `serialize` (per value, `undefined` falls through), `format` (whole
line, once per destination), `filter` (drop a record), `transport` (every
emitted line, colour stripped). `format` and `serialize` receive a `LogContext`
carrying the record, the destination, whether colour is on, and `paint`/`style`
bound to the active theme.

## Code Style

Enforced by Biome — run `bun run pretty` before committing:

- **Indent**: tabs
- **Quotes**: double quotes for JS/TS strings
- **Line endings**: LF (`.gitattributes` enforces this on checkout)
- **Linter**: Biome recommended rules
- Import organization: disabled (`organizeImports` is off)

## Testing

Tests use `bun:test` (built-in) and mirror the `src/` layout under `tests/`.

- No mocking of external services — `Logger` tests capture
  `process.stdout.write` / `process.stderr.write` into arrays and restore the
  spies first in `afterEach`, before anything else can write.
- `Logger` and `LogFile` tests write to a real `mkdtempSync` directory and
  close every logger they open before removing it, since Windows will not
  delete a file that still has an open descriptor.
- Logger tests pass `colors: false` so assertions compare plain strings;
  colour behaviour is asserted separately against escape sequences.

## Releases

An entire `vX.Y.Z` tip commit message on the default branch triggers `release.yml`.
The workflow verifies, updates metadata, atomically pushes the version commit and tag,
publishes to npm, and creates a GitHub Release with generated notes.
Configure `NPM_TOKEN` and allow Actions to push release metadata. Use `RELEASE_TOKEN`
only if required by branch/tag rules. Retry failed releases from their original Actions run.
Publish the logger before releasing discord-kit versions that depend on it.
See [.github/RELEASE_POLICY.md](.github/RELEASE_POLICY.md) for the exact trigger and setup.
Do not run release automation during ordinary verification.

## Renovate

Auto-dependency updates are configured in `renovate.json`, targeting the `dev`
branch. All update types are scheduled "at any time". PRs are
assigned/reviewed by `lilsnibbi`.
