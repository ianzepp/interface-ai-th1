import { basename, join } from "node:path";
import { createInterface } from "node:readline";

import {
    chromium,
    type Browser,
    type BrowserContext,
    type Page,
} from "playwright";

import { ArtifactPolicy, type PolicyConfiguration } from "../runtime/policy.js";
import { PlaywrightBrowserDriver } from "../surfaces/playwright-driver.js";
import type { ActionRisk, SurfaceAction } from "../surfaces/surface-driver.js";
import { PlaywrightTestRunCapture } from "./playwright-run-capture.js";
import { FileTestRunRecorder, type TestRunOutcome } from "./run-recorder.js";

interface SessionOptions {
    rootDirectory: string;
    goal: string;
    situation: string;
    targetProfile: string;
    targetVersion: string;
    fixtureId: string;
    policy: PolicyConfiguration;
    prepare(page: Page): Promise<void>;
}

type SessionCommand =
    | { type: "observe"; screenshot?: boolean }
    | {
          type: "act";
          action: SurfaceAction;
          risk: ActionRisk;
          rationale: string;
      }
    | { type: "checkpoint"; name: string; satisfied: boolean }
    | { type: "finish"; outcome: TestRunOutcome };

/**
 * Run one browser attempt while an external LLM supplies each next action.
 *
 * The host process writes one JSON command per line and receives one JSON
 * observation in response. This keeps discovery decisions outside the repo
 * while preserving a single Playwright context, trace, policy gate, and event
 * ledger for the complete attempt.
 */
export async function runInteractivePlaywrightSession(
    options: SessionOptions,
): Promise<void> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        // Authentication and other fixture bootstrap happen before tracing so
        // credentials cannot enter the run trace or event ledger.
        await options.prepare(page);

        const recorder = await FileTestRunRecorder.start({
            rootDirectory: options.rootDirectory,
            goal: options.goal,
            situation: options.situation,
            targetProfile: options.targetProfile,
            targetVersion: options.targetVersion,
            fixtureId: options.fixtureId,
        });
        const capture = await PlaywrightTestRunCapture.start(
            context.tracing,
            recorder,
        );
        const driver = new PlaywrightBrowserDriver(
            context,
            page,
            join(recorder.directory, "screenshots"),
        );
        const policy = new ArtifactPolicy(options.policy);
        let finished = false;

        emit({
            type: "ready",
            runId: basename(recorder.directory),
            runDirectory: recorder.directory,
            observation: await driver.observe({
                includeAccessibility: true,
                includeScreenshot: false,
            }),
        });

        const lines = createInterface({
            input: process.stdin,
            crlfDelay: Infinity,
        });
        for await (const line of lines) {
            if (line.trim() === "") continue;
            try {
                const command = parseSessionCommand(line);
                if (command.type === "observe") {
                    const observation = await driver.observe({
                        includeAccessibility: true,
                        includeScreenshot: command.screenshot ?? false,
                    });
                    await recorder.append({
                        type: "observation",
                        recordedAt: new Date().toISOString(),
                        observation,
                    });
                    emit({ type: "observation", observation });
                    continue;
                }
                if (command.type === "checkpoint") {
                    await recorder.append({
                        ...command,
                        recordedAt: new Date().toISOString(),
                    });
                    emit({ type: "checkpoint-recorded", name: command.name });
                    continue;
                }
                if (command.type === "finish") {
                    await capture.finish(command.outcome);
                    finished = true;
                    emit({ type: "finished", outcome: command.outcome });
                    lines.close();
                    break;
                }

                const decision = policy.evaluate(command.action, command.risk);
                await recorder.append({
                    type: "proposal",
                    recordedAt: new Date().toISOString(),
                    action: command.action,
                    risk: command.risk,
                    rationale: command.rationale,
                    policyDecision: decision,
                });
                if (decision.type !== "allow") {
                    emit({ type: "action-rejected", decision });
                    continue;
                }
                const originFailure = blockedOrigin(
                    command.action,
                    page,
                    options.policy.allowedOrigins,
                );
                if (originFailure !== null) {
                    emit({ type: "action-rejected", reason: originFailure });
                    continue;
                }
                if (
                    command.action.type !== "navigate" &&
                    command.action.type !== "press"
                ) {
                    await driver.locate(command.action.target);
                }
                const result = await driver.act(command.action);
                await recorder.append({
                    type: "action",
                    recordedAt: new Date().toISOString(),
                    action: command.action,
                    result,
                    rationale: command.rationale,
                });
                emit({ type: "action-completed", result });
            } catch (error) {
                emit({ type: "command-error", error: describeError(error) });
            }
        }

        if (!finished) {
            await capture.finish({
                status: "error",
                code: "controller-disconnected",
                summary:
                    "The external discovery controller disconnected before finalizing the run.",
            });
        }
    } finally {
        await closeQuietly(context, browser);
    }
}

export function parseSessionCommand(source: string): SessionCommand {
    const value = JSON.parse(source) as unknown;
    if (value === null || typeof value !== "object") {
        throw new Error("Session command must be a JSON object");
    }
    const command = value as Record<string, unknown>;
    if (
        command.type !== "observe" &&
        command.type !== "act" &&
        command.type !== "checkpoint" &&
        command.type !== "finish"
    ) {
        throw new Error("Unknown session command type");
    }
    return value as SessionCommand;
}

function blockedOrigin(
    action: SurfaceAction,
    page: Page,
    allowedOrigins: readonly string[],
): string | null {
    const candidate = action.type === "navigate" ? action.url : page.url();
    let origin: string;
    try {
        origin = new URL(candidate).origin;
    } catch {
        return `Invalid action URL: ${candidate}`;
    }
    return allowedOrigins.includes(origin)
        ? null
        : `Origin ${origin} is not allowlisted`;
}

function emit(value: unknown): void {
    process.stdout.write(`${JSON.stringify(value)}\n`);
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function closeQuietly(
    context: BrowserContext,
    browser: Browser,
): Promise<void> {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
}
