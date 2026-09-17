import { execFile, spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";

import type { ScanCandidate, ScanScope } from "./secret-scan.js";

const execFileAsync = promisify(execFile);

/**
 * Where the scan looks, and how it decides what would ship.
 *
 * Two surfaces matter. The working tree is what a `git add -A` would pick up, and
 * it is the right surface for "does this machine carry credentials". The index is
 * exactly the content a commit would create, and it is the right surface for a
 * commit hook, because the two differ: content staged and then edited in the
 * working tree is not what the commit contains, and content edited but not staged
 * is not either.
 *
 * Scope comes from Git rather than from parsing `.gitignore`, because the ignore
 * rules include negations, subdirectory files, and tracked files that are also
 * matched by a pattern. `git ls-files` already knows all of that: tracked plus
 * untracked-but-not-excluded is exactly the set a clone would carry, and
 * everything else on disk is local-only.
 */

const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules"]);

/** A NUL byte this early means the file is not text, whatever its extension. */
const BINARY_SNIFF_BYTES = 8192;

/** Above this, a file is listed but not scanned: a regex sweep is not worth it. */
const MAX_SCANNED_BYTES = 8 * 1024 * 1024;

/** Above this, reading the index stops rather than holding the repo in memory. */
const MAX_INDEX_BYTES = 128 * 1024 * 1024;

export interface SecretScanCatalog {
    candidates: readonly ScanCandidate[];
    /** Files that are not text, so nothing here read their contents. */
    skippedBinary: readonly string[];
    /** Files too large to scan, listed so a clean result is not overstated. */
    skippedLarge: readonly string[];
    /** Files that could not be read or are not regular files. */
    unreadable: readonly string[];
}

export async function collectScanCandidates(
    root: string,
): Promise<SecretScanCatalog> {
    const entries = await readdir(root, {
        recursive: true,
        withFileTypes: true,
    });
    const filePaths: string[] = [];
    const unreadable: string[] = [];

    for (const entry of entries) {
        const absolutePath = join(entry.parentPath, entry.name);
        const relativePath = relative(root, absolutePath).split(sep).join("/");
        if (isExcluded(relativePath)) continue;
        if (entry.isSymbolicLink()) {
            unreadable.push(relativePath);
            continue;
        }
        if (entry.isDirectory()) continue;
        filePaths.push(relativePath);
    }

    const committable = await readCommittablePaths(root);
    const candidates: ScanCandidate[] = [];
    const skippedBinary: string[] = [];
    const skippedLarge: string[] = [];

    for (const filePath of filePaths) {
        const scope: ScanScope = committable.has(filePath)
            ? "committable"
            : "local";
        const buffer = await readIfReadable(join(root, filePath), unreadable);
        if (buffer === null) continue;
        if (buffer.length > MAX_SCANNED_BYTES) {
            skippedLarge.push(filePath);
            continue;
        }
        if (isBinary(buffer)) {
            skippedBinary.push(filePath);
            continue;
        }
        candidates.push({ filePath, scope, text: buffer.toString("utf8") });
    }

    return { candidates, skippedBinary, skippedLarge, unreadable };
}

/**
 * The staged surface: exactly the content a commit would create.
 *
 * The index is read as blobs rather than from the working tree, because the two
 * disagree in both directions. Content staged and then edited again is still what
 * the commit would carry, and content edited without staging is not. A hook that
 * scanned the working tree would be wrong about both.
 */
export async function collectStagedCandidates(
    root: string,
): Promise<SecretScanCatalog> {
    const paths = (await gitPaths(root, ["ls-files", "-z", "--cached"])).filter(
        (path) => !isExcluded(path),
    );
    const blobs = await readIndexBlobs(root, paths);
    const candidates: ScanCandidate[] = [];
    const skippedBinary: string[] = [];
    const skippedLarge: string[] = [];
    const unreadable: string[] = [];

    for (const [index, path] of paths.entries()) {
        const buffer = blobs.at(index);
        if (buffer === undefined) {
            unreadable.push(path);
            continue;
        }
        if (buffer.length > MAX_SCANNED_BYTES) {
            skippedLarge.push(path);
            continue;
        }
        if (isBinary(buffer)) {
            skippedBinary.push(path);
            continue;
        }
        candidates.push({
            filePath: path,
            scope: "committable",
            text: buffer.toString("utf8"),
        });
    }

    return { candidates, skippedBinary, skippedLarge, unreadable };
}

/** Read every index blob in one `git cat-file --batch` round trip. */
async function readIndexBlobs(
    root: string,
    paths: readonly string[],
): Promise<readonly Buffer[]> {
    if (paths.length === 0) return [];
    const requests = paths.map((path) => `:${path}`).join("\n") + "\n";
    const { stdout } = await runWithStdin(
        "git",
        ["cat-file", "--batch"],
        requests,
        root,
    );
    return parseBatchOutput(stdout);
}

/**
 * Split `git cat-file --batch` output into per-request content.
 *
 * Frames are `<oid> <type> <size>` followed by that many bytes, and a request
 * that cannot be resolved answers with a single `<request> missing` line. Replies
 * come back in request order and carry no path, so callers pair them by index.
 */
function parseBatchOutput(output: Buffer): readonly Buffer[] {
    const contents: Buffer[] = [];
    let cursor = 0;

    while (cursor < output.length) {
        const newline = output.indexOf(0x0a, cursor);
        if (newline === -1) break;
        const header = output.subarray(cursor, newline).toString("utf8");
        cursor = newline + 1;
        const size = Number.parseInt(header.split(" ")[2] ?? "", 10);
        if (!Number.isInteger(size) || size < 0) {
            contents.push(Buffer.alloc(0));
            continue;
        }
        contents.push(output.subarray(cursor, cursor + size));
        cursor += size + 1;
    }
    return contents;
}

function runWithStdin(
    command: string,
    args: readonly string[],
    input: string,
    cwd: string,
): Promise<{ stdout: Buffer }> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, [...args], { cwd });
        const chunks: Buffer[] = [];
        let size = 0;
        let stderr = "";

        child.stdout.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_INDEX_BYTES) {
                child.kill();
                reject(
                    new Error(
                        `${command} ${args.join(" ")} produced more than ${String(MAX_INDEX_BYTES)} bytes`,
                    ),
                );
                return;
            }
            chunks.push(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
        });
        child.on("error", reject);
        child.on("close", (status) => {
            if (status !== 0) {
                reject(
                    new Error(
                        `${command} ${args.join(" ")} exited ${String(status)}: ${stderr.trim()}`,
                    ),
                );
                return;
            }
            resolve({ stdout: Buffer.concat(chunks) });
        });
        child.stdin.end(input);
    });
}

