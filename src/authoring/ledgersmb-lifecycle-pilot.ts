import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { chromium, type Locator } from "playwright";

import type {
    ActionResult,
    SurfaceAction,
    TargetDescriptor,
} from "../surfaces/surface-driver.js";
import { PlaywrightTestRunCapture } from "./playwright-run-capture.js";
import { FileTestRunRecorder } from "./run-recorder.js";

const BASE_URL = "http://127.0.0.1:5762";
const TODAY = new Date().toISOString().slice(0, 10);
const recorder = await FileTestRunRecorder.start({
    rootDirectory: join(process.cwd(), "runs"),
    goal: "Post a 30-unit purchase and three-unit sale, then record and approve a physical count of 25.",
    situation: "LedgerSMB catalog-ready with TRAIL-PACK-40 on hand at zero.",
    targetProfile: "ledgersmb",
    targetVersion: "1.13.7",
    fixtureId: "ledgersmb/catalog-ready",
});
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "en-US" });
const page = await context.newPage();
const capture = await PlaywrightTestRunCapture.start(context.tracing, recorder);

try {
    await navigate(`${BASE_URL}/login.pl`, "Open the LedgerSMB login surface.");
    await fill("#username", "admin", "Enter the fixture administrator.");
    await fill(
        "#password",
        "interface-ai-local",
        "Enter the fixture password.",
    );
    await fill("#company", "interface_ai", "Enter the catalog-ready company.");
    await click(
        roleTarget("button", "Login"),
        "Authenticate to the catalog-ready company.",
        page.getByRole("button", { name: "Login", exact: true }),
    );
    await page.getByText("Welcome to LedgerSMB", { exact: true }).waitFor();
    const passwordNotice = page.getByRole("button", {
        name: "OK",
        exact: true,
    });
    if (await passwordNotice.isVisible())
        await click(
            roleTarget("button", "OK"),
            "Dismiss the known password-expiry interstitial.",
            passwordNotice,
        );

    await createInvoice(
        "Accounts Payable",
        "Vendor Invoice",
        "BILL-2001",
        "30",
        "72.50",
        "2175.00",
    );
    await createInvoice(
        "Accounts Receivable",
        "Sales Invoice",
        "INV-1001",
        "3",
        "129.00",
        "387.00",
    );

    await openMenu("Goods & Services");
    await click(
        roleTarget("treeitem", "Enter Inventory"),
        "Open physical inventory entry.",
        page.getByRole("treeitem", { name: "Enter Inventory", exact: true }),
    );
    await page.getByText("Adjustment Details", { exact: true }).waitFor();
    await fillLocator(
        page.getByRole("textbox", { name: "Date", exact: true }),
        roleTarget("textbox", "Date"),
        TODAY,
        "Set the accounting-effective count date explicitly.",
    );
    await fillLocator(
        page.getByRole("textbox", { name: "Source", exact: true }),
        roleTarget("textbox", "Source"),
        "COUNT-001",
        "Set the count reference.",
    );
    await click(
        roleTarget("button", "Continue"),
        "Open the count lines.",
        page.getByRole("button", { name: "Continue", exact: true }),
    );
    await fill(
        "input[name=partnumber_1]",
        "TRAIL-PACK-40",
        "Identify the counted part.",
    );
    await fill("input[name=counted_1]", "25", "Enter the physical count.");
    await click(
        roleTarget("button", "Next"),
        "Calculate expected quantity and variance.",
        page.getByRole("button", { name: "Next", exact: true }),
    );
    await page
        .locator("input[name=onhand_1][value='27']")
        .waitFor({ state: "attached" });
    await click(
        roleTarget("button", "Save"),
        "Save the physical inventory report.",
        page.getByRole("button", { name: "Save", exact: true }),
    );

    await openMenu("Transaction Approval");
    await click(
        roleTarget("treeitem", "Inventory"),
        "Open pending inventory adjustments.",
        page.getByRole("treeitem", { name: "Inventory", exact: true }),
    );
    await page.getByText("Search Inventory Entry", { exact: true }).waitFor();
    await fillLocator(
        page.getByRole("textbox", { name: "Source", exact: true }),
        roleTarget("textbox", "Source"),
        "COUNT-001",
        "Filter the approval report to the count reference.",
    );
    await click(
        roleTarget("button", "Run Report"),
        "Run the pending inventory adjustment report.",
        page.getByRole("button", { name: "Run Report", exact: true }),
    );
    const countReport = page.getByRole("link", {
        name: "COUNT-001",
        exact: true,
    });
    await countReport.waitFor();
    await click(
        roleTarget("link", "COUNT-001"),
        "Open the pending count adjustment.",
        countReport,
    );
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    await approve.waitFor();
    await click(
        roleTarget("button", "Approve"),
        "Approve the observed two-unit shortage.",
        approve,
    );
    await approve.waitFor({ state: "hidden" });

    await mkdir(join(recorder.directory, "screenshots"), { recursive: true });
    await page.screenshot({
        path: join(
            recorder.directory,
            "screenshots",
            "inventory-lifecycle-complete.png",
        ),
        fullPage: true,
    });
    await recorder.append({
        type: "checkpoint",
        recordedAt: new Date().toISOString(),
        name: "inventory-lifecycle-complete",
        satisfied: true,
    });
    await capture.finish({
        status: "satisfied",
        summary:
            "Posted the purchase and sale, then approved COUNT-001 with final on-hand quantity 25.",
        checkpoint: "inventory-lifecycle-complete",
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
        code: "inventory-lifecycle-failed",
        summary: conciseError(error),
    });
    throw error;
} finally {
    await context.close();
    await browser.close();
    console.log(`Run directory: ${recorder.directory}`);
}

