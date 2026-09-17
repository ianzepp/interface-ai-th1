import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
    PlaywrightTestRunCapture,
    type TraceController,
    type TraceStartOptions,
    type TraceStopOptions,
} from "../src/authoring/playwright-run-capture.js";
import { FileTestRunRecorder } from "../src/authoring/run-recorder.js";

class FakeTraceController implements TraceController {
    public startOptions?: TraceStartOptions;
    public stopOptions?: TraceStopOptions;

    public start(options: TraceStartOptions): Promise<void> {
        this.startOptions = options;
        return Promise.resolve();
    }

    public async stop(options: TraceStopOptions): Promise<void> {
        this.stopOptions = options;
        await writeFile(options.path, "fake Playwright trace", "utf8");
    }
}

test("saves one Playwright trace inside the finalized run", async (context) => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "interface-ai-run-"));
    context.after(async () =>
        rm(rootDirectory, { recursive: true, force: true }),
    );

    const recorder = await FileTestRunRecorder.start({
        rootDirectory,
        runId: "run-with-trace",
        goal: "Find an account",
        situation: "Baseline fixture",
        targetProfile: "ledgersmb",
        targetVersion: "1.13",
        fixtureId: "baseline-v1",
    });
    const tracing = new FakeTraceController();
    const capture = await PlaywrightTestRunCapture.start(tracing, recorder);

    await capture.finish({
        status: "satisfied",
        summary: "The account was found.",
        checkpoint: "account-visible",
    });

    assert.deepEqual(tracing.startOptions, {
        screenshots: true,
        snapshots: true,
        sources: false,
        title: recorder.directory,
    });
    assert.match(tracing.stopOptions?.path ?? "", /interface-ai-trace-/);
    assert.equal(
        await readFile(recorder.tracePath, "utf8"),
        "fake Playwright trace",
    );
});

test("finalizes the run as an error when trace persistence fails", async (context) => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "interface-ai-run-"));
    context.after(async () =>
        rm(rootDirectory, { recursive: true, force: true }),
    );

    const recorder = await FileTestRunRecorder.start({
        rootDirectory,
        runId: "failed-trace",
        goal: "Find an account",
        situation: "Trace storage is unavailable",
        targetProfile: "ledgersmb",
        targetVersion: "1.13",
        fixtureId: "baseline-v1",
    });
    const tracing: TraceController = {
        start: () => Promise.resolve(),
        stop: () => Promise.reject(new Error("disk unavailable")),
    };
    const capture = await PlaywrightTestRunCapture.start(tracing, recorder);

    await assert.rejects(
        capture.finish({
            status: "satisfied",
            summary: "The account was found.",
            checkpoint: "account-visible",
        }),
        /disk unavailable/,
    );

    const manifest = await readFile(recorder.manifestPath, "utf8");
    const readme = await readFile(recorder.readmePath, "utf8");
    assert.match(manifest, /"code": "trace-stop-failed"/);
    assert.match(readme, /Status: `error`/);
    assert.match(readme, /disk unavailable/);
});

test("suspends tracing for sensitive actions and rejects contaminated candidates", async (context) => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "interface-ai-run-"));
    context.after(async () =>
        rm(rootDirectory, { recursive: true, force: true }),
    );
    const sentinel = "synthetic-sensitive-sentinel";
    const recorder = await FileTestRunRecorder.start({
        rootDirectory,
        runId: "contaminated-trace",
        goal: "Find an account",
        situation: "Baseline fixture",
        targetProfile: "ledgersmb",
        targetVersion: "1.13",
        fixtureId: "baseline-v1",
        sensitiveInputValues: [sentinel],
    });
    const stops: string[] = [];
    const tracing: TraceController = {
        start: () => Promise.resolve(),
        stop: async ({ path }) => {
            stops.push(path);
            await writeFile(
                path,
                stops.length === 1
                    ? "temporary"
                    : compressedZipMember("trace.trace", sentinel),
            );
        },
    };
    const capture = await PlaywrightTestRunCapture.start(tracing, recorder, [
        sentinel,
    ]);
    await capture.execute({ type: "fill", value: sentinel }, () =>
        Promise.resolve(),
    );
    await capture.finish({
        status: "satisfied",
        summary: "found",
        checkpoint: "found",
    });

    assert.equal(stops.length, 2);
    await assert.rejects(readFile(recorder.tracePath, "utf8"));
    const manifest = await readFile(recorder.manifestPath, "utf8");
    const readme = await readFile(recorder.readmePath, "utf8");
    assert.match(manifest, /sensitive-evidence-detected/);
    assert.doesNotMatch(manifest, new RegExp(sentinel));
    assert.doesNotMatch(readme, new RegExp(sentinel));
});

test("fails closed when a candidate trace cannot be read as an archive", async (context) => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "interface-ai-run-"));
    context.after(async () =>
        rm(rootDirectory, { recursive: true, force: true }),
    );

    const recorder = await FileTestRunRecorder.start({
        rootDirectory,
        runId: "malformed-trace",
        goal: "Find an account",
        situation: "Trace archive is malformed",
        targetProfile: "ledgersmb",
        targetVersion: "1.13",
        fixtureId: "baseline-v1",
        sensitiveInputValues: ["synthetic-sensitive-sentinel"],
    });
    const tracing: TraceController = {
        start: () => Promise.resolve(),
        stop: ({ path }) => writeFile(path, "not a ZIP archive", "utf8"),
    };
    const capture = await PlaywrightTestRunCapture.start(tracing, recorder, [
        "synthetic-sensitive-sentinel",
    ]);

    await assert.rejects(
        capture.finish({
            status: "satisfied",
            summary: "found",
            checkpoint: "found",
        }),
    );

    const manifest = await readFile(recorder.manifestPath, "utf8");
    assert.match(manifest, /trace-stop-failed/);
});

function compressedZipMember(name: string, content: string): Buffer {
    const nameBytes = Buffer.from(name);
    const uncompressed = Buffer.from(content);
    const compressed = deflateRawSync(uncompressed);
    const checksum = crc32(uncompressed);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(8, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    const localEntry = Buffer.concat([localHeader, nameBytes, compressed]);
    const centralDirectory = Buffer.alloc(46);
    centralDirectory.writeUInt32LE(0x02014b50);
    centralDirectory.writeUInt16LE(20, 4);
    centralDirectory.writeUInt16LE(20, 6);
    centralDirectory.writeUInt16LE(8, 8);
    centralDirectory.writeUInt32LE(checksum, 16);
    centralDirectory.writeUInt32LE(compressed.length, 20);
    centralDirectory.writeUInt32LE(uncompressed.length, 24);
    centralDirectory.writeUInt16LE(nameBytes.length, 28);
    const centralEntry = Buffer.concat([centralDirectory, nameBytes]);
    const endOfDirectory = Buffer.alloc(22);
    endOfDirectory.writeUInt32LE(0x06054b50);
    endOfDirectory.writeUInt16LE(1, 8);
    endOfDirectory.writeUInt16LE(1, 10);
    endOfDirectory.writeUInt32LE(centralEntry.length, 12);
    endOfDirectory.writeUInt32LE(localEntry.length, 16);
    return Buffer.concat([localEntry, centralEntry, endOfDirectory]);
}

function crc32(content: Buffer): number {
    let checksum = 0xffffffff;
    for (const byte of content) {
        checksum ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            checksum =
                checksum & 1 ? 0xedb88320 ^ (checksum >>> 1) : checksum >>> 1;
        }
    }
    return (checksum ^ 0xffffffff) >>> 0;
}