function isExcluded(relativePath: string): boolean {
    return relativePath
        .split("/")
        .some((segment) => EXCLUDED_DIRECTORIES.has(segment));
}

function isBinary(buffer: Buffer): boolean {
    return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

async function readIfReadable(
    path: string,
    unreadable: string[],
): Promise<Buffer | null> {
    try {
        return await readFile(path);
    } catch {
        unreadable.push(path);
        return null;
    }
}

/** Every path a clone would carry: tracked, plus untracked and not ignored. */
async function readCommittablePaths(
    root: string,
): Promise<ReadonlySet<string>> {
    const paths = new Set<string>();
    for (const args of [
        ["ls-files", "-z"],
        ["ls-files", "--others", "--exclude-standard", "-z"],
    ]) {
        for (const path of await gitPaths(root, args)) {
            paths.add(path);
        }
    }
    return paths;
}

async function gitPaths(
    root: string,
    args: readonly string[],
): Promise<readonly string[]> {
    try {
        const { stdout } = await execFileAsync("git", [...args], {
            cwd: root,
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
        });
        return stdout.split("\0").filter((entry) => entry.length > 0);
    } catch (error) {
        throw new Error(
            `git ${args.join(" ")} failed in ${root}: ${describeError(error)}`,
            { cause: error },
        );
    }
}

function describeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.length > 200 ? `${message.slice(0, 197)}...` : message;
}
