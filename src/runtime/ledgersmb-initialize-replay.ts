/**
 * Deterministic replay of `ledgersmb.initialize-company`, with no model present.
 *
 * This is the proof the execution plane works as its own path: the reviewed
 * artifact is handed to `DeterministicEngine` and nothing here decides anything.
 * The inputs are the fixture constants, the observer translates engine progress
 * into the same event ledger a discovery run writes, and the error path finalizes
 * the run with whatever the engine or the browser reported.
 *
 * Run it through `npm run replay:ledgersmb:initialize`, which builds and then
 * performs the destructive `fresh` reset. It leaves the initialized target
 * running and creates no snapshot: `initialized-company` is an intentional review
 * action taken after the run has been inspected.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { chromium } from "playwright";

import { PlaywrightTestRunCapture } from "../authoring/playwright-run-capture.js";
import { FileTestRunRecorder } from "../authoring/run-recorder.js";
import { ledgerSmbInitializeArtifact } from "../capabilities/ledgersmb-initialize.js";
import { PlaywrightBrowserDriver } from "../surfaces/playwright-driver.js";
import { DeterministicEngine } from "./engine.js";
import { ArtifactPolicy } from "./policy.js";

const PASSWORD = requireFixturePassword();

const recorder = await FileTestRunRecorder.start({
    rootDirectory: join(process.cwd(), "runs"),
    goal: ledgerSmbInitializeArtifact.contract.goal,
    situation: "Deterministic replay against fresh LedgerSMB Docker volumes.",
    targetProfile: "ledgersmb",
    targetVersion: "1.13.7",
    fixtureId: "ledgersmb/fresh",
    sensitiveInputValues: [PASSWORD],
});
await mkdir(join(recorder.directory, "screenshots"), { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "en-US" });
const page = await context.newPage();
const capture = await PlaywrightTestRunCapture.start(
    context.tracing,
    recorder,
    [PASSWORD],
);

const driver = new PlaywrightBrowserDriver(
    context,
    page,
    join(recorder.directory, "screenshots"),
);
const engine = new DeterministicEngine(
    driver,
    new ArtifactPolicy(ledgerSmbInitializeArtifact.policy),
    {
        observer: {
            async actionCompleted(stageId, action, result) {
                await recorder.append({
                    type: "action",
                    recordedAt: new Date().toISOString(),
                    action,
                    result,
                    rationale: `Deterministic artifact stage: ${stageId}`,
                });
            },
            async checkpoint(_stageId, detectorId) {
                await recorder.append({
                    type: "checkpoint",
                    recordedAt: new Date().toISOString(),
                    name: detectorId,
                    satisfied: true,
                });
            },
        },
    },
);

try {
    const invocation = {
        capabilityId: ledgerSmbInitializeArtifact.id,
        inputs: {
            baseUrl: "http://127.0.0.1:5762",
            databaseAdmin: "postgres",
            databasePassword: PASSWORD,
            company: "interface_ai",
            username: "admin",
            password: PASSWORD,
        },
    };
    const result = await capture.execute(invocation, () =>
        engine.run(ledgerSmbInitializeArtifact, invocation),
    );
    if (result.type !== "success") {
        throw new Error(`${result.type}: ${JSON.stringify(result)}`);
    }
    await page.screenshot({
        path: join(recorder.directory, "screenshots", "authenticated.png"),
        fullPage: true,
    });
    await capture.finish({
        status: "satisfied",
        summary:
            "The deterministic artifact initialized LedgerSMB and reached the authenticated home screen.",
        checkpoint: "authenticated-ledgersmb-home",
    });
} catch (error) {
    await capture.finish({
        status: "error",
        code: "deterministic-replay-failed",
        summary:
            error instanceof Error
                ? (error.message.split("\n", 1)[0] ?? "Unknown replay failure")
                : String(error),
    });
    throw error;
} finally {
    await context.close();
    await browser.close();
    console.log(`Run directory: ${recorder.directory}`);
}

function requireFixturePassword(): string {
    const password = process.env.LEDGERSMB_FIXTURE_PASSWORD;
    if (password === undefined || password === "") {
        throw new Error(
            "LEDGERSMB_FIXTURE_PASSWORD is required for npm run replay:ledgersmb:initialize",
        );
    }
    return password;
}
