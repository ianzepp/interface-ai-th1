/**
 * Error helpers shared by every module that reports a caught value.
 *
 * `catch` binds `unknown`, so anything printed or recorded from one has to be
 * narrowed first; these are the two narrowings the codebase needs.
 */

/** The message of a thrown value, whatever was thrown. */
export function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Whether a thrown value is a Node system error carrying an errno `code`. */
export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error;
}
