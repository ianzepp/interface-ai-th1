import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { chromium } from "playwright";

import { PlaywrightTestRunCapture } from "./playwright-run-capture.js";
import { FileTestRunRecorder } from "./run-recorder.js";
import type {
    ActionResult,
    Observation,
    SurfaceAction,
    TargetDescriptor,
} from "../surfaces/surface-driver.js";

const BASE_URL = "http://127.0.0.1:5762";
const DATABASE = "interface_ai";
const USERNAME = "admin";
const PASSWORD = "interface-ai-local";

const recorder = await FileTestRunRecorder.start({
    rootDirectory: join(process.cwd(), "runs"),
    goal: "Initialize a fresh LedgerSMB company and prove the first administrator can log in.",
    situation:
        "Fresh LedgerSMB Docker volumes with PostgreSQL available and no company database.",
    targetProfile: "ledgersmb",
    targetVersion: "1.13.7",
    fixtureId: "ledgersmb/fresh",
});

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "en-US" });
const page = await context.newPage();
const capture = await PlaywrightTestRunCapture.start(context.tracing, recorder);

try {
    await recordAction(
        { type: "navigate", url: `${BASE_URL}/setup.pl` },
        "Open the database setup surface on the allowlisted local origin.",
        () => page.goto(`${BASE_URL}/setup.pl`).then(() => undefined),
    );
    await page.locator("#s-user").waitFor();
    await recordFill(
        "#s-user",
        "postgres",
        "Enter the local database administrator.",
    );
    await recordFill(
        "#s-password",
        PASSWORD,
        "Enter the disposable local database password.",
    );
    await recordFill(
        "#database",
        DATABASE,
        "Name the fixture company database.",
    );
    await recordClick(
        roleTarget("button", "Create"),
        "Create the company database from the fresh PostgreSQL state.",
        () => page.getByRole("button", { name: "Create" }).click(),
    );

    await page.locator("input[name=coa_lc]").waitFor({ state: "attached" });
    await recordClick(
        roleTarget("option", "Argentina"),
        "Open the chart-of-accounts country list from its current selection.",
        () =>
            page
                .getByRole("option", { name: "Argentina", exact: true })
                .click(),
    );
    await recordClick(
        roleTarget("option", "United States"),
        "Select the United States chart family.",
        () =>
            page
                .getByRole("option", { name: "United States", exact: true })
                .click(),
    );
    await recordClick(
        roleTarget("button", "Next"),
        "Continue with the selected country.",
        () => page.getByRole("button", { name: "Next" }).click(),
    );

    await page.locator("input[name=chart]").waitFor({ state: "attached" });
    await recordClick(
        roleTarget("button", "Next"),
        "Accept the General chart of accounts selected by the application.",
        () => page.getByRole("button", { name: "Next" }).click(),
    );
    await page.locator("input[name=template_dir]").waitFor({
        state: "attached",
    });
    await recordClick(
        roleTarget("button", "Load Templates"),
        "Load the selected demo templates required by the fixture.",
        () => page.getByRole("button", { name: "Load Templates" }).click(),
    );

    await page.locator("#username").waitFor();
    await recordFill(
        "#username",
        USERNAME,
        "Set the initial application username.",
    );
    await recordFill(
        "#password",
        PASSWORD,
        "Set the disposable local application password.",
    );
    await recordFill(
        "#first-name",
        "Fixture",
        "Identify the synthetic administrator.",
    );
    await recordFill(
        "#last-name",
        "Administrator",
        "Identify the synthetic administrator.",
    );
    await recordFill(
        "#employeenumber",
        "EMP-001",
        "Set a stable employee identifier.",
    );
    await recordFill(
        "#dob",
        "1980-01-01",
        "Complete the required synthetic birth date.",
    );
    await recordFill(
        "#ssn",
        "000-00-0000",
        "Complete the required synthetic tax identifier.",
    );
    await selectCustomOption("Salutation", "Mr.");
    await selectCustomOption("Country", "United States");
    await selectCustomOption("Assign Permissions", "Full Permissions");
    await recordClick(
        roleTarget("button", "Create User"),
        "Create the initial administrator with full fixture permissions.",
        () => page.getByRole("button", { name: "Create User" }).click(),
    );

    await page
        .getByText("Database Operation Complete", { exact: true })
        .waitFor();
    await mkdir(join(recorder.directory, "screenshots"));
    await page.screenshot({
        path: join(recorder.directory, "screenshots", "setup-complete.png"),
        fullPage: true,
    });
    await recordObservation("screenshots/setup-complete.png");

    await recordAction(
        { type: "navigate", url: `${BASE_URL}/login.pl` },
        "Open the application login surface to verify the created user.",
        () => page.goto(`${BASE_URL}/login.pl`).then(() => undefined),
    );
    await recordFill(
        "#username",
        USERNAME,
        "Enter the fixture administrator username.",
    );
    await recordFill(
        "#password",
        PASSWORD,
        "Enter the disposable fixture password.",
    );
    await recordFill(
        "#company",
        DATABASE,
        "Select the initialized company database.",
    );
    await recordClick(
        cssTarget("form button"),
        "Authenticate with the newly created administrator.",
        () => page.locator("form").getByRole("button").click(),
    );

    await page.getByText("Welcome to LedgerSMB", { exact: true }).waitFor();
    const expiryAlert = page.getByRole("button", { name: "OK" });
    if (await expiryAlert.isVisible()) {
        await recordClick(
            roleTarget("button", "OK"),
            "Dismiss the expected disposable-password expiry notice.",
            () => expiryAlert.click(),
        );
    }
    await page.screenshot({
        path: join(recorder.directory, "screenshots", "authenticated.png"),
        fullPage: true,
    });
    await recordObservation("screenshots/authenticated.png");
    await recorder.append({
        type: "checkpoint",
        recordedAt: new Date().toISOString(),
        name: "authenticated-ledgersmb-home",
        satisfied: true,
    });
    await capture.finish({
        status: "satisfied",
        summary:
            "The company database and administrator were created, and the administrator reached the LedgerSMB home screen.",
        checkpoint: "authenticated-ledgersmb-home",
    });
} catch (error) {
    await mkdir(join(recorder.directory, "screenshots"), { recursive: true });
    await page
        .screenshot({
            path: join(recorder.directory, "screenshots", "error.png"),
            fullPage: true,
        })
        .catch(() => undefined);
    await capture.finish({
        status: "error",
        code: "initialize-company-failed",
        summary: conciseError(error),
    });
    throw error;
} finally {
    await context.close();
    await browser.close();
    console.log(`Run directory: ${recorder.directory}`);
}

