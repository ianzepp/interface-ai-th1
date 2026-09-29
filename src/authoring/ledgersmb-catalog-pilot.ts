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

import { runMain } from "../common/cli.js";
import {
    type LedgerSmbPilot,
    roleTarget,
    runLedgerSmbPilot,
} from "./ledgersmb-pilot.js";

async function main(): Promise<void> {
    await runLedgerSmbPilot({
        goal: "Create the Main Warehouse and TRAIL-PACK-40 inventory catalog record.",
        situation:
            "LedgerSMB initialized with customer CUST-1001 and vendor VEND-2001, but no warehouse or parts.",
        fixtureId: "ledgersmb/partners-ready",
        authenticateTo: "interface_ai",
        errorCode: "create-inventory-catalog-failed",
        async steps(pilot) {
            await createWarehouse(pilot);
            await createPart(pilot);
            await pilot.saveScreenshot("catalog-ready.png");
            await pilot.finishSatisfied(
                "warehouse-and-part-visible",
                "Created Main Warehouse and visibly verified TRAIL-PACK-40 with its pricing and account mappings.",
            );
        },
    });
}

async function createWarehouse(pilot: LedgerSmbPilot): Promise<void> {
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

async function createPart(pilot: LedgerSmbPilot): Promise<void> {
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

await runMain(main);
