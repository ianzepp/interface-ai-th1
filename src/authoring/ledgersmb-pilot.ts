/**
 * The shared harness behind the four scripted LedgerSMB capture pilots.
 *
 * A pilot is one recorded run of fixed browser steps: authenticate before the
 * run and trace open (or, for the pilot whose capability is creating the
 * credentials, suspend the trace across each credential-bearing exchange), act through the artifact policy gate, append a redacted action
 * event with the rationale for each step, and finalize the run. The pilots
 * differ only in their goal, starting fixture, and steps; everything else lives
 * here so the four record identically.
 *
 * INVARIANTS
 * - Every browser action passes `ArtifactPolicy` before Playwright sees it.
 * - The fixture password is declared a sensitive value to both the recorder and
 *   the trace capture, so it is redacted from the ledger and scanned out of the
 *   trace.
 * - Fixture authentication is never in the trace: the submit click of a login
 *   carries the password in its request body, so the login happens before
 *   tracing starts, or inside `pilot.untraced`.
 * - A run finalizes exactly once: `satisfied` through the steps'
 *   `finishSatisfied`, or `error` with a screenshot when any step throws.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
    type BrowserContext,
    chromium,
    type Locator,
    type Page,
} from "playwright";

import { print } from "../common/cli.js";
import { requireEnv } from "../common/env.js";
import { describeError } from "../common/errors.js";
import { ArtifactPolicy } from "../runtime/policy.js";
import type {
    ActionResult,
    Observation,
    SurfaceAction,
    TargetDescriptor,
} from "../surfaces/surface-driver.js";
import {
    executePolicyBoundAction,
    PlaywrightRunCapture,
} from "./playwright-run-capture.js";
import { FileRunRecorder } from "./run-recorder.js";

export const LEDGERSMB_ORIGIN = "http://127.0.0.1:5762";

/** Visible page text kept per observation; enough to review a step. */
const OBSERVATION_TEXT_LIMIT = 2_000;

const policy = new ArtifactPolicy({
    allowedOrigins: [LEDGERSMB_ORIGIN],
    allowedActionTypes: ["navigate", "activate", "fill", "select", "press"],
    riskyActionMode: "block",
});

/** What distinguishes one pilot run from another. */
export interface LedgerSmbPilotRun {
    goal: string;
    situation: string;
    /** Snapshot ID the run starts from, e.g. `ledgersmb/partners-ready`. */
    fixtureId: string;
    /**
     * Company to log in to before the run opens. Omit it when the run itself
     * creates the credentials and handles them inside `pilot.untraced`.
     */
    authenticateTo?: string;
    /** Terminal error code recorded when any step throws. */
    errorCode: string;
    /** The steps, ending in `pilot.finishSatisfied`. */
    steps(pilot: LedgerSmbPilot, password: string): Promise<void>;
}

/** Record one pilot run from browser launch through finalization. */
export async function runLedgerSmbPilot(run: LedgerSmbPilotRun): Promise<void> {
    const password = requireEnv("LEDGERSMB_FIXTURE_PASSWORD");
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({ locale: "en-US" });
        const page = await context.newPage();
        if (run.authenticateTo !== undefined) {
            await authenticate(page, run.authenticateTo, password);
        }
        await recordRun(run, password, context, page);
    } finally {
        await browser.close();
    }
}

async function recordRun(
    run: LedgerSmbPilotRun,
    password: string,
    context: BrowserContext,
    page: Page,
): Promise<void> {
    const recorder = await FileRunRecorder.start({
        rootDirectory: join(process.cwd(), "runs"),
        goal: run.goal,
        situation: run.situation,
        targetProfile: "ledgersmb",
        targetVersion: "1.13.7",
        fixtureId: run.fixtureId,
        sensitiveInputValues: [password],
    });
    const capture = await PlaywrightRunCapture.start(
        context.tracing,
        recorder,
        [password],
    );
    const pilot = new LedgerSmbPilot(page, recorder, capture);

    try {
        await run.steps(pilot, password);
    } catch (error) {
        await pilot.finishWithError(run.errorCode, error);
        throw error;
    } finally {
        await context.close();
        print(`Run directory: ${recorder.directory}`);
    }
}

/**
 * Log in as the fixture administrator, unrecorded and untraced.
 *
 * This is fixture bootstrap, like the discovery session's: the session cookie
 * it leaves in the context is the run's starting state. It is not capability
 * knowledge, and it must precede tracing because the submit request carries
 * the password.
 */
