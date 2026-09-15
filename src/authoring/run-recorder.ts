import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DiscoveryEvent, EventRecorder } from "./event-recorder.js";
import { redactKnownSecrets } from "./redaction.js";

/**
 * The on-disk unit of discovery evidence: one directory per test run.
 *
 * A run directory has to be reviewable without the process that produced it, so
 * it carries the run in four files:
 *
 * - `run.json` — goal, situation, target, fixture, and outcome
 * - `events.jsonl` — the sanitized ledger, one event per line
 * - `README.md` — those facts rendered for a person
 * - `trace.zip` — the Playwright trace, when capture completed
 *
 * INVARIANTS
 * - Events are redacted on the way in. The ledger is append-only, so redacting
 *   after the fact would mean the secret had already been written.
 * - Appends are serialized through one chain, so concurrent writers cannot
 *   interleave into a torn line in the jsonl file.
 * - A run finalizes exactly once and the manifest is rewritten at that point, so
 *   a crashed process leaves a recognizable `running` run rather than an
 *   unexplained trace file.
 */

/** What a run needs to identify itself before it starts. */
export interface TestRunStart {
    rootDirectory: string;
    runId?: string;
    goal: string;
    situation: string;
    targetProfile: string;
    targetVersion: string;
    fixtureId: string;
    now?: () => string;
}

/**
 * How a run ended.
 *
 * A satisfied run must name the checkpoint that proved it, and an error run
 * must name a code, so failures group by class instead of accumulating as prose
 * that has to be read one at a time.
 */
export type TestRunOutcome =
    | {
          status: "satisfied";
          summary: string;
          checkpoint: string;
      }
    | {
          status: "error";
          summary: string;
          code: string;
      };

/** The machine-readable index of one run directory. */
export interface TestRunManifest {
    runId: string;
    status: "running" | TestRunOutcome["status"];
    goal: string;
    situation: string;
    targetProfile: string;
    targetVersion: string;
    fixtureId: string;
    startedAt: string;
    finishedAt?: string;
    outcome?: TestRunOutcome;
    files: {
        readme: "README.md";
        events: "events.jsonl";
        trace: "trace.zip";
        screenshots: "screenshots/";
    };
}

const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export class FileTestRunRecorder implements EventRecorder {
    readonly #now: () => string;
    #finalized = false;
    #writeQueue: Promise<void> = Promise.resolve();

    private constructor(
        public readonly directory: string,
        public readonly manifestPath: string,
        public readonly eventsPath: string,
        public readonly readmePath: string,
        public readonly tracePath: string,
        private readonly manifest: TestRunManifest,
        now: () => string,
    ) {
        this.#now = now;
    }

    /**
     * Create a run directory and its empty ledger.
     *
     * The non-recursive create and the exclusive ledger write are what make a run
     * directory collision-proof: two runs cannot silently share a directory and
     * interleave their evidence.
     */
    public static async start(
        options: TestRunStart,
    ): Promise<FileTestRunRecorder> {
        const now = options.now ?? (() => new Date().toISOString());
        const startedAt = now();
        const runId = options.runId ?? createRunId(startedAt);
        if (!RUN_ID_PATTERN.test(runId)) {
            throw new Error(`Invalid run ID: ${runId}`);
        }

        const directory = join(options.rootDirectory, runId);
        await mkdir(options.rootDirectory, { recursive: true });
        await mkdir(directory);

        const manifest: TestRunManifest = {
            runId,
            status: "running",
            goal: options.goal,
            situation: options.situation,
            targetProfile: options.targetProfile,
            targetVersion: options.targetVersion,
            fixtureId: options.fixtureId,
            startedAt,
            files: {
                readme: "README.md",
                events: "events.jsonl",
                trace: "trace.zip",
                screenshots: "screenshots/",
            },
        };
        const recorder = new FileTestRunRecorder(
            directory,
            join(directory, "run.json"),
            join(directory, manifest.files.events),
            join(directory, manifest.files.readme),
            join(directory, manifest.files.trace),
            manifest,
            now,
        );

        await writeFile(recorder.eventsPath, "", { flag: "wx" });
        await recorder.writeSummaryFiles();
        return recorder;
    }

    /**
     * Record one event, redacted, in arrival order.
     *
     * Late writes are rejected so a stray event cannot land in a closed run and
     * leave its evidence disagreeing with its own manifest.
     */
    public append(event: DiscoveryEvent): Promise<void> {
        if (this.#finalized) {
            return Promise.reject(
                new Error(`Run ${this.manifest.runId} is already finalized`),
            );
        }

        const line = `${JSON.stringify(redactKnownSecrets(event))}\n`;
        this.#writeQueue = this.#writeQueue.then(() =>
            appendFile(this.eventsPath, line),
        );
        return this.#writeQueue;
    }

    public async readAll(): Promise<readonly DiscoveryEvent[]> {
        await this.#writeQueue;
        const source = await readFile(this.eventsPath, "utf8");
        if (source.trim() === "") {
            return [];
        }
        return source
            .trimEnd()
            .split("\n")
            .map((line) => JSON.parse(line) as DiscoveryEvent);
    }

    /**
     * Close the run and write its manifest and README.
     *
     * Queued appends are awaited first, so the summary never describes a run whose
     * last events are still in flight.
     */
    public async finalize(outcome: TestRunOutcome): Promise<void> {
        if (this.#finalized) {
            throw new Error(`Run ${this.manifest.runId} is already finalized`);
        }
        this.#finalized = true;
        await this.#writeQueue;

        this.manifest.status = outcome.status;
        this.manifest.finishedAt = this.#now();
        this.manifest.outcome = outcome;
        await this.writeSummaryFiles();
    }

    private async writeSummaryFiles(): Promise<void> {
        await writeFile(
            this.manifestPath,
            `${JSON.stringify(redactKnownSecrets(this.manifest), null, 2)}\n`,
            "utf8",
        );
        await writeFile(this.readmePath, renderReadme(this.manifest), "utf8");
    }
}

function createRunId(startedAt: string): string {
    const timestamp = startedAt.replaceAll(/[^0-9]/g, "").slice(0, 17);
    return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

/** Quote a block of text so it cannot break out of the surrounding document. */
function quote(value: string): string {
    return value
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
}

function renderReadme(manifest: TestRunManifest): string {
    const outcome = manifest.outcome;
    const outcomeBody =
        outcome === undefined
            ? "The run is still in progress."
            : outcome.status === "satisfied"
              ? `${outcome.summary}\n\nCheckpoint: \`${outcome.checkpoint}\``
              : `${outcome.summary}\n\nError code: \`${outcome.code}\``;

    return `# Test Run ${manifest.runId}

- Status: \`${manifest.status}\`
- Target: \`${manifest.targetProfile}\` \`${manifest.targetVersion}\`
- Fixture: \`${manifest.fixtureId}\`
- Started: \`${manifest.startedAt}\`
${manifest.finishedAt === undefined ? "" : `- Finished: \`${manifest.finishedAt}\`\n`}
## Goal

${quote(manifest.goal)}

## Situation

${manifest.situation}

## Outcome

${outcomeBody}

## Files

- \`run.json\` — structured run metadata and outcome
- \`events.jsonl\` — sanitized observations, decisions, and executed actions
- \`trace.zip\` — Playwright trace when capture completed
- \`screenshots/\` — meaningful checkpoint or terminal screenshots when captured
`;
}
