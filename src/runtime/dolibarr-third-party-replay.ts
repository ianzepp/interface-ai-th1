/**
 * Deterministic replay of `dolibarr.lookup-third-party`, with no model present.
 *
 * Unlike the LedgerSMB replay, this one is also the harness for a small branch
 * matrix. `DOLIBARR_LOOKUP_NAME` supplies the search term, `DOLIBARR_EXPECT_RESULT`
 * names the typed outcome the run must produce, and `DOLIBARR_SKIP_AUTH=1` starts
 * an unauthenticated session to exercise intervention routing. The run is
 * finalized `satisfied` whenever the engine returns the expected outcome and
 * `error` when it does not, so a mismatch is preserved as evidence rather than
 * swallowed. The typed result is written to `result.json` in the run directory.
 *
 * Run it through `npm run replay:dolibarr:third-party`, which builds and resets
 * the `demo-install-smoke` snapshot first.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium, type Page } from "playwright";

import { FileTestRunRecorder } from "../authoring/run-recorder.js";
import { dolibarrThirdPartyLookupArtifact } from "../capabilities/dolibarr-third-party-lookup.js";
import { PlaywrightBrowserDriver } from "../surfaces/playwright-driver.js";
import { DeterministicEngine } from "./engine.js";
import { ArtifactPolicy } from "./policy.js";

const BASE_URL = "http://127.0.0.1:8080";
const name = process.env.DOLIBARR_LOOKUP_NAME ?? "Book Keeping Company";
const expected = process.env.DOLIBARR_EXPECT_RESULT ?? "success";
const skipAuthentication = process.env.DOLIBARR_SKIP_AUTH === "1";
const password = process.env.DOLIBARR_FIXTURE_PASSWORD;
if (password === undefined && !skipAuthentication) {
    throw new Error("DOLIBARR_FIXTURE_PASSWORD is required");
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "en-US" });
const page = await context.newPage();
let recorder: FileTestRunRecorder | undefined;
let traceStopped = false;

try {
    await prepare(page, password, skipAuthentication);
    recorder = await FileTestRunRecorder.start({
        rootDirectory: join(process.cwd(), "runs"),
        goal: dolibarrThirdPartyLookupArtifact.contract.goal,
        situation: `Deterministic replay for expected result ${expected}.`,
        targetProfile: "dolibarr",
        targetVersion: "23.0.4",
        fixtureId: "dolibarr/demo-install-smoke",
    });
    await mkdir(join(recorder.directory, "screenshots"), { recursive: true });
    await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true,
    });

    const driver = new PlaywrightBrowserDriver(
        context,
        page,
        join(recorder.directory, "screenshots"),
    );
    const engine = new DeterministicEngine(
        driver,
        new ArtifactPolicy(dolibarrThirdPartyLookupArtifact.policy),
        {
            observer: {
                async actionCompleted(stageId, action, result) {
                    await recorder?.append({
                        type: "action",
                        recordedAt: new Date().toISOString(),
                        action,
                        result,
                        rationale: `Deterministic artifact stage: ${stageId}`,
                    });
                },
                async checkpoint(_stageId, detectorId) {
                    await recorder?.append({
                        type: "checkpoint",
                        recordedAt: new Date().toISOString(),
                        name: detectorId,
                        satisfied: true,
                    });
                },
            },
        },
    );

    const result = await engine.run(dolibarrThirdPartyLookupArtifact, {
        capabilityId: dolibarrThirdPartyLookupArtifact.id,
        inputs: { baseUrl: BASE_URL, name },
    });
    const resultKey = result.type === "success" ? "success" : result.code;
    if (resultKey !== expected) {
        throw new Error(
            `Expected ${expected}, received ${resultKey}: ${JSON.stringify(result)}`,
        );
    }

    await writeFile(
        join(recorder.directory, "result.json"),
        `${JSON.stringify(result, null, 2)}\n`,
        "utf8",
    );
    await page.screenshot({
        path: join(recorder.directory, "screenshots", "terminal.png"),
        fullPage: true,
    });
    await context.tracing.stop({ path: recorder.tracePath });
    traceStopped = true;
    await recorder.finalize({
        status: "satisfied",
        summary: `The deterministic artifact returned the expected typed result: ${resultKey}.`,
        checkpoint: resultKey,
    });
    console.log(JSON.stringify(result));
} catch (error) {
    if (recorder !== undefined) {
        if (!traceStopped) {
            await context.tracing
                .stop({ path: recorder.tracePath })
                .then(() => {
                    traceStopped = true;
                })
                .catch(() => undefined);
        }
        await recorder.finalize({
            status: "error",
            code: "deterministic-replay-failed",
            summary: error instanceof Error ? error.message : String(error),
        });
    }
    throw error;
} finally {
    if (recorder !== undefined && !traceStopped) {
        await context.tracing
            .stop({ path: recorder.tracePath })
            .catch(() => undefined);
    }
    await context.close();
    await browser.close();
    if (recorder !== undefined)
        console.log(`Run directory: ${recorder.directory}`);
}

async function prepare(
    page: Page,
    fixturePassword: string | undefined,
    unauthenticated: boolean,
): Promise<void> {
    await page.goto(BASE_URL);
    if (unauthenticated) return;
    await page.locator('input[name="username"]').fill("admin");
    await page.locator('input[name="password"]').fill(fixturePassword ?? "");
    await page
        .locator('input[type="submit"], button[type="submit"]')
        .first()
        .click();
    await page
        .getByRole("link", { name: "Third parties", exact: true })
        .waitFor();
}
