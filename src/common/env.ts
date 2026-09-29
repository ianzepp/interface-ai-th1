/**
 * Required environment configuration.
 *
 * Fixture credentials reach the process only through the environment, never
 * through flags or files, so they stay out of shell history and argv. An empty
 * value is treated as missing: an exported-but-blank variable is a setup
 * mistake, not a credential.
 */

/** The value of a required environment variable, or a thrown setup error. */
export function requireEnv(name: string): string {
    const value = process.env[name];
    if (value === undefined || value === "") {
        throw new Error(`${name} is required (see README "Setup")`);
    }
    return value;
}
