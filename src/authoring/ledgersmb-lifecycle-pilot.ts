/**
 * Scripted capture pilot for the LedgerSMB inventory lifecycle, phase three and
 * the final phase of the four-phase LedgerSMB corpus.
 *
 * From the `catalog-ready` snapshot it posts a 30-unit vendor purchase, posts a
 * three-unit customer sale, records a physical count of 25 against 27 expected,
 * and approves the resulting two-unit shortage. Each step appends a redacted
 * action event with the rationale that held when it ran. Run it through
 * `npm run capture:ledgersmb:lifecycle`, which restores the snapshot first.
 *
 * INVARIANTS
 * - Every wait is on something the application owns, never a sleep.
 * - A disposable-password expiry notice can cover the first menu action, so it
 *   is dismissed explicitly after login.
 * - A route change can land before the client-rendered frame changes, leaving a
 *   control whose label the previous screen shares briefly present, so each
 *   stage waits for a marker unique to its destination screen.
 * - Picking an inventory item fills its description and price asynchronously,
 *   and reading them early submits an invalid price, so invoices wait for those
 *   field values. A fixed delay is rejected: it failed in the contiguous
 *   end-to-end run.
 * - The run finalizes `satisfied` once the approval clears, or `error` with a
 *   screenshot when any step throws. It creates no snapshot.
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
    const today = new Date().toISOString().slice(0, 10);
    const recorder = await FileRunRecorder.start({
        rootDirectory: join(process.cwd(), "runs"),
        goal: "Post a 30-unit purchase and three-unit sale, then record and approve a physical count of 25.",
        situation:
            "LedgerSMB catalog-ready with TRAIL-PACK-40 on hand at zero.",
        targetProfile: "ledgersmb",
        targetVersion: "1.13.7",
        fixtureId: "ledgersmb/catalog-ready",
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
        await createInvoice(
            pilot,
            "Accounts Payable",
            "Vendor Invoice",
            "BILL-2001",
            "30",
            "72.50",
            "2175.00",
        );
        await createInvoice(
            pilot,
            "Accounts Receivable",
            "Sales Invoice",
            "INV-1001",
            "3",
            "129.00",
            "387.00",
        );
        await enterPhysicalCount(pilot, today);
        await approvePhysicalCount(pilot);
        await pilot.saveScreenshot("inventory-lifecycle-complete.png");
        await pilot.finishSatisfied(
            "inventory-lifecycle-complete",
            "Posted the purchase and sale, then approved COUNT-001 with final on-hand quantity 25.",
        );
    } catch (error) {
        await pilot.finishWithError("inventory-lifecycle-failed", error);
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
        "Enter the catalog-ready company.",
    );
    await pilot.click(
        roleTarget("button", "Login"),
        "Authenticate to the catalog-ready company.",
        page.getByRole("button", { name: "Login", exact: true }),
    );
    await page.getByText("Welcome to LedgerSMB", { exact: true }).waitFor();
    const expiryNotice = page.getByRole("button", { name: "OK", exact: true });
    if (await expiryNotice.isVisible()) {
        await pilot.click(
            roleTarget("button", "OK"),
            "Dismiss the known password-expiry interstitial.",
            expiryNotice,
        );
    }
}

/** Enter, total, save, and post a one-line TRAIL-PACK-40 invoice. */
async function createInvoice(
    pilot: Pilot,
    menu: string,
    item: string,
    number: string,
    quantity: string,
    price: string,
    total: string,
): Promise<void> {
    const { page } = pilot;
    await openMenu(pilot, menu);
    await pilot.click(
        roleTarget("treeitem", item),
        `Open ${item}.`,
        page.getByRole("treeitem", { name: item, exact: true }),
    );
    await page
        .getByRole("textbox", { name: "Invoice Number", exact: true })
        .waitFor();
    await pilot.fillLocator(
        page.getByRole("textbox", { name: "Invoice Number", exact: true }),
        roleTarget("textbox", "Invoice Number"),
        number,
        "Set the invoice number.",
    );
    await pilot.fill(
        "#partnumber_1",
        "TRAIL-PACK-40",
        "Enter the inventory part number.",
    );
    await pilot.click(
        roleTarget("option", "TRAIL-PACK-40--Trail Pack 40L"),
        "Resolve the inventory part.",
        page.getByRole("option", {
            name: "TRAIL-PACK-40--Trail Pack 40L",
            exact: true,
        }),
    );
    await page.waitForFunction(
        () =>
            (document.querySelector<HTMLInputElement>("#description_1")
                ?.value ?? "") === "Trail Pack 40L" &&
            (document.querySelector<HTMLInputElement>("#sellprice_1")?.value ??
                "") !== "",
    );
    await pilot.fill("#qty_1", quantity, "Set the invoice quantity.");
    await pilot.fill("#sellprice_1", price, "Set the invoice unit price.");
    await pilot.click(
        roleTarget("button", "Update"),
        "Calculate the invoice total.",
        page.getByRole("button", { name: "Update", exact: true }).last(),
    );
    await page.getByText(total, { exact: true }).first().waitFor();
    await pilot.click(
        roleTarget("button", "Save"),
        "Save the invoice workflow.",
        page.getByRole("button", { name: "Save", exact: true }).last(),
    );
    await page
        .getByRole("button", { name: "Post", exact: true })
        .first()
        .waitFor();
    await pilot.click(
        roleTarget("button", "Post"),
        "Post the invoice.",
        page.getByRole("button", { name: "Post", exact: true }).first(),
    );
    await page.getByText("POSTED", { exact: true }).first().waitFor();
}