async function authenticate(
    page: Page,
    company: string,
    password: string,
): Promise<void> {
    await page.goto(`${LEDGERSMB_ORIGIN}/login.pl`);
    await page.locator("#username").fill("admin");
    await page.locator("#password").fill(password);
    await page.locator("#company").fill(company);
    await page.getByRole("button", { name: "Login", exact: true }).click();
    await page.getByText("Welcome to LedgerSMB", { exact: true }).waitFor();
    // A disposable-password expiry notice can cover the first menu action.
    const expiryNotice = page.getByRole("button", { name: "OK", exact: true });
    if (await expiryNotice.isVisible()) await expiryNotice.click();
}

/** The page, recorder, and capture of one run, behind recorded actions. */
export class LedgerSmbPilot {
    constructor(
        readonly page: Page,
        private readonly recorder: FileRunRecorder,
        private readonly capture: PlaywrightRunCapture,
    ) {}

    /**
     * Run steps with tracing suspended for their whole span.
     *
     * Wrap every exchange that submits a credential, from the first field to
     * the response, because the submit click names no value yet sends it. The
     * steps still append redacted ledger events.
     */
    untraced<T>(steps: () => Promise<T>): Promise<T> {
        return this.capture.suspended(steps);
    }

    async navigate(url: string, rationale: string): Promise<void> {
        await this.recordAction({ type: "navigate", url }, rationale, () =>
            this.page.goto(url).then(() => undefined),
        );
    }

    /** Fill the unique element matching a CSS selector. */
    async fill(
        selector: string,
        value: string,
        rationale: string,
    ): Promise<void> {
        await this.fillLocator(
            this.page.locator(selector),
            cssTarget(selector),
            value,
            rationale,
        );
    }

    /** Fill a located element, recorded under a separately described target. */
    async fillLocator(
        locator: Locator,
        target: TargetDescriptor,
        value: string,
        rationale: string,
    ): Promise<void> {
        await this.recordAction(
            { type: "fill", target, value },
            rationale,
            () => locator.fill(value),
        );
    }

    async click(
        target: TargetDescriptor,
        rationale: string,
        locator: Locator,
    ): Promise<void> {
        await this.recordAction({ type: "activate", target }, rationale, () =>
            locator.click(),
        );
    }

    /** Save a full-page screenshot under the run's `screenshots/` directory. */
    async saveScreenshot(fileName: string): Promise<void> {
        const directory = join(this.recorder.directory, "screenshots");
        await mkdir(directory, { recursive: true });
        await this.page.screenshot({
            path: join(directory, fileName),
            fullPage: true,
        });
    }

    /** Append the current page as an observation pointing at a screenshot. */
    async recordObservation(screenshotPath: string): Promise<void> {
        const observation = await this.observe();
        await this.recorder.append({
            type: "observation",
            recordedAt: new Date().toISOString(),
            observation: { ...observation, screenshotPath },
        });
    }

    /** Append the satisfied checkpoint and finalize the run on it. */
    async finishSatisfied(checkpoint: string, summary: string): Promise<void> {
        await this.recorder.append({
            type: "checkpoint",
            recordedAt: new Date().toISOString(),
            name: checkpoint,
            satisfied: true,
        });
        await this.capture.finish({ status: "satisfied", summary, checkpoint });
    }

    /** Screenshot the failure where possible, then finalize the run as `error`. */
    async finishWithError(code: string, error: unknown): Promise<void> {
        const directory = join(this.recorder.directory, "screenshots");
        await mkdir(directory, { recursive: true });
        await this.page
            .screenshot({ path: join(directory, "error.png"), fullPage: true })
            .catch(() => undefined);
        await this.capture.finish({
            status: "error",
            code,
            summary: describeFailure(error),
        });
    }

    private async recordAction(
        action: SurfaceAction,
        rationale: string,
        execute: () => Promise<void>,
    ): Promise<void> {
        await executePolicyBoundAction(policy, action, () =>
            this.capture.execute(action, execute),
        );
        const result: ActionResult = {
            completed: true,
            observation: await this.observe(),
        };
        await this.recorder.append({
            type: "action",
            recordedAt: new Date().toISOString(),
            action,
            result,
            rationale,
        });
    }

    private async observe(): Promise<Observation> {
        return {
            url: this.page.url(),
            title: await this.page.title(),
            accessibility: {
                text: (await this.page.locator("body").innerText()).slice(
                    0,
                    OBSERVATION_TEXT_LIMIT,
                ),
            },
        };
    }
}

export function roleTarget(role: string, name: string): TargetDescriptor {
    return {
        candidates: [{ kind: "role", role, name }],
        require: "exactly-one",
    };
}

export function cssTarget(selector: string): TargetDescriptor {
    return { candidates: [{ kind: "css", selector }], require: "exactly-one" };
}

/** The first line of a thrown value's message, as a one-line run summary. */
function describeFailure(error: unknown): string {
    const [firstLine = ""] = describeError(error).split("\n", 1);
    return firstLine;
}