async function createInvoice(
    menu: string,
    item: string,
    number: string,
    quantity: string,
    price: string,
    total: string,
): Promise<void> {
    await openMenu(menu);
    await click(
        roleTarget("treeitem", item),
        `Open ${item}.`,
        page.getByRole("treeitem", { name: item, exact: true }),
    );
    await page
        .getByRole("textbox", { name: "Invoice Number", exact: true })
        .waitFor();
    await fillLocator(
        page.getByRole("textbox", { name: "Invoice Number", exact: true }),
        roleTarget("textbox", "Invoice Number"),
        number,
        "Set the invoice number.",
    );
    await fill(
        "#partnumber_1",
        "TRAIL-PACK-40",
        "Enter the inventory part number.",
    );
    await click(
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
    await fill("#qty_1", quantity, "Set the invoice quantity.");
    await fill("#sellprice_1", price, "Set the invoice unit price.");
    await click(
        roleTarget("button", "Update"),
        "Calculate the invoice total.",
        page.getByRole("button", { name: "Update", exact: true }).last(),
    );
    await page.getByText(total, { exact: true }).first().waitFor();
    await click(
        roleTarget("button", "Save"),
        "Save the invoice workflow.",
        page.getByRole("button", { name: "Save", exact: true }).last(),
    );
    await page
        .getByRole("button", { name: "Post", exact: true })
        .first()
        .waitFor();
    await click(
        roleTarget("button", "Post"),
        "Post the invoice.",
        page.getByRole("button", { name: "Post", exact: true }).first(),
    );
    await page.getByText("POSTED", { exact: true }).first().waitFor();
}

async function openMenu(name: string): Promise<void> {
    const item = page.getByRole("treeitem", { name, exact: true });
    if ((await item.getAttribute("aria-expanded")) !== "true")
        await click(
            roleTarget("treeitem", name),
            `Open the ${name} menu.`,
            item,
        );
}
async function navigate(url: string, rationale: string): Promise<void> {
    await record({ type: "navigate", url }, rationale, () =>
        page.goto(url).then(() => undefined),
    );
}
async function fill(
    selector: string,
    value: string,
    rationale: string,
): Promise<void> {
    await fillLocator(
        page.locator(selector),
        cssTarget(selector),
        value,
        rationale,
    );
}
async function fillLocator(
    locator: Locator,
    target: TargetDescriptor,
    value: string,
    rationale: string,
): Promise<void> {
    await record({ type: "fill", target, value }, rationale, () =>
        locator.fill(value),
    );
}
async function click(
    target: TargetDescriptor,
    rationale: string,
    locator: Locator,
): Promise<void> {
    await record({ type: "activate", target }, rationale, () =>
        locator.click(),
    );
}
async function record(
    action: SurfaceAction,
    rationale: string,
    execute: () => Promise<void>,
): Promise<void> {
    await execute();
    const result: ActionResult = {
        completed: true,
        observation: {
            url: page.url(),
            title: await page.title(),
            accessibility: {
                text: (await page.locator("body").innerText()).slice(0, 2_000),
            },
        },
    };
    await recorder.append({
        type: "action",
        recordedAt: new Date().toISOString(),
        action,
        result,
        rationale,
    });
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
function conciseError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.split("\n", 1)[0] ?? "Unknown lifecycle failure";
}