async function enterPhysicalCount(
    pilot: Pilot,
    countDate: string,
): Promise<void> {
    const { page } = pilot;
    await openMenu(pilot, "Goods & Services");
    await pilot.click(
        roleTarget("treeitem", "Enter Inventory"),
        "Open physical inventory entry.",
        page.getByRole("treeitem", { name: "Enter Inventory", exact: true }),
    );
    await page.getByText("Adjustment Details", { exact: true }).waitFor();
    await pilot.fillLocator(
        page.getByRole("textbox", { name: "Date", exact: true }),
        roleTarget("textbox", "Date"),
        countDate,
        "Set the accounting-effective count date explicitly.",
    );
    await pilot.fillLocator(
        page.getByRole("textbox", { name: "Source", exact: true }),
        roleTarget("textbox", "Source"),
        "COUNT-001",
        "Set the count reference.",
    );
    await pilot.click(
        roleTarget("button", "Continue"),
        "Open the count lines.",
        page.getByRole("button", { name: "Continue", exact: true }),
    );
    await pilot.fill(
        "input[name=partnumber_1]",
        "TRAIL-PACK-40",
        "Identify the counted part.",
    );
    await pilot.fill(
        "input[name=counted_1]",
        "25",
        "Enter the physical count.",
    );
    await pilot.click(
        roleTarget("button", "Next"),
        "Calculate expected quantity and variance.",
        page.getByRole("button", { name: "Next", exact: true }),
    );
    await page
        .locator("input[name=onhand_1][value='27']")
        .waitFor({ state: "attached" });
    await pilot.click(
        roleTarget("button", "Save"),
        "Save the physical inventory report.",
        page.getByRole("button", { name: "Save", exact: true }),
    );
}

async function approvePhysicalCount(pilot: Pilot): Promise<void> {
    const { page } = pilot;
    await openMenu(pilot, "Transaction Approval");
    await pilot.click(
        roleTarget("treeitem", "Inventory"),
        "Open pending inventory adjustments.",
        page.getByRole("treeitem", { name: "Inventory", exact: true }),
    );
    await page.getByText("Search Inventory Entry", { exact: true }).waitFor();
    await pilot.fillLocator(
        page.getByRole("textbox", { name: "Source", exact: true }),
        roleTarget("textbox", "Source"),
        "COUNT-001",
        "Filter the approval report to the count reference.",
    );
    await pilot.click(
        roleTarget("button", "Run Report"),
        "Run the pending inventory adjustment report.",
        page.getByRole("button", { name: "Run Report", exact: true }),
    );
    const countReport = page.getByRole("link", {
        name: "COUNT-001",
        exact: true,
    });
    await countReport.waitFor();
    await pilot.click(
        roleTarget("link", "COUNT-001"),
        "Open the pending count adjustment.",
        countReport,
    );
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    await approve.waitFor();
    await pilot.click(
        roleTarget("button", "Approve"),
        "Approve the observed two-unit shortage.",
        approve,
    );
    await approve.waitFor({ state: "hidden" });
}

/** Expand a menu tree item unless it is already expanded. */
async function openMenu(pilot: Pilot, name: string): Promise<void> {
    const item = pilot.page.getByRole("treeitem", { name, exact: true });
    if ((await item.getAttribute("aria-expanded")) !== "true") {
        await pilot.click(
            roleTarget("treeitem", name),
            `Open the ${name} menu.`,
            item,
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
