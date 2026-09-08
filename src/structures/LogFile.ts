import {
	closeSync,
	fstatSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readdirSync,
	renameSync,
	statSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import { join } from "node:path";
import type { LogLevel } from "./Logger";

/** How often a {@link LogFileOptions} sink starts a fresh file. */
export type LogRotation = "never" | "hourly" | "daily";

/** Options for writing log output to disk. */
export interface LogFileOptions {
	/** Directory to write into. Created recursively if it does not exist. */
	directory: string;
	/** Base filename, without a date suffix or extension. Defaults to `"app"`. */
	filename?: string;
	/** File extension, without the dot. Defaults to `"log"`. */
	extension?: string;
	/**
	 * Minimum level written to disk. Defaults to the logger's own level, so a
	 * file can keep `DEBUG` detail that the console drops.
	 */
	level?: LogLevel;
	/**
	 * How often to start a new file. `"daily"` and `"hourly"` add a date suffix
	 * to the filename. Defaults to `"daily"`.
	 */
	rotate?: LogRotation;
	/**
	 * Archive the active file once it exceeds this many bytes. `0` disables
	 * size-based rotation. Defaults to `5 * 1024 * 1024`.
	 */
	maxSize?: number;
	/**
	 * How many files to keep in the directory, newest first. `0` keeps every
	 * file. Defaults to `5`.
	 */
	maxFiles?: number;
	/**
	 * Delete files older than this many days. `0` disables age-based pruning.
	 * Defaults to `0`.
	 */
	maxAge?: number;
	/** Keep ANSI escapes in the file. Defaults to `false`. */
	colors?: boolean;
	/**
	 * Write one JSON object per line instead of the formatted text line, for
	 * when the file is consumed by a log shipper. Defaults to `false`.
	 */
	json?: boolean;
	/**
	 * Called when a write, rotation or prune fails. Defaults to reporting on
	 * `process.stderr`. File errors are never rethrown, so a full disk cannot
	 * take the process down.
	 */
	onError?: (error: Error) => void;
}

/** Milliseconds in a day, used to turn `maxAge` into a cutoff timestamp. */
const DAY = 24 * 60 * 60 * 1000;

/** Shared encoder, so every line is measured and written in the same pass. */
const ENCODER = new TextEncoder();

/**
 * An append-only log file with rotation and retention.
 *
 * A `Logger` owns one of these and hands it fully formatted lines; the file
 * decides when to start a new one and which old ones to delete.
 *
 * Writes are synchronous. A buffered stream would reorder entries against a
 * rename, so a rotation could move a file that the pending writes had not
 * created yet — synchronous appends keep rotation and retention exact at the
 * cost of blocking on the write. Filesystem failures are reported through
 * {@link LogFileOptions.onError} and never rethrown, so a full or read-only
 * disk cannot bring the process down, and a destination the process has no
 * right to write to latches the file off after the first refusal rather than
 * failing once per record.
 *
 * @example
 * ```ts
 * const file = new LogFile({ directory: "logs", filename: "api", maxFiles: 7 });
 *
 * file.write("[Tue 09:00:00.000] | api | NOTIF | started");
 * await file.close();
 * ```
 */
export class LogFile {
	/** Directory the files live in. */
	public readonly directory: string;
	/** Minimum level to write, or `undefined` to inherit the logger's level. */
	public readonly level: LogLevel | undefined;
	/** Whether ANSI escapes are kept in the file. */
	public readonly colors: boolean;
	/** Whether each entry is written as a JSON object. */
	public readonly json: boolean;

	private readonly filename: string;
	private readonly extension: string;
	private readonly rotation: LogRotation;
	private readonly maxSize: number;
	private readonly maxFiles: number;
	private readonly maxAge: number;
	private readonly onError: (error: Error) => void;

	private descriptor: number | null = null;
	private activePath = "";
	private activePeriod = "";
	private size = 0;
	private closed = false;
	private permitted = true;

	constructor(options: LogFileOptions) {
		this.directory = options.directory;
		this.filename = options.filename ?? "app";
		this.extension = options.extension ?? "log";
		this.level = options.level;
		this.rotation = options.rotate ?? "daily";
		this.maxSize = options.maxSize ?? 5 * 1024 * 1024;
		this.maxFiles = options.maxFiles ?? 5;
		this.maxAge = options.maxAge ?? 0;
		this.colors = options.colors ?? false;
		this.json = options.json ?? false;
		this.onError =
			options.onError ??
			((error) => {
				process.stderr.write(`[Logger] log file error: ${error.message}\n`);
			});
	}

	/** Path of the file currently being written to, or `""` before the first write. */
	public get path(): string {
		return this.activePath;
	}

	/**
	 * Whether the destination still accepts writes.
	 *
	 * Creating the directory and opening the file is the permission check — a
	 * read-only directory or a path the process has no rights to fails there
	 * and fails there every time. The first refusal reports through
	 * {@link LogFileOptions.onError} and turns this `false`, after which every
	 * `write` returns immediately. An unwritable destination therefore costs
	 * one failed attempt for the life of the logger rather than one per
	 * record, and console output carries on untouched.
	 */
	public get writable(): boolean {
		return this.permitted;
	}

	/**
	 * Appends a line, rotating first if the period changed or the file is full.
	 * @param line - The line to append. A newline is added for you.
	 */
	public write(line: string): void {
		if (this.closed || !this.permitted) return;

		const payload = ENCODER.encode(
			`${this.colors ? line : Bun.stripANSI(line)}\n`,
		);

		try {
			this.prepare(payload.byteLength);
			if (this.descriptor === null) return;

			let written = 0;
			while (written < payload.byteLength) {
				written += writeSync(this.descriptor, payload, written);
			}

			this.size += payload.byteLength;
		} catch (error) {
			this.report(error);
		}
	}

	/**
	 * Asks the operating system to commit the file to disk.
	 * @returns A promise that resolves once the flush completes.
	 */
	public flush(): Promise<void> {
		try {
			if (this.descriptor !== null) fsyncSync(this.descriptor);
		} catch (error) {
			this.report(error);
		}

		return Promise.resolve();
	}

	/**
	 * Closes the file. Subsequent writes are ignored.
	 * @returns A promise that resolves once the handle is closed.
	 */
	public close(): Promise<void> {
		this.closed = true;
		this.release();
		return Promise.resolve();
	}

	/** Opens or rotates the handle so that `bytes` more can be appended. */
	private prepare(bytes: number): void {
		const period = this.period(new Date());

		if (this.descriptor === null || period !== this.activePeriod) {
			this.open(period);
		}
		if (this.descriptor === null) return;

		if (this.maxSize > 0 && this.size > 0 && this.size + bytes > this.maxSize) {
			this.archive();
		}
	}

	/** Points the handle at the file for a given period, creating it if needed. */
	private open(period: string): void {
		this.release();

		this.activePeriod = period;
		this.activePath = join(this.directory, this.nameFor(period));

		try {
			mkdirSync(this.directory, { recursive: true });
			this.descriptor = openSync(this.activePath, "a");
			this.size = fstatSync(this.descriptor).size;
		} catch (error) {
			// Creating the directory and opening the file is the write
			// permission check, and the only place a refusal can be told apart
			// from a transient per-line failure, so this is where the file
			// latches off instead of retrying for every record that follows.
			this.permitted = false;
			this.release();
			this.report(error);
			return;
		}

		this.prune();
	}

	/** Renames the full active file out of the way and starts a fresh one. */
	private archive(): void {
		this.release();

		const suffix = `.${this.extension}`;
		const base = this.nameFor(this.activePeriod).slice(0, -suffix.length);
		const pattern = new RegExp(
			`^${escapeRegExp(base)}\\.(\\d+)\\.${escapeRegExp(this.extension)}$`,
		);

		const taken = new Set<string>();
		let highest = 0;

		for (const name of this.list()) {
			taken.add(name);
			const match = pattern.exec(name);
			if (match) highest = Math.max(highest, Number(match[1]));
		}

		// Counting up from the highest index already on disk rather than from
		// the first free one keeps the numbering monotonic, so `app.7.log` is
		// always newer than `app.6.log` even after pruning has removed both.
		let index = highest + 1;
		while (taken.has(`${base}.${index}${suffix}`)) index += 1;

		renameSync(
			this.activePath,
			join(this.directory, `${base}.${index}${suffix}`),
		);

		this.descriptor = openSync(this.activePath, "a");
		this.size = 0;

		this.prune();
	}

	/** Every filename directly inside the directory, or `[]` if unreadable. */
	private list(): string[] {
		try {
			return readdirSync(this.directory);
		} catch (error) {
			this.report(error);
			return [];
		}
	}

	/** Closes the current handle, if any. */
	private release(): void {
		if (this.descriptor === null) return;

		try {
			closeSync(this.descriptor);
		} catch (error) {
			this.report(error);
		}

		this.descriptor = null;
	}

	/** The filename for a period, e.g. `api-2026-08-25.log`. */
	private nameFor(period: string): string {
		const suffix = period === "" ? "" : `-${period}`;
		return `${this.filename}${suffix}.${this.extension}`;
	}

	/** The rotation key for a moment in time, or `""` when rotation is off. */
	private period(date: Date): string {
		if (this.rotation === "never") return "";

		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		const stamp = `${year}-${month}-${day}`;

		if (this.rotation === "daily") return stamp;

		return `${stamp}-${String(date.getHours()).padStart(2, "0")}`;
	}

	/** Deletes files beyond `maxFiles`, then any left that exceed `maxAge`. */
	private prune(): void {
		if (this.maxFiles <= 0 && this.maxAge <= 0) return;

		try {
			const pattern = new RegExp(
				`^${escapeRegExp(this.filename)}(?:-\\d{4}-\\d{2}-\\d{2}(?:-\\d{2})?)?(?:\\.[1-9]\\d*)?\\.${escapeRegExp(this.extension)}$`,
			);

			const files = this.list()
				.filter((name) => pattern.test(name))
				.map((name) => join(this.directory, name))
				.filter((path) => path !== this.activePath)
				.map((path) => ({ path, modified: statSync(path).mtimeMs }))
				// Rotating several times inside one millisecond leaves the
				// timestamps tied, so the archive index decides which is newer.
				.sort(
					(a, b) =>
						b.modified - a.modified ||
						b.path.localeCompare(a.path, undefined, { numeric: true }),
				);

			// The active file counts towards the limit, so one fewer is archived.
			const keep =
				this.maxFiles > 0 ? Math.max(0, this.maxFiles - 1) : files.length;
			const cutoff = this.maxAge > 0 ? Date.now() - this.maxAge * DAY : 0;

			for (const [index, file] of files.entries()) {
				if (index >= keep || file.modified < cutoff) unlinkSync(file.path);
			}
		} catch (error) {
			this.report(error);
		}
	}

	/** Hands a failure to {@link LogFileOptions.onError}. */
	private report(error: unknown): void {
		this.onError(error instanceof Error ? error : new Error(String(error)));
	}
}

/** Escapes a string for literal use inside a regular expression. */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
