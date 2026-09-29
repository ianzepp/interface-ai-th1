/**
 * Scripted capture pilot for the LedgerSMB inventory catalog, phase two of the
 * four-phase LedgerSMB corpus.
 *
 * From the `partners-ready` snapshot it creates `Main Warehouse` and the
 * `TRAIL-PACK-40` inventory part with its pricing, unit, bin, reorder point,
 * and default account mappings. Each step appends a redacted action event with
 * the rationale that held when it ran. Run it through
 * `npm run capture:ledgersmb:catalog`, which restores the snapshot first.
 *
 * INVARIANTS
 * - `Add Part` opens from a menu tree, so the part-number field is waited for
 *   before the first fill.
 * - The save is verified by waiting for the part number to reappear as a field
 *   value, not by assuming the save action returned after the record existed.
 * - The run finalizes `satisfied` once the saved part is visible, or `error`
 *   with a screenshot when any step throws. It creates no snapshot.
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
        goal: "Create the Main Warehouse and TRAIL-PACK-40 inventory catalog record.",
        situation:
            "LedgerSMB initialized with customer CUST-1001 and vendor VEND-2001, but no warehouse or parts.",
        targetProfile: "ledgersmb",
        targetVersion: "1.13.7",
        fixtureId: "ledgersmb/partners-ready",
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
        await createWarehouse(pilot);
        await createPart(pilot);
        await pilot.saveScreenshot("catalog-ready.png");
        await pilot.finishSatisfied(
            "warehouse-and-part-visible",
            "Created Main Warehouse and visibly verified TRAIL-PACK-40 with its pricing and account mappings.",
        );
    } catch (error) {
        await pilot.finishWithError("create-inventory-catalog-failed", error);
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
        "Authenticate to the partner-ready company.",
        page.getByRole("button", { name: "Login", exact: true }),
    );
    await page.getByText("Welcome to LedgerSMB", { exact: true }).waitFor();
}

async function createWarehouse(pilot: Pilot): Promise<void> {
    const { page } = pilot;
    await pilot.click(
        roleTarget("treeitem", "Goods & Services"),
        "Open the Goods & Services menu.",
        page.getByRole("treeitem", { name: "Goods & Services", exact: true }),
    );
    await pilot.click(
        roleTarget("treeitem", "Warehouses"),
        "Open warehouse configuration.",
        page.getByRole("treeitem", { name: "Warehouses", exact: true }),
    );
    await page
        .getByRole("heading", { name: "Configure warehouses", exact: true })
        .waitFor();
    await pilot.fill(
        "input[name=description]",
        "Main Warehouse",
        "Name the fixture warehouse.",
    );
    await pilot.click(
        roleTarget("button", "Add"),
        "Create the warehouse.",
        page.getByRole("button", { name: "Add", exact: true }),
    );
    await page.locator("input[value='Main Warehouse']").waitFor();
}

async function createPart(pilot: Pilot): Promise<void> {
    const { page } = pilot;
    await pilot.click(
        roleTarget("treeitem", "Add Part"),
        "Open inventory part creation.",
        page.getByRole("treeitem", { name: "Add Part", exact: true }),
    );
    await page.locator("input[name=partnumber]").waitFor();
    await pilot.fill(
        "input[name=partnumber]",
        "TRAIL-PACK-40",
        "Set the stable part number.",
    );
    await pilot.fill(
        "input[name=description]",
        "Trail Pack 40L",
        "Describe the inventory part.",
    );
    await pilot.fill("input[name=sellprice]", "129.00", "Set the sell price.");
    await pilot.fill("input[name=listprice]", "149.00", "Set the list price.");
    await pilot.fill(
        "input[name=lastcost]",
        "72.50",
        "Set the initial last cost.",
    );
    await pilot.fill("input[name=unit]", "each", "Set the stocking unit.");
    await pilot.fill("input[name=rop]", "5", "Set the reorder point.");
    await pilot.fill("input[name=bin]", "A-01", "Set the warehouse bin.");
    await pilot.click(
        roleTarget("button", "Save"),
        "Create the inventory catalog record with the default mapped accounts.",
        page.getByRole("button", { name: "Save", exact: true }),
    );
    await page
        .locator("input[name=partnumber][value='TRAIL-PACK-40']")
        .waitFor();
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
