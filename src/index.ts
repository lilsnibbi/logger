/**
 * Entry point for `@lilsnibbi/logger`.
 *
 * The class is the whole of the public surface for most uses; the theme
 * engine, the stack renderer and every option type are exported alongside it
 * so a consumer can build on them without reaching into the package.
 */
export * from "./core/formatError";
export * from "./core/paint";
export * from "./structures/LogFile";
export * from "./structures/Logger";
