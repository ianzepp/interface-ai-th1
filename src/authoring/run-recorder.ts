import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DiscoveryEvent, EventRecorder } from "./event-recorder.js";
import { redactKnownSecrets } from "./redaction.js";

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
`;
}
