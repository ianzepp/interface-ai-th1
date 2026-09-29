/**
 * Scripted capture pilot for LedgerSMB trading-partner creation, phase one of
 * the four-phase LedgerSMB corpus.
 *
 * From the `initialized-company` snapshot it creates the synthetic customer and
 * vendor, each with the credit account the later inventory phases depend on.
 * Each step appends a redacted action event with the rationale that held when
 * it ran. Run it through `npm run capture:ledgersmb:partners`, which restores
 * the snapshot first.
 *
 * INVARIANTS
 * - The run finalizes `satisfied` once both account numbers are visible, or
 *   `error` with a screenshot when any step throws.
 * - It leaves the created partners in the live fixture and creates no snapshot.
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
const policy = new ArtifactPolicy({
    allowedOrigins: [BASE_URL],
    allowedActionTypes: ["navigate", "activate", "fill", "select", "press"],
    riskyActionMode: "block",
});

async function main(): Promise<void> {
    const password = requireEnv("LEDGERSMB_FIXTURE_PASSWORD");
    const recorder = await FileRunRecorder.start({
        rootDirectory: join(process.cwd(), "runs"),
        goal: "Create the synthetic customer and vendor accounts required by the LedgerSMB inventory scenarios.",
        situation:
            "LedgerSMB initialized with the fixture administrator and no trading partners.",
        targetProfile: "ledgersmb",
        targetVersion: "1.13.7",
        fixtureId: "ledgersmb/initialized-company",
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
        await logIn(pilot, password);
        await createTradingPartner(
            pilot,
            "Northwind Outdoor Supply",
            "CUST-1001",
            "Customer",
            "Northwind customer account",
        );
        await createTradingPartner(
            pilot,
            "Summit Gear Manufacturing",
            "VEND-2001",
            "Vendor",
            "Summit vendor account",
        );
        await pilot.saveScreenshot("partners-ready.png");
        await pilot.finishSatisfied(
            "customer-and-vendor-accounts-visible",
            "Created and visibly verified customer CUST-1001 and vendor VEND-2001.",
        );
    } catch (error) {
        await pilot.finishWithError("create-trading-partners-failed", error);
        throw error;
    } finally {
        await context.close();
        await browser.close();
        print(`Run directory: ${recorder.directory}`);
    }
}

async function logIn(pilot: Pilot, password: string): Promise<void> {
    const { page } = pilot;
    await pilot.navigate(
        `${BASE_URL}/login.pl`,
        "Open the LedgerSMB login surface.",
    );
    await pilot.fill("#username", "admin", "Enter the fixture administrator.");
    await pilot.fill("#password", password, "Enter the fixture password.");
    await pilot.fill(
        "#company",
        "interface_ai",
        "Enter the initialized company.",
    );
    await pilot.click(
        roleTarget("button", "Login"),
        "Authenticate to the initialized company.",
        page.getByRole("button", { name: "Login", exact: true }),
    );
    await page.getByText("Welcome to LedgerSMB", { exact: true }).waitFor();
    const expiryNotice = page.getByRole("button", { name: "OK", exact: true });
    if (await expiryNotice.isVisible()) {
        await pilot.click(
            roleTarget("button", "OK"),
            "Dismiss the password notice.",
            expiryNotice,
        );
    }
}

/** Create one company entity and the customer or vendor credit account on it. */
async function createTradingPartner(
    pilot: Pilot,
    name: string,
    number: string,
    accountClass: "Customer" | "Vendor",
    description: string,
): Promise<void> {
    const { page } = pilot;
    const kind = accountClass.toLowerCase();
    const contacts = page.getByRole("treeitem", {
        name: "Contacts",
        exact: true,
    });
    if ((await contacts.getAttribute("aria-expanded")) !== "true") {
        await pilot.click(
            roleTarget("treeitem", "Contacts"),
            "Open the Contacts menu.",
            contacts,
        );
    }
    await pilot.click(
        roleTarget("treeitem", "Add Entity"),
        "Open the company creation form.",
        page.getByRole("treeitem", { name: "Add Entity", exact: true }),
    );
    await page.getByRole("textbox", { name: "Name", exact: true }).waitFor();
    await pilot.fillLocator(
        page.getByRole("textbox", { name: "Name", exact: true }),
        roleTarget("textbox", "Name"),
        name,
        `Enter the ${kind} company name.`,
    );
    await chooseOption(pilot, "Country", "United States");
    await pilot.click(
        roleTarget("button", "Generate Control Code"),
        "Generate a stable application-owned control code.",
        page.getByRole("button", {
            name: "Generate Control Code",
            exact: true,
        }),
    );
    await pilot.click(
        roleTarget("button", "Save"),
        "Save the company identity.",
        page.getByRole("button", { name: "Save", exact: true }),
    );

    await page
        .getByRole("tab", { name: "Credit Accounts", exact: true })
        .waitFor();
    if (accountClass === "Vendor") {
        await chooseOption(pilot, "Class", "Vendor");
    }
    await pilot.fillLocator(
        page.getByRole("textbox", { name: "Number", exact: true }),
        roleTarget("textbox", "Number"),
        number,
        `Enter the ${kind} account number.`,
    );
    await pilot.fillLocator(
        page.getByRole("textbox", { name: "Description", exact: true }),
        roleTarget("textbox", "Description"),
        description,
        `Describe the ${kind} account.`,
    );
    await pilot.click(
        roleTarget("button", "Save New"),
        `Create the ${kind} credit account.`,
        page.getByRole("button", { name: "Save New", exact: true }),
    );
    await page.getByRole("link", { name: number, exact: true }).waitFor();
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
        `Open the ${label} list.`,
        page.getByRole("listbox", { name: label, exact: true }),
    );
    await pilot.click(
        roleTarget("option", option),
        `Choose ${option} for ${label}.`,
        page.getByRole("option", { name: option, exact: true }),
    );
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
        await this.fillLocator(
            this.page.locator(selector),
            cssTarget(selector),
            value,
            rationale,
        );
    }

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
