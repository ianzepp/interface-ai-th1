/**
 * The one argument parser the harness CLIs share.
 *
 * These CLIs accept `--flag value` pairs and bare `--flag` switches, and they
 * pass flags to each other: the launcher names flags in the prompt it builds,
 * and the session CLI forwards some of its own flags to the session process.
 * A flag's spelling is therefore a contract between files, and a reader and
 * writer that disagree about the key never fail loudly; they silently fall back
 * to a default. Keys are stored bare: everything looks up `lane`, never
 * `--lane`.
 *
 * INVARIANTS
 * - A flag with no following value is a switch, recorded as `"true"`.
 * - A flag followed by another flag is a switch, so a caller cannot consume the
 *   next flag as this one's value by accident.
 * - An argument that is not a flag is rejected, because a silently ignored
 *   positional argument is a caller error worth reporting.
 */

/** Read `--flag value` pairs and `--flag` switches from an argument list. */
export function parseFlags(argv: readonly string[]): Map<string, string> {
    const parsed = new Map<string, string>();

    for (let index = 0; index < argv.length; index += 1) {
        const flag = argv[index];
        if (!flag?.startsWith("--")) {
            throw new Error(`Unexpected argument: ${String(flag)}`);
        }
        const key = flag.slice(2);
        const value = argv[index + 1];

        if (value === undefined || value.startsWith("--")) {
            parsed.set(key, "true");
            continue;
        }
        parsed.set(key, value);
        index += 1;
    }

    return parsed;
}

/** Read a required flag, or explain which one is missing. */
export function requireFlag(flags: Map<string, string>, name: string): string {
    const value = flags.get(name);
    if (value === undefined) throw new Error(`--${name} is required`);
    return value;
}

/** Read an optional numeric flag with a fallback, rejecting a non-number. */
export function readNumberFlag(
    flags: Map<string, string>,
    name: string,
    fallback: number,
): number {
    const raw = flags.get(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
        throw new Error(`--${name} must be a number (received ${raw})`);
    }
    return value;
}