async function recordFill(
    selector: string,
    value: string,
    rationale: string,
): Promise<void> {
    const action: SurfaceAction = {
        type: "fill",
        target: cssTarget(selector),
        value,
    };
    await recordAction(action, rationale, () =>
        page.locator(selector).fill(value),
    );
}

async function selectCustomOption(
    label: string,
    option: string,
): Promise<void> {
    await recordClick(
        roleTarget("listbox", label),
        `Open the ${label} selection.`,
        () => page.getByRole("listbox", { name: label }).click(),
    );
    await recordClick(
        roleTarget("option", option),
        `Select ${option} for ${label}.`,
        () => page.getByRole("option", { name: option, exact: true }).click(),
    );
}

async function recordClick(
    target: TargetDescriptor,
    rationale: string,
    execute: () => Promise<void>,
): Promise<void> {
    await recordAction({ type: "activate", target }, rationale, execute);
}

async function recordAction(
    action: SurfaceAction,
    rationale: string,
    execute: () => Promise<void>,
): Promise<void> {
    await execute();
    const result: ActionResult = {
        completed: true,
        observation: await observe(),
    };
    await recorder.append({
        type: "action",
        recordedAt: new Date().toISOString(),
        action,
        result,
        rationale,
    });
}

async function recordObservation(screenshotPath?: string): Promise<void> {
    const observation = await observe();
    if (screenshotPath !== undefined) {
        observation.screenshotPath = screenshotPath;
    }
    await recorder.append({
        type: "observation",
        recordedAt: new Date().toISOString(),
        observation,
    });
}

async function observe(): Promise<Observation> {
    return {
        url: page.url(),
        title: await page.title(),
        accessibility: {
            text: (await page.locator("body").innerText()).slice(0, 2_000),
        },
    };
}

function roleTarget(role: string, name: string): TargetDescriptor {
    return {
        candidates: [{ kind: "role", role, name }],
        require: "exactly-one",
    };
}

function cssTarget(selector: string): TargetDescriptor {
    return {
        candidates: [{ kind: "css", selector }],
        require: "exactly-one",
    };
}

function conciseError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.split("\n", 1)[0] ?? "Unknown initialization failure";
}
