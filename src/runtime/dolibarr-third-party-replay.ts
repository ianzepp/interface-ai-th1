/**
 * Deterministic replay of `dolibarr.lookup-third-party`, with no model present.
 *
 * Also the harness for a small branch matrix. `DOLIBARR_LOOKUP_NAME` supplies
 * the search term, `DOLIBARR_EXPECT_RESULT` names the typed outcome the run
 * must produce, and `DOLIBARR_SKIP_AUTH=1` starts an unauthenticated session to
 * exercise intervention routing. The run is finalized `satisfied` when the
 * engine returns the expected outcome and `error` when it does not, so a
 * mismatch is preserved as evidence. The typed result is written to
 * `result.json` in the run directory.
 *
 * Run it through `npm run replay:dolibarr:third-party`, which builds and resets
 * the `demo-install-smoke` snapshot first.
 *
 * INVARIANTS
 * - Authentication happens before the recorder and trace start, so the fixture
 *   password cannot enter replay evidence.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium, type Page } from "playwright";

import { FileRunRecorder } from "../authoring/run-recorder.js";
import { dolibarrThirdPartyLookupArtifact } from "../capabilities/dolibarr-third-party-lookup.js";
import { print, runMain } from "../common/cli.js";
import { requireEnv } from "../common/env.js";
import { describeError } from "../common/errors.js";
import { PlaywrightBrowserDriver } from "../surfaces/playwright-driver.js";
import { DeterministicEngine } from "./engine.js";
import { ArtifactPolicy } from "./policy.js";
import { createRecordingObserver } from "./recording-observer.js";

const BASE_URL = "http://127.0.0.1:8080";

async function main(): Promise<void> {
    const name = process.env.DOLIBARR_LOOKUP_NAME ?? "Book Keeping Company";
    const expected = process.env.DOLIBARR_EXPECT_RESULT ?? "success";
    const skipAuthentication = process.env.DOLIBARR_SKIP_AUTH === "1";
    let password: string | undefined;
    if (!skipAuthentication) password = requireEnv("DOLIBARR_FIXTURE_PASSWORD");

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    let recorder: FileRunRecorder | undefined;
    let traceStopped = false;

    try {
        await prepare(page, password);
        recorder = await FileRunRecorder.start({
            rootDirectory: join(process.cwd(), "runs"),
            goal: dolibarrThirdPartyLookupArtifact.contract.goal,
            situation: `Deterministic replay for expected result ${expected}.`,
            targetProfile: "dolibarr",
            targetVersion: "23.0.4",
            fixtureId: "dolibarr/demo-install-smoke",
        });
        await mkdir(join(recorder.directory, "screenshots"), {
            recursive: true,
        });
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
            { observer: createRecordingObserver(recorder) },
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
        print(JSON.stringify(result));
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
                summary: describeError(error),
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
        if (recorder !== undefined) {
            print(`Run directory: ${recorder.directory}`);
        }
    }
}

await runMain(main);

/** Open the fixture, signing in unless the run is deliberately anonymous. */
async function prepare(
    page: Page,
    fixturePassword: string | undefined,
): Promise<void> {
    await page.goto(BASE_URL);
    if (fixturePassword === undefined) return;
    await page.locator('input[name="username"]').fill("admin");
    await page.locator('input[name="password"]').fill(fixturePassword);
    await page
        .locator('input[type="submit"], button[type="submit"]')
        .first()
        .click();
    await page
        .getByRole("link", { name: "Third parties", exact: true })
        .waitFor();
}
