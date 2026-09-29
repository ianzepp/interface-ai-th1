/**
 * Deterministic replay of `dolibarr.create-customer-with-contact`.
 *
 * `DOLIBARR_CREATE_PARTY_EXPECT_RESULT` names the typed outcome the run must
 * produce. The run is finalized `satisfied` when the engine returns it and
 * `error` when it does not, and the typed result is written to `result.json`
 * in the run directory.
 *
 * Run it through `npm run replay:dolibarr:create-party`, which builds and
 * resets the `create-party` lane to the `demo-install-smoke` snapshot first.
 *
 * INVARIANTS
 * - Authentication happens before the recorder and trace start, so the fixture
 *   password cannot enter replay evidence.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium, type Page } from "playwright";

import { FileRunRecorder } from "../authoring/run-recorder.js";
import { dolibarrCreateCustomerWithContactArtifact } from "../capabilities/dolibarr-create-customer-with-contact.js";
import { print, runMain } from "../common/cli.js";
import { requireEnv } from "../common/env.js";
import { describeError } from "../common/errors.js";
import { PlaywrightBrowserDriver } from "../surfaces/playwright-driver.js";
import { DeterministicEngine } from "./engine.js";
import { ArtifactPolicy } from "./policy.js";
import { createRecordingObserver } from "./recording-observer.js";

const BASE_URL = "http://127.0.0.1:8126";

async function main(): Promise<void> {
    const thirdPartyName =
        process.env.DOLIBARR_CREATE_PARTY_NAME ?? "Aurora Signal Works";
    const thirdPartyId = process.env.DOLIBARR_CREATE_PARTY_ID ?? "63";
    const contactFirstName =
        process.env.DOLIBARR_CREATE_CONTACT_FIRST_NAME ?? "Elena";
    const contactLastName =
        process.env.DOLIBARR_CREATE_CONTACT_LAST_NAME ?? "Park";
    const expected =
        process.env.DOLIBARR_CREATE_PARTY_EXPECT_RESULT ?? "success";
    const password = requireEnv("DOLIBARR_FIXTURE_PASSWORD");

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    let recorder: FileRunRecorder | undefined;
    let traceStopped = false;

    try {
        await prepare(page, password);
        recorder = await FileRunRecorder.start({
            rootDirectory: join(process.cwd(), "runs"),
            goal: dolibarrCreateCustomerWithContactArtifact.contract.goal,
            situation:
                "Deterministic replay from the dolibarr/demo-install-smoke fixture.",
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
            page,
            join(recorder.directory, "screenshots"),
        );
        const engine = new DeterministicEngine(
            driver,
            new ArtifactPolicy(
                dolibarrCreateCustomerWithContactArtifact.policy,
            ),
            { observer: createRecordingObserver(recorder) },
        );

        const result = await engine.run(
            dolibarrCreateCustomerWithContactArtifact,
            {
                capabilityId: dolibarrCreateCustomerWithContactArtifact.id,
                inputs: {
                    baseUrl: BASE_URL,
                    thirdPartyName,
                    thirdPartyId,
                    contactFirstName,
                    contactLastName,
                },
            },
        );
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

/** Open the fixture, signing in unless the lane is already signed in. */
async function prepare(page: Page, fixturePassword: string): Promise<void> {
    await page.goto(BASE_URL);
    if (page.url().includes("/index.php?mainmenu=home")) return;
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
