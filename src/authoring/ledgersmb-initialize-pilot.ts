/**
 * Scripted capture pilot for LedgerSMB company initialization, phase zero of
 * the four-phase LedgerSMB corpus.
 *
 * From fresh Docker volumes it creates the company database, accepts the chart
 * of accounts and templates, creates the first administrator, and logs in as
 * that administrator. Each step appends a redacted action event with the
 * rationale that held when it ran. Run it through
 * `npm run capture:ledgersmb:initialize`, which performs the destructive
 * fixture reset first.
 *
 * INVARIANTS
 * - The run finalizes `satisfied` at the authenticated home screen, or `error`
 *   with a screenshot when any step throws.
 * - It creates no snapshot: `initialized-company` is a review action taken
 *   after the run has been checked.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { chromium, type Locator, type Page } from "playwright";

import { print, runMain } from "../common/cli.js";
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

const BASE_URL = "http://127.0.0.1:5762";
const DATABASE = "interface_ai";
const USERNAME = "admin";
const policy = new ArtifactPolicy({
    allowedOrigins: [BASE_URL],
    allowedActionTypes: ["navigate", "activate", "fill", "select", "press"],
    riskyActionMode: "block",
});

async function main(): Promise<void> {
    const password = requireEnv("LEDGERSMB_FIXTURE_PASSWORD");
    const recorder = await FileRunRecorder.start({
        rootDirectory: join(process.cwd(), "runs"),
        goal: "Initialize a fresh LedgerSMB company and prove the first administrator can log in.",
        situation:
            "Fresh LedgerSMB Docker volumes with PostgreSQL available and no company database.",
        targetProfile: "ledgersmb",
        targetVersion: "1.13.7",
        fixtureId: "ledgersmb/fresh",
        sensitiveInputValues: [password],
    });
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    const capture = await PlaywrightRunCapture.start(
        context.tracing,
        recorder,
        [password],
    );
    const pilot = new Pilot(page, recorder, capture);

    try {
        await createCompanyDatabase(pilot, password);
        await acceptChartAndTemplates(pilot);
        await createAdministrator(pilot, password);
        await pilot.saveScreenshot("setup-complete.png");
        await pilot.recordObservation("screenshots/setup-complete.png");
        await logIn(pilot, password);
        await pilot.saveScreenshot("authenticated.png");
        await pilot.recordObservation("screenshots/authenticated.png");
        await pilot.finishSatisfied(
            "authenticated-ledgersmb-home",
            "The company database and administrator were created, and the administrator reached the LedgerSMB home screen.",
        );
    } catch (error) {
        await pilot.finishWithError("initialize-company-failed", error);
        throw error;
    } finally {
        await context.close();
        await browser.close();
        print(`Run directory: ${recorder.directory}`);
    }
}

async function createCompanyDatabase(
    pilot: Pilot,
    password: string,
): Promise<void> {
    const { page } = pilot;
    await pilot.navigate(
        `${BASE_URL}/setup.pl`,
        "Open the database setup surface on the allowlisted local origin.",
    );
    await page.locator("#s-user").waitFor();
    await pilot.fill(
        "#s-user",
        "postgres",
        "Enter the local database administrator.",
    );
    await pilot.fill(
        "#s-password",
        password,
        "Enter the disposable local database password.",
    );
    await pilot.fill(
        "#database",
        DATABASE,
        "Name the fixture company database.",
    );
    await pilot.click(
        roleTarget("button", "Create"),
        "Create the company database from the fresh PostgreSQL state.",
        page.getByRole("button", { name: "Create" }),
    );
}

async function acceptChartAndTemplates(pilot: Pilot): Promise<void> {
    const { page } = pilot;
    await page.locator("input[name=coa_lc]").waitFor({ state: "attached" });
    await pilot.click(
        roleTarget("option", "Argentina"),
        "Open the chart-of-accounts country list from its current selection.",
        page.getByRole("option", { name: "Argentina", exact: true }),
    );
    await pilot.click(
        roleTarget("option", "United States"),
        "Select the United States chart family.",
        page.getByRole("option", { name: "United States", exact: true }),
    );
    await pilot.click(
        roleTarget("button", "Next"),
        "Continue with the selected country.",
        page.getByRole("button", { name: "Next" }),
    );

    await page.locator("input[name=chart]").waitFor({ state: "attached" });
    await pilot.click(
        roleTarget("button", "Next"),
        "Accept the General chart of accounts selected by the application.",
        page.getByRole("button", { name: "Next" }),
    );
    await page
        .locator("input[name=template_dir]")
        .waitFor({ state: "attached" });
    await pilot.click(
        roleTarget("button", "Load Templates"),
        "Load the selected demo templates required by the fixture.",
        page.getByRole("button", { name: "Load Templates" }),
    );
}

async function createAdministrator(
    pilot: Pilot,
    password: string,
): Promise<void> {
    const { page } = pilot;
    await page.locator("#username").waitFor();
    await pilot.fill(
        "#username",
        USERNAME,
        "Set the initial application username.",
    );
    await pilot.fill(
        "#password",
        password,
        "Set the disposable local application password.",
    );
    await pilot.fill(
        "#first-name",
        "Fixture",
        "Identify the synthetic administrator.",
    );
    await pilot.fill(
        "#last-name",
        "Administrator",
        "Identify the synthetic administrator.",
    );
    await pilot.fill(
        "#employeenumber",
        "EMP-001",
        "Set a stable employee identifier.",
    );
    await pilot.fill(
        "#dob",
        "1980-01-01",
        "Complete the required synthetic birth date.",
    );
    await pilot.fill(
        "#ssn",
        "000-00-0000",
        "Complete the required synthetic tax identifier.",
    );
    await chooseOption(pilot, "Salutation", "Mr.");
    await chooseOption(pilot, "Country", "United States");
    await chooseOption(pilot, "Assign Permissions", "Full Permissions");
    await pilot.click(
        roleTarget("button", "Create User"),
        "Create the initial administrator with full fixture permissions.",
        page.getByRole("button", { name: "Create User" }),
    );
    await page
        .getByText("Database Operation Complete", { exact: true })
        .waitFor();
}

/** Open a custom listbox by its label, then pick one option from it. */
async function chooseOption(
    pilot: Pilot,
    label: string,
    option: string,
): Promise<void> {
    const { page } = pilot;
    await pilot.click(
        roleTarget("listbox", label),
        `Open the ${label} selection.`,
        page.getByRole("listbox", { name: label }),
    );
    await pilot.click(
        roleTarget("option", option),
        `Select ${option} for ${label}.`,
        page.getByRole("option", { name: option, exact: true }),
    );
}

