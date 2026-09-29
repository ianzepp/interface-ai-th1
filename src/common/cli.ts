/**
 * The shared shape of a command-line entry point.
 *
 * Every `*-cli.ts`, pilot, and replay runner writes through `print` and wraps
 * its work in `runMain`, so all of them fail the same way: one `error:` line on
 * stdout and exit status 1, never an unhandled rejection with a stack trace.
 * Exit status 2 stays reserved for usage errors, which callers set themselves.
 */

import { describeError } from "./errors.js";

/** Write one line to stdout. The single console seam for CLI output. */
export function print(line: string): void {
    process.stdout.write(`${line}\n`);
}

/** Run an entry point, reporting a thrown error as `error: <message>`. */
export async function runMain(main: () => Promise<void>): Promise<void> {
    try {
        await main();
    } catch (error) {
        print(`error: ${describeError(error)}`);
        process.exitCode = 1;
    }
}
