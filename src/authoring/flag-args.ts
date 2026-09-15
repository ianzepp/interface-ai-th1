/**
 * The one argument parser the harness CLIs share.
 *
 * These CLIs accept `--flag value` pairs and bare `--flag` switches, and they
 * pass flags to each other: the launcher builds a prompt naming the flags the
 * model must use, and the session CLI forwards some of its own flags to the
 * session process it spawns. That means a flag's spelling is a contract between
 * files, and a reader and writer that disagree about the key never fail loudly —
 * they silently fall back to a default.
 *
 * That is exactly what happened once, so the key convention now lives in one
 * place: keys are stored bare, without the leading dashes the caller typed.
 * Everything looks up `lane`, never `--lane`.
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

export function flagValue(
    flags: Map<string, string>,
    name: string,
): string | undefined {
    return flags.get(name);
}

export function hasFlag(flags: Map<string, string>, name: string): boolean {
    return flags.has(name);
}

/** Read a required flag, or explain which one is missing. */
export function requireFlag(
    flags: Map<string, string>,
    name: string,
    options: Map<string, string> = flags,
): string {
    const value = options.get(name);
    if (value === undefined) throw new Error(`--${name} is required`);
    return value;
}

/** Read a required numeric flag, rejecting a value that is not a number. */
export function requireNumberFlag(
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