async function logIn(pilot: Pilot, password: string): Promise<void> {
    const { page } = pilot;
    await pilot.navigate(
        `${BASE_URL}/login.pl`,
        "Open the application login surface to verify the created user.",
    );
    await pilot.fill(
        "#username",
        USERNAME,
        "Enter the fixture administrator username.",
    );
    await pilot.fill(
        "#password",
        password,
        "Enter the disposable fixture password.",
    );
    await pilot.fill(
        "#company",
        DATABASE,
        "Select the initialized company database.",
    );
    await pilot.click(
        cssTarget("form button"),
        "Authenticate with the newly created administrator.",
        page.locator("form").getByRole("button"),
    );
    await page.getByText("Welcome to LedgerSMB", { exact: true }).waitFor();
    const expiryNotice = page.getByRole("button", { name: "OK" });
    if (await expiryNotice.isVisible()) {
        await pilot.click(
            roleTarget("button", "OK"),
            "Dismiss the expected disposable-password expiry notice.",
            expiryNotice,
        );
    }
}

/**
 * One capture run's page, driven only through recorded steps.
 *
 * Every step passes the artifact policy before the browser acts, then appends
 * an action event carrying the rationale and the observation it left behind.
 */
class Pilot {
    constructor(
        readonly page: Page,
        private readonly recorder: FileRunRecorder,
        private readonly capture: PlaywrightRunCapture,
    ) {}

    async navigate(url: string, rationale: string): Promise<void> {
        await this.recordAction({ type: "navigate", url }, rationale, () =>
            this.page.goto(url).then(() => undefined),
        );
    }

    async fill(
        selector: string,
        value: string,
        rationale: string,
    ): Promise<void> {
        await this.recordAction(
            { type: "fill", target: cssTarget(selector), value },
            rationale,
            () => this.page.locator(selector).fill(value),
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

    /** Append the current page as an observation pointing at a screenshot. */
    async recordObservation(screenshotPath: string): Promise<void> {
        const observation = await this.observe();
        await this.recorder.append({
            type: "observation",
            recordedAt: new Date().toISOString(),
            observation: { ...observation, screenshotPath },
        });
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
                    2_000,
                ),
            },
        };
    }
}

function roleTarget(role: string, name: string): TargetDescriptor {
    return {
        candidates: [{ kind: "role", role, name }],
        require: "exactly-one",
    };
}

function cssTarget(selector: string): TargetDescriptor {
    return { candidates: [{ kind: "css", selector }], require: "exactly-one" };
}

/** The first line of a thrown value's message, as a one-line run summary. */
function describeFailure(error: unknown): string {
    const [firstLine = ""] = describeError(error).split("\n", 1);
    return firstLine;
}

await runMain(main);
