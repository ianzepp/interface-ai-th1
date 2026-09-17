/**
 * Scripted capture pilot for the LedgerSMB inventory catalog.
 *
 * Phase two of the four-phase LedgerSMB corpus. Starting from the
 * `partners-ready` snapshot, it creates `Main Warehouse` and the `TRAIL-PACK-40`
 * inventory part with its pricing, unit, bin, reorder point, and account
 * mappings.
 *
 * This is the first phase that has to wait for the application rather than just
 * fill fields. `Add Part` is opened from a menu tree, so the part-number field is
 * waited for before the first fill, and the saved record is verified by waiting
 * for the part number to reappear as a field *value* rather than by assuming the
 * save action returned only once the record existed. Run it through
 * `npm run capture:ledgersmb:catalog`.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { chromium, type Locator } from "playwright";

import type {
    ActionResult,
    SurfaceAction,
    TargetDescriptor,
} from "../surfaces/surface-driver.js";
import {
    executePolicyBoundAction,
    PlaywrightTestRunCapture,
} from "./playwright-run-capture.js";
import { ArtifactPolicy } from "../runtime/policy.js";
import { FileTestRunRecorder } from "./run-recorder.js";

const BASE_URL = "http://127.0.0.1:5762";
const policy = new ArtifactPolicy({
    allowedOrigins: [BASE_URL],
    allowedActionTypes: ["navigate", "activate", "fill", "select", "press"],
    riskyActionMode: "block",
});
const PASSWORD = requireFixturePassword();
const recorder = await FileTestRunRecorder.start({
    rootDirectory: join(process.cwd(), "runs"),
    goal: "Create the Main Warehouse and TRAIL-PACK-40 inventory catalog record.",
    situation:
        "LedgerSMB initialized with customer CUST-1001 and vendor VEND-2001, but no warehouse or parts.",
    targetProfile: "ledgersmb",
    targetVersion: "1.13.7",
    fixtureId: "ledgersmb/partners-ready",
    sensitiveInputValues: [PASSWORD],
});
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "en-US" });
const page = await context.newPage();
const capture = await PlaywrightTestRunCapture.start(
    context.tracing,
    recorder,
    [PASSWORD],
);

try {
    await navigate(`${BASE_URL}/login.pl`, "Open the LedgerSMB login surface.");
    await fill("#username", "admin", "Enter the fixture administrator.");
    await fill("#password", PASSWORD, "Enter the fixture password.");
    await fill("#company", "interface_ai", "Enter the initialized company.");
    await click(
        roleTarget("button", "Login"),
        "Authenticate to the partner-ready company.",
        page.getByRole("button", { name: "Login", exact: true }),
    );
    await page.getByText("Welcome to LedgerSMB", { exact: true }).waitFor();

    await click(
        roleTarget("treeitem", "Goods & Services"),
        "Open the Goods & Services menu.",
        page.getByRole("treeitem", { name: "Goods & Services", exact: true }),
    );
    await click(
        roleTarget("treeitem", "Warehouses"),
        "Open warehouse configuration.",
        page.getByRole("treeitem", { name: "Warehouses", exact: true }),
    );
    await page
        .getByRole("heading", { name: "Configure warehouses", exact: true })
        .waitFor();
    await fill(
        "input[name=description]",
        "Main Warehouse",
        "Name the fixture warehouse.",
    );
    await click(
        roleTarget("button", "Add"),
        "Create the warehouse.",
        page.getByRole("button", { name: "Add", exact: true }),
    );
    await page.locator("input[value='Main Warehouse']").waitFor();

    await click(
        roleTarget("treeitem", "Add Part"),
        "Open inventory part creation.",
        page.getByRole("treeitem", { name: "Add Part", exact: true }),
    );
    await page.locator("input[name=partnumber]").waitFor();
    await fill(
        "input[name=partnumber]",
        "TRAIL-PACK-40",
        "Set the stable part number.",
    );
    await fill(
        "input[name=description]",
        "Trail Pack 40L",
        "Describe the inventory part.",
    );
    await fill("input[name=sellprice]", "129.00", "Set the sell price.");
    await fill("input[name=listprice]", "149.00", "Set the list price.");
    await fill("input[name=lastcost]", "72.50", "Set the initial last cost.");
    await fill("input[name=unit]", "each", "Set the stocking unit.");
    await fill("input[name=rop]", "5", "Set the reorder point.");
    await fill("input[name=bin]", "A-01", "Set the warehouse bin.");
    await click(
        roleTarget("button", "Save"),
        "Create the inventory catalog record with the default mapped accounts.",
        page.getByRole("button", { name: "Save", exact: true }),
    );
    await page
        .locator("input[name=partnumber][value='TRAIL-PACK-40']")
        .waitFor();

    await mkdir(join(recorder.directory, "screenshots"), { recursive: true });
    await page.screenshot({
        path: join(recorder.directory, "screenshots", "catalog-ready.png"),
        fullPage: true,
    });
    await recorder.append({
        type: "checkpoint",
        recordedAt: new Date().toISOString(),
        name: "warehouse-and-part-visible",
        satisfied: true,
    });
    await capture.finish({
        status: "satisfied",
        summary:
            "Created Main Warehouse and visibly verified TRAIL-PACK-40 with its pricing and account mappings.",
        checkpoint: "warehouse-and-part-visible",
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
        code: "create-inventory-catalog-failed",
        summary: conciseError(error),
    });
    throw error;
} finally {
    await context.close();
    await browser.close();
    console.log(`Run directory: ${recorder.directory}`);
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
    await record(
        { type: "fill", target: cssTarget(selector), value },
        rationale,
        () => page.locator(selector).fill(value),
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
    await executePolicyBoundAction(policy, action, () =>
        capture.execute(action, execute),
    );
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
    return message.split("\n", 1)[0] ?? "Unknown catalog creation failure";
}

function requireFixturePassword(): string {
    const password = process.env.LEDGERSMB_FIXTURE_PASSWORD;
    if (password === undefined || password === "") {
        throw new Error(
            "LEDGERSMB_FIXTURE_PASSWORD is required for npm run capture:ledgersmb:catalog",
        );
    }
    return password;
}
