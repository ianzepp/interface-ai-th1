/**
 * Narrowing parsed JSON to an object.
 *
 * Ledgers, manifests, seals, and host streams all arrive as `unknown`; each
 * reader checks this shape before reading fields, instead of casting.
 */

/** Whether a value is a plain object: not null, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
